"""
File / project analyzer.

Inspects an uploaded submission (source file, document, ZIP archive or an
extracted project folder) and reports:

* missing files (README, documentation, screenshots, entry points)
* likely compilation issues
* folder structure quality
* coding mistakes and comment density
* duplicate files and empty folders
"""
from __future__ import annotations

import hashlib
import os
import zipfile

from utils.helpers import clamp, dedupe, now, parse_date

# Text-ish extensions this engine can actually read content from for the
# lightweight per-student evidence check below (STEP 3B). Kept separate
# from CODE_EXT/DOC_EXT (used by the structural analyze_file() checks)
# because "can we open it and look for keywords" is a narrower question
# than "does this look like source code".
READABLE_EXT = {".txt", ".md", ".json", ".csv", ".py", ".js", ".jsx", ".ts", ".tsx",
                 ".java", ".c", ".cpp", ".cs", ".go", ".rb", ".php", ".html", ".css", ".sql"}

CODE_EXT = {
    ".js", ".jsx", ".ts", ".tsx", ".py", ".java", ".c", ".cpp", ".cs", ".go",
    ".rb", ".php", ".rs", ".kt", ".swift", ".dart", ".sql", ".html", ".css",
}
DOC_EXT = {".md", ".pdf", ".doc", ".docx", ".txt", ".ppt", ".pptx", ".odt"}
IMG_EXT = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"}
EXPECTED_FOLDERS = {"src", "docs", "tests", "assets", "public", "backend", "frontend"}


def _ext(name: str) -> str:
    return os.path.splitext(name)[1].lower()


def _inspect_code(name: str, text: str) -> list[str]:
    issues: list[str] = []
    lines = text.splitlines()
    code_lines = [l for l in lines if l.strip()] or [""]
    comments = [l for l in lines if l.strip().startswith(("//", "#", "/*", "*"))]

    if len(code_lines) > 40 and len(comments) / len(code_lines) < 0.03:
        issues.append(f"Improve code comments in {name}")
    if text.count("{") and abs(text.count("{") - text.count("}")) > 2:
        issues.append(f"Possible compilation issue (unbalanced braces) in {name}")
    if abs(text.count("(") - text.count(")")) > 2:
        issues.append(f"Possible compilation issue (unbalanced parentheses) in {name}")
    if "TODO" in text or "FIXME" in text:
        issues.append(f"Unresolved TODO/FIXME in {name}")
    if "console.log(" in text or "System.out.println" in text:
        issues.append(f"Debug statements left in {name}")
    return issues


def _walk_zip(path: str):
    with zipfile.ZipFile(path) as zf:
        for info in zf.infolist():
            text = ""
            if not info.is_dir() and _ext(info.filename) in CODE_EXT and info.file_size < 400_000:
                try:
                    text = zf.read(info.filename).decode("utf-8", "ignore")
                except Exception:
                    text = ""
            yield info.filename.replace("\\", "/"), info.is_dir(), info.file_size, text


def _walk_folder(root: str):
    for dirpath, dirnames, filenames in os.walk(root):
        rel_dir = os.path.relpath(dirpath, root).replace("\\", "/")
        if rel_dir != ".":
            yield rel_dir + "/", True, 0, ""
        for fname in filenames:
            full = os.path.join(dirpath, fname)
            rel = os.path.relpath(full, root).replace("\\", "/")
            text = ""
            if _ext(fname) in CODE_EXT and os.path.getsize(full) < 400_000:
                try:
                    with open(full, "r", encoding="utf-8", errors="ignore") as fh:
                        text = fh.read()
                except OSError:
                    text = ""
            yield rel, False, os.path.getsize(full), text


def analyze_file(payload: dict) -> dict:
    path = payload.get("path") or ""
    filename = payload.get("filename") or os.path.basename(path)
    issues: list[str] = []
    recommendations: list[str] = []
    checks = {
        "hasReadme": False,
        "hasDocumentation": False,
        "hasScreenshots": False,
        "hasSourceCode": False,
        "hasTests": False,
        "emptyFolders": [],
        "duplicateFiles": [],
        "fileCount": 0,
        "folderCount": 0,
        "topLevelFolders": [],
    }

    if not path or not os.path.exists(path):
        return {
            "engine": "ai-engine",
            "score": None,
            "summary": f"File not reachable by the AI engine ({filename}).",
            "issues": ["The AI engine could not read the uploaded file path."],
            "recommendations": ["Ensure AI_ENGINE_UPLOAD_DIR points at the backend uploads folder."],
            "checks": checks,
            "analyzedAt": now().isoformat(),
        }

    if zipfile.is_zipfile(path):
        entries = _walk_zip(path)
    elif os.path.isdir(path):
        entries = _walk_folder(path)
    else:
        entries = iter([(filename, False, os.path.getsize(path), _read_single(path))])

    hashes: dict[str, str] = {}
    dirs: set[str] = set()
    dirs_with_children: set[str] = set()

    for name, is_dir, size, text in entries:
        if is_dir:
            dirs.add(name.rstrip("/"))
            checks["folderCount"] += 1
            continue
        checks["fileCount"] += 1
        base = os.path.basename(name).lower()
        ext = _ext(name)
        parent = "/".join(name.split("/")[:-1])
        if parent:
            dirs_with_children.add(parent)
        if "/" in name:
            top = name.split("/")[0]
            if top not in checks["topLevelFolders"]:
                checks["topLevelFolders"].append(top)

        if base.startswith("readme"):
            checks["hasReadme"] = True
        elif ext in DOC_EXT:
            checks["hasDocumentation"] = True
        if ext in IMG_EXT:
            checks["hasScreenshots"] = True
        if "test" in name.lower() or "spec" in base:
            checks["hasTests"] = True
        if ext in CODE_EXT:
            checks["hasSourceCode"] = True
            issues.extend(_inspect_code(name, text)[:2])
            digest = hashlib.md5((text or name).encode("utf-8", "ignore")).hexdigest()
            if digest in hashes and text:
                checks["duplicateFiles"].append(f"{hashes[digest]} == {name}")
            else:
                hashes[digest] = name

    for d in dirs:
        if not any(p == d or p.startswith(d + "/") for p in dirs_with_children):
            checks["emptyFolders"].append(d)

    if not checks["hasReadme"]:
        issues.append("Missing README file")
        recommendations.append("Add a README file with setup, usage and team details")
    if not checks["hasDocumentation"]:
        issues.append("Missing documentation")
        recommendations.append("Add project documentation (design/report document)")
    if checks["hasSourceCode"] and not checks["hasScreenshots"]:
        recommendations.append("Add screenshots of the working application")
    if checks["hasSourceCode"] and not checks["hasTests"]:
        recommendations.append("Add unit tests / testing evidence")
    if checks["emptyFolders"]:
        issues.append("Empty folders: " + ", ".join(checks["emptyFolders"][:5]))
        recommendations.append("Remove or populate empty folders")
    if checks["duplicateFiles"]:
        issues.append("Duplicate files: " + ", ".join(checks["duplicateFiles"][:5]))
        recommendations.append("Remove duplicated source files")
    if checks["fileCount"] > 5 and not (set(f.lower() for f in checks["topLevelFolders"]) & EXPECTED_FOLDERS):
        issues.append("Folder structure incomplete")
        recommendations.append("Improve folder structure (src / docs / tests / assets)")

    score = 100
    score -= 0 if checks["hasReadme"] else 12
    score -= 0 if checks["hasDocumentation"] else 10
    score -= 0 if (checks["hasScreenshots"] or not checks["hasSourceCode"]) else 6
    score -= min(20, len(checks["emptyFolders"]) * 4)
    score -= min(20, len(checks["duplicateFiles"]) * 5)
    score -= min(25, len(issues) * 4)

    return {
        "engine": "ai-engine",
        "score": clamp(score, 20, 100),
        "summary": (
            f"Reviewed {checks['fileCount']} file(s) across {checks['folderCount']} folder(s). "
            + (f"{len(issues)} issue(s) found." if issues else "No blocking issues found.")
        ),
        "issues": dedupe(issues)[:20],
        "recommendations": dedupe(recommendations)[:12],
        "checks": checks,
        "analyzedAt": now().isoformat(),
    }


def _read_single(path: str) -> str:
    if _ext(path) not in CODE_EXT:
        return ""
    try:
        with open(path, "r", encoding="utf-8", errors="ignore") as fh:
            return fh.read()
    except OSError:
        return ""


def _keyword_overlap(text_a: str, text_b: str) -> int:
    stop = {"the", "and", "for", "with", "this", "that", "from", "into", "a", "an", "of", "to", "in", "on"}
    words_a = {w for w in text_a.lower().split() if len(w) > 2 and w not in stop}
    words_b = {w for w in text_b.lower().split() if len(w) > 2 and w not in stop}
    return len(words_a & words_b)


def analyze_student_file(file_meta: dict, task: dict | None = None) -> dict:
    """
    STEP 3B — per-file evidence for one student's uploaded/shared project
    file. This is deliberately lighter than analyze_file() above (which
    inspects a whole submission/zip for project-structure quality); this
    function answers the narrower Step 3 questions: is this file relevant
    to the student's assigned task, and does it look like progress
    evidence — using only what the engine can actually access.

    file_meta: {filename/name, size, mimeType, uploadedAt/createdAt,
                uploadedBy, path (optional, for content read), taskId}
    task: the assigned task this file is being checked against, if any
          ({id, title, description}).
    """
    filename = file_meta.get("filename") or file_meta.get("name") or file_meta.get("originalName") or "unknown"
    ext = _ext(filename)
    size = file_meta.get("size")
    uploaded_at = file_meta.get("uploadedAt") or file_meta.get("createdAt") or file_meta.get("updatedAt")
    student_id = file_meta.get("uploadedBy") or file_meta.get("studentId")
    task_id = file_meta.get("taskId") or (task or {}).get("id")

    supported = ext in CODE_EXT or ext in DOC_EXT or ext in READABLE_EXT
    content_analysis = "unsupported"
    content_text = ""
    if supported:
        path = file_meta.get("path")
        if path and os.path.exists(path) and ext in READABLE_EXT:
            try:
                if os.path.getsize(path) < 400_000:
                    with open(path, "r", encoding="utf-8", errors="ignore") as fh:
                        content_text = fh.read()
                    content_analysis = "analyzed"
                else:
                    content_analysis = "too_large"
            except OSError:
                content_analysis = "unreadable"
        else:
            # We know the type is a supported family but have no readable
            # path (e.g. only metadata was sent) — say so rather than
            # pretending we inspected content we never had.
            content_analysis = "metadata_only"

    relevant_to_task = None
    relevance_reason = "No assigned task was provided to compare against."
    if task:
        task_text = f"{task.get('title', '')} {task.get('description', '')} {task.get('module', '')}"
        haystack = filename + " " + content_text[:2000]
        overlap = _keyword_overlap(task_text, haystack)
        relevant_to_task = overlap > 0
        relevance_reason = (
            f"Filename/content shares {overlap} keyword(s) with the assigned task."
            if overlap > 0
            else "No keyword overlap found between this file and the assigned task."
        )

    issues, missing_work, suggestions = [], [], []
    provides_progress_evidence = supported and (content_analysis in ("analyzed", "metadata_only"))

    if not supported:
        issues.append(f"File type '{ext or 'unknown'}' cannot be parsed by the AI engine.")
        suggestions.append("Upload the file in a supported text/code/document format if it should count as evidence.")
    if task and relevant_to_task is False:
        issues.append("This file does not appear related to the assigned task.")
        missing_work.append("A file demonstrating progress on the assigned task was not found.")
    if content_analysis == "analyzed" and ext in CODE_EXT | READABLE_EXT:
        if "TODO" in content_text or "FIXME" in content_text:
            issues.append("Unresolved TODO/FIXME found in the file.")
        if not content_text.strip():
            issues.append("File appears to be empty.")
            provides_progress_evidence = False

    return {
        "filename": filename,
        "fileType": ext or "unknown",
        "size": size,
        "uploadedAt": uploaded_at,
        "studentId": student_id,
        "taskId": task_id,
        "relevantToTask": relevant_to_task,
        "relevanceReason": relevance_reason,
        "providesProgressEvidence": provides_progress_evidence,
        "contentAnalysis": content_analysis,
        "issues": dedupe(issues),
        "missingWork": dedupe(missing_work),
        "suggestions": dedupe(suggestions),
        "analyzedAt": now().isoformat(),
    }
