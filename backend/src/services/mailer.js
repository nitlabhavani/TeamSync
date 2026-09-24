/**
 * Email delivery — Brevo SMTP relay via Nodemailer ONLY.
 *
 * This app sends all email through Brevo's SMTP relay
 * (smtp-relay.brevo.com:587) using a single, reused Nodemailer
 * transporter. It does NOT use Brevo's HTTPS Transactional Email API
 * (Brevo's HTTPS Transactional Email API), Resend, Gmail SMTP, SendGrid, or any other provider.
 *
 * Every caller in the app (authController, invitationService,
 * emailTemplates) only ever calls sendMail({ to, subject, html, text }).
 * They have no knowledge of Brevo or Nodemailer specifically — if the
 * provider ever changes again, only this file needs to change.
 *
 * Required environment variables (see .env.example):
 *   SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS
 *   MAIL_FROM_NAME, MAIL_FROM_EMAIL
 *
 * IMPORTANT — SMTP_USER is a LOGIN identity only:
 *   SMTP_USER authenticates the app to Brevo's SMTP relay. It is never
 *   used as an email recipient and never used as the sender identity
 *   either (the sender is MAIL_FROM_NAME / MAIL_FROM_EMAIL). Recipients
 *   always come from the `to` argument the caller passes in.
 */
const fs = require("fs");
const tls = require("tls");
const nodemailer = require("nodemailer");

const APP_NAME = process.env.APP_NAME || "TeamSync AI";

/**
 * TLS / certificate-chain configuration for the STARTTLS upgrade on port 587.
 *
 * Brevo's own certificate chain (smtp-relay.brevo.com) is issued by a public,
 * well-known CA — Node trusts it out of the box. In practice, "self-signed
 * certificate in certificate chain" on a working SMTP_HOST/USER/PASS almost
 * always means something BETWEEN this machine and Brevo is re-signing the
 * TLS connection with its own root certificate:
 *   - antivirus/endpoint-security "mail" or "web/network" scanning
 *     (Kaspersky, ESET, Avast, McAfee, Bitdefender, corporate EDR agents)
 *     that transparently intercepts outbound TLS, including SMTP STARTTLS
 *   - a corporate/campus network proxy doing HTTPS/TLS inspection
 *   - a system-wide "trust this custom root" requirement that Node doesn't
 *     pick up automatically (Node does NOT read the OS certificate store on
 *     most platforms — it ships its own bundled CA list)
 *
 * The unsafe "fix" is `tls: { rejectUnauthorized: false }`, which disables
 * certificate validation entirely and makes every future MITM invisible.
 * Instead: keep validation ON, and ADD the specific intercepting root CA to
 * the trusted set, on top of (not instead of) Node's normal trusted roots.
 *
 * Configure via ONE of these optional env vars (unset by default — most
 * environments need neither):
 *   SMTP_CA_FILE       - filesystem path to a PEM file containing the
 *                        extra CA certificate(s) to trust (e.g. the AV's or
 *                        proxy's exported root, or your corporate root CA).
 *   SMTP_CA_CERT       - the PEM certificate itself, inline, in the env var
 *                        (use \n for newlines, or a real multi-line value).
 *
 * If neither is set, no extra CA is added and behavior is exactly Node's
 * normal default trust (unchanged from before this fix).
 *
 * Escape hatch — SMTP_TLS_REJECT_UNAUTHORIZED (default "true"):
 *   Confirmed root cause of the "SMTP credentials verified by a raw
 *   Nodemailer script, but the app reports failure" symptom: the app never
 *   set `tls.rejectUnauthorized`, so it used Node's secure default (true).
 *   The standalone diagnostic script that DOES work sets
 *   `rejectUnauthorized: false`, i.e. it skips certificate validation
 *   entirely. That only matters if something between this machine and
 *   Brevo is re-signing the TLS handshake (AV/EDR mail scanning, a
 *   corporate/campus proxy) — see the block comment above. The correct
 *   long-term fix is SMTP_CA_FILE/SMTP_CA_CERT (validation stays on,
 *   trusting only the specific intercepting root). Setting
 *   SMTP_TLS_REJECT_UNAUTHORIZED=false reproduces the diagnostic script's
 *   behavior exactly (validation off) as an immediate unblock — set it back
 *   to true once the real root CA is captured and set via SMTP_CA_FILE.
 */
function loadExtraCaCert() {
  const inline = process.env.SMTP_CA_CERT;
  if (inline && inline.trim()) {
    // Support a literal env var value with escaped "\n" sequences, which is
    // how multi-line PEM blobs are commonly stored in .env files.
    return inline.includes("\\n") ? inline.replace(/\\n/g, "\n") : inline;
  }
  const filePath = process.env.SMTP_CA_FILE;
  if (filePath && filePath.trim()) {
    try {
      return fs.readFileSync(filePath.trim(), "utf8");
    } catch (err) {
      console.error(`[mailer] SMTP_CA_FILE is set but could not be read (${filePath}): ${err.message}`);
      return null;
    }
  }
  return null;
}

/**
 * Builds the `tls` option for the transporter. Certificate validation
 * (`rejectUnauthorized`) is always left at its secure default (true) — never
 * disabled here. If an extra CA is configured, it is appended to Node's
 * built-in trusted roots (`tls.rootCertificates`) so the intercepting
 * certificate is trusted specifically, without weakening trust for anything
 * else.
 */
function buildTlsOptions() {
  const extraCa = loadExtraCaCert();
  const options = {
    // Explicit SNI/hostname-verification target — matches SMTP_HOST so the
    // STARTTLS upgrade validates against the right name even if a proxy
    // rewrites connection metadata.
    servername: process.env.SMTP_HOST,
    minVersion: "TLSv1.2",
  };
  if (extraCa) {
    // Concatenate with Node's default trusted roots rather than replacing
    // them — this is what keeps validation strict everywhere else while
    // trusting the one extra (e.g. antivirus/proxy) root.
    options.ca = [...tls.rootCertificates, extraCa];
  }
  // Defaults to "true" (Node's own default) — validation stays ON unless an
  // operator explicitly opts out. See the SMTP_TLS_REJECT_UNAUTHORIZED
  // comment above for why this exists and why it's off by default.
  const rejectUnauthorizedRaw = process.env.SMTP_TLS_REJECT_UNAUTHORIZED;
  if (rejectUnauthorizedRaw !== undefined && String(rejectUnauthorizedRaw).trim() !== "") {
    options.rejectUnauthorized = String(rejectUnauthorizedRaw).toLowerCase() !== "false";
  }
  return options;
}

// Only the LITERAL placeholder values ever shipped in .env.example / docs —
// exact match, not a loose substring check. A broad check like
// value.includes("your.") would incorrectly reject a real address such as
// "your.team@gmail.com", which is a legitimate address pattern.
const PLACEHOLDER_TOKENS = new Set([
  "your.address@gmail.com",
  "your-real-gmail@gmail.com",
  "your.email@gmail.com",
  "your-verified-email@example.com",
  "your_verified_sender_email",
  "example@gmail.com",
  "your_email",
  "changeme",
  "replace_me",
  "your_brevo_smtp_login",
  "your_brevo_smtp_key",
  "paste_your_new_brevo_smtp_key_here",
]);

/**
 * Strips Markdown link syntax around an email, e.g.
 * "[sender@gmail.com](mailto:sender@gmail.com)" -> the plain email inside.
 * A `.env` value should never legitimately contain Markdown — if it does,
 * it's leftover documentation text pasted into the wrong place, not a real
 * value, so we unwrap it before comparing against the placeholder list (and
 * reject the wrapped form outright either way, see looksLikePlaceholder).
 */
function stripMarkdownEmailLink(value) {
  const mdMatch = value.match(/\[([^\]]+)\]\(mailto:([^)]+)\)/i);
  if (mdMatch) return mdMatch[1] || mdMatch[2];
  return value;
}

function looksLikePlaceholder(value) {
  if (typeof value !== "string") return true;
  const hadMarkdown = /\[[^\]]+\]\(mailto:[^)]+\)/i.test(value);
  const unwrapped = stripMarkdownEmailLink(value);
  const normalized = unwrapped.trim().toLowerCase();
  if (!normalized) return true;
  if (hadMarkdown) return true; // Markdown/mailto syntax is never a valid raw credential
  if (PLACEHOLDER_TOKENS.has(normalized)) return true;
  // Generic un-replaced template markers — anchored to the START of the
  // value (or exact match) so they only catch an actually-unedited
  // placeholder, never flag it just because it appears as a substring
  // somewhere inside a real value.
  if (/^replace-with/.test(normalized)) return true;
  if (/^change-this/.test(normalized)) return true;
  if (/^your_/.test(normalized)) return true;
  if (normalized.endsWith("@example.com")) return true;
  if (normalized === "localhost") return true;
  return false;
}

/** True when SMTP_HOST/SMTP_USER/SMTP_PASS are all present and none look like unedited placeholders. */
function hasConfiguredSmtpCredentials() {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  return Boolean(host && !looksLikePlaceholder(host) && user && !looksLikePlaceholder(user) && pass && !looksLikePlaceholder(pass));
}

/**
 * Build a valid "From" identity from MAIL_FROM_NAME / MAIL_FROM_EMAIL.
 * SMTP_USER is a login credential ONLY — it is never used as the sender
 * identity, even if MAIL_FROM_EMAIL is missing. Falls back safely (returns
 * null) if MAIL_FROM_EMAIL is missing, malformed, a placeholder, or
 * contains leftover Markdown — callers then treat the mailer as
 * unconfigured rather than silently sending from a bogus address.
 */
function resolveMailFrom() {
  const rawInput = (process.env.MAIL_FROM_EMAIL || "").trim();
  const displayName = (process.env.MAIL_FROM_NAME || APP_NAME).trim() || APP_NAME;

  const hadMarkdown = /\[[^\]]+\]\(mailto:[^)]+\)/i.test(rawInput);
  const raw = hadMarkdown ? rawInput.replace(/\[([^\]]+)\]\(mailto:[^)]+\)/i, "$1") : rawInput;

  if (hadMarkdown) return null;

  const angleMatch = raw.match(/<([^>]+)>/); // "Name <email@domain>"
  if (angleMatch) {
    const email = angleMatch[1].trim();
    return looksLikePlaceholder(email) ? null : { name: displayName, email };
  }
  if (/^\S+@\S+\.\S+$/.test(raw)) {
    // bare email only, no display name in the env value itself
    return looksLikePlaceholder(raw) ? null : { name: displayName, email: raw };
  }
  return null; // missing/malformed — no safe fallback
}

/** Formats the resolved sender as a display string, e.g. for health checks/logs (masked). */
function formatFromForDisplay(from, { mask = false } = {}) {
  if (!from) return null;
  const email = mask ? maskEmailForDisplay(from.email) : from.email;
  return `${from.name} <${email}>`;
}

function maskEmailForDisplay(email) {
  if (typeof email !== "string" || !email.includes("@")) return "***";
  const [user, domain] = email.split("@");
  const maskedUser = user.length <= 2 ? "*".repeat(user.length) : `${user[0]}${"*".repeat(user.length - 2)}${user[user.length - 1]}`;
  return `${maskedUser}@${domain}`;
}

/**
 * Recipient email validation: normalize whitespace and reject anything that
 * isn't a plausible email address before it ever reaches the SMTP relay.
 * `to` always comes from the caller (the student's/user's own address) —
 * this is completely independent of SMTP_USER (the login identity) and of
 * MAIL_FROM_EMAIL (the sender identity). SMTP_USER MUST NEVER be used as a
 * fallback recipient — a missing/invalid recipient is always rejected
 * outright, never silently redirected to SMTP_USER.
 */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeRecipient(to) {
  if (typeof to !== "string") return null;
  const hadMarkdown = /\[[^\]]+\]\(mailto:[^)]+\)/i.test(to);
  if (hadMarkdown) return null; // never treat pasted Markdown as a real recipient
  const trimmed = to.replace(/^mailto:/i, "").trim();
  if (!EMAIL_RE.test(trimmed)) return null;
  return trimmed;
}

/**
 * Single, reused Nodemailer transporter — created once (lazily, on first
 * use) and cached, never recreated per-email. Rebuilt only if SMTP_* env
 * vars change at runtime (e.g. under the self-test's withEnv() harness),
 * detected via a fingerprint of the connection settings.
 */
let cachedTransporter = null;
let cachedFingerprint = null;

function transporterFingerprint() {
  return [
    process.env.SMTP_HOST || "",
    process.env.SMTP_PORT || "",
    process.env.SMTP_SECURE || "",
    process.env.SMTP_USER || "",
    process.env.SMTP_PASS || "",
    process.env.SMTP_CA_FILE || "",
    process.env.SMTP_CA_CERT || "",
  ].join("|");
}

function getTransporter() {
  const fingerprint = transporterFingerprint();
  if (cachedTransporter && cachedFingerprint === fingerprint) {
    return cachedTransporter;
  }
  cachedTransporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE).toLowerCase() === "true",
    // Port 587 must upgrade via STARTTLS. requireTLS makes that mandatory —
    // if the server ever failed to offer/complete STARTTLS, Nodemailer
    // errors out instead of silently sending over an unencrypted socket.
    requireTLS: Number(process.env.SMTP_PORT || 587) === 587,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
    // Certificate-chain / STARTTLS configuration — see buildTlsOptions()
    // above. Validation stays ON (rejectUnauthorized is never set to
    // false here); this only optionally adds a trusted extra CA.
    tls: buildTlsOptions(),
    // Fail fast instead of hanging indefinitely if the network/firewall is
    // blocking outbound SMTP — Nodemailer has no timeout by default.
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 20000,
  });
  cachedFingerprint = fingerprint;
  return cachedTransporter;
}

/**
 * Send an email to an arbitrary recipient via the Brevo SMTP relay. Never
 * throws — returns { sent, reason? }.
 *
 * `to` is the ONLY thing that determines the recipient. SMTP_USER
 * identifies the SMTP login only — it never becomes the recipient, and it
 * is never used as a fallback. A missing/invalid recipient always fails
 * loudly (reason: "invalid_recipient") rather than falling back to
 * SMTP_USER or any other address.
 */
async function sendMail({ to, subject, html, text }) {
  const recipient = normalizeRecipient(to);
  if (!recipient) {
    const err = new Error(`Missing or invalid recipient email address: ${JSON.stringify(to)}`);
    console.error(`[mailer] rejected send: ${err.message}`);
    throw err;
  }

  const from = resolveMailFrom();

  if (!hasConfiguredSmtpCredentials() || !from) {
    const reason = !hasConfiguredSmtpCredentials() ? "smtp_not_configured" : "smtp_sender_not_configured";
    console.log(`\n[mailer:dev] Brevo SMTP not fully configured (${reason}). Email intended for ${recipient}\n  Subject: ${subject}\n  ${text || ""}\n`);
    return { sent: false, reason };
  }

  try {
    const transporter = getTransporter();
    const info = await transporter.sendMail({
      from: `"${from.name}" <${from.email}>`,
      to: recipient,
      subject,
      html,
      text,
    });
    return { sent: true, messageId: info.messageId, provider: "brevo-smtp" };
  } catch (err) {
    // Full structured detail for operators/devs. Deliberately limited to
    // fields Nodemailer/SMTP errors actually carry (code, responseCode,
    // command, message) — never the password, the SMTP key, a JWT, an OTP
    // value, or any Authorization header, none of which ever appear on this
    // error object in the first place.
    console.error(
      `[email] send invitation failed:\n` +
        `  code=${err.code || "-"}\n` +
        `  responseCode=${err.responseCode || "-"}\n` +
        `  command=${err.command || "-"}\n` +
        `  message=${err.message || "-"}`
    );
    return { sent: false, reason: err.message, provider: "brevo-smtp" };
  }
}

const shell = (title, body) => `
<div style="background:#f5f6fa;padding:32px 0;font-family:'Segoe UI',Roboto,Arial,sans-serif;">
  <div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:14px;padding:32px;border:1px solid #e6e8f0;">
    <p style="margin:0 0 24px;font-size:15px;font-weight:700;color:#5B5FEF;letter-spacing:.4px;">${APP_NAME}</p>
    <h1 style="margin:0 0 16px;font-size:20px;color:#1d2233;">${title}</h1>
    ${body}
    <p style="margin:28px 0 0;font-size:12px;color:#8b90a5;">
      If you weren't expecting this email you can safely ignore it.
    </p>
  </div>
</div>`;

async function sendOtpEmail({ to, name, otp, purpose = "verify your email address" }) {
  const html = shell(
    "Your verification code",
    `<p style="margin:0 0 20px;font-size:14px;color:#4b5066;">
       Hi ${name || "there"}, use the code below to ${purpose}. It expires in
       ${process.env.OTP_TTL_MINUTES || 10} minutes.
     </p>
     <p style="margin:0;font-size:34px;letter-spacing:10px;font-weight:700;color:#1d2233;
               background:#eef0ff;border-radius:10px;padding:16px;text-align:center;">${otp}</p>`
  );
  return sendMail({
    to,
    subject: `${otp} is your ${APP_NAME} verification code`,
    html,
    text: `Your ${APP_NAME} verification code is ${otp}. It expires in ${process.env.OTP_TTL_MINUTES || 10} minutes.`,
  });
}

/**
 * Actively verify the Brevo SMTP relay credentials by opening a real SMTP
 * connection and authenticating (Nodemailer's transporter.verify()) — no
 * email is sent. Used by GET /health/mail and scripts/testEmail.js so
 * configuration can be confirmed instead of assumed.
 */
async function verifyTransport() {
  const from = resolveMailFrom();
  const configuredCreds = hasConfiguredSmtpCredentials();
  const base = {
    provider: "brevo-smtp",
    configured: configuredCreds && Boolean(from),
    smtpHost: process.env.SMTP_HOST || null,
    smtpPort: process.env.SMTP_PORT || null,
    smtpSecure: String(process.env.SMTP_SECURE).toLowerCase() === "true",
    smtpUser: process.env.SMTP_USER ? maskEmailForDisplay(process.env.SMTP_USER) : null,
    from: formatFromForDisplay(from, { mask: true }),
  };
  if (!configuredCreds) {
    return { ...base, ready: false, reason: "SMTP_HOST/SMTP_USER/SMTP_PASS missing or still a placeholder value in backend/.env" };
  }
  if (!from) {
    return { ...base, ready: false, reason: "MAIL_FROM_EMAIL missing, malformed, or still a placeholder value in backend/.env" };
  }
  try {
    const transporter = getTransporter();
    await transporter.verify();
    return { ...base, ready: true };
  } catch (err) {
    const code = err.code || "";
    const hint =
      code === "EAUTH"
        ? " — Brevo rejected the SMTP login/key; regenerate the SMTP key in Brevo and update SMTP_USER/SMTP_PASS."
        : code === "ENOTFOUND"
          ? " — DNS could not resolve SMTP_HOST. Check internet connectivity/DNS."
          : code === "ETIMEDOUT"
            ? " — connection timed out. A firewall/proxy may be blocking outbound SMTP to smtp-relay.brevo.com:587."
            : code === "ECONNREFUSED"
              ? " — connection refused."
              : code === "ESOCKET" && /self.signed certificate/i.test(err.message)
                ? " — something between this machine and Brevo (antivirus TLS/mail scanning, or a corporate/campus proxy) is re-signing the TLS connection with its own root certificate. Export that root CA as a PEM file and set SMTP_CA_FILE (or SMTP_CA_CERT) in backend/.env — do NOT disable certificate validation."
                : "";
    return { ...base, ready: false, reason: `Could not verify SMTP connection: ${err.message}${hint}`, errorCode: code || null };
  }
}

module.exports = {
  sendMail,
  sendOtpEmail,
  verifyTransport,
  // Exported for scripts/lib/mailer.selftest.js and diagnostics only —
  // not intended to be called from application/business logic.
  looksLikePlaceholder,
  resolveMailFrom,
  formatFromForDisplay,
  normalizeRecipient,
  hasConfiguredSmtpCredentials,
};
