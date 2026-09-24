/**
 * STEP 17 — Feature 3: Deep AI Code Review (Node, static-analysis only).
 *
 * Runs ALONGSIDE (never instead of) the existing project-identity/task-
 * relevance ZIP analysis in taskSubmissionAnalysisService.js — same
 * pattern as plagiarismAnalyzer.js. Consumes the SAME already-built,
 * already-safety-filtered manifest (see buildManifest there): no ZIP is
 * ever re-opened, no code is ever executed, no file outside the manifest
 * is ever read.
 *
 * Every check here is a plain regex/line-scan heuristic — there is no
 * compilation, no AST, no execution of any kind. "Be careful: do not
 * report something as a vulnerability unless static evidence clearly
 * supports it" (spec) — every rule below is deliberately conservative:
 * it would rather miss an issue than fabricate one, and every issue's
 * `line` is either a real computed line number or `null` (never guessed).
 */

const SEVERITY_WEIGHTS = { CRITICAL: 25, HIGH: 15, MEDIUM: 8, LOW: 3, INFO: 1 };

// Per-rule caps so a large legitimate project doesn't get buried in noise
// ("do not over-report" — spec).
const CAPS = {
  perFileConsole: 3,
  totalConsole: 8,
  perFileTodo: 3,
  totalTodo: 8,
  perFileMagicNumber: 3,
  totalMagicNumber: 8,
  perFileLongFunction: 3,
  totalLongFunction: 10,
  perFileUnusedImport: 3,
  totalUnusedImport: 8,
  totalIssues: 40,
};

const LONG_FUNCTION_LINES = 60;
const LARGE_FILE_LINES = 300;
const LARGE_COMPONENT_LINES = 150;

const COMMON_NUMBER_WHITELIST = new Set([
  0, 1, 2, 10, 100, 200, 201, 204, 301, 302, 304, 400, 401, 403, 404, 405, 409, 422, 429,
  500, 502, 503, 1000, 24, 60, 3600, 86400, 1024, 2024, 2025, 2026,
]);

function lineOf(content, index) {
  if (index < 0) return null;
  return content.slice(0, index).split("\n").length;
}

function isBackendish(file) {
  const p = file.relPath.toLowerCase();
  if (p.includes("controller") || p.includes("/routes/") || p.includes("route")) return true;
  return /require\(["']express["']\)|from ["']express["']|router\.(get|post|put|patch|delete)\(|app\.(get|post|put|patch|delete)\(/.test(
    file.content
  );
}

function isReactish(file) {
  if (file.ext === ".jsx" || file.ext === ".tsx") return true;
  return /from ["']react["']|React\.(Component|useState|useEffect)/.test(file.content);
}

function isJsLike(file) {
  return [".js", ".jsx", ".ts", ".tsx"].includes(file.ext);
}

/** Finds the index of the `}` matching the `{` at openIndex (simple brace counting; ignores braces inside strings/comments — a known limitation of a regex-only, non-AST analyzer, noted in the Step 17 report). */
function matchingBraceEnd(content, openIndex) {
  let depth = 0;
  for (let i = openIndex; i < content.length; i += 1) {
    if (content[i] === "{") depth += 1;
    else if (content[i] === "}") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/* ---------------------------------------------------------------------
 * ERROR_HANDLING
 * ------------------------------------------------------------------- */

function detectEmptyCatch(file, issues) {
  const re = /catch\s*(\([^)]*\))?\s*\{\s*\}/g;
  let m;
  while ((m = re.exec(file.content))) {
    issues.push({
      severity: "HIGH",
      category: "ERROR_HANDLING",
      file: file.relPath,
      line: lineOf(file.content, m.index),
      message: "Empty catch block — an error is caught and silently discarded.",
      suggestion: "At minimum log the error, and handle or rethrow it as appropriate.",
    });
  }
}

function detectPromiseWithoutCatch(file, issues) {
  // A `.then(` chain with no `.catch(` anywhere in the same statement chain
  // (approximated by scanning up to the next `;` or double-newline).
  const re = /\.then\s*\(/g;
  let m;
  let count = 0;
  while ((m = re.exec(file.content)) && count < 5) {
    const windowEnd = Math.min(file.content.length, m.index + 400);
    const tail = file.content.slice(m.index, windowEnd);
    const stop = tail.search(/;|\n\s*\n/);
    const statement = stop >= 0 ? tail.slice(0, stop) : tail;
    if (!statement.includes(".catch(") && !statement.includes("await ")) {
      issues.push({
        severity: "MEDIUM",
        category: "ERROR_HANDLING",
        file: file.relPath,
        line: lineOf(file.content, m.index),
        message: "Promise chain does not appear to have a .catch() handler.",
        suggestion: "Add a .catch() (or wrap in try/catch if awaited) so a rejection cannot go unhandled.",
      });
      count += 1;
    }
  }
}

const ERROR_HANDLING_MARKERS = ["try", "asyncHandler", "catchAsync", "asyncWrapper", ".catch("];

function detectAsyncWithoutErrorHandling(file, issues) {
  if (!isBackendish(file)) return;
  const hasRouteHandler = /router\.(get|post|put|patch|delete)\(|app\.(get|post|put|patch|delete)\(/.test(file.content);
  const hasAsync = /\basync\s+function\b|\basync\s*\(/.test(file.content);
  if (!hasRouteHandler || !hasAsync) return;
  const hasErrorHandling = ERROR_HANDLING_MARKERS.some((m) => file.content.includes(m));
  if (hasErrorHandling) return;
  issues.push({
    severity: "MEDIUM",
    category: "ERROR_HANDLING",
    file: file.relPath,
    line: null,
    message: "This file defines async route handler(s) with no try/catch, .catch(), or error-handling wrapper found anywhere in the file.",
    suggestion: "Wrap async route handlers in try/catch (or an async-error-handling wrapper) and return a proper error response on failure.",
  });
}

/* ---------------------------------------------------------------------
 * CODE_QUALITY
 * ------------------------------------------------------------------- */

function detectConsoleStatements(file, issues, totals) {
  const re = /console\.(log|debug|warn|error)\s*\(/g;
  let m;
  let count = 0;
  while ((m = re.exec(file.content)) && count < CAPS.perFileConsole && totals.console < CAPS.totalConsole) {
    issues.push({
      severity: "LOW",
      category: "CODE_QUALITY",
      file: file.relPath,
      line: lineOf(file.content, m.index),
      message: "console/debug statement left in the code.",
      suggestion: "Remove debug output before submitting, or use a proper logger the project already has.",
    });
    count += 1;
    totals.console += 1;
  }
}

function detectTodoFixme(file, issues, totals) {
  const re = /\b(TODO|FIXME)\b/g;
  let m;
  let count = 0;
  while ((m = re.exec(file.content)) && count < CAPS.perFileTodo && totals.todo < CAPS.totalTodo) {
    issues.push({
      severity: "INFO",
      category: "CODE_QUALITY",
      file: file.relPath,
      line: lineOf(file.content, m.index),
      message: `Unresolved ${m[1]} marker.`,
      suggestion: "Resolve or track this before final submission.",
    });
    count += 1;
    totals.todo += 1;
  }
}

function detectLongFunctions(file, issues, totals) {
  if (!isJsLike(file)) return;
  const cap = isReactish(file) ? LARGE_COMPONENT_LINES : LONG_FUNCTION_LINES;
  const re = /(function\s+\w+\s*\([^)]*\)\s*\{|(?:const|let)\s+\w+\s*=\s*(?:async\s*)?\([^)]*\)\s*=>\s*\{)/g;
  let m;
  let count = 0;
  while ((m = re.exec(file.content)) && count < CAPS.perFileLongFunction && totals.longFn < CAPS.totalLongFunction) {
    const openBrace = file.content.indexOf("{", m.index);
    if (openBrace === -1) continue;
    const closeBrace = matchingBraceEnd(file.content, openBrace);
    if (closeBrace === -1) continue;
    const lineCount = file.content.slice(openBrace, closeBrace).split("\n").length;
    if (lineCount > cap) {
      issues.push({
        severity: "LOW",
        category: "CODE_QUALITY",
        file: file.relPath,
        line: lineOf(file.content, m.index),
        message: isReactish(file)
          ? `Component/function is large (~${lineCount} lines) and could be split into smaller components.`
          : `Function is long (~${lineCount} lines) and could be split into smaller functions.`,
        suggestion: isReactish(file)
          ? "Extract a self-contained section into its own component."
          : "Extract cohesive chunks of this function into smaller, named helper functions.",
      });
      count += 1;
      totals.longFn += 1;
    }
  }
}

function detectLargeFile(file, issues) {
  const lineCount = file.content.split("\n").length;
  if (lineCount > LARGE_FILE_LINES) {
    issues.push({
      severity: "LOW",
      category: "CODE_QUALITY",
      file: file.relPath,
      line: null,
      message: `File is large (${lineCount} lines).`,
      suggestion: "Consider splitting this file into smaller, more focused modules.",
    });
  }
}

function detectDuplicatedBlocks(file, issues) {
  const lines = file.content.split("\n").map((l) => l.trim());
  const seen = new Map();
  for (let i = 0; i + 5 <= lines.length; i += 1) {
    const window = lines.slice(i, i + 5);
    if (window.some((l) => l.length < 4)) continue; // skip windows with near-empty lines (too generic to count)
    const key = window.join("\n");
    if (key.length < 60) continue; // too short to be meaningful evidence of duplication
    if (seen.has(key)) {
      issues.push({
        severity: "LOW",
        category: "CODE_QUALITY",
        file: file.relPath,
        line: seen.get(key),
        message: "A 5+ line block of code appears to be duplicated elsewhere in this file.",
        suggestion: "Extract the repeated block into a shared function.",
      });
      return; // one report per file is enough — avoid flooding on one repeated pattern
    }
    seen.set(key, i + 1);
  }
}

function detectMagicNumbers(file, issues, totals) {
  const re = /\b(?:if|while)\s*\([^)]*?\b(\d{3,})\b[^)]*\)/g;
  let m;
  let count = 0;
  while ((m = re.exec(file.content)) && count < CAPS.perFileMagicNumber && totals.magic < CAPS.totalMagicNumber) {
    const num = Number(m[1]);
    if (COMMON_NUMBER_WHITELIST.has(num)) continue;
    issues.push({
      severity: "INFO",
      category: "CODE_QUALITY",
      file: file.relPath,
      line: lineOf(file.content, m.index),
      message: `Magic number ${num} used directly in a condition.`,
      suggestion: "Extract it into a named constant so its meaning is clear.",
    });
    count += 1;
    totals.magic += 1;
  }
}

function detectUnusedImports(file, issues, totals) {
  if (!isJsLike(file)) return;
  const re = /import\s*\{([^}]+)\}\s*from\s*["'][^"']+["']/g;
  let m;
  let count = 0;
  while ((m = re.exec(file.content)) && count < CAPS.perFileUnusedImport && totals.unusedImport < CAPS.totalUnusedImport) {
    const names = m[1].split(",").map((s) => s.trim().split(/\s+as\s+/)[0].trim()).filter(Boolean);
    const afterImportLine = file.content.slice(m.index + m[0].length);
    names.forEach((name) => {
      if (!name || name === "React") return;
      const usedElsewhere = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(afterImportLine);
      if (!usedElsewhere && count < CAPS.perFileUnusedImport && totals.unusedImport < CAPS.totalUnusedImport) {
        issues.push({
          severity: "LOW",
          category: "CODE_QUALITY",
          file: file.relPath,
          line: lineOf(file.content, m.index),
          message: `Imported "${name}" does not appear to be used anywhere else in this file.`,
          suggestion: "Remove the unused import, or use it if it was meant to be used.",
        });
        count += 1;
        totals.unusedImport += 1;
      }
    });
  }
}

/* ---------------------------------------------------------------------
 * REACT (jsx/tsx only)
 * ------------------------------------------------------------------- */

function detectMissingReactKey(file, issues) {
  if (!isReactish(file)) return;
  const mapCalls = [...file.content.matchAll(/\.map\s*\(/g)];
  if (!mapCalls.length) return;
  const rendersJsx = /\.map\s*\([\s\S]{0,60}?=>\s*\(?\s*</.test(file.content);
  if (!rendersJsx) return;
  if (file.content.includes("key=")) return; // some key prop exists somewhere — don't claim it's missing
  issues.push({
    severity: "MEDIUM",
    category: "REACT",
    file: file.relPath,
    line: null,
    message: "This file maps over a list and renders JSX, but no key= prop was found anywhere in the file.",
    suggestion: "Add a stable, unique key prop to each element rendered inside .map().",
  });
}

function detectMissingDependencyArray(file, issues) {
  if (!isReactish(file)) return;
  const re = /useEffect\s*\(/g;
  let m;
  let count = 0;
  while ((m = re.exec(file.content)) && count < 3) {
    const openParen = file.content.indexOf("(", m.index);
    // Walk forward tracking paren depth to find this call's own closing ")".
    let depth = 0;
    let closeParen = -1;
    let topLevelComma = false;
    for (let i = openParen; i < file.content.length; i += 1) {
      const ch = file.content[i];
      if (ch === "(") depth += 1;
      else if (ch === ")") {
        depth -= 1;
        if (depth === 0) {
          closeParen = i;
          break;
        }
      } else if (ch === "," && depth === 1) {
        topLevelComma = true;
      }
    }
    if (closeParen !== -1 && !topLevelComma) {
      issues.push({
        severity: "MEDIUM",
        category: "REACT",
        file: file.relPath,
        line: lineOf(file.content, m.index),
        message: "useEffect() call has no second (dependency array) argument.",
        suggestion: "Add a dependency array — [] to run once, or the specific values the effect depends on.",
      });
      count += 1;
    }
  }
}

/* ---------------------------------------------------------------------
 * BACKEND
 * ------------------------------------------------------------------- */

function detectUnvalidatedRequestFields(file, issues) {
  if (!isBackendish(file)) return;
  const usesBodyDirectly = /\.(create|updateOne|findOneAndUpdate|insertMany)\s*\(\s*req\.body\s*\)/.test(file.content);
  if (!usesBodyDirectly) return;
  const hasValidation = /\b(joi|zod|express-validator|celebrate|yup)\b/i.test(file.content) || /\.parse\(|\.safeParse\(|validate\(/.test(file.content);
  if (hasValidation) return;
  issues.push({
    severity: "MEDIUM",
    category: "BACKEND",
    file: file.relPath,
    line: null,
    message: "req.body is passed directly into a database write with no validation library or explicit validate() call found in this file.",
    suggestion: "Validate/sanitize request fields before writing them to the database (e.g. a schema validator or explicit field allow-list).",
  });
}

function detectClientControlledIdInSensitiveOp(file, issues) {
  if (!isBackendish(file)) return;
  const re = /(findByIdAndDelete|findByIdAndUpdate|deleteOne|updateOne)\s*\(\s*(?:\{\s*_id\s*:\s*)?req\.params\.\w*[Ii]d/g;
  let m;
  if (!re.test(file.content)) return;
  re.lastIndex = 0;
  const hasOwnershipCheck = /req\.user/.test(file.content);
  if (hasOwnershipCheck) return; // some form of auth/ownership context is present in this file
  while ((m = re.exec(file.content))) {
    issues.push({
      severity: "MEDIUM",
      category: "BACKEND",
      file: file.relPath,
      line: lineOf(file.content, m.index),
      message: "A client-supplied ID (req.params) is used directly in a write/delete operation, and this file contains no visible ownership/authorization check (no req.user reference found).",
      suggestion: "Verify the requesting user is authorized to modify/delete this specific resource before applying the change.",
    });
    break; // one report per file/rule is enough evidence to act on
  }
}

/* ---------------------------------------------------------------------
 * Orchestration
 * ------------------------------------------------------------------- */

const ALL_RULES_FILE_LEVEL = [
  detectEmptyCatch,
  detectPromiseWithoutCatch,
  detectAsyncWithoutErrorHandling,
  detectLargeFile,
  detectDuplicatedBlocks,
  detectMissingReactKey,
  detectMissingDependencyArray,
  detectUnvalidatedRequestFields,
  detectClientControlledIdInSensitiveOp,
];

/**
 * @param {Array<{relPath:string, ext:string, content:string}>} files — the
 *   SAME manifest built for the existing ZIP submission analysis (already
 *   safety-filtered, already size-capped — see buildManifest in
 *   taskSubmissionAnalysisService.js). Files with empty content (binary/
 *   non-texty/oversized, per that existing cap) are skipped here too.
 */
function reviewCode(files = []) {
  const issues = [];
  const totals = { console: 0, todo: 0, magic: 0, longFn: 0, unusedImport: 0 };
  const scanned = (files || []).filter((f) => f && typeof f.content === "string" && f.content.length > 0);

  scanned.forEach((file) => {
    ALL_RULES_FILE_LEVEL.forEach((rule) => rule(file, issues));
    detectConsoleStatements(file, issues, totals);
    detectTodoFixme(file, issues, totals);
    detectMagicNumbers(file, issues, totals);
    detectLongFunctions(file, issues, totals);
    detectUnusedImports(file, issues, totals);
  });

  const cappedIssues = issues.slice(0, CAPS.totalIssues);

  let score = null;
  if (scanned.length > 0) {
    score = 100;
    cappedIssues.forEach((i) => {
      score -= SEVERITY_WEIGHTS[i.severity] || 0;
    });
    score = Math.max(0, Math.min(100, Math.round(score)));
  }

  const positiveFindings = [];
  const jsFiles = scanned.filter(isJsLike);
  const backendFiles = scanned.filter(isBackendish);
  const reactFiles = scanned.filter(isReactish);
  const byCategory = (cat) => cappedIssues.some((i) => i.category === cat);

  if (jsFiles.length && !cappedIssues.some((i) => i.message.startsWith("Empty catch"))) {
    positiveFindings.push("No empty catch blocks found in the analyzed files.");
  }
  if (jsFiles.length && totals.console === 0) {
    positiveFindings.push("No console/debug statements found in the analyzed files.");
  }
  if (jsFiles.length && totals.todo === 0) {
    positiveFindings.push("No unresolved TODO/FIXME markers found.");
  }
  if (reactFiles.length && !byCategory("REACT")) {
    positiveFindings.push("No obvious React key/dependency-array issues detected in the analyzed components.");
  }
  if (backendFiles.length && !byCategory("BACKEND") && !cappedIssues.some((i) => i.category === "ERROR_HANDLING" && i.file && isBackendish({ relPath: i.file, content: "", ext: "" }))) {
    positiveFindings.push("No obvious unvalidated-input or unchecked-ID patterns detected in the analyzed backend files.");
  }

  return {
    score,
    issues: cappedIssues,
    positiveFindings,
    analyzedFileCount: scanned.length,
  };
}

module.exports = {
  reviewCode,
  SEVERITY_WEIGHTS,
  CAPS,
  isBackendish,
  isReactish,
  isJsLike,
  // exported for unit tests
  detectEmptyCatch,
  detectPromiseWithoutCatch,
  detectAsyncWithoutErrorHandling,
  detectConsoleStatements,
  detectTodoFixme,
  detectLongFunctions,
  detectLargeFile,
  detectDuplicatedBlocks,
  detectMagicNumbers,
  detectUnusedImports,
  detectMissingReactKey,
  detectMissingDependencyArray,
  detectUnvalidatedRequestFields,
  detectClientControlledIdInSensitiveOp,
};
