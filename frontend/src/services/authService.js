import { api, setSession, clearSession, getStoredUser } from "../lib/apiClient";
export { clearSession };

const store = (data) => {
  setSession({ token: data.token, refreshToken: data.refreshToken, user: data.user });
  // login/verify-otp both resume any pending invitations for this email
  // server-side (see acceptPendingInvitations in authController.js). Return
  // the count alongside the (unmodified) user object so callers can react
  // to it without it leaking into the persisted session shape.
  return { user: data.user, joinedGroups: data.joinedGroups || 0 };
};

const PENDING_KEY = "teamsync_pending_signup";

/**
 * Where to send the student after they finish logging in / registering —
 * used so the invitation page (JoinInvitation.jsx) can send someone to
 * Login/Signup without losing track of the group they were trying to join.
 * The actual acceptance is always re-validated server-side; this only
 * controls where the browser navigates to afterwards.
 */
const POST_LOGIN_REDIRECT_KEY = "teamsync_post_login_redirect";

export const setPostLoginRedirect = (path) => {
  if (typeof sessionStorage === "undefined" || !path) return;
  sessionStorage.setItem(POST_LOGIN_REDIRECT_KEY, path);
};

export const consumePostLoginRedirect = () => {
  if (typeof sessionStorage === "undefined") return null;
  const value = sessionStorage.getItem(POST_LOGIN_REDIRECT_KEY);
  sessionStorage.removeItem(POST_LOGIN_REDIRECT_KEY);
  return value || null;
};

export const getPendingSignup = () => {
  if (typeof sessionStorage === "undefined") return null;
  try {
    return JSON.parse(sessionStorage.getItem(PENDING_KEY) || "null");
  } catch {
    return null;
  }
};

const setPendingSignup = (value) => {
  if (typeof sessionStorage === "undefined") return;
  if (value) sessionStorage.setItem(PENDING_KEY, JSON.stringify(value));
  else sessionStorage.removeItem(PENDING_KEY);
};

export const login = async ({ email, password }) => {
  if (!email || !password) throw new Error("Enter your email and password.");
  return store(await api.post("/auth/login", { email, password }));
};

/**
 * Step 1 of registration. No account is created yet — the backend emails a
 * 6-digit OTP and parks the details until it is verified.
 */
export const requestSignupOtp = async ({ name, email, password, role, dept }) => {
  if (!name?.trim()) throw new Error("Enter your full name.");
  if (!/^\S+@\S+\.\S+$/.test(String(email || ""))) throw new Error("Enter a valid email address.");
  if (String(password || "").length < 8) throw new Error("Password must be at least 8 characters.");

  const data = await api.post("/auth/signup", {
    name: name.trim(),
    email: email.trim().toLowerCase(),
    password,
    role: role || "student",
    dept,
  });
  setPendingSignup({ email: data.email, name: name.trim(), role: role || "student" });
  return data;
};

/** Step 2 — verifying the OTP creates the account and signs the user in. */
export const verifySignupOtp = async ({ email, otp }) => {
  const code = String(otp || "").trim();
  if (!/^\d{6}$/.test(code)) throw new Error("Enter the 6-digit code.");
  const target = email || getPendingSignup()?.email;
  if (!target) throw new Error("Your signup session expired. Please start again.");

  const data = await api.post("/auth/verify-otp", { email: target, otp: code });
  setPendingSignup(null);
  return store(data);
};

export const resendSignupOtp = async ({ email }) =>
  api.post("/auth/resend-otp", { email: email || getPendingSignup()?.email });

export const cancelSignup = async ({ email } = {}) => {
  const target = email || getPendingSignup()?.email;
  setPendingSignup(null);
  if (target) await api.post("/auth/cancel-signup", { email: target }).catch(() => {});
};

/** Back-compat alias used by the OTP screen. */
export const verifyOtp = verifySignupOtp;
export const resendOtp = resendSignupOtp;

export const forgotPassword = async ({ email }) => {
  if (!email) throw new Error("Enter the email linked to your account.");
  return api.post("/auth/forgot-password", { email });
};

export const resetPassword = async ({ email, otp, password }) =>
  api.post("/auth/reset-password", { email, otp, password });

/** Cached user for instant boot; call refreshCurrentUser() to revalidate. */
export const getCurrentUser = () => getStoredUser();

export const refreshCurrentUser = async () => {
  try {
    const data = await api.get("/auth/me");
    const user = data.user || data;
    setSession({ user });
    return user;
  } catch {
    clearSession();
    return null;
  }
};

export const logout = async () => {
  try {
    await api.post("/auth/logout");
  } catch {
    /* token may already be invalid */
  }
  clearSession();
  return { ok: true };
};
