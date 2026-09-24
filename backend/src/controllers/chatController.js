const path = require("path");
const fs = require("fs");
const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/apiError");
const Message = require("../models/Message");
const Group = require("../models/Group");
const { summarizeConversation } = require("../services/aiService");
const { notifyUsers } = require("../services/notificationService");
const { emitToGroup, emitToUser } = require("../services/socketService");
const { processGroupMessageForTasks } = require("../services/chatTaskService");
const { analyzeGroupMessageForConflicts } = require("../services/conflictDetectionService");
// Reused unchanged for file-type classification — no second implementation
// (mirrors the "reuse, not duplication" rule already used throughout this
// codebase's AI/knowledge services).
const { kindOf } = require("../controllers/fileController");
const { verifyAudioFile } = require("../utils/audioMagicBytes");
const { verifyMediaFile } = require("../utils/mediaMagicBytes");

exports.groupMessages = asyncHandler(async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const messages = await Message.find({ group: req.group._id, deleted: false })
    .populate("sender", "name color avatar")
    .sort("-createdAt")
    .limit(limit);
  res.json({ success: true, data: messages.reverse() });
});

// Longest a single private voice note's reported duration is ever trusted
// for (seconds) — matches the frontend's own recording cutoff (see
// useVoiceRecorder.js / constants.js), so a tampered client-reported value
// can never inflate the stored duration beyond what a real recording could
// have produced.
const MAX_VOICE_DURATION_SECONDS = Number(process.env.MAX_VOICE_DURATION_SECONDS || 120);

// Only these fields are ever trusted from a client-supplied attachment
// object — the file itself was already uploaded (and validated, and
// scoped to this group) via POST /groups/:groupId/files, so all a chat
// message needs is the resulting FileAsset's public metadata. Anything
// else on the payload is dropped rather than persisted verbatim.
const sanitizeAttachments = (attachments) => {
  if (!Array.isArray(attachments)) return [];
  return attachments
    .filter((a) => a && typeof a.url === "string" && a.url.trim())
    .slice(0, 10)
    .map((a) => ({
      name: String(a.name || "file").slice(0, 255),
      url: String(a.url),
      size: Number.isFinite(a.size) ? a.size : 0,
      type: a.type ? String(a.type).slice(0, 40) : "file",
      mimeType: a.mimeType ? String(a.mimeType).slice(0, 120) : undefined,
      // PRIVATE VOICE MESSAGES — only meaningful for type "audio"; clamped
      // to MAX_VOICE_DURATION_SECONDS so a manipulated client payload can
      // never claim a longer recording than the server-side upload limit
      // (directVoiceUpload.js) would ever actually allow.
      duration:
        a.type === "audio" && Number.isFinite(a.duration)
          ? Math.max(0, Math.min(Number(a.duration), MAX_VOICE_DURATION_SECONDS))
          : undefined,
    }));
};

exports.sendGroupMessage = asyncHandler(async (req, res) => {
  const text = typeof req.body.text === "string" ? req.body.text.trim() : "";
  const attachments = sanitizeAttachments(req.body.attachments);
  if (!text && !attachments.length) {
    throw ApiError.badRequest("Message must contain text or at least one attachment");
  }

  const message = await Message.create({
    group: req.group._id,
    sender: req.user._id,
    text,
    attachments,
  });
  const populated = await message.populate("sender", "name color avatar");
  emitToGroup(req.group._id, "group:message", populated);

  const preview = text ? text.slice(0, 80) : `📎 ${attachments[0]?.name || "sent a file"}`;
  await notifyUsers(req.group.members, {
    title: `New message in ${req.group.name}`,
    body: `${req.user.name}: ${preview}`,
    type: "chat",
    // STEP 34 — this notification's `group` id was already stored, but
    // `link` was never set, so clicking it did nothing (Notifications.jsx
    // only navigates when `n.link` is truthy). `link` points at the exact
    // group's workspace via its authoritative _id (never `req.group.name`,
    // which two groups can share). `message` additionally carries the exact
    // Message _id so the chat page can scroll to and highlight it — see
    // GroupContext.setPendingMessageTarget / GroupDetails.jsx.
    link: `/app/groups/${req.group._id}`,
    group: req.group._id,
    message: message._id,
  }, { exclude: req.user._id });

  // AI-based automatic task assignment from group chat: fire-and-forget so
  // a slow or unreachable AI engine can never delay or fail chat delivery
  // (the response below is already on its way regardless of this outcome).
  // See chatTaskService.js — this is only ever triggered for GROUP chat
  // messages, never direct/private messages (sendDirectMessage below has
  // no equivalent call).
  processGroupMessageForTasks({ message, group: req.group, sender: req.user, isGuide: req.isGuide }).catch((err) => {
    // eslint-disable-next-line no-console -- required debug checkpoint; never swallow silently
    console.error(`[chat-task] ERROR: processing failed for message ${message._id}: ${err.message}`);
  });

  // STEP 24 — AI Conflict Detection: same fire-and-forget pattern as the
  // task-extraction call directly above. Re-scans this group's recent
  // GROUP messages only (never private/direct chat — see
  // conflictDetectionService.isGroupMessage/belongsToGroup) and is fully
  // independent of the task-extraction outcome, so a failure here can
  // never delay or break message delivery, task extraction, or chat.
  analyzeGroupMessageForConflicts({ group: req.group }).catch((err) => {
    // eslint-disable-next-line no-console -- required debug checkpoint; never swallow silently
    console.error(`[conflict-detection] ERROR: analysis failed for group ${req.group._id}: ${err.message}`);
  });

  res.status(201).json({ success: true, data: populated });
});

exports.directMessages = asyncHandler(async (req, res) => {
  const key = Message.conversationKey(req.user._id, req.params.userId);
  const messages = await Message.find({ conversation: key, deleted: false })
    .populate("sender", "name color avatar")
    .sort("createdAt")
    .limit(200);
  res.json({ success: true, data: messages });
});

exports.sendDirectMessage = asyncHandler(async (req, res) => {
  const text = typeof req.body.text === "string" ? req.body.text.trim() : "";
  // Same sanitizer as sendGroupMessage — only the safe {name, url, size,
  // type, mimeType} fields from an already-uploaded attachment are ever
  // trusted/persisted (see uploadDirectFile below for the only endpoint
  // that produces one of these for a private conversation).
  const attachments = sanitizeAttachments(req.body.attachments);
  if (!text && !attachments.length) {
    throw ApiError.badRequest("Message must contain text or at least one attachment");
  }

  // PRIVATE MEDIA & VOICE MESSAGES: determine type if message is media-only
  const isVoiceMessage = !text && attachments.length === 1 && attachments[0].type === "audio";
  const isImageMessage = !text && attachments.length === 1 && attachments[0].type === "image";
  const isVideoMessage = !text && attachments.length === 1 && attachments[0].type === "video";
  let messageType = "text";
  if (isVoiceMessage) messageType = "voice";
  else if (isImageMessage) messageType = "image";
  else if (isVideoMessage) messageType = "video";

  const message = await Message.create({
    conversation: Message.conversationKey(req.user._id, req.params.userId),
    sender: req.user._id,
    recipient: req.params.userId,
    text,
    type: messageType,
    attachments,
  });
  const populated = await message.populate("sender", "name color avatar");
  emitToUser(req.params.userId, "direct:message", populated);
  const preview = text
    ? text.slice(0, 80)
    : isVoiceMessage
    ? "🎤 Voice message"
    : isImageMessage
    ? "📷 Photo"
    : isVideoMessage
    ? "🎥 Video"
    : `📎 ${attachments[0]?.name || "sent a file"}`;
  const isGuideRecipient = req.peer?.role === "guide" || req.peer?.role === "admin";
  const notificationLink = isGuideRecipient ? `/guide/chat/${req.user._id}` : `/app/chat/${req.user._id}`;
  await notifyUsers([req.params.userId], {
    title: `Message from ${req.user.name}`,
    body: preview,
    type: "chat",
    link: notificationLink,
  });
  res.status(201).json({ success: true, data: populated });
});

/**
 * PRIVATE CHAT FILE SHARING (fixes: "Private/Single Chat does not provide
 * file sharing").
 *
 * POST /chat/direct/:userId/files — uploads a file for the private
 * conversation between the caller and :userId, using the same disk-based
 * multer storage/limits as group chat (middleware/directUpload.js), and
 * returns {name, url, size, type, mimeType} — the exact shape
 * sendDirectMessage's sanitizeAttachments expects, and the exact shape
 * ChatInput.jsx already builds for group chat. No FileAsset document is
 * created and no group is touched in any way: this is deliberately NOT the
 * same code path as fileController.upload, so a private attachment can
 * never appear in a group's "Shared Files" tab, group file AI analysis,
 * group file-uploaded notifications/sockets, Project Knowledge, or the
 * Project Memory Assistant (which never reads Message documents at all —
 * see services/projectMemoryAssistantService.js).
 */
exports.uploadDirectFile = asyncHandler(async (req, res) => {
  const uploads = req.files || (req.file ? [req.file] : []);
  if (!uploads.length) throw ApiError.badRequest("No file uploaded");

  const conversationKey = Message.conversationKey(req.user._id, req.params.userId);
  const saved = uploads.map((file) => ({
    name: file.originalname,
    url: `/uploads/private/${conversationKey}/${file.filename}`,
    size: file.size,
    mimeType: file.mimetype,
    type: kindOf(file.mimetype, file.originalname),
  }));

  res.status(201).json({ success: true, data: saved.length === 1 ? saved[0] : saved });
});

/**
 * GET /chat/direct/:userId/files/:filename/download — authenticated
 * re-derivation of the same conversationKey used at upload time. A
 * non-participant cannot access another pair's private attachment by
 * manipulating :userId: the folder actually read is
 * conversationKey(req.user._id, req.params.userId) — for that to resolve
 * to a real, populated conversation folder, req.user must genuinely be one
 * of that conversation's two participants. Guessing someone else's
 * conversation and supplying their id as :userId only ever computes a
 * DIFFERENT (empty) key, never the real pair's folder.
 */
exports.downloadDirectFile = asyncHandler(async (req, res) => {
  const conversationKey = Message.conversationKey(req.user._id, req.params.userId);
  const baseUploadDir = process.env.UPLOAD_DIR || "uploads";
  const uploadRoot = path.isAbsolute(baseUploadDir)
    ? path.join(baseUploadDir, "private")
    : path.join(__dirname, "..", "..", baseUploadDir, "private");
  const safeFilename = path.basename(req.params.filename); // never allow ../ traversal
  const targetDir = path.resolve(path.join(uploadRoot, conversationKey));
  const abs = path.resolve(targetDir, safeFilename);
  if (!abs.startsWith(targetDir)) throw ApiError.forbidden("Access denied: path traversal detected");
  if (!fs.existsSync(abs)) throw ApiError.notFound("File not found");
  res.download(abs);
});

/**
 * PRIVATE VOICE MESSAGES.
 *
 * POST /chat/direct/:userId/voice — uploads a REAL MediaRecorder-captured
 * audio blob for the private conversation between the caller and :userId.
 * Deliberately a separate endpoint/middleware (directVoiceUpload.js) from
 * uploadDirectFile above: audio is (a) mime-restricted to real recorder
 * output formats, (b) verified via real binary file signatures (magic bytes)
 * so disguised non-audio or corrupt uploads are rejected immediately,
 * (c) stored under a completely different, non-statically-served root so it
 * is unreachable except through streamDirectVoice below, and (d) never
 * becomes a FileAsset / never appears in a group's Shared Files.
 *
 * `req.body.duration` is the actual recorded duration (seconds) the client
 * measured from its own MediaRecorder session — trusted only as a display
 * hint here and re-clamped again in sanitizeAttachments when the message is
 * actually created, so a manipulated value can never persist unclamped.
 */
exports.uploadDirectVoice = asyncHandler(async (req, res) => {
  if (!req.file) throw ApiError.badRequest("No audio recorded");

  // Phase 4: Verify real audio magic bytes / file signature to prevent MIME-spoofing
  const audioCheck = verifyAudioFile(req.file.path);
  if (!audioCheck.valid) {
    try {
      fs.unlinkSync(req.file.path);
    } catch {
      /* ignore */
    }
    throw ApiError.badRequest(audioCheck.reason || "Invalid audio recording signature");
  }

  const rawDuration = Number(req.body.duration);
  const duration = Number.isFinite(rawDuration) && rawDuration >= 0 ? Math.round(rawDuration) : 0;

  res.status(201).json({
    success: true,
    data: {
      name: "Voice message",
      // Authenticated streaming endpoint path, API-relative (no leading
      // "/api" — the frontend appends this directly to its already-/api-
      // rooted API_URL via api.getBlob(), exactly like every other
      // authenticated GET in this app; see fileService.uploadDirectVoice /
      // chatService.toAttachment for why voice attachments deliberately
      // skip the SERVER_URL-prefixing regular file attachments get).
      url: `/chat/direct/${req.params.userId}/voice/${req.file.filename}`,
      size: req.file.size,
      mimeType: req.file.mimetype,
      type: "audio",
      duration,
    },
  });
});

/**
 * GET /chat/direct/:userId/voice/:filename — authenticated, Range-aware
 * audio streaming for playback (never a bare filesystem path). Re-derives
 * the same conversationKey directVoiceUpload.js wrote to; a non-participant
 * guessing :userId only ever computes a DIFFERENT (nonexistent) folder,
 * exactly like downloadDirectFile's existing authorization pattern.
 *
 * Uses Content-Disposition: inline (not `res.download`'s `attachment`) and
 * honors Range requests so the browser <audio> element can seek/scrub
 * without downloading the whole clip up front.
 */
exports.streamDirectVoice = asyncHandler(async (req, res) => {
  const baseVoiceDir = process.env.VOICE_UPLOAD_DIR || "uploads-voice";
  const uploadRoot = path.isAbsolute(baseVoiceDir)
    ? path.join(baseVoiceDir, "private")
    : path.join(__dirname, "..", "..", baseVoiceDir, "private");
  const safeFilename = path.basename(req.params.filename); // never allow ../ traversal

  // Strict filename validation: must match expected server-generated pattern
  if (!/^voice-\d+-[a-z0-9]+\.[a-z0-9]+$/i.test(safeFilename)) {
    throw ApiError.badRequest("Invalid voice message filename");
  }

  let conversationKey = null;
  if (req.params.userId && String(req.user._id) !== String(req.params.userId)) {
    conversationKey = Message.conversationKey(req.user._id, req.params.userId);
  }
  if (!conversationKey || !fs.existsSync(path.join(uploadRoot, conversationKey, safeFilename))) {
    if (fs.existsSync(uploadRoot)) {
      const userStr = String(req.user._id);
      const folders = fs.readdirSync(uploadRoot);
      for (const f of folders) {
        if (f.includes(userStr)) {
          if (fs.existsSync(path.join(uploadRoot, f, safeFilename))) {
            conversationKey = f;
            break;
          }
        }
      }
    }
  }
  if (!conversationKey) throw ApiError.notFound("Voice message not found");

  const targetDir = path.resolve(path.join(uploadRoot, conversationKey));
  const abs = path.resolve(targetDir, safeFilename);
  if (!abs.startsWith(targetDir)) {
    throw ApiError.forbidden("Access denied: path traversal detected");
  }

  if (!fs.existsSync(abs)) throw ApiError.notFound("Voice message not found");

  const stat = fs.statSync(abs);
  const ext = path.extname(safeFilename).slice(1).toLowerCase();
  const mimeByExt = { webm: "audio/webm", ogg: "audio/ogg", mp4: "audio/mp4", mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/m4a", aac: "audio/aac" };
  const contentType = mimeByExt[ext] || "application/octet-stream";

  const range = req.headers.range;
  if (!range) {
    res.set({
      "Content-Type": contentType,
      "Content-Length": stat.size,
      "Content-Disposition": "inline",
      "Accept-Ranges": "bytes",
    });
    fs.createReadStream(abs).pipe(res);
    return;
  }

  const match = /bytes=(\d*)-(\d*)/.exec(range);
  const start = match && match[1] ? parseInt(match[1], 10) : 0;
  const end = match && match[2] ? parseInt(match[2], 10) : stat.size - 1;
  if (Number.isNaN(start) || Number.isNaN(end) || start > end || end >= stat.size) {
    res.status(416).set({ "Content-Range": `bytes */${stat.size}` }).end();
    return;
  }
  res.status(206).set({
    "Content-Type": contentType,
    "Content-Range": `bytes ${start}-${end}/${stat.size}`,
    "Accept-Ranges": "bytes",
    "Content-Length": end - start + 1,
    "Content-Disposition": "inline",
  });
  fs.createReadStream(abs, { start, end }).pipe(res);
});

/**
 * POST /chat/direct/:userId/media — uploads a private image or video.
 * Validates magic bytes / binary file signature to reject MIME-spoofed or corrupt files.
 * Rejects non-image and non-video files.
 * Enforces 15MB limit for photos, 50MB limit for videos.
 * Cleans up invalid files from disk immediately.
 */
exports.uploadDirectMedia = asyncHandler(async (req, res) => {
  if (!req.file) throw ApiError.badRequest("No media file uploaded");

  // Verify binary magic bytes
  const mediaCheck = verifyMediaFile(req.file.path);
  if (!mediaCheck.valid) {
    try {
      fs.unlinkSync(req.file.path);
    } catch {
      /* ignore */
    }
    throw ApiError.badRequest(mediaCheck.reason || "Invalid media file signature");
  }

  const isVideo = mediaCheck.type === "video" || req.file.mimetype.startsWith("video/");
  const isImage = mediaCheck.type === "image" || req.file.mimetype.startsWith("image/");
  const mediaType = isVideo ? "video" : isImage ? "image" : "file";

  // Individual size limit check: 15MB for images
  if (isImage && req.file.size > 15 * 1024 * 1024) {
    try {
      fs.unlinkSync(req.file.path);
    } catch {
      /* ignore */
    }
    throw ApiError.badRequest("Image size exceeds the 15MB limit");
  }

  res.status(201).json({
    success: true,
    data: {
      name: req.file.originalname || (isVideo ? "Video" : "Photo"),
      url: `/chat/direct/${req.params.userId}/media/${req.file.filename}`,
      size: req.file.size,
      mimeType: req.file.mimetype,
      type: mediaType,
    },
  });
});

/**
 * GET /chat/direct/:userId/media/:filename — authenticated, Range-aware
 * photo and video streaming/serving (never a bare public filesystem path).
 *
 * Enforces validateDirectPeer, derives conversationKey, validates filename,
 * supports Range headers for video seeking, and sets Content-Disposition: inline.
 */
exports.streamDirectMedia = asyncHandler(async (req, res) => {
  const baseMediaDir = process.env.MEDIA_UPLOAD_DIR || "uploads-media";
  const uploadRoot = path.isAbsolute(baseMediaDir)
    ? path.join(baseMediaDir, "private")
    : path.join(__dirname, "..", "..", baseMediaDir, "private");
  const safeFilename = path.basename(req.params.filename);

  // Strict filename validation: must match server-generated pattern
  if (!/^media-\d+-[a-z0-9]+\.[a-z0-9]+$/i.test(safeFilename)) {
    throw ApiError.badRequest("Invalid media filename");
  }

  let conversationKey = null;
  if (req.params.userId && String(req.user._id) !== String(req.params.userId)) {
    conversationKey = Message.conversationKey(req.user._id, req.params.userId);
  }
  if (!conversationKey || !fs.existsSync(path.join(uploadRoot, conversationKey, safeFilename))) {
    if (fs.existsSync(uploadRoot)) {
      const userStr = String(req.user._id);
      const folders = fs.readdirSync(uploadRoot);
      for (const f of folders) {
        if (f.includes(userStr)) {
          if (fs.existsSync(path.join(uploadRoot, f, safeFilename))) {
            conversationKey = f;
            break;
          }
        }
      }
    }
  }
  if (!conversationKey) throw ApiError.notFound("Media file not found");

  const targetDir = path.resolve(path.join(uploadRoot, conversationKey));
  const abs = path.resolve(targetDir, safeFilename);
  if (!abs.startsWith(targetDir)) {
    throw ApiError.forbidden("Access denied: path traversal detected");
  }

  if (!fs.existsSync(abs)) throw ApiError.notFound("Media file not found");

  const stat = fs.statSync(abs);
  const ext = path.extname(safeFilename).slice(1).toLowerCase();
  const mimeByExt = {
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
  const contentType = mimeByExt[ext] || "application/octet-stream";

  const range = req.headers.range;
  if (!range) {
    res.set({
      "Content-Type": contentType,
      "Content-Length": stat.size,
      "Content-Disposition": "inline",
      "Accept-Ranges": "bytes",
    });
    fs.createReadStream(abs).pipe(res);
    return;
  }

  const match = /bytes=(\d*)-(\d*)/.exec(range);
  const start = match && match[1] ? parseInt(match[1], 10) : 0;
  const end = match && match[2] ? parseInt(match[2], 10) : stat.size - 1;
  if (Number.isNaN(start) || Number.isNaN(end) || start > end || end >= stat.size) {
    res.status(416).set({ "Content-Range": `bytes */${stat.size}` }).end();
    return;
  }
  res.status(206).set({
    "Content-Type": contentType,
    "Content-Range": `bytes ${start}-${end}/${stat.size}`,
    "Accept-Ranges": "bytes",
    "Content-Length": end - start + 1,
    "Content-Disposition": "inline",
  });
  fs.createReadStream(abs, { start, end }).pipe(res);
});

exports.conversations = asyncHandler(async (req, res) => {
  const messages = await Message.find({
    $or: [{ sender: req.user._id }, { recipient: req.user._id }],
    conversation: { $ne: null },
    deleted: false,
  })
    .populate("sender recipient", "name color avatar role dept")
    .sort("-createdAt")
    .lean();

  const seen = new Map();
  const unreadCounts = new Map();

  messages.forEach((m) => {
    const isRecipient = String(m.recipient?._id || m.recipient) === String(req.user._id);
    const isUnread = isRecipient && (!m.readBy || !m.readBy.some((r) => String(r) === String(req.user._id)));

    if (isUnread) {
      unreadCounts.set(m.conversation, (unreadCounts.get(m.conversation) || 0) + 1);
    }

    if (!seen.has(m.conversation)) {
      const other = String(m.sender?._id || m.sender) === String(req.user._id) ? m.recipient : m.sender;
      if (other && other._id) {
        let lastPreview = m.text || "";
        if (!lastPreview && m.type === "voice") {
          lastPreview = "🎤 Voice message";
        } else if (!lastPreview && m.type === "image") {
          lastPreview = "📷 Photo";
        } else if (!lastPreview && m.type === "video") {
          lastPreview = "🎥 Video";
        } else if (!lastPreview && m.attachments?.length) {
          lastPreview = `📎 ${m.attachments[0]?.name || "Attachment"}`;
        }
        seen.set(m.conversation, {
          conversation: m.conversation,
          user: other,
          lastMessage: lastPreview,
          type: m.type,
          at: m.createdAt,
          unreadCount: 0,
        });
      }
    }
  });

  const result = [...seen.values()].map((conv) => ({
    ...conv,
    unreadCount: unreadCounts.get(conv.conversation) || 0,
  }));

  res.json({ success: true, data: result });
});

exports.remove = asyncHandler(async (req, res) => {
  const message = await Message.findById(req.params.messageId);
  if (!message) throw ApiError.notFound("Message not found");
  if (String(message.sender) !== String(req.user._id)) throw ApiError.forbidden();
  message.deleted = true;
  await message.save();
  res.json({ success: true, message: "Message deleted" });
});

/** AI conversation summary for a group chat. */
exports.summarize = asyncHandler(async (req, res) => {
  const messages = await Message.find({ group: req.group._id, deleted: false })
    .sort("-createdAt")
    .limit(Number(req.query.limit) || 100)
    .lean();
  res.json({ success: true, data: summarizeConversation(messages.reverse()) });
});

/** Mark every message in a group chat as read by the current user. */
exports.markGroupRead = asyncHandler(async (req, res) => {
  const result = await Message.updateMany(
    { group: req.group._id, deleted: false, readBy: { $ne: req.user._id } },
    { $addToSet: { readBy: req.user._id } }
  );
  res.json({ success: true, data: { updated: result.modifiedCount || 0 } });
});

/** Mark a direct conversation as read by the current user. */
exports.markDirectRead = asyncHandler(async (req, res) => {
  const key = Message.conversationKey(req.user._id, req.params.userId);
  const result = await Message.updateMany(
    { conversation: key, deleted: false, readBy: { $ne: req.user._id } },
    { $addToSet: { readBy: req.user._id } }
  );
  res.json({ success: true, data: { updated: result.modifiedCount || 0 } });
});
