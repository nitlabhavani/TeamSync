const path = require("path");
const fs = require("fs");
const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/apiError");
const FileAsset = require("../models/FileAsset");
const { analyseSubmissionFile } = require("../services/fileAnalysisService");
const { notifyUsers } = require("../services/notificationService");
const { logActivity } = require("../services/activityService");
const { emitToGroup, emitToUser } = require("../services/socketService");

exports.kindOf = (mime = "", name = "") => {
  const ext = path.extname(name || "").toLowerCase();
  // PRIVATE VOICE MESSAGES — checked first so a recorded voice note (e.g.
  // "voice-message.webm", mimetype audio/webm) is classified as "audio",
  // not misdetected by a later, coincidentally-matching branch below.
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("image/") || [".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"].includes(ext)) return "image";
  if (mime === "application/pdf" || ext === ".pdf") return "pdf";
  if (ext === ".zip" || /zip|compressed/.test(mime)) return "zip";
  if ([".doc", ".docx", ".odt"].includes(ext) || /word|document/.test(mime)) return "doc";
  if ([".ppt", ".pptx"].includes(ext) || /presentation/.test(mime)) return "ppt";
  if ([".xls", ".xlsx", ".ods"].includes(ext) || /sheet/.test(mime)) return "sheet";
  if ([".js", ".jsx", ".ts", ".tsx", ".py", ".java", ".c", ".cpp", ".cs", ".go", ".rb", ".php", ".rs", ".kt", ".swift", ".dart", ".sql", ".html", ".css"].includes(ext)) return "code";
  return "file";
};

exports.list = asyncHandler(async (req, res) => {
  const files = await FileAsset.find({ group: req.group._id })
    .populate("uploadedBy", "name color avatar")
    .sort("-createdAt");
  res.json({ success: true, data: files });
});

exports.upload = asyncHandler(async (req, res) => {
  const uploads = req.files || (req.file ? [req.file] : []);
  if (!uploads.length) throw ApiError.badRequest("No file uploaded");

  const savedAssets = [];
  for (const file of uploads) {
    const asset = await FileAsset.create({
      group: req.group._id,
      name: file.originalname,
      originalName: file.originalname,
      url: `/uploads/${req.params.groupId}/${file.filename}`,
      size: file.size,
      mimeType: file.mimetype,
      type: exports.kindOf(file.mimetype, file.originalname),
      uploadedBy: req.user._id,
    });

    try {
      const analysis = await analyseSubmissionFile({
        filePath: file.path,
        originalName: file.originalname,
        groupName: req.group.name,
      });
      asset.aiAnalysis = analysis;
      await asset.save();
    } catch (err) {
      asset.aiAnalysis = {
        engine: "error",
        summary: "Analysis failed",
        reason: err.message,
        analyzedAt: new Date(),
      };
      await asset.save();
    }

    savedAssets.push(await asset.populate("uploadedBy", "name color avatar"));
  }

  await logActivity({
    req,
    group: req.group._id,
    action: "file.uploaded",
    summary: `${savedAssets.length} file(s) uploaded to ${req.group.name}`,
    meta: { files: savedAssets.map((f) => f.originalName) },
  });

  const groupPayload = {
    groupId: String(req.group._id),
    files: savedAssets.map((asset) => ({
      ...asset.toObject(),
      uploadedBy: asset.uploadedBy,
      id: String(asset._id),
    })),
  };
  emitToGroup(req.group._id, "group:file:uploaded", groupPayload);

  await notifyUsers([req.group.guide], {
    title: "File uploaded",
    body: `New file uploaded by ${req.user.name}`,
    type: "file",
    link: `/groups/${req.params.groupId}`,
    group: req.group._id,
  }, { exclude: String(req.user._id) });

  for (const asset of savedAssets) {
    const guide = req.group.guide;
    if (!guide) continue;
    emitToUser(guide, "guide:file:ai-ready", {
      groupId: String(req.group._id),
      fileId: String(asset._id),
      fileName: asset.name,
      uploadedBy: { id: String(req.user._id), name: req.user.name },
      aiAnalysis: asset.aiAnalysis,
    });
  }

  const response = savedAssets.length === 1 ? savedAssets[0] : savedAssets;
  res.status(201).json({ success: true, data: response });
});

exports.download = asyncHandler(async (req, res) => {
  const asset = await FileAsset.findOne({ _id: req.params.fileId, group: req.group._id });
  if (!asset) throw ApiError.notFound("File not found");
  asset.downloads += 1;
  await asset.save();
  const abs = path.join(__dirname, "..", "..", asset.url.replace(/^\//, ""));
  if (!fs.existsSync(abs)) throw ApiError.notFound("File missing on disk");
  res.download(abs, asset.originalName || asset.name);
});

exports.remove = asyncHandler(async (req, res) => {
  const asset = await FileAsset.findOne({ _id: req.params.fileId, group: req.group._id });
  if (!asset) throw ApiError.notFound("File not found");
  if (String(asset.uploadedBy) !== String(req.user._id) && !req.isGuide)
    throw ApiError.forbidden("Only the uploader or guide can delete this file");

  const abs = path.join(__dirname, "..", "..", asset.url.replace(/^\//, ""));
  fs.promises.unlink(abs).catch(() => {});
  await asset.deleteOne();

  emitToGroup(req.group._id, "group:file:deleted", {
    groupId: String(req.group._id),
    fileId: String(asset._id),
  });

  await logActivity({
    req,
    group: req.group._id,
    action: "file.deleted",
    summary: `${asset.name} deleted from ${req.group.name}`,
    meta: { fileId: String(asset._id), fileName: asset.name },
  });

  res.json({ success: true, message: "File deleted" });
});
