import { api, normalize, idOf, SERVER_URL } from "../lib/apiClient";

const toFile = (f) => {
  const file = normalize(f);
  return {
    ...file,
    uploadedBy: idOf(file.uploadedBy),
    uploadedByUser: file.uploadedBy,
    uploadedAt: file.createdAt || file.uploadedAt,
    url: file.url ? `${SERVER_URL}${file.url}` : undefined,
  };
};

export const getGroupFiles = async (groupId) =>
  (await api.get(`/groups/${groupId}/files`)).map(toFile);

export const uploadFile = async ({ groupId, file, onProgress }) => {
  const form = new FormData();
  form.append("file", file);
  return toFile(await api.upload(`/groups/${groupId}/files`, form, onProgress));
};

export const uploadFiles = async ({ groupId, files, onProgress }) => {
  const form = new FormData();
  for (const file of files) form.append("files", file);
  const result = await api.upload(`/groups/${groupId}/files`, form, onProgress);
  const list = Array.isArray(result) ? result : [result];
  return list.map(toFile);
};

export const deleteFile = async (groupId, fileId) => {
  await api.del(`/groups/${groupId}/files/${fileId}`);
  return { deleted: true, fileId };
};

export const downloadUrl = (groupId, fileId) =>
  `${SERVER_URL}/api/groups/${groupId}/files/${fileId}/download`;

/**
 * PRIVATE CHAT FILE SHARING — uploads a file for the 1:1 conversation with
 * `peerUserId`, via the new /chat/direct/:userId/files endpoint (see
 * backend/src/controllers/chatController.js). Deliberately does NOT call
 * getGroupFiles/uploadFile above or create a FileAsset: this is a separate
 * endpoint precisely so a private attachment is never listed in any
 * group's "Shared Files" tab and never touches group file AI analysis.
 * Returns the plain {name, url, size, type, mimeType} shape the chat
 * message attachments array expects — no `normalize()`/`toFile()`, since
 * there is no Mongoose document (no `_id`, no `uploadedBy`) here.
 */
export const uploadDirectFile = async ({ peerUserId, file, onProgress }) => {
  const form = new FormData();
  form.append("file", file);
  const saved = await api.upload(`/chat/direct/${peerUserId}/files`, form, onProgress);
  return {
    ...saved,
    url: saved.url ? `${SERVER_URL}${saved.url}` : undefined,
  };
};

/**
 * PRIVATE VOICE MESSAGES — uploads a real recorded audio Blob for the 1:1
 * conversation with `peerUserId`, via the new
 * POST /chat/direct/:userId/voice endpoint (directVoiceUpload.js +
 * chatController.uploadDirectVoice). Deliberately separate from
 * uploadDirectFile above (different endpoint, different storage root,
 * audio-mime-restricted) so a voice note can never be mistaken for or
 * mixed with an ordinary private file attachment. `duration` is the real
 * seconds measured by the recorder (see useVoiceRecorder.js) — never a
 * guess — and is re-clamped server-side regardless.
 */
export const uploadDirectVoice = async ({ peerUserId, blob, mimeType, duration, onProgress }) => {
  const ext = (mimeType.split("/")[1] || "webm").split(";")[0];
  const form = new FormData();
  form.append("audio", blob, `voice-message.${ext}`);
  form.append("duration", String(Math.round(duration || 0)));
  // NOTE: unlike uploadDirectFile above, the returned `url` is deliberately
  // left exactly as the backend sent it (an API-relative path like
  // "/chat/direct/:userId/voice/:filename") rather than prefixed with
  // SERVER_URL. It is never used as a direct <a href>/static asset URL —
  // AudioMessage.jsx always fetches it through api.getBlob(), which expects
  // an API-relative path and attaches the Bearer token the authenticated
  // streaming endpoint requires. See chatService.toAttachment for the
  // matching read-side behavior.
  return api.upload(`/chat/direct/${peerUserId}/voice`, form, onProgress);
};

/**
 * PRIVATE MEDIA SHARING (Photos & Videos) — uploads a photo or video for the 1:1
 * conversation with `peerUserId` via POST /chat/direct/:userId/media.
 * Uses authenticated upload with magic-bytes verification.
 * Returns { name, url, size, type: "image" | "video", mimeType }.
 */
export const uploadDirectMedia = async ({ peerUserId, file, onProgress }) => {
  const form = new FormData();
  form.append("media", file);
  return api.upload(`/chat/direct/${peerUserId}/media`, form, onProgress);
};
