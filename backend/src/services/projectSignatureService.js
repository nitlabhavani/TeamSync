/**
 * Project identity signature.
 *
 * Step 9 requires the AI to recognise a submission as "the current TeamSync
 * AI project" without hard-coding assumptions from an older step. Instead of
 * a static list, this module builds the reference signature by scanning the
 * CURRENT repository on disk (backend services/models/routes, the ai-engine
 * analyzers, and the frontend pages/components) every time it's asked,
 * cached briefly so a burst of submissions doesn't re-walk the tree.
 *
 * This is intentionally dependency-free (fs only) and read-only.
 */
const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.join(__dirname, "..", "..", ".."); // .../<repo>/backend/src/services -> repo root
const CACHE_MS = 5 * 60 * 1000;

let cache = null;
let cachedAt = 0;

const safeListFiles = (dir, exts) => {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile() && (!exts || exts.includes(path.extname(e.name).toLowerCase())))
      .map((e) => e.name);
  } catch {
    return [];
  }
};

const safeReadJson = (file) => {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
};

const safeReadText = (file) => {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
};

/**
 * Route path fragments actually registered in the backend, e.g.
 * "tasks/:taskId/submit" -> "tasks", "submit". Used as an identity signal
 * (a submission that mentions these routes/services is much more likely to
 * be this project) — pulled live from routes/index.js so it never drifts
 * from whatever routes actually exist today.
 */
const extractRouteTokens = (routesFile) => {
  const text = safeReadText(routesFile);
  const tokens = new Set();
  const re = /router\.\w+\(\s*["'`]([^"'`]+)["'`]/g;
  let m;
  // eslint-disable-next-line no-cond-assign
  while ((m = re.exec(text))) {
    m[1]
      .split("/")
      .filter((seg) => seg && !seg.startsWith(":"))
      .forEach((seg) => tokens.add(seg.toLowerCase()));
  }
  return [...tokens];
};

function buildSignature() {
  const backendRoot = path.join(REPO_ROOT, "backend");
  const aiEngineRoot = path.join(REPO_ROOT, "ai-engine");
  const frontendRoot = path.join(REPO_ROOT, "frontend");

  const backendPkg = safeReadJson(path.join(backendRoot, "package.json")) || {};
  const frontendPkg = safeReadJson(path.join(frontendRoot, "package.json")) || {};

  const serviceFiles = safeListFiles(path.join(backendRoot, "src", "services"), [".js"]);
  const modelFiles = safeListFiles(path.join(backendRoot, "src", "models"), [".js"]);
  const controllerFiles = safeListFiles(path.join(backendRoot, "src", "controllers"), [".js"]);
  const middlewareFiles = safeListFiles(path.join(backendRoot, "src", "middleware"), [".js"]);
  const analyzerFiles = safeListFiles(path.join(aiEngineRoot, "analyzers"), [".py"]);
  const pageFiles = [
    ...safeListFiles(path.join(frontendRoot, "src", "pages", "student"), [".jsx", ".tsx"]),
    ...safeListFiles(path.join(frontendRoot, "src", "pages", "guide"), [".jsx", ".tsx"]),
    ...safeListFiles(path.join(frontendRoot, "src", "pages", "common"), [".jsx", ".tsx"]),
  ];
  const routeTokens = extractRouteTokens(path.join(backendRoot, "src", "routes", "index.js"));

  // Strip extensions -> bare module names ("chatTaskService.js" -> "chattaskservice").
  const bare = (files) => files.map((f) => path.basename(f, path.extname(f)).toLowerCase());

  const identifiers = new Set([
    "teamsync",
    "teamsyncai",
    "teamsync-ai",
    ...(backendPkg.name ? [backendPkg.name.toLowerCase()] : []),
    ...(frontendPkg.name ? [frontendPkg.name.toLowerCase()] : []),
    ...bare(serviceFiles),
    ...bare(modelFiles),
    ...bare(controllerFiles),
    ...bare(middlewareFiles),
    ...bare(analyzerFiles),
    ...bare(pageFiles),
    ...routeTokens,
  ]);

  return {
    generatedAt: new Date().toISOString(),
    backendName: backendPkg.name || "",
    frontendName: frontendPkg.name || "",
    serviceFiles,
    modelFiles,
    controllerFiles,
    middlewareFiles,
    analyzerFiles,
    pageFiles,
    routeTokens,
    // Flat, lower-cased identifier set the AI engine matches submitted
    // filenames/content against. Kept separate from the per-category lists
    // above so callers can still explain *why* something matched.
    identifiers: [...identifiers].filter(Boolean),
  };
}

/** Returns the current project signature, rebuilding at most every CACHE_MS. */
function getProjectSignature({ forceRefresh = false } = {}) {
  const stale = !cache || Date.now() - cachedAt > CACHE_MS;
  if (forceRefresh || stale) {
    cache = buildSignature();
    cachedAt = Date.now();
  }
  return cache;
}

module.exports = { getProjectSignature };
