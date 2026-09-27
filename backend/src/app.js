const path = require("path");
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const compression = require("compression");
const cookieParser = require("cookie-parser");
const rateLimit = require("express-rate-limit");

const routes = require("./routes");
const { notFound, errorHandler } = require("./middleware/error");

const app = express();

app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(
  cors({
    origin: (process.env.CLIENT_ORIGIN || "http://localhost:8080").split(","),
    credentials: true,
  })
);
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(compression());
if (process.env.NODE_ENV !== "test") app.use(morgan("dev"));

app.set("etag", false);

app.use("/api", (req, res, next) => {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.set("Pragma", "no-cache");
  res.set("Expires", "0");
  next();
});

app.use(
  "/api",
  rateLimit({
    windowMs: 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

// Static files for uploads.
//
// SECURITY FIX (production audit): private direct-chat file attachments are
// written to `${UPLOAD_DIR}/private/<conversationKey>/<filename>` (see
// middleware/directUpload.js), and `conversationKey` is just the two
// participants' user ids, sorted and joined ("userA_userB" —
// Message.conversationKey) — not a secret. Mounting express.static
// unauthenticated at `/uploads` therefore let ANYONE who could compute or
// guess that key (e.g. any other member of a shared group, who can see both
// user ids) fetch a private attachment directly via
// GET /uploads/private/<key>/<filename> — completely bypassing the
// authenticated, membership-checked `downloadDirectFile` controller this
// app already exposes at `/chat/direct/:userId/files/:filename/download`.
//
// This middleware closes that hole by rejecting the `/uploads/private/*`
// subtree with 403 before it ever reaches express.static, forcing private
// attachments through the authenticated route. It changes nothing about
// group file / profile picture serving (still public static, as before) and
// requires no migration: existing private files stay exactly where they
// are on disk — only the previously-unauthenticated direct URL is closed.
app.use("/uploads/private", (req, res) => {
  res.status(403).json({
    success: false,
    message: "Private attachments are not available via static file access. Use the authenticated chat API.",
  });
});
app.use(
  "/uploads",
  express.static(path.join(__dirname, "..", process.env.UPLOAD_DIR || "uploads"))
);

const mongoose = require("mongoose");
const DB_STATES = ["disconnected", "connected", "connecting", "disconnecting"];

app.get("/health", (req, res) => {
  const db = DB_STATES[mongoose.connection.readyState] || "unknown";
  res.json({
    ok: db === "connected",
    service: "teamsync-ai-backend",
    database: { status: db, name: mongoose.connection.name || null },
    time: new Date().toISOString(),
  });
});

/** Email configuration check — confirms the Brevo SMTP relay is really wired up. */
const { envFilePath, loadError } = require("./config/env");
const { verifyTransport } = require("./services/mailer");
const mailHealth = async (req, res) => {
  const status = await verifyTransport();
  res.status(status.ready ? 200 : 503).json({
    ok: status.ready,
    email: status,
    // Path only — never the file's contents or any credential — so you can
    // confirm the backend is reading backend/.env and not some other file.
    envFile: envFilePath,
    envFileError: loadError, // e.g. "ENOENT" if the file genuinely doesn't exist at that path
  });
};
app.get("/health/mail", mailHealth);
app.get("/api/health/mail", mailHealth);

app.use("/api", routes);

app.use(notFound);
app.use(errorHandler);

module.exports = app;
