const fs = require("fs");
const path = require("path");
const multer = require("multer");
const Message = require("../models/Message");
const ApiError = require("../utils/apiError");

/**
 * PRIVATE VOICE MESSAGES — upload middleware for real MediaRecorder-captured
 * audio in 1:1 chat only.
 *
 * Deliberately NOT stored under `process.env.UPLOAD_DIR` (default "uploads"),
 * which app.js serves unauthenticated via `express.static("/uploads")`. Voice
 * notes are conversation-private, so they live in a sibling root
 * (`VOICE_UPLOAD_DIR`, default "uploads-voice") that is never mounted as a
 * static route — the only way to ever read one back is through the
 * authenticated GET /chat/direct/:userId/voice/:filename endpoint in
 * chatController.js, which re-derives the same conversationKey used here and
 * verifies the requester is actually one of the two participants.
 *
 * Folder layout mirrors directUpload.js exactly (uploads-voice/private/
 * <conversationKey>/<filename>), keyed the same way, so authorization for
 * "who can write here" and "who can read this back" both reduce to the same
 * question directUpload.js/chatController already answer correctly for
 * ordinary private file attachments: only the two real participants in that
 * exact conversationKey can ever resolve to this folder.
 *
 * Filenames are always server-generated (never derived from any client-
 * supplied name), so there is no path-traversal surface here at all.
 */
const voiceDir = process.env.VOICE_UPLOAD_DIR || "uploads-voice";
const uploadRoot = path.isAbsolute(voiceDir)
  ? path.join(voiceDir, "private")
  : path.join(__dirname, "..", "..", voiceDir, "private");

// Real browser MediaRecorder output formats this app expects — chosen at
// runtime by the frontend based on MediaRecorder.isTypeSupported() (see
// useVoiceRecorder.js). Anything else is rejected outright: this endpoint
// only ever accepts genuine recorded audio, never arbitrary files renamed
// with an audio extension.
const ALLOWED_AUDIO_MIME = new Set([
  "audio/webm",
  "audio/ogg",
  "audio/mp4",
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/x-wav",
  "audio/m4a",
  "audio/aac",
]);

const EXT_BY_MIME = {
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mp4": "mp4",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/m4a": "m4a",
  "audio/aac": "aac",
};

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const key = Message.conversationKey(req.user._id, req.params.userId);
    const dir = path.join(uploadRoot, key);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  // Server-generated filename only — the client's own filename (if any) is
  // never used for anything, including here, eliminating path-traversal or
  // filename-collision risk entirely rather than merely sanitizing it.
  filename: (req, file, cb) => {
    const ext = EXT_BY_MIME[file.mimetype] || "webm";
    const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    cb(null, `voice-${unique}.${ext}`);
  },
});

const fileFilter = (req, file, cb) => {
  if (!ALLOWED_AUDIO_MIME.has(file.mimetype)) {
    // ApiError (not a bare Error) so error.js's generic handler reports
    // this as 400 Bad Request rather than falling through to its 500
    // default — an unsupported format is a client validation error, not a
    // server fault.
    cb(ApiError.badRequest(`Unsupported audio format: ${file.mimetype || "unknown"}`));
    return;
  }
  cb(null, true);
};

// Voice notes get their own (smaller) ceiling rather than sharing
// MAX_UPLOAD_MB with arbitrary file attachments — inspected/configurable via
// env, same pattern as directUpload.js's MAX_UPLOAD_MB.
const maxMb = Number(process.env.MAX_VOICE_MB || 15);

module.exports = multer({
  storage,
  fileFilter,
  limits: { fileSize: maxMb * 1024 * 1024 },
});

module.exports.uploadRoot = uploadRoot;
module.exports.ALLOWED_AUDIO_MIME = ALLOWED_AUDIO_MIME;
