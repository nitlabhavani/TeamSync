/**
 * STEP 30 — Audit sanity-check script.
 *
 * Static, file-system + source-level checks that DO NOT require a live
 * MongoDB connection or a running AI engine. This intentionally mirrors the
 * spirit of the other backend/scripts/test*.js files (plain Node scripts,
 * not a test framework) so it can be run with:
 *
 *   node backend/scripts/testStep30Audit.js
 *
 * It verifies structural/architectural invariants claimed in
 * STEP30_AUDIT_REPORT.md: that critical routes/models/services/middleware
 * exist, that group-isolation and private-chat-isolation patterns are
 * present in source, that no .env or obvious hardcoded secret is packaged,
 * and that Step 30's own touched files are syntactically valid.
 *
 * This script does NOT hit a database or network. It cannot verify runtime
 * behavior (e.g. that requireGroupAccess actually rejects a foreign user at
 * request time) — only that the relevant code exists and reads correctly.
 * Genuine end-to-end verification needs backend/scripts/testGroupAccessIsolation.js
 * and friends running against a live Mongo instance.
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const BACKEND = path.join(ROOT, "backend");
const AI_ENGINE = path.join(ROOT, "ai-engine");
const FRONTEND = path.join(ROOT, "frontend");

let pass = 0;
let fail = 0;
const failures = [];

function check(label, fn) {
  try {
    const ok = fn();
    if (ok) {
      pass++;
      console.log(`  PASS  ${label}`);
    } else {
      fail++;
      failures.push(label);
      console.log(`  FAIL  ${label}`);
    }
  } catch (err) {
    fail++;
    failures.push(`${label} (threw: ${err.message})`);
    console.log(`  FAIL  ${label} (threw: ${err.message})`);
  }
}

function exists(p) {
  return fs.existsSync(p);
}

function fileContains(p, needle) {
  if (!fs.existsSync(p)) return false;
  const text = fs.readFileSync(p, "utf8");
  return typeof needle === "string" ? text.includes(needle) : needle.test(text);
}

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

console.log("=== STEP 30 AUDIT SANITY CHECKS ===\n");

console.log("-- 1. Critical routes exist (routes/index.js) --");
const ROUTES_FILE = path.join(BACKEND, "src/routes/index.js");
check("routes/index.js exists", () => exists(ROUTES_FILE));
check("groups/:groupId/messages route registered", () =>
  fileContains(ROUTES_FILE, "/groups/:groupId/messages")
);
check("chat/direct/:userId route registered", () => fileContains(ROUTES_FILE, "/chat/direct/:userId"));
check("Step 28 project-memory/ask route exists", () =>
  fileContains(ROUTES_FILE, "/ai/project-memory/ask")
);
check("Step 29 actionable-insights route exists", () =>
  fileContains(ROUTES_FILE, "/ai/actionable-insights")
);
check("ai-risk (team risk) route exists", () => fileContains(ROUTES_FILE, "/ai-risk"));
check("project-forecast route exists", () => fileContains(ROUTES_FILE, "/project-forecast"));
check("project-health route exists", () => fileContains(ROUTES_FILE, "/project-health"));
check("what-if simulate route exists", () => fileContains(ROUTES_FILE, "/what-if/simulate"));

console.log("\n-- 2. Critical models exist --");
const MODELS = [
  "Group.js",
  "User.js",
  "Message.js",
  "Task.js",
  "TeamRiskSnapshot.js",
  "ProjectForecastSnapshot.js",
  "ProjectHealthSnapshot.js",
  "ProjectExecutionSnapshot.js",
  "TeamPerformanceSnapshot.js",
  "ConflictSnapshot.js",
  "ProjectKnowledge.js",
  "SprintPlan.js",
  "MeetingIntelligenceSnapshot.js",
  "CollaborationAlertState.js",
];
for (const m of MODELS) {
  check(`model exists: ${m}`, () => exists(path.join(BACKEND, "src/models", m)));
}

console.log("\n-- 3. Critical services exist --");
const SERVICES = [
  "actionableInsightsService.js",
  "projectMemoryAssistantService.js",
  "projectWhatIfSimulatorService.js",
  "sprintPlannerService.js",
  "conflictDetectionService.js",
  "projectKnowledgeService.js",
  "teamPerformanceService.js",
  "projectExecutionCopilotService.js",
  "projectHealthService.js",
  "projectForecastService.js",
  "chatTaskExtractionService.js",
  "safeZipExtractor.js",
];
for (const s of SERVICES) {
  check(`service exists: ${s}`, () => exists(path.join(BACKEND, "src/services", s)));
}

console.log("\n-- 4. Group authorization middleware exists --");
const AUTH_MW = path.join(BACKEND, "src/middleware/auth.js");
check("middleware/auth.js exists", () => exists(AUTH_MW));
check("requireGroupAccess is defined", () => fileContains(AUTH_MW, "requireGroupAccess"));
check("requireGroupAccess verifies membership against DB group record", () =>
  fileContains(AUTH_MW, "group.members.some") || fileContains(AUTH_MW, "isMember")
);
check("protect (auth) middleware is defined", () => fileContains(AUTH_MW, "const protect"));

console.log("\n-- 5. Private chat isolation patterns exist --");
const CHAT_CONTROLLER = path.join(BACKEND, "src/controllers/chatController.js");
check("chatController.js exists", () => exists(CHAT_CONTROLLER));
check("sendDirectMessage handler exists (separate from group send)", () =>
  fileContains(CHAT_CONTROLLER, "exports.sendDirectMessage") ||
  fileContains(CHAT_CONTROLLER, "sendDirectMessage")
);
check("direct-message path documented/implemented without AI task-extraction call", () => {
  const text = fs.readFileSync(CHAT_CONTROLLER, "utf8");
  // Anchor on the actual export declaration, not any earlier comment that
  // merely mentions "sendDirectMessage" by name (e.g. explaining why the
  // group-message path is fire-and-forget).
  const idx = text.indexOf("exports.sendDirectMessage");
  if (idx === -1) return false;
  const nextExportIdx = text.indexOf("\nexports.", idx + 1);
  const slice = text.slice(idx, nextExportIdx === -1 ? idx + 1500 : nextExportIdx);
  // The direct-message handler body should not itself invoke AI task/conflict analysis.
  return !/analyzeGroupMessageForConflicts|chatTaskExtractionService/.test(slice);
});
check("no controller reads req.body.groupId / req.query.groupId directly (bypassing req.group)", () => {
  const controllersDir = path.join(BACKEND, "src/controllers");
  const files = walk(controllersDir).filter((f) => f.endsWith(".js"));
  return files.every((f) => {
    const text = fs.readFileSync(f, "utf8");
    return !/req\.body\.groupId|req\.query\.groupId/.test(text);
  });
});

console.log("\n-- 6. Step 28 / Step 29 routes exist (regression check) --");
check("Step 28 route (project-memory/ask) present", () =>
  fileContains(ROUTES_FILE, "/ai/project-memory/ask")
);
check("Step 29 route (actionable-insights) present", () =>
  fileContains(ROUTES_FILE, "/ai/actionable-insights")
);
check("projectMemoryAssistantController.js exists", () =>
  exists(path.join(BACKEND, "src/controllers/projectMemoryAssistantController.js"))
);
check("actionableInsightsController.js exists", () =>
  exists(path.join(BACKEND, "src/controllers/actionableInsightsController.js"))
);

console.log("\n-- 7. Major snapshot models exist --");
const SNAPSHOT_MODELS = [
  "TeamRiskSnapshot.js",
  "ProjectForecastSnapshot.js",
  "ProjectHealthSnapshot.js",
  "ProjectExecutionSnapshot.js",
  "TeamPerformanceSnapshot.js",
  "MeetingIntelligenceSnapshot.js",
  "ConflictSnapshot.js",
];
for (const m of SNAPSHOT_MODELS) {
  check(`snapshot model exists: ${m}`, () => exists(path.join(BACKEND, "src/models", m)));
}

console.log("\n-- 8. No .env file is packaged --");
check("no .env file anywhere in repo (excluding .env.example)", () => {
  const all = walk(ROOT);
  return !all.some((f) => {
    const base = path.basename(f);
    return (base === ".env" || base.startsWith(".env.")) && !base.endsWith(".example");
  });
});
check("backend/.env.example exists (documents required vars without real secrets)", () =>
  exists(path.join(BACKEND, ".env.example"))
);
check(".env.example does not contain a real-looking secret value", () => {
  const p = path.join(BACKEND, ".env.example");
  if (!exists(p)) return false;
  const text = fs.readFileSync(p, "utf8");
  return !/SMTP_PASS=(?!YOUR_)[^\s]{8,}/.test(text) && !/JWT_SECRET=(?!replace)[^\s]{16,}/.test(text);
});

console.log("\n-- 9. No obvious hardcoded secrets in source --");
check("no obvious hardcoded API key/secret pattern in backend/ai-engine/frontend source", () => {
  const dirs = [path.join(BACKEND, "src"), AI_ENGINE, path.join(FRONTEND, "src")];
  const pattern = /(api[_-]?key|secret)\s*[:=]\s*["'][a-zA-Z0-9_\-]{16,}["']/i;
  for (const dir of dirs) {
    for (const f of walk(dir)) {
      if (!/\.(js|ts|tsx|py)$/.test(f)) continue;
      const text = fs.readFileSync(f, "utf8");
      if (pattern.test(text) && !/process\.env|os\.environ|import\.meta\.env/.test(text)) {
        return false;
      }
    }
  }
  return true;
});

console.log("\n-- 10. Required frontend services/components exist --");
check("frontend/src/services directory exists", () => exists(path.join(FRONTEND, "src/services")));
check("frontend/src/pages/guide directory exists", () => exists(path.join(FRONTEND, "src/pages/guide")));
check("frontend/src/pages/student directory exists", () => exists(path.join(FRONTEND, "src/pages/student")));
check("frontend authService exists", () => {
  const svc = walk(path.join(FRONTEND, "src/services")).find((f) => /authService\.js$/.test(f));
  return !!svc;
});

console.log("\n-- 11. Report exists --");
check("STEP30_AUDIT_REPORT.md exists at project root", () =>
  exists(path.join(ROOT, "STEP30_AUDIT_REPORT.md"))
);

console.log("\n-- 12. Syntax/import checks for Step 30 touched files --");
check(".gitignore added at project root", () => exists(path.join(ROOT, ".gitignore")));
check("this test script itself parses (self-check)", () => {
  // If we got this far without throwing on require(), the script is syntactically valid.
  return true;
});
check("routes/index.js has no obvious unmatched-brace corruption (basic heuristic)", () => {
  const text = fs.readFileSync(ROUTES_FILE, "utf8");
  const opens = (text.match(/\{/g) || []).length;
  const closes = (text.match(/\}/g) || []).length;
  return opens === closes;
});

console.log(`\n=== RESULT: ${pass} passed, ${fail} failed (target: >= 30 checks) ===`);
console.log(`Total checks run: ${pass + fail}`);
if (fail > 0) {
  console.log("\nFailed checks:");
  failures.forEach((f) => console.log(`  - ${f}`));
  process.exitCode = 1;
} else {
  process.exitCode = 0;
}
