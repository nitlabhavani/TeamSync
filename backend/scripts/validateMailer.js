/**
 * TeamSync AI — Email Configuration Validator (read-only, Brevo SMTP)
 * --------------------------------------------------------
 * Prints exactly what the application currently sees for email config:
 *   - which backend/.env was actually loaded (absolute path)
 *   - masked SMTP_USER / SMTP_PASS (never real values)
 *   - the placeholder-detection result
 *   - the resolved From identity (MAIL_FROM_NAME / MAIL_FROM_EMAIL)
 *   - whether a live SMTP connection + auth check succeeds
 *
 * This does NOT send an email. Use `node scripts/testEmail.js you@example.com`
 * for that. Both scripts share the same underlying config/placeholder logic
 * in src/config/env.js and src/services/mailer.js — this file only formats
 * the report, it does not re-implement email handling.
 *
 * USAGE
 *   cd backend
 *   node scripts/validateMailer.js
 */
const { printReport } = require("./lib/mailDiagnostics");

async function main() {
  console.log("=== TeamSync AI Email Configuration (Brevo SMTP) ===\n");
  const status = await printReport();
  console.log("");
  if (!status.configured) {
    console.log("RESULT: SMTP credentials are missing or still the literal placeholder values shipped in .env.example.");
    console.log("Edit backend/.env with your real SMTP_USER, SMTP_PASS (from Brevo → SMTP & API → SMTP tab),");
    console.log("and a verified MAIL_FROM_EMAIL, then re-run this script.");
  } else if (status.ready) {
    console.log("RESULT: Credentials are configured and the live Brevo SMTP connection succeeded. ✅");
  } else {
    console.log("RESULT: Credentials are configured but the live SMTP check failed.");
    console.log(`Reason: ${status.reason}`);
  }
}

main()
  .catch((err) => {
    console.error("Validation script crashed:", err.message);
    process.exitCode = 1;
  })
  .finally(() => process.exit());
