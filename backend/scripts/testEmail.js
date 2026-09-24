/**
 * TeamSync AI — Standalone Email Diagnostic (Brevo SMTP relay)
 * ----------------------------------------------------------------
 * Tests ONLY the email transport. Does not need MongoDB, Express, or the
 * full server running — so if `node server.js` is failing to even start
 * (e.g. Mongo not running), you can still isolate whether email itself
 * would work, independently of everything else.
 *
 * Uses the exact same mailer.sendMail()/verifyTransport() the real
 * application uses — this script never re-implements sending.
 *
 * USAGE
 *   cd backend
 *   node scripts/testEmail.js
 *   node scripts/testEmail.js you@example.com   (also sends a real test email)
 *
 * SAFETY: never prints SMTP_PASS. Only sends an email if you pass a
 * recipient address as an argument.
 */
require("../src/config/env");
const mailer = require("../src/services/mailer");
const { printReport } = require("./lib/mailDiagnostics");

async function main() {
  console.log("=== TeamSync AI Email Diagnostic (Brevo SMTP) ===\n");
  const status = await printReport();
  console.log("");

  if (!status.configured) {
    console.log("RESULT: SMTP_HOST/SMTP_USER/SMTP_PASS/MAIL_FROM_EMAIL missing or still a placeholder in backend/.env.");
    console.log("Get your SMTP login + key from Brevo → SMTP & API → SMTP tab, then re-run this script.");
    return;
  }

  if (!status.ready) {
    console.log("RESULT: SMTP credentials are present but the connection/auth check failed.");
    console.log(`Reason reported: ${status.reason}`);
    console.log("");
    console.log("Common causes by symptom:");
    console.log("  - EAUTH                              -> SMTP_USER/SMTP_PASS invalid or the SMTP key was revoked; generate a new one in Brevo");
    console.log("  - ENOTFOUND                           -> DNS failure resolving SMTP_HOST (smtp-relay.brevo.com)");
    console.log("  - ETIMEDOUT                            -> a firewall/proxy may be blocking outbound SMTP to port 587");
    console.log("  - ECONNREFUSED                         -> connection refused by the SMTP host");
    return;
  }

  console.log("Brevo SMTP authentication succeeded. ✅ (SMTP_USER authenticated against smtp-relay.brevo.com:587)");

  const recipient = process.argv[2];
  if (!recipient) {
    console.log("\n(No test recipient passed — skipping actual send. Run again with an email address to send a real test email:)");
    console.log("  node scripts/testEmail.js you@example.com");
    return;
  }

  console.log(`\n--- Sending a real test email to ${recipient} via Brevo SMTP ---`);
  const sendResult = await mailer.sendMail({
    to: recipient,
    subject: "TeamSync AI — email test",
    text: "If you're reading this, TeamSync AI's Brevo SMTP configuration is working.",
    html: "<p>If you're reading this, TeamSync AI's Brevo SMTP configuration is working.</p>",
  });
  console.log(JSON.stringify(sendResult, null, 2));
  if (sendResult.sent) {
    console.log("RESULT: Email sent successfully.");
    console.log("Provider: brevo-smtp");
    console.log(`Recipient: ${recipient}`);
    console.log(`Message ID: ${sendResult.messageId || "(not returned)"}`);
    console.log("\nTest email was accepted by Brevo's SMTP relay.");
  } else {
    console.log(`RESULT: Send failed — ${sendResult.reason}`);
  }
}

main()
  .catch((err) => {
    console.error("Diagnostic script crashed:", err.message);
    process.exitCode = 1;
  })
  .finally(() => process.exit());
