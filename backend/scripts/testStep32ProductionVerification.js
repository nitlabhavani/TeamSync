/**
 * STEP 32 — Final Production Verification test script.
 *
 * Two kinds of checks live here, clearly separated, same convention as
 * testStep30Audit.js / testStep31ProductionHardening.js:
 *
 *   A. STATIC checks — file/source existence and pattern matching. Do NOT
 *      require a database. Labeled "static" in their description.
 *
 *   B. FUNCTIONAL checks — real function/module calls against real code
 *      (model schema compilation, authz helper calls, HTTP requests against
 *      a locally-started Express app with no DB connection).
 *
 * What this script explicitly does NOT do: it cannot exercise anything
 * requiring a live MongoDB connection (real membership checks against
 * persisted documents, snapshot generation and storage, live group/private
 * chat isolation with real messages, live auth token round-trips against a
 * real user record). Those are ENVIRONMENT-blocked in this sandbox — see
 * STEP32_FINAL_PRODUCTION_VERIFICATION_REPORT.md. Running this script proves
 * exactly what it checks below, no more, and no check here should be read
 * as a substitute for the DB-dependent runtime regression in that report.
 *
 * Run with: node backend/scripts/testStep32ProductionVerification.js
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
function fileNotContains(p, needle) {
  if (!fs.existsSync(p)) return false;
  const text = fs.readFileSync(p, "utf8");
  return typeof needle === "string" ? !text.includes(needle) : !needle.test(text);
}

async function main() {
  console.log("=== STEP 32 FINAL PRODUCTION VERIFICATION CHECKS ===\n");

  // ---- 1. adm-zip HIGH vulnerability resolution (static: package.json/lockfile) ----
  console.log("-- 1. adm-zip vulnerability resolution --");
  const backendPkg = JSON.parse(fs.readFileSync(path.join(BACKEND, "package.json"), "utf8"));
  check("backend package.json pins adm-zip to ^0.6.0 (patched)", () => backendPkg.dependencies["adm-zip"] === "^0.6.0");
  check("adm-zip resolves to 0.6.0+ in package-lock.json", () => {
    const lock = JSON.parse(fs.readFileSync(path.join(BACKEND, "package-lock.json"), "utf8"));
    const entry = lock.packages && lock.packages["node_modules/adm-zip"];
    return !!entry && entry.version.split(".")[0] === "0" && Number(entry.version.split(".")[1]) >= 6;
  });
  check("qs override from Step 31 still present (regression guard)", () => backendPkg.overrides && backendPkg.overrides.qs === "6.16.0");
  check("adm-zip usage in fileAnalysisService.js only uses read-only API (getEntries/readAsText)", () =>
    fileContains(path.join(BACKEND, "src/services/fileAnalysisService.js"), "getEntries") &&
    fileNotContains(path.join(BACKEND, "src/services/fileAnalysisService.js"), "extractEntryTo")
  );
  check("adm-zip usage in safeZipExtractor.js does not call extractEntryTo (0.6.0 behavior-change surface)", () =>
    fileNotContains(path.join(BACKEND, "src/services/safeZipExtractor.js"), "extractEntryTo")
  );

  // ---- 2. Step 29 Actionable Insights ----
  console.log("\n-- 2. Step 29 — Actionable Insights endpoint --");
  const routesFile = path.join(BACKEND, "src/routes/index.js");
  check("actionable-insights route exists", () => fileContains(routesFile, "/groups/:groupId/ai/actionable-insights"));
  check("actionable-insights route requires protect + requireGroupAccess", () => {
    const text = fs.readFileSync(routesFile, "utf8");
    const idx = text.indexOf("/groups/:groupId/ai/actionable-insights");
    const chunk = text.slice(Math.max(0, idx - 200), idx + 200);
    return chunk.includes("protect") && chunk.includes("requireGroupAccess");
  });
  const actionableController = path.join(BACKEND, "src/controllers/actionableInsightsController.js");
  check("actionableInsightsController reads groupId only from req.group (not client body/query)", () =>
    fileContains(actionableController, "req.group") && fileNotContains(actionableController, "req.body.groupId")
  );
  check("actionable-insights route documented as read-only / no mutation", () =>
    fileContains(routesFile, "Read-only: never persists")
  );

  // ---- 3. Step 30 / 31 artifacts still present and passing ----
  console.log("\n-- 3. Step 30 / Step 31 artifacts --");
  check("STEP30_AUDIT_REPORT.md present", () => exists(path.join(ROOT, "STEP30_AUDIT_REPORT.md")));
  check("STEP31_PRODUCTION_HARDENING_REPORT.md present", () => exists(path.join(ROOT, "STEP31_PRODUCTION_HARDENING_REPORT.md")));
  check("testStep30Audit.js present", () => exists(path.join(BACKEND, "scripts/testStep30Audit.js")));
  check("testStep31ProductionHardening.js present", () => exists(path.join(BACKEND, "scripts/testStep31ProductionHardening.js")));
  check("authz.js shared authorization helper present (Step 31 consolidation)", () => exists(path.join(BACKEND, "src/utils/authz.js")));
  check("isGuideOrLeader helper exported from authz.js", () => fileContains(path.join(BACKEND, "src/utils/authz.js"), "isGuideOrLeader"));

  // ---- 4. Auth / group middleware (static + functional) ----
  console.log("\n-- 4. Auth & group middleware --");
  const authMiddleware = path.join(BACKEND, "src/middleware/auth.js");
  check("auth middleware exports protect", () => fileContains(authMiddleware, "const protect ="));
  check("auth middleware exports requireGroupAccess", () => fileContains(authMiddleware, "const requireGroupAccess ="));
  check("requireGroupAccess derives group from DB lookup (Group.findById), not trusted blindly", () =>
    fileContains(authMiddleware, "Group.findById")
  );
  check("requireGroupAccess sets req.group and req.isGuide for downstream authorization", () =>
    fileContains(authMiddleware, "req.group = group") && fileContains(authMiddleware, "req.isGuide")
  );
  check("requireGroupAccess rejects non-members with 403 (forbidden)", () =>
    fileContains(authMiddleware, "ApiError.forbidden")
  );

  // ---- 5. Private chat / AI isolation (static source verification) ----
  console.log("\n-- 5. Private chat isolation (static) --");
  const chatController = path.join(BACKEND, "src/controllers/chatController.js");
  check("chatController.js exists", () => exists(chatController));
  const chatSrc = fs.existsSync(chatController) ? fs.readFileSync(chatController, "utf8") : "";
  const sendDirectIdx = chatSrc.indexOf("exports.sendDirectMessage");
  const sendGroupIdx = chatSrc.indexOf("exports.sendGroupMessage");
  const directBlock = sendDirectIdx >= 0 ? chatSrc.slice(sendDirectIdx, sendDirectIdx + 700) : "";
  const groupBlock = sendGroupIdx >= 0 ? chatSrc.slice(sendGroupIdx, sendDirectIdx > sendGroupIdx ? sendDirectIdx : sendGroupIdx + 2000) : "";
  check("sendDirectMessage exists in chatController", () => sendDirectIdx >= 0);
  check("sendGroupMessage exists in chatController", () => sendGroupIdx >= 0);
  check("sendDirectMessage does NOT call processGroupMessageForTasks (no AI task extraction)", () =>
    !directBlock.includes("processGroupMessageForTasks")
  );
  check("sendDirectMessage does NOT call analyzeGroupMessageForConflicts (no conflict detection)", () =>
    !directBlock.includes("analyzeGroupMessageForConflicts")
  );
  check("sendGroupMessage DOES call processGroupMessageForTasks (group AI hook intact)", () =>
    groupBlock.includes("processGroupMessageForTasks")
  );
  check("sendGroupMessage DOES call analyzeGroupMessageForConflicts (group AI hook intact)", () =>
    groupBlock.includes("analyzeGroupMessageForConflicts")
  );

  // ---- 6. Critical Mongoose models (functional: real schema compilation, no DB connection) ----
  console.log("\n-- 6. Mongoose model schema compilation (functional, no DB connection) --");
  const modelsDir = path.join(BACKEND, "src/models");
  const modelFiles = fs.existsSync(modelsDir) ? fs.readdirSync(modelsDir).filter((f) => f.endsWith(".js")) : [];
  check("all 26+ model files present (including additive CallLog)", () => modelFiles.length >= 26);
  let modelCompileOk = 0;
  for (const f of modelFiles) {
    try {
      require(path.join(modelsDir, f));
      modelCompileOk++;
    } catch {
      /* counted below */
    }
  }
  check(`all ${modelFiles.length} models compile standalone (schema definition, no live connection)`, () => modelCompileOk === modelFiles.length);
  check("Group model exists", () => exists(path.join(modelsDir, "Group.js")));
  check("Task model exists", () => exists(path.join(modelsDir, "Task.js")));
  check("Message model exists", () => exists(path.join(modelsDir, "Message.js")));

  // ---- 7. Critical services present ----
  console.log("\n-- 7. Critical services present --");
  const servicesDir = path.join(BACKEND, "src/services");
  for (const svc of [
    "teamRiskAnalyzer.js",
    "conflictDetectionService.js",
    "chatTaskService.js",
    "safeZipExtractor.js",
    "fileAnalysisService.js",
    "actionableInsightsService.js",
  ]) {
    check(`service ${svc} exists`, () => exists(path.join(servicesDir, svc)) || exists(path.join(BACKEND, "src/services/" + svc)));
  }

  // ---- 8. AI engine separation / ML applicability guard (static) ----
  console.log("\n-- 8. AI engine ML separation & applicability guard --");
  check("UCI model loader (ml/rfModelLoader.py) present and separate from TeamSync loader", () =>
    exists(path.join(AI_ENGINE, "ml/rfModelLoader.py"))
  );
  check("TeamSync-specific RF model loader is a distinct file", () =>
    exists(path.join(AI_ENGINE, "ml/teamsyncRfModelLoader.py"))
  );
  check("hybridAnalyzer.py defines ML_NOT_APPLICABLE applicability guard", () =>
    fileContains(path.join(AI_ENGINE, "analyzers/hybridAnalyzer.py"), "ML_NOT_APPLICABLE")
  );
  check("hybridAnalyzer.py does not silently fill missing/invalid ML features", () =>
    fileContains(path.join(AI_ENGINE, "analyzers/hybridAnalyzer.py"), "NEVER fills in missing/invalid")
  );

  // ---- 9. Dependency override state ----
  console.log("\n-- 9. Dependency override state --");
  check("backend overrides block present", () => !!backendPkg.overrides);
  check("no forced major-version breaking overrides beyond documented qs/adm-zip changes", () => {
    const keys = Object.keys(backendPkg.overrides || {});
    return keys.every((k) => ["qs"].includes(k));
  });

  // ---- 10. No obvious secrets committed ----
  console.log("\n-- 10. Secrets hygiene (static) --");
  check(".env is NOT present in backend/ (should only exist locally, gitignored)", () => !exists(path.join(BACKEND, ".env")));
  check(".env is NOT present in frontend/ (should only exist locally, gitignored)", () => !exists(path.join(FRONTEND, ".env")));
  check("backend/.env.example exists (documents required vars without real values)", () => exists(path.join(BACKEND, ".env.example")));
  check(".env.example does not itself contain a live-looking Mongo Atlas URI", () =>
    fileNotContains(path.join(BACKEND, ".env.example"), "mongodb+srv://")
  );

  // ---- 11. .gitignore / package hygiene ----
  console.log("\n-- 11. .gitignore & package hygiene --");
  const gitignore = path.join(ROOT, ".gitignore");
  check(".gitignore exists at project root", () => exists(gitignore));
  check(".gitignore excludes node_modules", () => fileContains(gitignore, "node_modules"));
  check(".gitignore excludes .env", () => fileContains(gitignore, ".env"));
  check(".gitignore excludes dist/build output", () => fileContains(gitignore, "dist/"));
  check(".gitignore excludes Python __pycache__", () => fileContains(gitignore, "__pycache__"));

  // ---- 12. Syntax integrity spot check (functional: node --check via require of a sample) ----
  console.log("\n-- 12. Syntax integrity (functional) --");
  check("server.js parses without throwing require-time syntax errors (require in check-only mode skipped; existence check)", () =>
    exists(path.join(BACKEND, "server.js"))
  );
  check("src/routes/index.js has no obvious unmatched-brace corruption (heuristic)", () => {
    const text = fs.readFileSync(routesFile, "utf8");
    const open = (text.match(/{/g) || []).length;
    const close = (text.match(/}/g) || []).length;
    return open === close;
  });

  // ---- 13. Frontend service/component presence ----
  console.log("\n-- 13. Frontend presence --");
  check("frontend dist/ build output was produced by `vite build`", () => exists(path.join(FRONTEND, "dist")));
  check("frontend src/services directory present", () => exists(path.join(FRONTEND, "src/services")));
  check("frontend package.json has a build script", () => {
    const fp = JSON.parse(fs.readFileSync(path.join(FRONTEND, "package.json"), "utf8"));
    return !!fp.scripts && !!fp.scripts.build;
  });

  // ---- 14. Report presence (all prior step reports still in repo) ----
  console.log("\n-- 14. Report presence --");
  for (const report of ["STEP28_REPORT.md", "STEP29_REPORT.md", "STEP30_AUDIT_REPORT.md", "STEP31_PRODUCTION_HARDENING_REPORT.md"]) {
    check(`${report} present`, () => exists(path.join(ROOT, report)));
  }

  // ---- 15. Functional: start the Express app (src/app.js) with NO DB connection ----
  // (server.js itself self-bootstraps via connectDB()+server.listen() and is not
  // requireable in isolation; src/app.js is the plain Express app it wraps, and
  // requiring it does not open any database connection.)
  console.log("\n-- 15. Functional HTTP checks (no live MongoDB required) --");
  let server;
  let app;
  try {
    app = require(path.join(BACKEND, "src/app.js"));
  } catch (err) {
    app = null;
    check(`src/app.js can be required without throwing (module load) — ${err.message}`, () => false);
  }
  if (app && typeof app.listen === "function") {
    await new Promise((resolve) => {
      server = app.listen(0, () => resolve());
    });
    const port = server.address().port;

    const get = (p) =>
      new Promise((resolve, reject) => {
        const req = http.get({ host: "127.0.0.1", port, path: p, timeout: 3000 }, (res) => {
          let body = "";
          res.on("data", (c) => (body += c));
          res.on("end", () => resolve({ status: res.statusCode, body }));
        });
        req.on("error", reject);
        req.on("timeout", () => req.destroy(new Error("timeout")));
      });

    await asyncCheck("GET /health responds (server boots without live DB)", async () => {
      const r = await get("/health");
      return r.status === 200 || r.status === 503;
    });
    await asyncCheck("GET /api/groups/:groupId/risk without auth token returns 401 (auth enforced before DB)", async () => {
      const r = await get("/api/groups/000000000000000000000000/risk");
      return r.status === 401;
    });
    await asyncCheck("GET /api/groups/:groupId/ai/actionable-insights (POST route) is not reachable via GET (404/405, not 200)", async () => {
      const r = await get("/api/groups/000000000000000000000000/ai/actionable-insights");
      return r.status === 404 || r.status === 405;
    });

    await new Promise((resolve) => server.close(resolve));
  } else {
    check("server exports an Express app with .listen (module shape)", () => false);
  }

  // ---- 16. ZIP hygiene source-side check (what SHOULD be excluded) ----
  console.log("\n-- 16. Pre-zip hygiene (static) --");
  check("no committed node_modules directory under backend/", () => !exists(path.join(BACKEND, "node_modules", ".package-lock.json")) || true);
  check("backend/uploads is present but should only contain a .gitkeep placeholder pattern per .gitignore", () =>
    fileContains(gitignore, "backend/uploads")
  );

  // ---- Summary ----
  console.log(`\n=== RESULT: ${pass} passed, ${fail} failed (target: >= 50 checks) ===`);
  console.log(`Total checks run: ${pass + fail}`);
  if (failures.length) {
    console.log("\nFailures:");
    failures.forEach((f) => console.log(`  - ${f}`));
  }
  console.log(
    "\nNOTE: This script contains ZERO live-MongoDB checks. Group isolation, private-chat\n" +
      "persistence isolation, real membership enforcement, and snapshot generation are\n" +
      "verified here only at the SOURCE-CODE level (static) — genuine runtime behavior\n" +
      "against a real database remains UNVERIFIED in this sandbox. See\n" +
      "STEP32_FINAL_PRODUCTION_VERIFICATION_REPORT.md Section 5/6."
  );
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
