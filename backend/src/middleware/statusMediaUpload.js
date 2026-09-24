const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const multer = require("multer");
const ApiError = require("../utils/apiError");

/**
 * STATUS MEDIA UPLOAD (Photos & Videos)
 * =====================================
 * Upload storage for 24-hour private status updates.
 * Stored in "uploads-media/status/<userId>/", completely isolated from
 * public static routes.
 */
const mediaDir = process.env.MEDIA_UPLOAD_DIR || "uploads-media";
const uploadRoot = path.isAbsolute(mediaDir)
  ? path.join(mediaDir, "status")
  : path.join(__dirname, "..", "..", mediaDir, "status");

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
    const userId = String(req.user?._id || "anon");
    const dir = path.join(uploadRoot, userId);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = EXT_BY_MIME[file.mimetype] || "bin";
    const rand = crypto.randomBytes(8).toString("hex");
    cb(null, `status-${Date.now()}-${rand}.${ext}`);
  },
});

function fileFilter(req, file, cb) {
  if (!ALLOWED_MEDIA_MIME.has(file.mimetype)) {
    return cb(
      ApiError.badRequest(
        `Unsupported media format "${file.mimetype}". Allowed formats: PNG, JPEG, GIF, WebP, MP4, WebM, OGG.`
      ),
      false
    );
  }
  cb(null, true);
}

const statusMediaUpload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB max for video
    files: 1,
  },
});

module.exports = {
  statusMediaUpload,
  uploadRoot,
};
