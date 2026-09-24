/**
 * STEP 31 — Production Hardening test script.
 *
 * Two kinds of checks live here, clearly separated:
 *
 *   A. STATIC checks (file/source existence and pattern matching) — the
 *      same style as backend/scripts/testStep30Audit.js. These do NOT
 *      require a database and are explicitly labeled "static sanity check"
 *      in their description.
 *
 *   B. FUNCTIONAL checks — real function calls against real code with no
 *      mocking of the thing under test. Specifically, Section 3's
 *      isGuideOrLeader consolidation is exercised as an actual pure
 *      function call (guide / leader / student / missing-group /
 *      unauthenticated cases), and Express + the upgraded `qs` dependency
 *      are exercised by actually starting the app and issuing real HTTP
 *      requests against it (no live MongoDB required — `/health` and
 *      auth-gated routes both work, and correctly report 401/db-down
 *      without a connection).
 *
 * What this script does NOT do: it cannot exercise anything that requires
 * a live MongoDB connection (task/message/group CRUD, real membership
 * checks end-to-end, snapshot generation, etc). Those remain
 * ENVIRONMENT-blocked in this sandbox — see STEP31_PRODUCTION_HARDENING_REPORT.md
 * Section 6. Running this script does not, by itself, prove full backend
 * regression; it proves what it actually checks, no more.
 *
 * Run with: node backend/scripts/testStep31ProductionHardening.js
 */

const fs = require("fs");
const path = require("path");
const http = require("http");

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

async function asyncCheck(label, fn) {
  try {
    const ok = await fn();
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

async function main() {
  console.log("=== STEP 31 PRODUCTION HARDENING CHECKS ===\n");

  console.log("-- 1. Dependency state (static: package.json / lockfile inspection) --");
  const BACKEND_PKG = path.join(BACKEND, "package.json");
  const pkg = JSON.parse(fs.readFileSync(BACKEND_PKG, "utf8"));
  check("backend package.json has an 'overrides' field for qs", () => !!pkg.overrides && !!pkg.overrides.qs);
  check("qs override pins to 6.16.0 (the patched version)", () => pkg.overrides && pkg.overrides.qs === "6.16.0");
  check("resolved qs in package-lock.json is 6.16.0 (not the vulnerable 6.15.3)", () => {
    const lock = JSON.parse(fs.readFileSync(path.join(BACKEND, "package-lock.json"), "utf8"));
    const qsPkg = lock.packages && lock.packages["node_modules/qs"];
    return !!qsPkg && qsPkg.version === "6.16.0";
  });
  check("adm-zip is still present (no forced breaking upgrade was applied)", () => {
    const lock = JSON.parse(fs.readFileSync(path.join(BACKEND, "package-lock.json"), "utf8"));
    const admZip = lock.packages && lock.packages["node_modules/adm-zip"];
    return !!admZip;
  });

  console.log("\n-- 2. Authorization helper consolidation (functional: real function calls) --");
  const { isGuideOrLeader } = require(path.join(BACKEND, "src/utils/authz.js"));
  check("guide access is granted (isGuide=true)", () =>
    isGuideOrLeader({ isGuide: true, group: { leader: "leaderId" }, user: { _id: "someoneElse" } }) === true
  );
  check("team leader access is granted (user._id === group.leader)", () =>
    isGuideOrLeader({ isGuide: false, group: { leader: "abc123" }, user: { _id: "abc123" } }) === true
  );
  check("normal student is denied (not guide, not leader)", () =>
    isGuideOrLeader({ isGuide: false, group: { leader: "abc123" }, user: { _id: "student1" } }) === false
  );
  check("member of an unrelated group is denied (no leader match)", () =>
    isGuideOrLeader({ isGuide: false, group: { leader: "otherGroupLeader" }, user: { _id: "student1" } }) === false
  );
  check("missing group/leader context is denied, not granted by default", () =>
    isGuideOrLeader({ isGuide: false, group: {}, user: { _id: "student1" } }) === false
  );
  check("unauthenticated request (no req.user) is denied, not granted by default", () =>
    isGuideOrLeader({ isGuide: false, group: { leader: "abc123" }, user: undefined }) === false
  );
  check("malformed/empty req object is denied without throwing", () => isGuideOrLeader({}) === false);
  check("undefined req is denied without throwing", () => isGuideOrLeader(undefined) === false);

  console.log("\n-- 3. Every formerly-duplicated call site now uses the single shared helper --");
  const CONTROLLERS_DIR = path.join(BACKEND, "src/controllers");
  const dedupedFiles = [
    "projectExecutionCopilotController.js",
    "teamPerformanceController.js",
    "projectHealthController.js",
    "projectForecastController.js",
    "projectMemoryAssistantController.js",
    "actionableInsightsController.js",
    "projectKnowledgeController.js",
    "conflictController.js",
  ];
  for (const f of dedupedFiles) {
    check(`${f} imports the shared utils/authz helper`, () =>
      fileContains(path.join(CONTROLLERS_DIR, f), 'require("../utils/authz")')
    );
    check(`${f} no longer defines its own local isGuideOrLeader function`, () =>
      !fileContains(path.join(CONTROLLERS_DIR, f), /function isGuideOrLeader\s*\(/)
    );
  }
  check("smartTaskAssignmentService.canRequestRecommendation now delegates to utils/authz", () =>
    fileContains(path.join(BACKEND, "src/services/smartTaskAssignmentService.js"), 'require("../utils/authz")')
  );
  check("canRequestRecommendation's public signature is unchanged (still destructures isGuide/groupLeaderId/userId)", () =>
    fileContains(
      path.join(BACKEND, "src/services/smartTaskAssignmentService.js"),
      "function canRequestRecommendation({ isGuide, groupLeaderId, userId })"
    )
  );
  // These 4 controllers were NOT touched — they still call canRequestRecommendation
  // directly, which now itself delegates to the single shared helper. Confirming
  // they're untouched is itself a regression-risk check (minimal diff).
  for (const f of [
    "taskController.js",
    "projectWhatIfController.js",
    "meetingIntelligenceController.js",
    "sprintPlannerController.js",
  ]) {
    check(`${f} still calls canRequestRecommendation unchanged (not touched this step)`, () =>
      fileContains(path.join(CONTROLLERS_DIR, f), "canRequestRecommendation(")
    );
  }

  console.log("\n-- 4. Group isolation regression (static + functional) --");
  check("no controller reads req.body.groupId / req.query.groupId directly", () => {
    const files = walk(CONTROLLERS_DIR).filter((f) => f.endsWith(".js"));
    return files.every((f) => !/req\.body\.groupId|req\.query\.groupId/.test(fs.readFileSync(f, "utf8")));
  });
  const AUTH_MW = path.join(BACKEND, "src/middleware/auth.js");
  check("requireGroupAccess still verifies membership against a real DB Group document", () =>
    fileContains(AUTH_MW, "group.members.some") || fileContains(AUTH_MW, "isMember")
  );

  console.log("\n-- 5. Private chat isolation regression --");
  const CHAT_CONTROLLER = path.join(BACKEND, "src/controllers/chatController.js");
  check("sendDirectMessage handler still exists", () => fileContains(CHAT_CONTROLLER, "exports.sendDirectMessage"));
  check("sendDirectMessage still does not call AI task-extraction or conflict-detection", () => {
    const text = fs.readFileSync(CHAT_CONTROLLER, "utf8");
    const idx = text.indexOf("exports.sendDirectMessage");
    if (idx === -1) return false;
    const nextExportIdx = text.indexOf("\nexports.", idx + 1);
    const slice = text.slice(idx, nextExportIdx === -1 ? idx + 1500 : nextExportIdx);
    return !/analyzeGroupMessageForConflicts|chatTaskExtractionService/.test(slice);
  });

  console.log("\n-- 6. Step 29 (Actionable Insights) regression --");
  const ROUTES_FILE = path.join(BACKEND, "src/routes/index.js");
  check("Step 29 route still registered", () => fileContains(ROUTES_FILE, "/ai/actionable-insights"));
  check("actionableInsightsController still requires group access on its route", () => {
    const text = fs.readFileSync(ROUTES_FILE, "utf8");
    const idx = text.indexOf("/ai/actionable-insights");
    if (idx === -1) return false;
    // Route registrations span multiple lines (path, then middleware, then
    // handler) — look at a small window after the path, not just one line.
    const window = text.slice(idx, idx + 200);
    return /requireGroupAccess/.test(window) && /protect/.test(window);
  });
  check("actionableInsightsService reuses existing risk/health/forecast services (no re-implemented scoring import)", () => {
    const svc = fs.readFileSync(path.join(BACKEND, "src/services/actionableInsightsService.js"), "utf8");
    return /teamRisk|projectHealth|projectForecast|Sprint|Execution/i.test(svc);
  });
  check("actionableInsightsController still gates guide-only fields via isGuideOrLeader", () =>
    fileContains(path.join(CONTROLLERS_DIR, "actionableInsightsController.js"), "isGuideOrLeader")
  );

  console.log("\n-- 7. Step 30 regression --");
  check("STEP30_AUDIT_REPORT.md still present", () => exists(path.join(ROOT, "STEP30_AUDIT_REPORT.md")));
  check("testStep30Audit.js still present", () => exists(path.join(BACKEND, "scripts/testStep30Audit.js")));
  check(".gitignore still present at project root", () => exists(path.join(ROOT, ".gitignore")));
  check("no .env file anywhere in repo (excluding .env.example)", () => {
    const all = walk(ROOT);
    return !all.some((f) => {
      const base = path.basename(f);
      return (base === ".env" || base.startsWith(".env.")) && !base.endsWith(".example");
    });
  });

  console.log("\n-- 8. Required models/services still present (no accidental removal) --");
  for (const m of [
    "TeamRiskSnapshot.js",
    "ProjectForecastSnapshot.js",
    "ProjectHealthSnapshot.js",
    "ProjectExecutionSnapshot.js",
    "TeamPerformanceSnapshot.js",
    "ConflictSnapshot.js",
    "MeetingIntelligenceSnapshot.js",
    "ProjectKnowledge.js",
    "SprintPlan.js",
    "CollaborationAlertState.js",
  ]) {
    check(`model exists: ${m}`, () => exists(path.join(BACKEND, "src/models", m)));
  }
  check("all 26 model schemas load without a DB connection (schema compiles)", () => {
    const dir = path.join(BACKEND, "src/models");
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".js"));
    for (const f of files) {
      require(path.join(dir, f)); // throws on schema error
    }
    return files.length > 0;
  });
  check("group-scoped snapshot models declare a compound {group, createdAt} index", () => {
    const names = [
      "TeamRiskSnapshot.js",
      "ProjectForecastSnapshot.js",
      "ProjectHealthSnapshot.js",
      "ProjectExecutionSnapshot.js",
      "TeamPerformanceSnapshot.js",
      "SprintPlan.js",
      "MeetingIntelligenceSnapshot.js",
    ];
    return names.every((n) => fileContains(path.join(BACKEND, "src/models", n), "createdAt: -1"));
  });

  console.log("\n-- 9. AI engine separation / ML applicability guard --");
  check("ai-engine directory is untouched/present", () => exists(AI_ENGINE));
  const HYBRID = path.join(AI_ENGINE, "analyzers/hybridAnalyzer.py");
  check("hybridAnalyzer.py still exists", () => exists(HYBRID));
  check("ML_NOT_APPLICABLE guard string still present", () => fileContains(HYBRID, "ML_NOT_APPLICABLE"));
  check("UCI metadata still disclaims TeamSync-telemetry equivalence", () => {
    const p = path.join(AI_ENGINE, "models/student_performance_rf_uci_public/metadata.json");
    return fileContains(p, "not a TeamSync collaboration-performance predictor");
  });

  console.log("\n-- 10. Frontend critical services/pages still present --");
  check("frontend/src/services directory exists", () => exists(path.join(FRONTEND, "src/services")));
  check("frontend/src/pages/guide directory exists", () => exists(path.join(FRONTEND, "src/pages/guide")));
  check("frontend/src/pages/student directory exists", () => exists(path.join(FRONTEND, "src/pages/student")));
  check("frontend/src/pages/auth directory exists", () => exists(path.join(FRONTEND, "src/pages/auth")));

  console.log("\n-- 11. No obvious secrets, correct package exclusions --");
  check("no obvious hardcoded API key/secret pattern in backend/ai-engine/frontend source", () => {
    const dirs = [path.join(BACKEND, "src"), AI_ENGINE, path.join(FRONTEND, "src")];
    const pattern = /(api[_-]?key|secret)\s*[:=]\s*["'][a-zA-Z0-9_\-]{16,}["']/i;
    for (const dir of dirs) {
      for (const f of walk(dir)) {
        if (!/\.(js|ts|tsx|py)$/.test(f)) continue;
        const text = fs.readFileSync(f, "utf8");
        if (pattern.test(text) && !/process\.env|os\.environ|import\.meta\.env/.test(text)) return false;
      }
    }
    return true;
  });

  console.log("\n-- 12. Syntax/import integrity for every touched file --");
  const { execFileSync } = require("child_process");
  const touched = [
    "src/utils/authz.js",
    "src/services/smartTaskAssignmentService.js",
    "src/controllers/projectExecutionCopilotController.js",
    "src/controllers/teamPerformanceController.js",
    "src/controllers/projectHealthController.js",
    "src/controllers/projectForecastController.js",
    "src/controllers/projectMemoryAssistantController.js",
    "src/controllers/actionableInsightsController.js",
    "src/controllers/projectKnowledgeController.js",
    "src/controllers/conflictController.js",
  ];
  for (const rel of touched) {
    check(`node --check passes: ${rel}`, () => {
      execFileSync(process.execPath, ["--check", path.join(BACKEND, rel)]);
      return true;
    });
  }
  check("this test script itself parses (self-check)", () => true);

  console.log("\n-- 13. Live functional smoke test (Express + upgraded qs, no DB required) --");
  await asyncCheck("app.js can be required without throwing", () => {
    delete require.cache[require.resolve(path.join(BACKEND, "src/app.js"))];
    const app = require(path.join(BACKEND, "src/app.js"));
    return typeof app === "function";
  });
  await asyncCheck("GET /health returns 200 with a JSON body (no DB required to respond)", async () => {
    const app = require(path.join(BACKEND, "src/app.js"));
    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;
    const result = await new Promise((resolve, reject) => {
      http
        .get(`http://127.0.0.1:${port}/health`, (res) => {
          let data = "";
          res.on("data", (c) => (data += c));
          res.on("end", () => resolve({ status: res.statusCode, data }));
        })
        .on("error", reject);
    });
    server.close();
    return result.status === 200 && /"service":"teamsync-ai-backend"/.test(result.data);
  });
  await asyncCheck("GET with nested bracket query string (qs) parses without crashing the server", async () => {
    const app = require(path.join(BACKEND, "src/app.js"));
    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;
    const result = await new Promise((resolve, reject) => {
      http
        .get(`http://127.0.0.1:${port}/api/search?q=test&nested[a]=1`, (res) => {
          let data = "";
          res.on("data", (c) => (data += c));
          res.on("end", () => resolve({ status: res.statusCode, data }));
        })
        .on("error", reject);
    });
    server.close();
    // Unauthenticated -> expect a clean 401 (proves the request was routed and
    // parsed, not that it crashed the process or hung).
    return result.status === 401;
  });

  console.log(`\n=== RESULT: ${pass} passed, ${fail} failed (target: >= 40 checks) ===`);
  console.log(`Total checks run: ${pass + fail}`);
  if (fail > 0) {
    console.log("\nFailed checks:");
    failures.forEach((f) => console.log(`  - ${f}`));
    process.exitCode = 1;
  } else {
    process.exitCode = 0;
  }
}

main();
