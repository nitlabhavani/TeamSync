import { api, normalize, SERVER_URL, getToken, API_URL } from "../lib/apiClient";

/** Prefix relative /uploads paths with the API host. */
export const assetUrl = (url) =>
  url && url.startsWith("/uploads") ? `${SERVER_URL}${url}` : url || "";

const shape = (user) => {
  const u = normalize(user) || {};
  return {
    ...u,
    personal: u.personal || {},
    academic: u.academic || {},
    social: u.social || {},
    professional: u.professional || {},
    settings: u.settings || {},
    skills: u.skills || [],
    programmingLanguages: u.programmingLanguages || [],
    frameworks: u.frameworks || [],
    tools: u.tools || [],
    certifications: (u.certifications || []).map((c) => ({ ...c, href: assetUrl(c.url) })),
    resume: u.resume?.url ? { ...u.resume, href: assetUrl(u.resume.url) } : null,
    avatarUrl: assetUrl(u.avatar),
  };
};

export const getMyProfile = async () => shape(await api.get("/users/me/profile"));

export const updateMyProfile = async (payload) => shape(await api.patch("/users/me", payload));

const uploadFile = (path, file, extra = {}, onProgress) => {
  const form = new FormData();
  form.append("file", file);
  Object.entries(extra).forEach(([k, v]) => v && form.append(k, v));
  return api.upload(path, form, onProgress);
};

export const uploadAvatar = (file, onProgress) => {
  if (!file.type.startsWith("image/")) throw new Error("Profile picture must be an image.");
  return uploadFile("/users/me/avatar", file, {}, onProgress);
};

export const uploadResume = (file, onProgress) => {
  if (file.type !== "application/pdf") throw new Error("Resume must be a PDF file.");
  if (file.size > 25 * 1024 * 1024) throw new Error("Resume must be smaller than 25 MB.");
  return uploadFile("/users/me/resume", file, {}, onProgress);
};

export const updateSettings = (payload) => api.patch("/users/me/settings", payload);

export const changePassword = (payload) => api.post("/users/me/password", payload);

export const deleteResume = () => api.del("/users/me/resume");

export const uploadCertificate = (file, meta = {}, onProgress) => {
  const ok = file.type === "application/pdf" || file.type.startsWith("image/");
  if (!ok) throw new Error("Certificates must be a PDF or an image.");
  return uploadFile("/users/me/certificates", file, meta, onProgress);
};

export const deleteCertificate = (certId) => api.del(`/users/me/certificates/${certId}`);

/** Authenticated blob download (used for "Download resume"). */
export const downloadFile = async (url, filename) => {
  const href = assetUrl(url);
  const res = await fetch(href, {
    headers: getToken() ? { Authorization: `Bearer ${getToken()}` } : {},
    credentials: "include",
  });
  if (!res.ok) throw new Error("Could not download the file.");
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = objectUrl;
  a.download = filename || "download";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(objectUrl);
};

export const PROFILE_API = API_URL;
