/**
 * Shared email diagnostic report — used by both scripts/testEmail.js and
 * scripts/validateMailer.js so there is exactly ONE place that prints the
 * .env path, masked SMTP credentials, and configuration status. Neither
 * script re-implements this logic itself, per the project's "single source
 * of truth" rule for email configuration (see src/config/env.js and
 * src/services/mailer.js).
 *
 * Provider: Brevo SMTP relay (smtp-relay.brevo.com) via Nodemailer.
 * Never prints SMTP_PASS.
 */
require("../../src/config/env");
const { envFilePath, loadError } = require("../../src/config/env");
const mailer = require("../../src/services/mailer");

/** Masks a credential string, e.g. "b5e128001@smtp-brevo.com" -> "b5e12*****om". Never logs the real value. */
function maskSecret(value) {
  if (!value) return null;
  if (value.length <= 6) return "*".repeat(value.length);
  return `${value.slice(0, 5)}${"*".repeat(Math.max(value.length - 8, 4))}${value.slice(-3)}`;
}

/** Masks an email address for display, e.g. "student@gmail.com" -> "s*****t@gmail.com". */
function maskEmail(email) {
  if (!email || typeof email !== "string" || !email.includes("@")) return email || "(not set)";
  const [user, domain] = email.split("@");
  const maskedUser = user.length <= 2 ? "*".repeat(user.length) : `${user[0]}${"*".repeat(user.length - 2)}${user[user.length - 1]}`;
  return `${maskedUser}@${domain}`;
}

/** Prints the full config/placeholder/connection report. Returns the status object. */
async function printReport() {
  console.log(`.env path:          ${envFilePath}`);
  console.log(`.env load error:    ${loadError || "none (loaded OK)"}`);
  console.log(`Provider:           brevo-smtp`);
  console.log(`SMTP host:          ${process.env.SMTP_HOST || "(not set)"}`);
  console.log(`SMTP port:          ${process.env.SMTP_PORT || "(not set)"}`);
  console.log(`SMTP secure:        ${String(process.env.SMTP_SECURE).toLowerCase() === "true"}`);
  console.log(`SMTP user:          ${maskEmail(process.env.SMTP_USER) || "(not set)"}`);
  console.log(`SMTP pass set:      ${Boolean(process.env.SMTP_PASS && !mailer.looksLikePlaceholder(process.env.SMTP_PASS))}`);
  console.log(`SMTP pass:          ${process.env.SMTP_PASS ? maskSecret(process.env.SMTP_PASS) : "(not set)"}`);
  console.log(`MAIL_FROM_NAME:     ${process.env.MAIL_FROM_NAME || process.env.APP_NAME || "TeamSync AI"}`);
  console.log(`MAIL_FROM_EMAIL:    ${maskEmail(process.env.MAIL_FROM_EMAIL)}`);
  console.log("");

  const status = await mailer.verifyTransport();

  console.log(`SMTP configured:         ${status.configured}`);
  console.log(`resolved From:           ${status.from || "(unresolved — see reason below)"}`);
  console.log(`ready (verified):        ${status.ready}`);
  if (!status.ready) console.log(`reason:                  ${status.reason}`);
  console.log("");
  console.log("--- Full status object (never includes SMTP_PASS) ---");
  console.log(JSON.stringify(status, null, 2));

  return status;
}

module.exports = { printReport, maskSecret, maskEmail };
