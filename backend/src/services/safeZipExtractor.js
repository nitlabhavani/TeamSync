/**
 * Safe ZIP extraction for untrusted student uploads (Step 9).
 *
 * Threats mitigated here:
 *   - Zip Slip / path traversal    (entry names containing "..", absolute
 *                                    paths, or resolving outside the target
 *                                    directory are rejected)
 *   - Zip bombs / huge extraction   (limits on entry count, per-entry size
 *                                    and total uncompressed size, checked
 *                                    against the archive's own metadata
 *                                    BEFORE any bytes are written)
 *   - Nested archives                (zip-inside-zip entries are skipped,
 *                                    never auto-extracted)
 *   - Executable / secret exposure  (extension/name denylist; .env & secret
 *                                    files are recorded as "present" for
 *                                    detection purposes but their contents
 *                                    are never read or forwarded anywhere)
 *
 * Nothing here ever executes extracted code — this only reads bytes and
 * writes them into an isolated temp directory that the caller is
 * responsible for deleting (see cleanup()).
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const AdmZip = require("adm-zip");

// Directories whose contents are irrelevant to a static code review and can
// blow up an ordinary project by 100-1000x (node_modules, venvs, build
// output, VCS metadata, caches).
const IGNORED_DIR_NAMES = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "__pycache__",
  ".venv",
  "venv",
  ".next",
  ".cache",
  "coverage",
  ".pytest_cache",
  ".idea",
  ".vscode",
]);

// Filenames that must never be read/forwarded, even though we note that they
// exist (useful for e.g. "your .env was excluded from analysis" messaging).
const SECRET_FILE_RE = /^(\.env(\..*)?|.*\.pem|.*\.key|.*secret.*|.*credentials.*)$/i;

// Extensions that are either binary (no static-review value) or executable
// (never analysed, never written with exec bits, never run).
const EXECUTABLE_OR_BINARY_EXT = new Set([
  ".exe", ".dll", ".so", ".dylib", ".bin", ".sh", ".bat", ".cmd", ".msi",
  ".jar", ".class", ".apk", ".app",
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".bmp",
  ".mp4", ".mov", ".mp3", ".wav", ".zip", ".rar", ".7z", ".tar", ".gz",
  ".pdf", ".woff", ".woff2", ".ttf", ".eot",
]);

const LIMITS = {
  maxEntries: 8000,
  maxTotalUncompressedBytes: 300 * 1024 * 1024, // 300MB safety ceiling
  maxSingleEntryBytes: 25 * 1024 * 1024, // 25MB — a single source file this large is not source code
};

function isDangerousDirSegment(seg) {
  return IGNORED_DIR_NAMES.has(seg) || IGNORED_DIR_NAMES.has(seg.toLowerCase());
}

/**
 * Normalises a zip entry name and rejects anything that could escape the
 * extraction root. Returns null for entries that must be skipped.
 */
function resolveSafeEntryPath(extractRoot, rawName) {
  const normalized = rawName.replace(/\\/g, "/");
  if (!normalized || normalized.startsWith("/") || /^[a-zA-Z]:/.test(normalized)) return null; // absolute path
  if (normalized.split("/").includes("..")) return null; // traversal attempt

  const resolved = path.resolve(extractRoot, normalized);
  const relative = path.relative(extractRoot, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return null; // escapes the temp dir (zip slip)
  return { normalized, resolved };
}

/**
 * Extracts a ZIP into a fresh, isolated temp directory with all the
 * protections described above. Returns a manifest of what was kept
 * (safeFiles) and what was filtered out (ignored/dangerous/secret), plus a
 * cleanup() function the caller MUST call when done (success or failure).
 */
function safeExtractZip(zipFilePath) {
  const extractRoot = fs.mkdtempSync(path.join(os.tmpdir(), "teamsync-submission-"));
  const cleanup = () => {
    try {
      fs.rmSync(extractRoot, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  };

  try {
    const stat = fs.statSync(zipFilePath);
    if (!stat.isFile()) throw Object.assign(new Error("Uploaded file is not readable"), { code: "INVALID_ZIP" });

    let zip;
    try {
      zip = new AdmZip(zipFilePath);
    } catch {
      throw Object.assign(new Error("The uploaded file is not a valid ZIP archive"), { code: "INVALID_ZIP" });
    }

    const entries = zip.getEntries();
    if (entries.length > LIMITS.maxEntries) {
      throw Object.assign(
        new Error(`ZIP contains too many entries (${entries.length}); refusing to extract`),
        { code: "ZIP_TOO_LARGE" }
      );
    }

    // Pre-flight the declared uncompressed size across every entry BEFORE
    // writing anything — this is what actually stops a zip bomb (a tiny
    // compressed file that claims to expand to gigabytes).
    const declaredTotal = entries.reduce((sum, e) => sum + (e.header?.size || 0), 0);
    if (declaredTotal > LIMITS.maxTotalUncompressedBytes) {
      throw Object.assign(
        new Error("ZIP's uncompressed size exceeds the safe extraction limit"),
        { code: "ZIP_TOO_LARGE" }
      );
    }

    const safeFiles = []; // { relPath, absPath, size, ext }
    const ignoredPaths = []; // dangerous dirs / binaries / nested archives, by name only
    const secretFiles = []; // names only — never read, never forwarded
    let extractedBytes = 0;

    for (const entry of entries) {
      const rawName = entry.entryName;
      const segments = rawName.replace(/\\/g, "/").split("/").filter(Boolean);

      if (entry.isDirectory) continue;

      // Zip-slip guard — do this before anything else touches the filesystem.
      const safePath = resolveSafeEntryPath(extractRoot, rawName);
      if (!safePath) {
        ignoredPaths.push({ path: rawName, reason: "unsafe_path" });
        continue;
      }

      // Skip anything under a dangerous/irrelevant directory.
      if (segments.slice(0, -1).some(isDangerousDirSegment)) {
        ignoredPaths.push({ path: rawName, reason: "ignored_directory" });
        continue;
      }

      const baseName = segments[segments.length - 1];
      const ext = path.extname(baseName).toLowerCase();

      // Nested archives are never auto-extracted (nested-zip abuse).
      if ([".zip", ".rar", ".7z", ".tar", ".gz"].includes(ext)) {
        ignoredPaths.push({ path: rawName, reason: "nested_archive" });
        continue;
      }

      if (SECRET_FILE_RE.test(baseName)) {
        secretFiles.push(rawName);
        continue; // never write, never read, never forward
      }

      if (EXECUTABLE_OR_BINARY_EXT.has(ext)) {
        ignoredPaths.push({ path: rawName, reason: "binary_or_executable" });
        continue;
      }

      const declaredSize = entry.header?.size || 0;
      if (declaredSize > LIMITS.maxSingleEntryBytes) {
        ignoredPaths.push({ path: rawName, reason: "entry_too_large" });
        continue;
      }

      let data;
      try {
        data = entry.getData();
      } catch {
        ignoredPaths.push({ path: rawName, reason: "unreadable" });
        continue;
      }

      extractedBytes += data.length;
      if (extractedBytes > LIMITS.maxTotalUncompressedBytes) {
        throw Object.assign(
          new Error("ZIP's actual uncompressed size exceeds the safe extraction limit"),
          { code: "ZIP_TOO_LARGE" }
        );
      }

      fs.mkdirSync(path.dirname(safePath.resolved), { recursive: true });
      // Write with explicit non-executable permissions — this analysis never
      // executes anything, but belt-and-suspenders.
      fs.writeFileSync(safePath.resolved, data, { mode: 0o600 });

      safeFiles.push({
        relPath: safePath.normalized,
        absPath: safePath.resolved,
        size: data.length,
        ext,
      });
    }

    return {
      extractRoot,
      safeFiles,
      ignoredPaths,
      secretFiles,
      totalEntries: entries.length,
      cleanup,
    };
  } catch (err) {
    cleanup();
    throw err;
  }
}

/** Cheap content fingerprint used for duplicate-submission detection. */
function hashFile(filePath) {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(buf).digest("hex");
}

module.exports = { safeExtractZip, hashFile, resolveSafeEntryPath, IGNORED_DIR_NAMES, LIMITS };
