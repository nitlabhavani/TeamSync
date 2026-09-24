const fs = require("fs");
const path = require("path");
const multer = require("multer");

const uploadRoot = path.join(__dirname, "..", "..", process.env.UPLOAD_DIR || "uploads");
fs.mkdirSync(uploadRoot, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(uploadRoot, req.params.groupId || "shared");
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const safe = file.originalname.replace(/[^\w.\-]+/g, "_");
    cb(null, `${Date.now()}-${safe}`);
  },
});

const maxMb = Number(process.env.MAX_UPLOAD_MB || 25);

module.exports = multer({
  storage,
  limits: { fileSize: maxMb * 1024 * 1024 },
});
