/**
 * Loads backend/.env by its ABSOLUTE path, not a cwd-relative one.
 *
 * dotenv.config() with no `path` resolves ".env" relative to
 * process.cwd() — so starting the backend from the project root (or any
 * directory other than backend/) would silently load the WRONG .env (or
 * none at all), leaving SMTP_USER/SMTP_PASS undefined and producing the
 * exact "missing or still using placeholder values" error even when
 * backend/.env is correctly filled in.
 *
 * Requiring THIS module (instead of calling dotenv directly) makes env
 * loading identical no matter where `npm start`/`node server.js` was run
 * from, and lets other modules (e.g. the /health/mail diagnostic) confirm
 * which file was actually loaded — without ever exposing its contents.
 *
 * This must be required first, before any module that reads
 * process.env (mailer.js, db.js, etc.).
 */
const path = require("path");
const dotenv = require("dotenv");

const envFilePath = path.join(__dirname, "..", "..", ".env");
const result = dotenv.config({ path: envFilePath, override: true });

module.exports = {
  envFilePath,
  loadError: result.error ? result.error.code || result.error.message : null,
};
