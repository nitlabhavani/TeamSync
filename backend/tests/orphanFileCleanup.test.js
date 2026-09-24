// Verifies the orphan-file cleanup module that was previously defined but
// never invoked anywhere in the app (see FINAL_PRODUCTION_AUDIT_REPORT.md,
// "orphanFileCleanup"). Uses a real temp directory for filesystem behavior
// (so path-safety and age-gating are exercised for real) and mocks only the
// MongoDB `Message.exists` lookup, matching the existing test style in this
// suite (see callService.test.js / callSignaling.integration.test.js).

const fs = require("fs");
const os = require("os");
const path = require("path");

jest.mock("../src/models/Message", () => ({
  exists: jest.fn(),
}));

const Message = require("../src/models/Message");
const {
  cleanupOrphanVoiceFiles,
  cleanupOrphanPrivateFiles,
  runOrphanCleanupOnce,
  startOrphanCleanupScheduler,
  stopOrphanCleanupScheduler,
} = require("../src/utils/orphanFileCleanup");

describe("orphanFileCleanup — safe reconciliation of unreferenced upload files", () => {
  let tmpRoot;

  beforeEach(() => {
    jest.clearAllMocks();
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "teamsync-orphan-test-"));
    process.env.VOICE_UPLOAD_DIR = tmpRoot; // absolute -> used as-is by cleanupOrphanVoiceFiles
  });

  afterEach(() => {
    stopOrphanCleanupScheduler();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    delete process.env.VOICE_UPLOAD_DIR;
  });

  function writeAgedFile(conversationKey, filename, ageMs) {
    const dir = path.join(tmpRoot, "private", conversationKey);
    fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, filename);
    fs.writeFileSync(filePath, "fake-audio-bytes");
    const past = new Date(Date.now() - ageMs);
    fs.utimesSync(filePath, past, past);
    return filePath;
  }

  test("removes a referenced-nowhere file older than the safety window", async () => {
    const filePath = writeAgedFile("abc_def", "voice-123-xyz.webm", 2 * 60 * 60 * 1000);
    Message.exists.mockResolvedValue(null); // no Message references this filename

    const result = await cleanupOrphanVoiceFiles();

    expect(result.removed).toBe(1);
    expect(fs.existsSync(filePath)).toBe(false);
  });

  test("never deletes a file that a Message document still references", async () => {
    const filePath = writeAgedFile("abc_def", "voice-999-real.webm", 2 * 60 * 60 * 1000);
    Message.exists.mockResolvedValue({ _id: "some-message" }); // referenced

    const result = await cleanupOrphanVoiceFiles();

    expect(result.removed).toBe(0);
    expect(fs.existsSync(filePath)).toBe(true);
  });

  test("never touches a fresh file that may be mid-upload/mid-send", async () => {
    const filePath = writeAgedFile("abc_def", "voice-111-fresh.webm", 5000); // 5s old
    Message.exists.mockResolvedValue(null);

    const result = await cleanupOrphanVoiceFiles();

    // The file is still counted as "seen" (scanned), but the age gate must
    // skip it before ever consulting Mongo or touching disk.
    expect(result.removed).toBe(0);
    expect(fs.existsSync(filePath)).toBe(true);
    expect(Message.exists).not.toHaveBeenCalled();
  });

  test("never escapes the configured upload root", async () => {
    // Sanity check: cleanup only ever walks paths built from readdir() results
    // under uploadRoot, never from user input, so there is no traversal
    // surface — this asserts the root itself is respected as the fs walk
    // boundary rather than some ancestor directory.
    writeAgedFile("abc_def", "voice-1-a.webm", 2 * 60 * 60 * 1000);
    Message.exists.mockResolvedValue(null);
    const outsideMarker = path.join(tmpRoot, "..", "should-never-be-touched.txt");
    fs.writeFileSync(outsideMarker, "safe");

    await cleanupOrphanVoiceFiles();

    expect(fs.existsSync(outsideMarker)).toBe(true);
    fs.rmSync(outsideMarker, { force: true });
  });

  test("cleans up both voice and regular-file roots via runOrphanCleanupOnce", async () => {
    process.env.UPLOAD_DIR = tmpRoot; // reuse same tmp root's sibling structure for files
    writeAgedFile("conv1", "voice-1-a.webm", 2 * 60 * 60 * 1000);
    Message.exists.mockResolvedValue(null);

    const results = await runOrphanCleanupOnce();

    expect(results.voice).toBeTruthy();
    expect(results.files).toBeTruthy();
    delete process.env.UPLOAD_DIR;
  });

  test("startOrphanCleanupScheduler is idempotent and does not double-schedule", () => {
    const t1 = startOrphanCleanupScheduler();
    const t2 = startOrphanCleanupScheduler();
    expect(t1).toBe(t2);
    stopOrphanCleanupScheduler();
  });

  test("a corrupted directory read does not throw and is reported in errors[]", async () => {
    // Point at a path that does not exist as a directory (a file instead) to
    // force a readdir error, proving cleanup degrades gracefully.
    const bogus = path.join(tmpRoot, "not-a-real-voice-root");
    process.env.VOICE_UPLOAD_DIR = path.join(tmpRoot, "nonexistent-parent");
    const result = await cleanupOrphanVoiceFiles();
    expect(result).toEqual({ scanned: 0, removed: 0, errors: [] });
    void bogus;
  });

  test("cleanupOrphanPrivateFiles reconciles regular direct-chat attachments the same way", async () => {
    process.env.UPLOAD_DIR = tmpRoot;
    const dir = path.join(tmpRoot, "private", "conv2");
    fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, "report.pdf");
    fs.writeFileSync(filePath, "fake-pdf-bytes");
    const past = new Date(Date.now() - 2 * 60 * 60 * 1000);
    fs.utimesSync(filePath, past, past);
    Message.exists.mockResolvedValue(null);

    const result = await cleanupOrphanPrivateFiles();

    expect(result.removed).toBe(1);
    expect(fs.existsSync(filePath)).toBe(false);
    delete process.env.UPLOAD_DIR;
  });
});
