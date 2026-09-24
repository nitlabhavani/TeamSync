/**
 * AI file analysis.
 *
 * Primary path: delegate to the Python AI engine (ai-engine/analyzers/fileAnalyzer.py).
 * Fallback path: the deterministic Node heuristics below, so submissions are
 * always reviewed even when the engine is offline.
 *
 * Checks performed: missing README / documentation / screenshots, empty
 * folders, duplicate files, folder structure, obvious compilation-blocking
 * mistakes and code-comment density.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const aiEngine = require("./aiEngineClient");

const CODE_EXT = new Set([
  ".js", ".jsx", ".ts", ".tsx", ".py", ".java", ".c", ".cpp", ".cs", ".go",
  ".rb", ".php", ".rs", ".kt", ".swift", ".dart", ".sql", ".html", ".css",
]);
const DOC_EXT = new Set([".md", ".pdf", ".docx", ".doc", ".txt", ".ppt", ".pptx"]);
const IMG_EXT = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"]);

const ext = (p) => path.extname(p).toLowerCase();

/** List entries of a zip (uses adm-zip when installed, otherwise skips). */
function readZipEntries(filePath) {
  try {
    // eslint-disable-next-line global-require, import/no-extraneous-dependencies
    const AdmZip = require("adm-zip");
    const zip = new AdmZip(filePath);
    return zip.getEntries().map((e) => ({
      name: e.entryName,
      isDirectory: e.isDirectory,
      size: e.header.size,
      read: () => (e.isDirectory ? "" : zip.readAsText(e)),
    }));
  } catch (err) {
    return null;
  }
}

function analyseCodeText(name, text) {
  const issues = [];
  const lines = text.split("\n");
  const commentLines = lines.filter((l) => /^\s*(\/\/|#|\/\*|\*)/.test(l)).length;
  const codeLines = lines.filter((l) => l.trim()).length || 1;

  if (commentLines / codeLines < 0.03 && codeLines > 40) {
    issues.push(`Improve code comments in ${name}`);
  }
  if (/console\.log\(|print\(\s*["']debug/i.test(text)) {
    issues.push(`Remove debug output from ${name}`);
  }
  if (/TODO|FIXME/.test(text)) issues.push(`Unresolved TODO/FIXME in ${name}`);

  // very small "will it compile" sanity check — unbalanced braces/brackets
  const open = (text.match(/[{[(]/g) || []).length;
  const close = (text.match(/[}\])]/g) || []).length;
  if (Math.abs(open - close) > 2) issues.push(`Possible compilation issue (unbalanced brackets) in ${name}`);

  return issues;
}

/** Deterministic local analysis of a single uploaded file. */
function analyseLocally(filePath, originalName) {
  const checks = {
    hasReadme: false,
    hasDocumentation: false,
    hasScreenshots: false,
    hasSourceCode: false,
    emptyFolders: [],
    duplicateFiles: [],
    fileCount: 0,
    folderCount: 0,
    topLevelFolders: [],
  };
  const issues = [];
  const recommendations = [];
  const e = ext(originalName || filePath);

  const isArchive = e === ".zip";
  const entries = isArchive ? readZipEntries(filePath) : null;

  if (isArchive && entries) {
    const hashes = new Map();
    const dirs = new Set();
    const dirHasChild = new Set();

    entries.forEach((entry) => {
      const name = entry.name.replace(/\\/g, "/");
      if (entry.isDirectory) {
        dirs.add(name.replace(/\/$/, ""));
        checks.folderCount += 1;
        return;
      }
      checks.fileCount += 1;
      const parent = name.split("/").slice(0, -1).join("/");
      if (parent) dirHasChild.add(parent);
      const base = path.basename(name).toLowerCase();
      const fe = ext(name);

      if (base.startsWith("readme")) checks.hasReadme = true;
      if (DOC_EXT.has(fe) && !base.startsWith("readme")) checks.hasDocumentation = true;
      if (IMG_EXT.has(fe)) checks.hasScreenshots = true;
      if (CODE_EXT.has(fe)) {
        checks.hasSourceCode = true;
        const text = entry.read();
        if (text) issues.push(...analyseCodeText(name, text).slice(0, 2));
        const h = crypto.createHash("md5").update(text || name).digest("hex");
        if (hashes.has(h)) checks.duplicateFiles.push(`${hashes.get(h)} == ${name}`);
        else hashes.set(h, name);
      }
      const top = name.split("/")[0];
      if (name.includes("/") && !checks.topLevelFolders.includes(top)) checks.topLevelFolders.push(top);
    });

    dirs.forEach((d) => {
      const hasChild = [...dirHasChild].some((p) => p === d || p.startsWith(`${d}/`));
      if (!hasChild) checks.emptyFolders.push(d);
    });
  } else {
    // Single file submission
    checks.fileCount = 1;
    const base = path.basename(originalName || filePath).toLowerCase();
    if (base.startsWith("readme")) checks.hasReadme = true;
    if (DOC_EXT.has(e)) checks.hasDocumentation = true;
    if (IMG_EXT.has(e)) checks.hasScreenshots = true;
    if (CODE_EXT.has(e)) {
      checks.hasSourceCode = true;
      try {
        const text = fs.readFileSync(filePath, "utf8");
        issues.push(...analyseCodeText(base, text));
      } catch {
        /* binary or unreadable */
      }
    }
  }

  if (!checks.hasReadme) recommendations.push("Add a README file describing setup and usage");
  if (!checks.hasDocumentation) recommendations.push("Add project documentation (report / design document)");
  if (!checks.hasScreenshots && checks.hasSourceCode) recommendations.push("Add screenshots of the working application");
  if (checks.emptyFolders.length) {
    issues.push(`Empty folder(s): ${checks.emptyFolders.slice(0, 5).join(", ")}`);
    recommendations.push("Remove or populate empty folders");
  }
  if (checks.duplicateFiles.length) {
    issues.push(`Duplicate file(s): ${checks.duplicateFiles.slice(0, 5).join(", ")}`);
    recommendations.push("Remove duplicated source files");
  }
  if (isArchive && entries && checks.topLevelFolders.length < 2) {
    recommendations.push("Improve folder structure (separate src, docs and assets)");
  }
  if (isArchive && !entries) {
    issues.push("Archive could not be inspected on this server (install adm-zip for deep ZIP analysis)");
  }

  let score = 100;
  score -= checks.hasReadme ? 0 : 12;
  score -= checks.hasDocumentation ? 0 : 10;
  score -= checks.hasScreenshots || !checks.hasSourceCode ? 0 : 6;
  score -= Math.min(20, checks.emptyFolders.length * 4);
  score -= Math.min(20, checks.duplicateFiles.length * 5);
  score -= Math.min(25, issues.length * 4);
  score = Math.max(20, Math.round(score));

  const summary = `Reviewed ${checks.fileCount} file(s)${
    checks.folderCount ? ` across ${checks.folderCount} folder(s)` : ""
  }. ${issues.length ? `${issues.length} issue(s) found.` : "No blocking issues found."}`;

  return {
    engine: "node-heuristics",
    score,
    summary,
    issues: [...new Set(issues)].slice(0, 20),
    recommendations: [...new Set(recommendations)].slice(0, 12),
    checks,
    analyzedAt: new Date(),
  };
}

/**
 * Analyse an uploaded submission file. Tries the Python engine first, then the
 * local heuristics.
 */
async function analyseSubmissionFile({ filePath, originalName, taskTitle, groupName }) {
  const engine = await aiEngine.analyzeFile({
    path: filePath,
    filename: originalName,
    taskTitle,
    groupName,
  });
  if (engine.ok && engine.data) {
    return { ...engine.data, engine: engine.data.engine || "ai-engine", analyzedAt: new Date() };
  }
  return analyseLocally(filePath, originalName);
}

module.exports = { analyseSubmissionFile, analyseLocally };
