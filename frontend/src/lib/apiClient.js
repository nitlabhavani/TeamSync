/**
 * Single HTTP client for the TeamSync AI backend.
 * Base URL comes from VITE_API_URL (see .env.example).
 *
 * IMPORTANT — VITE_API_URL is a Vite *build-time* env var: it gets baked
 * into the compiled JS when `npm run build` runs, not read at runtime in
 * the browser. If the frontend is deployed somewhere other than localhost
 * without VITE_API_URL set at build time, every request silently falls
 * back to http://localhost:5000/api — which the deployed visitor's browser
 * can never reach, and shows up as a generic "Network error" on every API
 * call (login, file upload, everything). Locally this default is correct
 * and harmless, since the backend really is on localhost:5000.
 */
export const API_URL = (
  import.meta.env?.VITE_API_URL ||
  (typeof window !== "undefined" && !["localhost", "127.0.0.1"].includes(window.location.hostname)
    ? "https://teamsync-m6o8.onrender.com/api"
    : "http://localhost:5000/api")
).replace(/\/$/, "");
export const SERVER_URL = API_URL.replace(/\/api$/, "");

if (
  typeof window !== "undefined" &&
  !import.meta.env?.VITE_API_URL &&
  !["localhost", "127.0.0.1"].includes(window.location.hostname)
) {
  console.warn(
    `[teamsync] VITE_API_URL was not set at build time, so the app is falling back to ${API_URL}. ` +
      `That is only reachable from localhost — set VITE_API_URL to this deployment's real backend URL ` +
      `and rebuild, or every request (including file upload) will fail with a network error.`,
  );
}

const TOKEN_KEY = "teamsync_token";
const REFRESH_KEY = "teamsync_refresh_token";
const USER_KEY = "teamsync_session";

export const getToken = () =>
  typeof localStorage === "undefined" ? null : localStorage.getItem(TOKEN_KEY);
export const getRefreshToken = () =>
  typeof localStorage === "undefined" ? null : localStorage.getItem(REFRESH_KEY);

export const setSession = ({ token, refreshToken, user }) => {
  if (typeof localStorage === "undefined") return;
  if (token) localStorage.setItem(TOKEN_KEY, token);
  if (refreshToken) localStorage.setItem(REFRESH_KEY, refreshToken);
  if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
};

export const getStoredUser = () => {
  if (typeof localStorage === "undefined") return null;
  try {
    return JSON.parse(localStorage.getItem(USER_KEY) || "null");
  } catch {
    return null;
  }
};

export const clearSession = () => {
  if (typeof localStorage === "undefined") return;
  [TOKEN_KEY, REFRESH_KEY, USER_KEY].forEach((k) => localStorage.removeItem(k));
};

const parse = async (res) => {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { message: text };
  }
};

async function refreshAccessToken() {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return false;
  const res = await fetch(`${API_URL}/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken }),
  });
  if (!res.ok) return false;
  const body = await parse(res);
  const token = body?.data?.token;
  if (!token) return false;
  setSession({ token, refreshToken: body?.data?.refreshToken });
  return true;
}

/** Wraps fetch() so a real network failure (backend unreachable, DNS, CORS
 *  block, mixed-content) surfaces the URL it was trying to reach instead of
 *  a bare "Failed to fetch" — that's the detail needed to tell "wrong API
 *  URL" apart from "backend is down" apart from "CORS origin mismatch". */
async function fetchOrDiagnose(url, opts) {
  try {
    return await fetch(url, opts);
  } catch (err) {
    throw new Error(
      `Could not reach ${url} (${err.message}). Check that the backend is running and that ` +
        `VITE_API_URL (currently "${API_URL}") points to it, and that its CORS CLIENT_ORIGIN ` +
        `includes this site's origin.`,
    );
  }
}

export async function request(
  path,
  { method = "GET", body, headers = {}, isForm = false, retry = true } = {},
) {
  const token = getToken();
  const url = `${API_URL}${path}`;
  const res = await fetchOrDiagnose(url, {
    method,
    credentials: "include",
    headers: {
      ...(isForm ? {} : { "Content-Type": "application/json" }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: isForm ? body : body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401 && retry && getRefreshToken() && !path.startsWith("/auth/")) {
    if (await refreshAccessToken()) {
      return request(path, { method, body, headers, isForm, retry: false });
    }
    clearSession();
  }

  const payload = await parse(res);
  if (!res.ok) {
    throw new Error(payload?.message || payload?.error || `Request failed (${res.status})`);
  }
  return payload?.data !== undefined ? payload.data : payload;
}

export async function requestRaw(path, opts = {}) {
  const token = getToken();
  const url = `${API_URL}${path}`;
  const res = await fetchOrDiagnose(url, {
    method: opts.method || "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts.headers || {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const payload = await parse(res);
  if (!res.ok)
    throw new Error(payload?.message || payload?.error || `Request failed (${res.status})`);
  return payload;
}

/**
 * PRIVATE VOICE MESSAGES — authenticated binary fetch for the voice
 * streaming endpoint (GET /chat/direct/:userId/voice/:filename). A plain
 * <audio src="..."> can't attach the app's Bearer token, so playback goes
 * through this instead: fetch the audio as a Blob (with the same
 * Authorization header every other request uses), and the caller turns
 * that into a local object URL for the <audio> element. Not routed through
 * request() above since a 200 here is real audio bytes, not JSON.
 */
export async function getBlob(path) {
  const token = getToken();
  const url = /^https?:\/\//i.test(path) ? path : `${API_URL}${path}`;
  const res = await fetchOrDiagnose(url, {
    method: "GET",
    credentials: "include",
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
  if (!res.ok) {
    const payload = await parse(res);
    throw new Error(payload?.message || `Request failed (${res.status})`);
  }
  return res.blob();
}

export const api = {
  get: (path) => request(path),
  post: (path, body) => request(path, { method: "POST", body }),
  patch: (path, body) => request(path, { method: "PATCH", body }),
  del: (path) => request(path, { method: "DELETE" }),
  delete: (path) => request(path, { method: "DELETE" }),
  /** Like post(), but returns the full { success, data, meta } payload instead of unwrapping to `data`. */
  postRaw: (path, body) => requestRaw(path, { method: "POST", body }),
  /** Like patch(), but returns the full { success, data, meta } payload instead of unwrapping to `data`. */
  patchRaw: (path, body) => requestRaw(path, { method: "PATCH", body }),
  getBlob,
  /** multipart upload with progress via XHR */
  upload: (path, formData, onProgress) =>
    new Promise((resolve, reject) => {
      const url = `${API_URL}${path}`;
      const xhr = new XMLHttpRequest();
      xhr.open("POST", url);
      const token = getToken();
      if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
      xhr.withCredentials = true;
      // Fail fast with a clear reason instead of hanging silently if the
      // backend never responds (e.g. it's down, or a firewall is dropping
      // the connection).
      xhr.timeout = 30000;
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress?.(Math.round((e.loaded / e.total) * 100));
      };
      xhr.onload = () => {
        let payload = {};
        try {
          payload = JSON.parse(xhr.responseText || "{}");
        } catch {
          payload = {};
        }
        if (xhr.status >= 200 && xhr.status < 300) resolve(payload.data ?? payload);
        else reject(new Error(payload.message || `Upload failed (${xhr.status})`));
      };
      xhr.onerror = () =>
        reject(
          new Error(
            `Could not reach ${url} to upload the file. Check that the backend is running and that ` +
              `VITE_API_URL (currently "${API_URL}") points to it, and that its CORS CLIENT_ORIGIN ` +
              `includes this site's origin — this is what shows up as a generic "Network error".`,
          ),
        );
      xhr.ontimeout = () =>
        reject(
          new Error(
            `Upload to ${url} timed out after ${xhr.timeout / 1000}s — the backend didn't respond.`,
          ),
        );
      xhr.send(formData);
    }),
};

/** Mongo documents -> UI friendly objects (`_id` becomes `id`). */
export const normalize = (doc) => {
  if (!doc || typeof doc !== "object") return doc;
  if (Array.isArray(doc)) return doc.map(normalize);
  const out = { ...doc };
  if (out._id) {
    out.id = String(out._id);
    delete out._id;
  }
  delete out.__v;
  Object.keys(out).forEach((k) => {
    const v = out[k];
    if (v && typeof v === "object") out[k] = normalize(v);
  });
  return out;
};

export const idOf = (v) =>
  v && typeof v === "object" ? String(v.id || v._id) : v ? String(v) : null;
