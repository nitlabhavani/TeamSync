const path = require("path");
const fs = require("fs");
const AdmZip = require("adm-zip");

const projectRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(projectRoot, "..");
const outZipPath = path.resolve(repoRoot, "..", "teamsync-ai-calendar-task-relevance-final.zip");

console.log("Packaging clean source release...");
console.log("Source directory:", repoRoot);
console.log("Output destination:", outZipPath);

const zip = new AdmZip();

const EXCLUDE_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  ".next",
  "build",
  "coverage",
  "__pycache__",
  ".pytest_cache",
  ".venv",
  "venv",
  ".cache",
]);

const EXCLUDE_FILES = new Set([
  ".env",
  ".env.local",
  ".DS_Store",
  "thumbs.db",
]);

function addDirectoryRecursively(currentPath, zipBasePath) {
  const entries = fs.readdirSync(currentPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(currentPath, entry.name);
    const relZipPath = zipBasePath ? `${zipBasePath}/${entry.name}` : entry.name;

    if (entry.isDirectory()) {
      if (EXCLUDE_DIRS.has(entry.name.toLowerCase())) {
        continue;
      }
      addDirectoryRecursively(fullPath, relZipPath);
    } else if (entry.isFile()) {
      if (EXCLUDE_FILES.has(entry.name.toLowerCase()) || entry.name.endsWith(".log") || entry.name.endsWith(".tmp")) {
        continue;
      }
      zip.addLocalFile(fullPath, zipBasePath);
    }
  }
}

// Add teamsync-ai-private-voice-recording-final project files
const folderName = path.basename(repoRoot);
addDirectoryRecursively(repoRoot, folderName);

zip.writeZip(outZipPath);
const stat = fs.statSync(outZipPath);
console.log(`Successfully created clean source archive: ${outZipPath}`);
console.log(`Archive size: ${(stat.size / 1024 / 1024).toFixed(2)} MB`);
