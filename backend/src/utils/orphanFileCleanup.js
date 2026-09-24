const fs = require("fs");
const path = require("path");
const Message = require("../models/Message");

/**
 * SAFE ORPHAN FILE CLEANUP & RECONCILIATION
 * ==========================================
 *
 * Reconciles files stored under a private upload root (voice recordings or
 * regular direct-chat file attachments) with MongoDB `Message` records.
 *
 * Both `uploadDirectVoice` and `uploadDirectFile` are two-phase endpoints:
 * the file is written to disk first and only becomes "real" once a
 * follow-up `sendDirectMessage`/voice-message call persists a Message
 * document that references its URL. If the client abandons that second
 * step (navigation away, crash, network failure, cancelled send), the file
 * is left on disk with nothing pointing at it — an orphan. This module is
 * what reconciles and removes those orphans; see `startOrphanCleanupScheduler`
 * below for how it is actually invoked (previously this file existed but was
 * never wired into anything — see FINAL_PRODUCTION_AUDIT_REPORT.md).
 *
 * Safety guarantees:
 * 1. Only touches files older than `olderThanMs` (default: 1 hour) to ensure
 *    active in-flight recordings or messages currently being uploaded/sent
 *    are never deleted.
 * 2. Explicitly queries MongoDB to verify whether ANY Message document
 *    references the file URL before unlinking.
 * 3. Never deletes legitimate messages or attachments.
 * 4. Cleans up empty conversation directories once orphaned files are removed.
 * 5. Path is always resolved from a fixed root — filenames read from disk are
 *    never concatenated with user input, so there is no traversal surface.
 */
async function cleanupOrphanFilesInRoot(uploadRoot, { olderThanMs = 60 * 60 * 1000 } = {}) {
  if (!fs.existsSync(uploadRoot)) {
    return { scanned: 0, removed: 0, errors: [] };
  }

  const now = Date.now();
  let scanned = 0;
  let removed = 0;
  const errors = [];

  try {
    const conversationDirs = await fs.promises.readdir(uploadRoot, { withFileTypes: true });

    for (const dirent of conversationDirs) {
      if (!dirent.isDirectory()) continue;
      const conversationDir = path.join(uploadRoot, dirent.name);
      let files = [];
      try {
        files = await fs.promises.readdir(conversationDir);
      } catch (err) {
        errors.push(`Failed to read dir ${dirent.name}: ${err.message}`);
        continue;
      }

      for (const filename of files) {
        const filePath = path.join(conversationDir, filename);
        try {
          const stat = await fs.promises.stat(filePath);
          if (!stat.isFile()) continue;

          scanned++;
          const ageMs = now - stat.mtimeMs;
          if (ageMs < olderThanMs) {
            // Still fresh — may be part of an in-flight upload/message send
            continue;
          }

          // Check if any Message attachment references this filename
          const referenced = await Message.exists({
            "attachments.url": { $regex: filename },
          });

          if (!referenced) {
            await fs.promises.unlink(filePath);
            removed++;
          }
        } catch (err) {
          errors.push(`Failed processing ${filename}: ${err.message}`);
        }
      }

      // If directory is now empty, remove it
      try {
        const remaining = await fs.promises.readdir(conversationDir);
        if (remaining.length === 0) {
          await fs.promises.rmdir(conversationDir);
        }
      } catch {
        /* ignore directory cleanup errors */
      }
    }
  } catch (err) {
    errors.push(`Root scan error: ${err.message}`);
  }

  return { scanned, removed, errors };
}

/** Voice recordings: uploads-voice/private/<conversationKey>/voice-*.<ext> */
async function cleanupOrphanVoiceFiles(opts = {}) {
  const baseVoiceDir = process.env.VOICE_UPLOAD_DIR || "uploads-voice";
  // Mirrors chatController.streamDirectVoice's own root resolution exactly,
  // so an absolute VOICE_UPLOAD_DIR (common in containerized deployments) is
  // honored the same way here as it is at upload/stream time.
  const uploadRoot = path.isAbsolute(baseVoiceDir)
    ? path.join(baseVoiceDir, "private")
    : path.join(__dirname, "..", "..", baseVoiceDir, "private");
  return cleanupOrphanFilesInRoot(uploadRoot, opts);
}

/** Regular direct-chat file attachments: uploads/private/<conversationKey>/* */
async function cleanupOrphanPrivateFiles(opts = {}) {
  const baseUploadDir = process.env.UPLOAD_DIR || "uploads";
  const uploadRoot = path.isAbsolute(baseUploadDir)
    ? path.join(baseUploadDir, "private")
    : path.join(__dirname, "..", "..", baseUploadDir, "private");
  return cleanupOrphanFilesInRoot(uploadRoot, opts);
}

let timer = null;
let initialTimeout = null;

/**
 * Runs both cleanups once, logging a concise summary. Never throws — a
 * failure here must never crash the server or affect any other scheduler
 * (same isolation pattern as deadlineService's runOnce).
 */
async function runOrphanCleanupOnce() {
  const results = { voice: null, files: null };
  try {
    results.voice = await cleanupOrphanVoiceFiles();
  } catch (err) {
    results.voice = { scanned: 0, removed: 0, errors: [err.message] };
  }
  try {
    results.files = await cleanupOrphanPrivateFiles();
  } catch (err) {
    results.files = { scanned: 0, removed: 0, errors: [err.message] };
  }
  const removed = (results.voice?.removed || 0) + (results.files?.removed || 0);
  if (removed > 0 || results.voice?.errors?.length || results.files?.errors?.length) {
    // eslint-disable-next-line no-console
    console.log(
      `[orphanCleanup] voice: scanned=${results.voice?.scanned || 0} removed=${results.voice?.removed || 0} | ` +
        `files: scanned=${results.files?.scanned || 0} removed=${results.files?.removed || 0}`
    );
  }
  return results;
}

/**
 * Starts the periodic orphan-file reconciliation job. Idempotent (calling
 * twice does not double-schedule). First pass runs shortly after boot (well
 * after any request that started mid-upload at process start would have
 * finished), then on a fixed interval — mirrors startDeadlineScheduler's
 * pattern in services/deadlineService.js.
 */
function startOrphanCleanupScheduler() {
  if (timer) return timer;
  const minutes = Number(process.env.ORPHAN_CLEANUP_SCAN_MINUTES || 60);
  // eslint-disable-next-line no-console
  console.log(`[orphanCleanup] scheduler active — scanning every ${minutes} minute(s)`);
  // .unref() lets these timers never hold the Node process (or a test
  // runner) open by themselves — matches how the rest of the app avoids
  // leaking handles that would block a clean shutdown/exit.
  initialTimeout = setTimeout(runOrphanCleanupOnce, 30_000);
  initialTimeout.unref?.();
  timer = setInterval(runOrphanCleanupOnce, minutes * 60 * 1000);
  timer.unref?.();
  return timer;
}

function stopOrphanCleanupScheduler() {
  if (timer) clearInterval(timer);
  if (initialTimeout) clearTimeout(initialTimeout);
  timer = null;
  initialTimeout = null;
}

module.exports = {
  cleanupOrphanVoiceFiles,
  cleanupOrphanPrivateFiles,
  runOrphanCleanupOnce,
  startOrphanCleanupScheduler,
  stopOrphanCleanupScheduler,
};
