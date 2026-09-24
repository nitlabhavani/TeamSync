const fs = require("fs");
const path = require("path");
const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/apiError");
const StatusUpdate = require("../models/StatusUpdate");
const { verifyMediaBuffer } = require("../utils/mediaMagicBytes");
const { uploadRoot } = require("../middleware/statusMediaUpload");

const MAX_IMAGE_SIZE = 15 * 1024 * 1024;
const MAX_VIDEO_SIZE = 50 * 1024 * 1024;

/**
 * GET /api/updates — list active (unexpired) status updates grouped by user.
 */
exports.list = asyncHandler(async (req, res) => {
  const now = new Date();
  const currentUserId = String(req.user._id);

  const updates = await StatusUpdate.find({ expiresAt: { $gt: now } })
    .populate("user", "name avatar color role dept email")
    .sort("-createdAt")
    .lean();

  const myStatuses = [];
  const unviewedGrouped = new Map(); // userId -> { user, statuses: [] }
  const viewedGrouped = new Map();   // userId -> { user, statuses: [] }

  for (const s of updates) {
    const isMine = String(s.user?._id || s.user) === currentUserId;
    const hasViewed = (s.views || []).some((v) => String(v.user) === currentUserId);
    const enriched = {
      ...s,
      viewCount: (s.views || []).length,
      hasViewed: isMine ? true : hasViewed,
      isMine,
    };

    if (isMine) {
      myStatuses.push(enriched);
    } else {
      const peerId = String(s.user?._id || s.user);
      const targetMap = hasViewed ? viewedGrouped : unviewedGrouped;

      if (!targetMap.has(peerId)) {
        targetMap.set(peerId, {
          user: s.user,
          statuses: [],
          latestTimestamp: s.createdAt,
        });
      }
      targetMap.get(peerId).statuses.push(enriched);
    }
  }

  // If a peer has both viewed and unviewed statuses, prioritize in unviewed
  for (const [peerId, data] of Array.from(viewedGrouped.entries())) {
    if (unviewedGrouped.has(peerId)) {
      unviewedGrouped.get(peerId).statuses.push(...data.statuses);
      viewedGrouped.delete(peerId);
    }
  }

  res.json({
    success: true,
    data: {
      myStatuses,
      unviewedUpdates: Array.from(unviewedGrouped.values()),
      viewedUpdates: Array.from(viewedGrouped.values()),
      totalActive: updates.length,
    },
  });
});

/**
 * POST /api/updates — post a new status update (Photo, Video, or Text).
 */
exports.create = asyncHandler(async (req, res) => {
  const rawText = typeof req.body.text === "string" ? req.body.text.trim() : "";
  const color = typeof req.body.color === "string" && req.body.color.trim() ? req.body.color.trim() : "#10B981";

  let mediaUrl = null;
  let mediaType = "text";

  if (req.file) {
    const filePath = req.file.path;
    try {
      const fd = fs.openSync(filePath, "r");
      const headBuf = Buffer.alloc(64);
      fs.readSync(fd, headBuf, 0, 64, 0);
      fs.closeSync(fd);

      const verified = verifyMediaBuffer(headBuf);
      if (!verified.valid) {
        fs.unlinkSync(filePath);
        throw ApiError.badRequest(`Uploaded file is not a valid image or video: ${verified.reason}`);
      }

      const fileSize = req.file.size || (fs.existsSync(filePath) ? fs.statSync(filePath).size : 0);
      if (verified.type === "image" && fileSize > MAX_IMAGE_SIZE) {
        fs.unlinkSync(filePath);
        throw ApiError.badRequest("Photo exceeds maximum limit of 15MB");
      }
      if (verified.type === "video" && fileSize > MAX_VIDEO_SIZE) {
        fs.unlinkSync(filePath);
        throw ApiError.badRequest("Video exceeds maximum limit of 50MB");
      }

      mediaType = verified.type;
      mediaUrl = `/api/updates/media/${req.file.filename}`;
    } catch (err) {
      if (fs.existsSync(filePath)) {
        try { fs.unlinkSync(filePath); } catch {}
      }
      throw err;
    }
  } else if (!rawText) {
    throw ApiError.badRequest("Status text or media is required");
  }

  if (rawText.length > 300) {
    throw ApiError.badRequest("Status text cannot exceed 300 characters");
  }

  const update = await StatusUpdate.create({
    user: req.user._id,
    text: rawText,
    color,
    mediaUrl,
    mediaType,
    views: [],
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  });

  const populated = await update.populate("user", "name avatar color role dept email");
  res.status(201).json({ success: true, data: populated });
});

/**
 * POST /api/updates/:id/view — record authenticated user view on a status.
 */
exports.recordView = asyncHandler(async (req, res) => {
  const status = await StatusUpdate.findById(req.params.id);
  if (!status) {
    throw ApiError.notFound("Status update not found");
  }

  if (new Date() > new Date(status.expiresAt)) {
    throw ApiError.badRequest("This status update has expired");
  }

  const currentUserId = String(req.user._id);
  const isOwner = String(status.user) === currentUserId;

  // Don't track owner's own views as viewer count
  if (!isOwner) {
    const alreadyViewed = status.views.some((v) => String(v.user) === currentUserId);
    if (!alreadyViewed) {
      status.views.push({
        user: req.user._id,
        viewedAt: new Date(),
      });
      await status.save();
    }
  }

  res.json({
    success: true,
    data: {
      viewed: true,
      viewCount: status.views.length,
    },
    viewed: true,
    viewCount: status.views.length,
  });
});

/**
 * GET /api/updates/:id/viewers — only the status author can view the viewer list.
 */
exports.getViewers = asyncHandler(async (req, res) => {
  const status = await StatusUpdate.findById(req.params.id).populate(
    "views.user",
    "name avatar color role dept email"
  );

  if (!status) {
    throw ApiError.notFound("Status update not found");
  }

  const currentUserId = String(req.user._id);
  const isOwner = String(status.user) === currentUserId;

  if (!isOwner && req.user.role !== "admin") {
    throw ApiError.forbidden("Only the status author can view the viewer list");
  }

  const viewersList = status.views.map((v) => ({
    user: v.user,
    viewedAt: v.viewedAt,
  }));

  res.json({
    success: true,
    data: viewersList,
    totalViews: status.views.length,
    viewers: viewersList,
  });
});

/**
 * GET /api/updates/media/:filename — authenticated media streaming with Range support.
 */
exports.streamMedia = asyncHandler(async (req, res) => {
  const filename = path.basename(String(req.params.filename || ""));
  if (!/^status-\d+-[a-f0-9]+\.(png|jpg|jpeg|gif|webp|mp4|webm|ogg|mov)$/i.test(filename)) {
    throw ApiError.badRequest("Invalid status media filename");
  }

  // Find status record containing this mediaUrl
  const expectedUrl = `/api/updates/media/${filename}`;
  const status = await StatusUpdate.findOne({ mediaUrl: expectedUrl });
  if (!status) {
    throw ApiError.notFound("Status media not found");
  }

  if (new Date() > new Date(status.expiresAt)) {
    throw ApiError.notFound("Status media has expired");
  }

  // Locate file under uploads-media/status/<userId>/<filename>
  const ownerId = String(status.user);
  const filePath = path.join(uploadRoot, ownerId, filename);

  if (!fs.existsSync(filePath)) {
    throw ApiError.notFound("Media file not found on disk");
  }

  const stat = fs.statSync(filePath);
  const fileSize = stat.size;
  const ext = path.extname(filename).toLowerCase().replace(".", "");

  const mimeMap = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    mp4: "video/mp4",
    webm: "video/webm",
    ogg: "video/ogg",
    mov: "video/quicktime",
  };
  const contentType = mimeMap[ext] || "application/octet-stream";

  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Type", contentType);
  res.setHeader("Content-Disposition", `inline; filename="${filename}"`);

  // Handle Range requests (HTTP 206) for video seeking
  const range = req.headers.range;
  if (range) {
    const parts = range.replace(/bytes=/, "").split("-");
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

    if (start >= fileSize || end >= fileSize || start > end) {
      res.setHeader("Content-Range", `bytes */${fileSize}`);
      return res.status(416).end();
    }

    const chunksize = end - start + 1;
    res.writeHead(206, {
      "Content-Range": `bytes ${start}-${end}/${fileSize}`,
      "Accept-Ranges": "bytes",
      "Content-Length": chunksize,
      "Content-Type": contentType,
    });
    fs.createReadStream(filePath, { start, end }).pipe(res);
  } else {
    res.setHeader("Content-Length", fileSize);
    res.setHeader("Accept-Ranges", "bytes");
    res.status(200);
    fs.createReadStream(filePath).pipe(res);
  }
});

/**
 * DELETE /api/updates/:id — delete own status update.
 */
exports.remove = asyncHandler(async (req, res) => {
  const update = await StatusUpdate.findById(req.params.id);
  if (!update) throw ApiError.notFound("Status update not found");

  if (String(update.user) !== String(req.user._id) && req.user.role !== "admin") {
    throw ApiError.forbidden("You cannot delete another user's status update");
  }

  // Cleanup media file if present
  if (update.mediaUrl) {
    const filename = path.basename(update.mediaUrl);
    const ownerId = String(update.user);
    const filePath = path.join(uploadRoot, ownerId, filename);
    if (fs.existsSync(filePath)) {
      try { fs.unlinkSync(filePath); } catch {}
    }
  }

  await update.deleteOne();
  res.json({ success: true, message: "Status update deleted" });
});
