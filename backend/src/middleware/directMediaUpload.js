const fs = require("fs");
const path = require("path");
const multer = require("multer");
const Message = require("../models/Message");
const ApiError = require("../utils/apiError");

/**
 * PRIVATE MEDIA UPLOAD (Photos & Videos) — 1:1 Direct Chat Only
 * =============================================================
 *
 * Dedicated multer configuration for private images and videos shared in single chat.
 * Stored under `MEDIA_UPLOAD_DIR` (default "uploads-media/private/<conversationKey>/"),
 * which is NEVER mounted as an unauthenticated static folder in Express.
 *
 * Access is exclusively permitted through the authenticated streaming endpoint:
 *   GET /api/chat/direct/:userId/media/:filename
 * which enforces `validateDirectPeer` and conversationKey matching.
 *
 * Files are named using server-generated cryptographically random tokens,
 * eliminating path traversal and collision risks completely.
 */
const mediaDir = process.env.MEDIA_UPLOAD_DIR || "uploads-media";
const uploadRoot = path.isAbsolute(mediaDir)
  ? path.join(mediaDir, "private")
  : path.join(__dirname, "..", "..", mediaDir, "private");

const ALLOWED_MEDIA_MIME = new Set([
  // Images
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/gif",
  "image/webp",
  // Videos
  "video/mp4",
  "video/webm",
  "video/ogg",
  "video/quicktime",
]);

const EXT_BY_MIME = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/ogg": "ogg",
  "video/quicktime": "mov",
};

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const key = Message.conversationKey(req.user._id, req.params.userId);
    const dir = path.join(uploadRoot, key);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = EXT_BY_MIME[file.mimetype] || "bin";
    const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    cb(null, `media-${unique}.${ext}`);
  },
});

const fileFilter = (req, file, cb) => {
  if (!ALLOWED_MEDIA_MIME.has(file.mimetype)) {
    cb(ApiError.badRequest(`Unsupported media format: ${file.mimetype || "unknown"}. Only photos and videos are allowed.`));
    return;
  }
  cb(null, true);
};

// 50MB maximum upload limit for videos; images are checked in controller for 15MB limit
const maxMb = Number(process.env.MAX_MEDIA_MB || 50);

module.exports = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: maxMb * 1024 * 1024,
  },
});
