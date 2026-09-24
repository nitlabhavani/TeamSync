const fs = require("fs");
const path = require("path");
const multer = require("multer");
const Message = require("../models/Message");

/**
 * PRIVATE CHAT FILE UPLOAD — mirrors middleware/upload.js's storage/limits
 * exactly (same MAX_UPLOAD_MB env var, same timestamp-safe filename
 * scheme) so private attachments follow the identical validation rules as
 * group attachments. The ONLY difference is the destination folder: this
 * writes into uploads/private/<conversationKey>/ instead of
 * uploads/<groupId>/, where <conversationKey> is the SAME sorted
 * "userA_userB" key already used by Message.conversationKey /
 * chatController.directMessages / sendDirectMessage.
 *
 * This guarantees private files are never written under a group's own
 * upload folder (uploads/<groupId>/...) and therefore can never be picked
 * up by anything that lists/serves a group's folder (FileAsset, "Shared
 * Files" tab, group file AI analysis, etc.) — see fileController.js,
 * which only ever reads FileAsset documents scoped by `group`, and never
 * scans the filesystem directly.
 *
 * Requires `protect` to have already run (req.user set) — the destination
 * callback derives the folder from req.user._id + req.params.userId, so a
 * caller can only ever write into (and, on download, only ever read from —
 * see chatController.downloadDirectFile) the conversation folder for a
 * conversation they are actually part of.
 */
const uploadDir = process.env.UPLOAD_DIR || "uploads";
const uploadRoot = path.isAbsolute(uploadDir)
  ? path.join(uploadDir, "private")
  : path.join(__dirname, "..", "..", uploadDir, "private");

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const key = Message.conversationKey(req.user._id, req.params.userId);
    const dir = path.join(uploadRoot, key);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const safe = file.originalname.replace(/[^\w.\-]+/g, "_");
    cb(null, `${Date.now()}-${safe}`);
  },
});

// Same limit as the existing group upload middleware — never a separate,
// looser rule for private chat.
const maxMb = Number(process.env.MAX_UPLOAD_MB || 25);

module.exports = multer({
  storage,
  limits: { fileSize: maxMb * 1024 * 1024 },
});
