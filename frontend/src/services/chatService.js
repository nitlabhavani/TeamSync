import { api, normalize, idOf, SERVER_URL } from "../lib/apiClient";

// Attachment URLs are stored relative (e.g. "/uploads/<groupId>/<file>"),
// same as FileAsset.url in fileService.js — prefix with the backend's own
// origin (not the frontend's) so the browser fetches from the API server
// rather than treating it as relative to whatever page is currently open.
//
// PRIVATE VOICE MESSAGES (type "audio") are the one exception: their `url`
// is an API-relative path ("/chat/direct/:userId/voice/:filename") meant
// only for api.getBlob() — which itself appends the already-/api-rooted
// API_URL — never for a direct <a href>/static fetch, since the streaming
// endpoint requires the app's own Bearer auth. Prefixing it with SERVER_URL
// here would produce a URL that 404s if ever used directly, so it is left
// exactly as the backend returned it. See AudioMessage.jsx.
const toAttachment = (a) => {
  if (a?.type === "audio" || (typeof a?.url === "string" && a.url.startsWith("/chat/direct/"))) {
    return { ...a }; // never prefixed — fetched via api.getBlob() with Bearer auth
  }
  return {
    ...a,
    url: a?.url && !/^https?:\/\//i.test(a.url) ? `${SERVER_URL}${a.url}` : a?.url,
  };
};

export const toMessage = (m) => {
  const msg = normalize(m);
  return {
    ...msg,
    senderId: idOf(msg.sender),
    senderName: msg.sender?.name,
    senderColor: msg.sender?.color,
    readBy: (msg.readBy || []).map((r) => idOf(r)),
    time: msg.createdAt || msg.time || new Date().toISOString(),
    attachments: (msg.attachments || []).map(toAttachment),
  };
};

export const getGroupMessages = async (groupId, limit = 50) =>
  (await api.get(`/groups/${groupId}/messages?limit=${limit}`)).map(toMessage);

export const getPrivateMessages = async (userId) =>
  (await api.get(`/chat/direct/${userId}`)).map(toMessage);

export const getConversations = async () => normalize(await api.get("/chat/conversations"));

/**
 * Sends a message. `conversationId` is a group id when `scope` is "group"
 * (default), otherwise the other participant's user id.
 *
 * `attachments` is an array of already-uploaded file metadata —
 * {name, url, size, type, mimeType}. For group scope the file was
 * uploaded via /groups/:groupId/files (fileService.uploadFile/uploadFiles);
 * for direct scope it was uploaded via /chat/direct/:userId/files
 * (fileService.uploadDirectFile) — see ChatInput.jsx/useFileUpload.js.
 * Both scopes now forward attachments the same way (previously "direct"
 * silently dropped them, which was the root cause of private chat having
 * no file sharing even after selecting/uploading a file).
 */
export const sendMessage = async ({ conversationId, text, scope = "group", attachments }) => {
  const path =
    scope === "direct" ? `/chat/direct/${conversationId}` : `/groups/${conversationId}/messages`;
  const body = { text, attachments: attachments || [] };
  return toMessage(await api.post(path, body));
};

export const deleteMessage = async (messageId) => api.del(`/chat/messages/${messageId}`);

/** Marks a whole conversation as read for the signed-in user. */
export const markRead = async ({ conversationId, scope = "group" }) => {
  const path =
    scope === "direct"
      ? `/chat/direct/${conversationId}/read`
      : `/groups/${conversationId}/messages/read`;
  try {
    return await api.post(path, {});
  } catch {
    return null;
  }
};

export const summarizeGroupChat = async (groupId) => api.get(`/groups/${groupId}/messages/summary`);
