const fs = require("fs");
const path = require("path");
const multer = require("multer");

/** Per-user storage for profile documents: uploads/profiles/<userId>/ */
const uploadRoot = path.join(__dirname, "..", "..", process.env.UPLOAD_DIR || "uploads", "profiles");
fs.mkdirSync(uploadRoot, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(uploadRoot, String(req.user._id));
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const safe = file.originalname.replace(/[^\w.\-]+/g, "_");
    cb(null, `${Date.now()}-${safe}`);
  },
});

const maxMb = Number(process.env.MAX_UPLOAD_MB || 25);

const only = (mimes, label) => (req, file, cb) => {
  if (mimes.some((m) => file.mimetype === m || file.mimetype.startsWith(m))) return cb(null, true);
  cb(new Error(`Only ${label} files are allowed`));
};

const build = (filter) =>
  multer({ storage, limits: { fileSize: maxMb * 1024 * 1024 }, fileFilter: filter });

module.exports = {
  /** Resume must be a PDF. */
  resume: build(only(["application/pdf"], "PDF")),
  /** Certificates: PDF or image. */
  certificate: build(only(["application/pdf", "image/"], "PDF or image")),
  /** Avatar: image only. */
  avatar: build(only(["image/"], "image")),
  uploadRoot,
};
