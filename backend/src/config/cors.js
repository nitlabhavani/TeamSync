/**
 * Centralized CORS Configuration for TeamSync AI
 * Supports both local development (localhost:8080, 5173, 3000, 5000)
 * and production deployments (Vercel, Render, custom domains).
 */

const DEFAULT_ALLOWED_ORIGINS = [
  "https://team-sync-5qgs29my0-bhavanis-projects-20b39995.vercel.app",
  "https://teamsync-m6o8.onrender.com",
  "https://teamsync-1-k3to.onrender.com",
  "http://localhost:8080",
  "http://localhost:5173",
  "http://localhost:3000",
  "http://localhost:5000",
  "http://127.0.0.1:8080",
  "http://127.0.0.1:5173",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:5000",
];

function getAllowedOrigins() {
  const envOrigins = [
    process.env.CLIENT_ORIGIN,
    process.env.CLIENT_URL,
    process.env.ALLOWED_ORIGINS,
  ]
    .filter(Boolean)
    .flatMap((val) => val.split(","))
    .map((s) => s.trim().replace(/\/+$/, ""))
    .filter(Boolean);

  return Array.from(new Set([...DEFAULT_ALLOWED_ORIGINS, ...envOrigins]));
}

function isOriginAllowed(origin) {
  // Allow requests with no origin (like mobile apps, curl, server-to-server, Postman)
  if (!origin) return true;

  const clean = origin.trim().replace(/\/+$/, "");
  const allowed = getAllowedOrigins();

  if (allowed.includes(clean)) return true;

  // Allow all Vercel deployments and preview URLs for this app
  if (/^https:\/\/team-sync.*\.vercel\.app$/i.test(clean)) return true;
  if (/^https:\/\/.*-bhavanis-projects-.*\.vercel\.app$/i.test(clean)) return true;
  if (/^https:\/\/.*\.vercel\.app$/i.test(clean)) return true;

  // Allow any localhost / 127.0.0.1 port in dev/test
  if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(clean)) return true;

  // Allow Render domains
  if (/^https:\/\/.*\.onrender\.com$/i.test(clean)) return true;

  return false;
}

const corsOptions = {
  origin: (origin, callback) => {
    if (isOriginAllowed(origin)) {
      callback(null, true);
    } else {
      callback(new Error(`CORS policy does not allow access from origin: ${origin}`));
    }
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "X-Requested-With",
    "Accept",
    "Origin",
    "X-AI-Engine-Key",
    "Range",
  ],
  exposedHeaders: ["Content-Range", "X-Content-Range", "Content-Disposition"],
  maxAge: 86400,
};

module.exports = {
  isOriginAllowed,
  corsOptions,
  getAllowedOrigins,
};
