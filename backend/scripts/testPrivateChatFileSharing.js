/**
 * STEP — PRIVATE CHAT FILE SHARING regression tests (Issue #2 fix).
 *
 * Exercises the REAL production code: middleware/directUpload.js and
 * chatController.uploadDirectFile / downloadDirectFile, mounted on a real
 * Express app listening on a real port, hit with real multipart HTTP
 * requests (Node's built-in fetch/FormData/Blob). Only `protect` is
 * stubbed (to inject a fake authenticated user) — nothing else in the
 * fix requires a live MongoDB, since neither the upload nor the download
 * handler touches the database.
 *
 * Run: node backend/scripts/testPrivateChatFileSharing.js
 */
const assert = require("assert");
const path = require("path");
const fs = require("fs");
const os = require("os");
const express = require("express");

// Isolate this test run's uploads under a throwaway temp dir instead of the
// real backend/uploads folder.
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "teamsync-private-upload-test-"));
process.env.UPLOAD_DIR = tmpRoot;
process.env.MAX_UPLOAD_MB = "1"; // small on purpose, to exercise the size-limit test below

// NOTE: middleware/directUpload.js (like the existing middleware/upload.js
// it mirrors) builds its upload root via
// `path.join(__dirname, "..", "..", process.env.UPLOAD_DIR, "private")`.
// `path.join` does NOT special-case an absolute path passed as a middle
// segment the way `path.resolve` would — it normalizes the whole chain as
// one relative-ish string — so passing an absolute `tmpRoot` here does NOT
// actually redirect writes under `os.tmpdir()`; it ends up nested under
// backend/tmp/<tmpRoot-without-its-leading-slash>/private instead. This is
// a pre-existing characteristic of the UPLOAD_DIR pattern already used by
// middleware/upload.js (harmless in real use, where UPLOAD_DIR is always a
// short relative folder name like "uploads" per .env.example) — this test
// only needs to know the REAL resulting path so it can clean up correctly.
const actualUploadRoot = path.join(__dirname, "..", tmpRoot);
function cleanup() {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  fs.rmSync(actualUploadRoot, { recursive: true, force: true });
  // Remove an now-empty backend/tmp wrapper directory this test created.
  try {
    fs.rmdirSync(path.join(__dirname, "..", "tmp"));
  } catch {
    /* not empty / already gone — fine, other tests may share it */
  }
}

const directUpload = require("../src/middleware/directUpload");
const chat = require("../src/controllers/chatController");
const { errorHandler } = require("../src/middleware/error");

function fakeAuthAs(userId) {
  return (req, res, next) => {
    req.user = { _id: userId };
    next();
  };
}

function buildApp(userId) {
  const app = express();
  app.use(express.json());
  app.post("/chat/direct/:userId/files", fakeAuthAs(userId), directUpload.any(), chat.uploadDirectFile);
  app.get("/chat/direct/:userId/files/:filename/download", fakeAuthAs(userId), chat.downloadDirectFile);
  app.use(errorHandler);
  return app;
}

async function withServer(userId, fn) {
  const app = buildApp(userId);
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const port = server.address().port;
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const USER_A = "aaaaaaaaaaaaaaaaaaaaaaaa";
const USER_B = "bbbbbbbbbbbbbbbbbbbbbbbb";
const USER_C = "cccccccccccccccccccccccc"; // non-participant / attacker

let passed = 0;
function ok(label) {
  console.log(`ok - ${label}`);
  passed += 1;
}

async function main() {
  // 1. Private attachment upload (A uploads for the A<->B conversation)
  let uploadedUrl;
  await withServer(USER_A, async (base) => {
    const form = new FormData();
    form.append("file", new Blob(["hello private world"], { type: "text/plain" }), "note.txt");
    const res = await fetch(`${base}/chat/direct/${USER_B}/files`, { method: "POST", body: form });
    assert.strictEqual(res.status, 201);
    const body = await res.json();
    assert.ok(body.success);
    assert.ok(body.data.url.includes("/uploads/private/"));
    assert.strictEqual(body.data.name, "note.txt");
    assert.strictEqual(body.data.type, "file"); // .txt has no special kindOf() mapping — falls back to "file"
    uploadedUrl = body.data.url;
  });
  ok("1. private attachment upload succeeds and returns {name,url,size,type,mimeType}");

  assert.ok(uploadedUrl && !uploadedUrl.includes(`/uploads/${USER_B}/`), "must not be written under a group-style folder");
  ok("2. private attachment is never written into a group-shaped folder");

  const filename = uploadedUrl.split("/").pop();

  // 3. Participant (B) can download the same file A uploaded for A<->B
  await withServer(USER_B, async (base) => {
    const res = await fetch(`${base}/chat/direct/${USER_A}/files/${filename}/download`);
    assert.strictEqual(res.status, 200);
    const text = await res.text();
    assert.strictEqual(text, "hello private world");
  });
  ok("3. the other participant (B) can download A's private attachment");

  // 4. Non-participant (C) cannot access it by manipulating :userId
  await withServer(USER_C, async (base) => {
    // C tries every combination of "who is my conversation partner" —
    // none of them can ever resolve to the real A<->B folder.
    for (const guess of [USER_A, USER_B]) {
      const res = await fetch(`${base}/chat/direct/${guess}/files/${filename}/download`);
      assert.strictEqual(res.status, 404, `non-participant guessing userId=${guess} must not succeed`);
    }
  });
  ok("4. a non-participant (C) cannot access the private attachment by manipulating :userId");

  // 5. A cannot access it by (incorrectly) claiming the conversation is with C
  await withServer(USER_A, async (base) => {
    const res = await fetch(`${base}/chat/direct/${USER_C}/files/${filename}/download`);
    assert.strictEqual(res.status, 404);
  });
  ok("5. even the real uploader cannot fetch it under the wrong conversation key");

  // 6. Oversized file is rejected (MAX_UPLOAD_MB=1 for this test run)
  await withServer(USER_A, async (base) => {
    const bigBlob = new Blob([new Uint8Array(2 * 1024 * 1024)], { type: "application/octet-stream" }); // 2MB > 1MB limit
    const form = new FormData();
    form.append("file", bigBlob, "big.bin");
    const res = await fetch(`${base}/chat/direct/${USER_B}/files`, { method: "POST", body: form });
    assert.strictEqual(res.status, 400);
    const body = await res.json();
    assert.ok(/exceeds the maximum upload size/i.test(body.message));
  });
  ok("6. oversized file is rejected using the existing MAX_UPLOAD_MB rule");

  // 7. No file uploaded is rejected
  await withServer(USER_A, async (base) => {
    const form = new FormData();
    const res = await fetch(`${base}/chat/direct/${USER_B}/files`, { method: "POST", body: form });
    assert.strictEqual(res.status, 400);
  });
  ok("7. a request with no file is rejected");

  // 8. sanitizeAttachments (used by sendDirectMessage) only trusts safe fields
  // and requires text OR attachment — exercised as a pure function via the
  // exported helper used by both sendGroupMessage and sendDirectMessage.
  {
    const svc = require("../src/controllers/chatController");
    // sanitizeAttachments isn't exported directly (module-private), so we
    // assert the equivalent behavior via the Message model's own validator,
    // which is what actually enforces "text or attachment required" for
    // both group and direct messages.
    const Message = require("../src/models/Message");
    const withNeither = new Message({ conversation: "x", sender: USER_A, recipient: USER_B, text: "", attachments: [] });
    // The "text or attachment required" rule runs in an async pre("validate")
    // hook (see Message.js), so it must be exercised via validate(), not
    // validateSync() (which cannot run async/next-style hooks).
    let neitherErr = null;
    try {
      await withNeither.validate();
    } catch (e) {
      neitherErr = e;
    }
    assert.ok(neitherErr, "a message with neither text nor attachments must fail validation");
    const withAttachmentOnly = new Message({
      conversation: "x",
      sender: USER_A,
      recipient: USER_B,
      text: "",
      attachments: [{ name: "a.txt", url: "/uploads/private/x/a.txt", size: 3, type: "file" }],
    });
    await withAttachmentOnly.validate(); // must not throw

  }
  ok("8. Message model still requires text-or-attachment for direct messages, and a file-only message is valid");

  console.log(`\n${passed} checks passed.`);
  cleanup();
}

main().catch((err) => {
  console.error("FAILED:", err);
  cleanup();
  process.exit(1);
});
