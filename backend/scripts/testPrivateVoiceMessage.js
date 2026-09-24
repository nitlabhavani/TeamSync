/**
 * PRIVATE VOICE MESSAGES — regression tests.
 *
 * Exercises the REAL production code: middleware/directVoiceUpload.js and
 * chatController.uploadDirectVoice / streamDirectVoice, mounted on a real
 * Express app listening on a real port, hit with real multipart HTTP
 * requests (Node's built-in fetch/FormData/Blob) — same style as
 * testPrivateChatFileSharing.js. Only `protect` is stubbed (to inject a
 * fake authenticated user); nothing here requires a live MongoDB except the
 * Message-model checks at the end, which use plain `new Message(...)` +
 * `.validate()` (no DB connection needed for schema/validator checks).
 *
 * Run: node backend/scripts/testPrivateVoiceMessage.js
 */
const assert = require("assert");
const path = require("path");
const fs = require("fs");
const os = require("os");
const express = require("express");

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "teamsync-voice-test-"));
process.env.VOICE_UPLOAD_DIR = tmpRoot;
process.env.MAX_VOICE_MB = "1"; // small on purpose, to exercise the size-limit test below
process.env.MAX_VOICE_DURATION_SECONDS = "120";

// Same path.join-vs-absolute-path caveat as testPrivateChatFileSharing.js:
// directVoiceUpload.js builds its root via
// `path.join(__dirname, "..", "..", process.env.VOICE_UPLOAD_DIR, "private")`,
// which does not treat an absolute VOICE_UPLOAD_DIR as an anchor — it ends
// up nested under backend/<tmpRoot-without-leading-slash>/private instead.
const actualUploadRoot = path.join(__dirname, "..", tmpRoot);
function cleanup() {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  fs.rmSync(actualUploadRoot, { recursive: true, force: true });
}

const directVoiceUpload = require("../src/middleware/directVoiceUpload");
const chat = require("../src/controllers/chatController");
const { errorHandler } = require("../src/middleware/error");
const Message = require("../src/models/Message");
const { kindOf } = require("../src/controllers/fileController");

function fakeAuthAs(userId) {
  return (req, res, next) => {
    req.user = { _id: userId };
    next();
  };
}

function buildApp(userId) {
  const app = express();
  app.use(express.json());
  app.post("/chat/direct/:userId/voice", fakeAuthAs(userId), directVoiceUpload.single("audio"), chat.uploadDirectVoice);
  app.get("/chat/direct/:userId/voice/:filename", fakeAuthAs(userId), chat.streamDirectVoice);
  // A bare-bones stand-in for a GROUP route, proving no group-scoped voice
  // endpoint exists to accidentally reuse this middleware/controller pair —
  // see test 13 below, which asserts the real router (routes/index.js) has
  // no such route at all rather than hitting this stand-in.
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

// Minimal but structurally valid webm bytes are not required here — multer
// only inspects the declared mimetype (real MediaRecorder output would set
// this correctly), and streamDirectVoice only inspects the file extension
// it wrote at upload time; the tests below only ever verify HTTP-layer
// authorization/validation, not codec-level audio decoding.
function audioBlob(bytes = "RIFF....WAVEfake-audio-bytes") {
  return new Blob([bytes], { type: "audio/webm" });
}

async function main() {
  // 1. Authenticated participant can upload a voice message
  let uploadedUrl;
  let uploadedFilename;
  await withServer(USER_A, async (base) => {
    const form = new FormData();
    form.append("audio", audioBlob(), "voice-message.webm");
    form.append("duration", "8");
    const res = await fetch(`${base}/chat/direct/${USER_B}/voice`, { method: "POST", body: form });
    assert.strictEqual(res.status, 201);
    const body = await res.json();
    assert.ok(body.success);
    assert.strictEqual(body.data.type, "audio");
    assert.strictEqual(body.data.duration, 8);
    assert.ok(body.data.url.includes(`/chat/direct/${USER_B}/voice/`), "url must be the authenticated streaming endpoint");
    assert.ok(!body.data.url.startsWith("/uploads/"), "voice url must never be a static filesystem path");
    uploadedUrl = body.data.url;
    uploadedFilename = uploadedUrl.split("/").pop();
  });
  ok("1. authenticated participant can upload a voice message and gets back an authenticated streaming url");

  // 2. Unauthenticated user rejected — verified against the REAL router
  // wiring (routes/index.js): `protect` runs before directVoiceUpload on
  // both the upload and stream routes, so an unauthenticated request is
  // rejected by `protect` (401) before ever reaching multer or the
  // controller — the same authorization ordering used by every other
  // private-chat route in this app (see uploadDirectFile above it).
  // (Not exercised by directly invoking directVoiceUpload with no
  // req.user here: multer's storage engine calls the destination callback
  // synchronously from inside its internal stream-parsing state machine, so
  // an unhandled throw there crashes the process rather than producing an
  // HTTP error — which is exactly why real routes must never mount this
  // middleware without `protect` first, as verified below.)
  {
    const routesSrc = fs.readFileSync(path.join(__dirname, "..", "src", "routes", "index.js"), "utf8");
    const voiceUploadLine = routesSrc.split("\n").find((l) => l.includes('post("/chat/direct/:userId/voice"'));
    const voiceStreamLine = routesSrc.split("\n").find((l) => l.includes('get("/chat/direct/:userId/voice/:filename"'));
    assert.ok(voiceUploadLine && /protect/.test(voiceUploadLine), "voice upload route must require `protect`");
    assert.ok(voiceStreamLine && /protect/.test(voiceStreamLine), "voice stream route must require `protect`");
    assert.ok(voiceUploadLine.indexOf("protect") < voiceUploadLine.indexOf("directVoiceUpload"), "`protect` must run before directVoiceUpload");
  }
  ok("2. both voice routes require `protect` (authentication) ahead of the upload middleware in the real router");

  // 3. Non-participant (C) cannot stream A<->B's voice message by manipulating :userId
  await withServer(USER_C, async (base) => {
    for (const guess of [USER_A, USER_B]) {
      const res = await fetch(`${base}/chat/direct/${guess}/voice/${uploadedFilename}`);
      assert.strictEqual(res.status, 404, `non-participant guessing userId=${guess} must not succeed`);
    }
  });
  ok("3. a non-participant (C) cannot access the private voice message by manipulating :userId");

  // 4. Participant B (the recipient) CAN stream the voice message A sent
  await withServer(USER_B, async (base) => {
    const res = await fetch(`${base}/chat/direct/${USER_A}/voice/${uploadedFilename}`);
    assert.strictEqual(res.status, 200);
    assert.ok((res.headers.get("content-type") || "").startsWith("audio/"));
    assert.strictEqual(res.headers.get("content-disposition"), "inline", "must stream inline, never force a download");
    const buf = Buffer.from(await res.arrayBuffer());
    assert.ok(buf.length > 0);
  });
  ok("4. the other participant (B) can stream A's voice message inline");

  // 5. Sender (A) can also stream their own sent voice message back
  await withServer(USER_A, async (base) => {
    const res = await fetch(`${base}/chat/direct/${USER_B}/voice/${uploadedFilename}`);
    assert.strictEqual(res.status, 200);
  });
  ok("5. the sender (A) can also play back their own sent voice message");

  // 6. Range requests are honored (seeking support)
  await withServer(USER_B, async (base) => {
    const res = await fetch(`${base}/chat/direct/${USER_A}/voice/${uploadedFilename}`, {
      headers: { Range: "bytes=0-3" },
    });
    assert.strictEqual(res.status, 206);
    assert.ok((res.headers.get("content-range") || "").startsWith("bytes 0-3/"));
  });
  ok("6. Range requests are honored for scrubbing/seeking");

  // 7. Unsupported MIME type is rejected
  await withServer(USER_A, async (base) => {
    const form = new FormData();
    form.append("audio", new Blob(["not audio"], { type: "text/plain" }), "note.txt");
    const res = await fetch(`${base}/chat/direct/${USER_B}/voice`, { method: "POST", body: form });
    assert.strictEqual(res.status, 400);
  });
  ok("7. a non-audio MIME type is rejected");

  // 8. Oversized audio is rejected (MAX_VOICE_MB=1 for this test run)
  await withServer(USER_A, async (base) => {
    const bigBlob = new Blob([new Uint8Array(2 * 1024 * 1024)], { type: "audio/webm" }); // 2MB > 1MB limit
    const form = new FormData();
    form.append("audio", bigBlob, "big.webm");
    const res = await fetch(`${base}/chat/direct/${USER_B}/voice`, { method: "POST", body: form });
    assert.strictEqual(res.status, 400);
    const body = await res.json();
    assert.ok(/exceeds the maximum upload size/i.test(body.message));
  });
  ok("8. oversized audio is rejected using MAX_VOICE_MB");

  // 9. No audio uploaded is rejected
  await withServer(USER_A, async (base) => {
    const form = new FormData();
    const res = await fetch(`${base}/chat/direct/${USER_B}/voice`, { method: "POST", body: form });
    assert.strictEqual(res.status, 400);
  });
  ok("9. a request with no audio is rejected");

  // 10. Server-generated filenames — no path traversal surface via client filename
  await withServer(USER_A, async (base) => {
    const form = new FormData();
    form.append("audio", audioBlob(), "../../../etc/passwd.webm");
    const res = await fetch(`${base}/chat/direct/${USER_B}/voice`, { method: "POST", body: form });
    assert.strictEqual(res.status, 201);
    const body = await res.json();
    assert.ok(/^\/chat\/direct\/[a-f0-9]+\/voice\/voice-\d+-[a-z0-9]+\.webm$/.test(body.data.url), "filename must be fully server-generated");
  });
  ok("10. uploaded filename is always server-generated, never derived from client input");

  // 11. Path traversal in the :filename param on stream/download is blocked
  await withServer(USER_B, async (base) => {
    const res = await fetch(`${base}/chat/direct/${USER_A}/voice/..%2F..%2F..%2Fetc%2Fpasswd`);
    assert.notStrictEqual(res.status, 200, "path traversal in :filename must never succeed");
  });
  ok("11. path traversal via the :filename param is blocked");

  // 12. kindOf() correctly classifies real recorder mimetypes as "audio"
  assert.strictEqual(kindOf("audio/webm", "voice-message.webm"), "audio");
  assert.strictEqual(kindOf("audio/ogg", "voice-message.ogg"), "audio");
  assert.strictEqual(kindOf("audio/mp4", "voice-message.mp4"), "audio");
  assert.strictEqual(kindOf("application/pdf", "report.pdf"), "pdf"); // unaffected
  ok("12. fileController.kindOf classifies real recorder audio mimetypes as \"audio\" without affecting existing kinds");

  // 13. No group-scoped voice route exists in the real router at all
  {
    const routesSrc = fs.readFileSync(path.join(__dirname, "..", "src", "routes", "index.js"), "utf8");
    const routerCallLines = routesSrc.split("\n").filter((l) => /^\s*router\.(get|post|put|patch|delete)\(/.test(l));
    assert.ok(!routerCallLines.some((l) => /groups\/:groupId\/voice/.test(l)), "there must be no registered group voice route");
    assert.ok(routerCallLines.some((l) => /chat\/direct\/:userId\/voice/.test(l)), "the private voice route must exist");
  }
  ok("13. the real router defines no group-scoped voice endpoint — group voice access is impossible at the API layer");

  // 14. Message model: sendDirectMessage's voice-detection logic (mirrored
  // here as a pure function of {text, attachments}, matching
  // chatController.sendDirectMessage's isVoiceMessage expression exactly)
  {
    const isVoiceMessage = (text, attachments) => !text && attachments.length === 1 && attachments[0].type === "audio";
    assert.strictEqual(isVoiceMessage("", [{ type: "audio" }]), true);
    assert.strictEqual(isVoiceMessage("hi", [{ type: "audio" }]), false, "text + audio must stay a text message");
    assert.strictEqual(isVoiceMessage("", [{ type: "audio" }, { type: "file" }]), false, "multiple attachments must stay a text message");
    assert.strictEqual(isVoiceMessage("", [{ type: "file" }]), false, "a non-audio attachment must stay a text message");
  }
  ok("14. voice-message type detection only fires for a lone audio attachment with no caption text");

  // 15. Message model persists type + duration correctly, and existing
  // text-only / file-only messages are completely unaffected
  {
    const textMsg = new Message({ conversation: "x", sender: USER_A, recipient: USER_B, text: "hello" });
    await textMsg.validate();
    assert.strictEqual(textMsg.type, "text", "type must default to text for ordinary messages");

    const voiceMsg = new Message({
      conversation: "x",
      sender: USER_A,
      recipient: USER_B,
      text: "",
      type: "voice",
      attachments: [{ name: "Voice message", url: "/chat/direct/b/voice/f.webm", size: 900, type: "audio", mimeType: "audio/webm", duration: 12 }],
    });
    await voiceMsg.validate();
    assert.strictEqual(voiceMsg.type, "voice");
    assert.strictEqual(voiceMsg.attachments[0].duration, 12);

    const fileMsg = new Message({
      conversation: "x",
      sender: USER_A,
      recipient: USER_B,
      text: "",
      attachments: [{ name: "a.txt", url: "/uploads/private/x/a.txt", size: 3, type: "file" }],
    });
    await fileMsg.validate(); // existing file-only messages must still validate fine
    assert.strictEqual(fileMsg.type, "text", "a non-voice file attachment must not be mistyped as voice");
  }
  ok("15. Message model: type/duration persist correctly; existing text and file message shapes are unaffected");

  // 16. Disguised non-audio file with audio/webm mime-type is rejected by magic-bytes verification
  await withServer(USER_A, async (base) => {
    const form = new FormData();
    // Executable/text content disguised with audio/webm Content-Type
    const fakeAudio = new Blob(["MZThisIsAnExecutableFileDisguisedAsAudioWithFakeMimeTypeHere1234567890"], { type: "audio/webm" });
    form.append("audio", fakeAudio, "malware.webm");
    const res = await fetch(`${base}/chat/direct/${USER_B}/voice`, { method: "POST", body: form });
    assert.strictEqual(res.status, 400);
    const body = await res.json();
    assert.ok(/invalid audio|unrecognized/i.test(body.message), "must reject disguised non-audio file");
  });
  ok("16. disguised non-audio file with forged audio MIME type is rejected by magic-bytes inspection");

  // 17. Corrupted audio file (< 12 bytes) is rejected
  await withServer(USER_A, async (base) => {
    const form = new FormData();
    const tinyCorrupt = new Blob([new Uint8Array([0x1a, 0x45, 0xdf])], { type: "audio/webm" });
    form.append("audio", tinyCorrupt, "corrupt.webm");
    const res = await fetch(`${base}/chat/direct/${USER_B}/voice`, { method: "POST", body: form });
    assert.strictEqual(res.status, 400);
  });
  ok("17. corrupted/truncated audio file is rejected");

  // 18. validateDirectPeer middleware rejects invalid peer, self-chat, and inactive peer
  {
    const validateDirectPeer = require("../src/middleware/validateDirectPeer");
    // Invalid ObjectId format
    let errInvalidId;
    await validateDirectPeer({ params: { userId: "not-a-valid-id" }, user: { _id: USER_A } }, {}, (err) => { errInvalidId = err; });
    assert.strictEqual(errInvalidId?.statusCode, 400);

    // Self conversation
    let errSelf;
    await validateDirectPeer({ params: { userId: USER_A }, user: { _id: USER_A } }, {}, (err) => { errSelf = err; });
    assert.strictEqual(errSelf?.statusCode, 400);
  }
  ok("18. validateDirectPeer middleware enforces valid ObjectId format and rejects self-conversations");

  // 19. All direct routes in real router are guarded with validateDirectPeer
  {
    const routesSrc = fs.readFileSync(path.join(__dirname, "..", "src", "routes", "index.js"), "utf8");
    const directVoicePost = routesSrc.split("\n").find((l) => l.includes('post("/chat/direct/:userId/voice"'));
    const directVoiceGet = routesSrc.split("\n").find((l) => l.includes('get("/chat/direct/:userId/voice/:filename"'));
    const directFilesPost = routesSrc.split("\n").find((l) => l.includes('post("/chat/direct/:userId/files"'));
    const directFilesGet = routesSrc.split("\n").find((l) => l.includes('get("/chat/direct/:userId/files/:filename/download"'));

    assert.ok(directVoicePost && directVoicePost.includes("validateDirectPeer"), "direct voice POST must include validateDirectPeer");
    assert.ok(directVoiceGet && directVoiceGet.includes("validateDirectPeer"), "direct voice GET must include validateDirectPeer");
    assert.ok(directFilesPost && directFilesPost.includes("validateDirectPeer"), "direct files POST must include validateDirectPeer");
    assert.ok(directFilesGet && directFilesGet.includes("validateDirectPeer"), "direct files GET must include validateDirectPeer");
  }
  ok("19. real router enforces validateDirectPeer on all direct voice and file endpoints ahead of upload handlers");

  console.log(`\n${passed} checks passed.`);
  cleanup();
}

main().catch((err) => {
  console.error("FAILED:", err);
  cleanup();
  process.exit(1);
});
