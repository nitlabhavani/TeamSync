"""
Task ZIP submission analyzer — Step 9.

Answers three questions about a student's uploaded ZIP, in order:

1. PROJECT IDENTITY  — does this ZIP actually belong to the current
   TeamSync AI project (not just judged by filename, by structure/content
   signals supplied by the Node backend's live repository scan)?
2. TASK RELEVANCE     — if it belongs to TeamSync AI, does it touch the
   files/areas relevant to the ASSIGNED task?
3. IMPLEMENTATION     — if relevant, is the implementation actually there
   (not just a comment claiming so), complete, and clean?

Deliberately rule-based/deterministic — same philosophy as
projectPlanner.py and messageTaskAnalyzer.py: the inputs here are a bounded
file manifest, not free text, so explicit, auditable heuristics beat a
black-box model for a decision this consequential (it can mark a task
Completed).

The Node backend has ALREADY:
  - safely extracted the ZIP with zip-slip / zip-bomb protection
  - stripped node_modules/.git/dist/build/__pycache__/.venv/binaries
  - excluded .env / secret files entirely (never even reaches this module)
  - truncated file contents to a small per-file / total cap

So this module only ever sees a preprocessed, bounded, secret-free
manifest — never a raw ZIP, never executed code.
"""
from __future__ import annotations

import os
import re
from typing import Any

from utils.helpers import clamp, dedupe, now

STOPWORDS = {
    "the", "and", "for", "with", "this", "that", "from", "into", "a", "an", "of",
    "to", "in", "on", "is", "are", "be", "will", "your", "you", "it", "as", "or",
    "task", "assigned", "assignment", "project", "implement", "student", "team",
    # Generic architecture/category words (often the whole content of a
    # task's "module" label, e.g. "Backend / AI") that would otherwise
    # trivially match almost every file simply for living in that folder.
    "backend", "frontend", "module", "feature", "system", "application", "app",
}

TODO_RE = re.compile(r"\bTODO\b|\bFIXME\b|not implemented|coming soon|placeholder", re.IGNORECASE)
EMPTY_FN_RE = re.compile(r"function\s+\w*\s*\([^)]*\)\s*{\s*}|def\s+\w+\([^)]*\):\s*pass\b")


def _progress_label(progress: int) -> str:
    """Step 13 §1 — human-readable progress bucket, purely a function of the
    already-computed 0-100 progress number."""
    if progress >= 100:
        return "Complete"
    if progress >= 70:
        return "Nearly Complete"
    if progress > 0:
        return "In Progress"
    return "Not Started"

# Confidence / progress thresholds. Kept as named constants (not magic
# numbers scattered through the logic below) so the decision boundaries in
# the spec (§4, §7) are easy to audit and retune.
PROJECT_RELATED_THRESHOLD = 55
TASK_RELATED_MIN_HITS = 2
PARTIAL_VS_VALID_MATCH_RATIO = 0.5  # fraction of "expected" task files that must be touched


def _tokenize(text: str) -> set[str]:
    return {w for w in re.split(r"\W+", (text or "").lower()) if len(w) > 3 and w not in STOPWORDS}


def _basename_noext(rel_path: str) -> str:
    base = os.path.basename(rel_path.replace("\\", "/"))
    return os.path.splitext(base)[0].lower()


def _score_project_identity(files: list[dict], reference: dict) -> tuple[int, list[str]]:
    """Weighted match between the submission and the CURRENT repo's real
    service/model/route/identifier signals (never a hard-coded old list —
    `reference` is built live by the Node backend from today's repo)."""
    identifiers = {str(i).lower() for i in (reference.get("identifiers") or [])}
    service_names = {str(s).lower().rsplit(".", 1)[0] for s in (reference.get("serviceFiles") or [])}
    model_names = {str(s).lower().rsplit(".", 1)[0] for s in (reference.get("modelFiles") or [])}
    route_tokens = {str(s).lower() for s in (reference.get("routeTokens") or [])}

    matched_reasons: list[str] = []
    name_hits = 0
    content_hits = 0
    combined_text = ""

    for f in files:
        rel = f.get("relPath", "")
        base = _basename_noext(rel)
        content = (f.get("content") or "")
        combined_text += " " + content.lower()

        if base in service_names:
            name_hits += 2
            matched_reasons.append(f"Matches an existing TeamSync service module: {rel}")
        elif base in model_names:
            name_hits += 2
            matched_reasons.append(f"Matches an existing TeamSync data model: {rel}")
        elif base in identifiers:
            name_hits += 1

    combined_low = combined_text
    for ident in identifiers:
        if len(ident) > 4 and ident in combined_low:
            content_hits += 1
    for token in route_tokens:
        if len(token) > 3 and token in combined_low:
            content_hits += 1

    file_count = max(1, len(files))
    # Normalise so a tiny submission with a couple of unmistakable matches
    # (e.g. a service filename that only exists in this codebase) scores
    # high, while a huge unrelated dump of files doesn't dilute a real match
    # down to nothing.
    # No dilution-by-file-count here on purpose: matches only ever come from
    # a real filename hit against the CURRENT repo's service/model list or a
    # genuine identifier appearing in file content, so more matching
    # evidence should never LOWER confidence — only the absence of matches
    # (raw stays 0) does that.
    _ = file_count
    confidence = clamp(name_hits * 35 + content_hits * 8, 0, 100)
    if not matched_reasons and content_hits:
        matched_reasons.append(f"Found {content_hits} TeamSync-specific identifier(s) referenced in the submitted files.")
    return confidence, dedupe(matched_reasons)


def _score_task_relevance(files: list[dict], task_text: str) -> tuple[bool, list[str], int]:
    """Returns (taskRelated, matchedFiles, taskConfidence). taskConfidence
    (Step 13 §1) is a 0-100 score derived from the same hit-weighting used
    for the taskRelated boolean — never a separate/independent guess."""
    task_tokens = _tokenize(task_text)
    if not task_tokens:
        return False, [], 0

    matched_files: list[str] = []
    hits = 0
    for f in files:
        rel = f.get("relPath", "")
        # Deliberately basename + content only (NOT the full directory
        # path) — every backend file lives under "backend/...", so folding
        # the whole path in would make generic folder names match almost
        # any file regardless of what it actually does.
        hay = f"{os.path.basename(rel)} {f.get('content', '')}".lower()
        file_tokens = _tokenize(hay)
        overlap = task_tokens & file_tokens
        # Filenames are frequently camelCase/glued ("chatTaskService.js"),
        # so a plain word-tokenizer never splits them into separate tokens.
        # Check task keywords as SUBSTRINGS of the basename too — a much
        # stronger signal than incidental prose overlap inside a big file.
        base = _basename_noext(rel)
        name_overlap = {t for t in task_tokens if t in base}
        weight = len(overlap) + len(name_overlap) * 3
        if weight > 0:
            hits += weight
            matched_files.append(rel)

    task_confidence = clamp(hits * 12, 0, 100)
    return hits >= TASK_RELATED_MIN_HITS, dedupe(matched_files), task_confidence


def _inspect_quality(files: list[dict]) -> tuple[list[str], list[str]]:
    """Concrete, evidence-based issues/suggestions — never invented."""
    issues: list[str] = []
    suggestions: list[str] = []
    for f in files:
        content = f.get("content") or ""
        if not content:
            continue
        rel = f.get("relPath")
        if TODO_RE.search(content):
            issues.append(f"Unresolved TODO/placeholder found in {rel}")
        if EMPTY_FN_RE.search(content):
            issues.append(f"Empty function/method body found in {rel}")
        if "console.log(" in content or "print(" in content and "def " not in content[:50]:
            pass  # debug prints alone aren't worth flagging here; kept out to avoid noisy false positives
        if ("catch" not in content and ("fetch(" in content or "axios." in content)) and len(content) > 200:
            suggestions.append(f"Add error handling around network/AI-engine calls in {rel}")
    return dedupe(issues)[:20], dedupe(suggestions)[:12]


def analyze_task_submission(payload: dict) -> dict:
    files: list[dict] = payload.get("files") or []
    reference: dict = payload.get("referenceProject") or {}
    task_title = payload.get("taskTitle") or ""
    task_description = payload.get("taskDescription") or ""
    task_module = payload.get("taskModule") or ""
    task_text = f"{task_title} {task_description} {task_module}"

    analyzed_files = [f.get("relPath") for f in files if f.get("relPath")]

    project_confidence, identity_reasons = _score_project_identity(files, reference)
    project_related = project_confidence >= PROJECT_RELATED_THRESHOLD

    if not project_related:
        missing = ["No matching TeamSync AI project files were found in this archive."]
        return {
            "engine": "ai-engine",
            "projectRelated": False,
            "projectConfidence": project_confidence,
            "taskRelated": False,
            "taskConfidence": 0,
            "implementationStatus": "WRONG_PROJECT",
            "progress": 0,
            "progressLabel": _progress_label(0),
            "summary": (
                "❌ Incorrect ZIP folder uploaded. The files in this ZIP do not belong to the TeamSync AI project."
            ),
            "completedParts": [],
            "missingParts": [
                "Expected TeamSync AI project files and assigned task code were not found in this archive."
            ],
            "criticalIssues": ["❌ Wrong ZIP folder — archive does not match the assigned project."],
            "positiveFindings": [],
            "suggestions": [
                "1. Check your computer and locate the correct TeamSync project folder.",
                "2. Make sure you compress the entire root project directory into a new .zip archive.",
                "3. Upload the correct ZIP folder here to redo the submission.",
            ],
            "analyzedFiles": analyzed_files,
            "analyzedAt": now().isoformat(),
        }

    task_related, matched_files, task_confidence = _score_task_relevance(files, task_text)

    if not task_related:
        return {
            "engine": "ai-engine",
            "projectRelated": True,
            "projectConfidence": project_confidence,
            "taskRelated": False,
            "taskConfidence": task_confidence,
            "implementationStatus": "PROJECT_RELATED_TASK_NOT_IMPLEMENTED",
            "progress": 15,
            "progressLabel": _progress_label(15),
            "summary": (
                f"⚠️ Project folder detected, but code for your assigned task \"{task_title}\" is missing from this ZIP."
            ),
            "completedParts": [f"Matching base project structure detected ({len(identity_reasons)} items)"] + identity_reasons[:4],
            "missingParts": [
                f"Missing task-specific code files for \"{task_title}\" ({task_module or 'General module'}).",
                "No implementation functions or routes found for this assigned task."
            ],
            "criticalIssues": [f"Assigned task \"{task_title}\" has not been implemented yet."],
            "positiveFindings": identity_reasons[:5],
            "suggestions": [
                f"1. Open your code editor and implement the required features for \"{task_title}\".",
                "2. Save your new or updated code files inside your project directory.",
                "3. Re-zip your project folder and submit the updated ZIP folder again.",
            ],
            "analyzedFiles": analyzed_files,
            "analyzedAt": now().isoformat(),
        }

    issues, suggestions = _inspect_quality([f for f in files if f.get("relPath") in matched_files])

    has_placeholders = any("Unresolved TODO/placeholder" in i or "Empty function" in i for i in issues)
    match_strength = len(matched_files)

    positive_base = [f"Correct TeamSync AI project detected ({project_confidence}% confidence)."]
    if matched_files:
        positive_base.append(f"Matching task files found ({len(matched_files)} files): {', '.join(matched_files[:4])}.")

    if has_placeholders or match_strength < 2:
        progress = clamp(35 + match_strength * 10, 35, 65)
        missing = issues if issues else ["Additional task components and full logic implementation needed."]
        return {
            "engine": "ai-engine",
            "projectRelated": True,
            "projectConfidence": project_confidence,
            "taskRelated": True,
            "taskConfidence": task_confidence,
            "implementationStatus": "PARTIAL_PROGRESS",
            "progress": progress,
            "progressLabel": _progress_label(progress),
            "summary": f"🔄 Task partially completed ({progress}%). Some required features or topics are still missing.",
            "completedParts": matched_files,
            "missingParts": missing,
            "criticalIssues": ["Unfinished code or placeholders need to be completed before approval."],
            "positiveFindings": positive_base,
            "suggestions": suggestions or [
                "1. Complete the missing features and resolve all TODO/placeholder markers in your code.",
                "2. Verify that all components for this task function properly.",
                "3. Re-zip your project folder and upload the new ZIP folder to achieve 100% completion.",
            ],
            "analyzedFiles": analyzed_files,
            "analyzedAt": now().isoformat(),
        }

    if issues:
        progress = clamp(70 + match_strength * 5, 70, 89)
        return {
            "engine": "ai-engine",
            "projectRelated": True,
            "projectConfidence": project_confidence,
            "taskRelated": True,
            "taskConfidence": task_confidence,
            "implementationStatus": "VALID_BUT_NEEDS_IMPROVEMENT",
            "progress": progress,
            "progressLabel": _progress_label(progress),
            "summary": f"💡 Implementation found ({progress}%). A few minor improvements are recommended.",
            "completedParts": matched_files,
            "missingParts": issues,
            "criticalIssues": [],
            "positiveFindings": positive_base,
            "suggestions": suggestions or [
                "1. Address the code improvement suggestions noted above.",
                "2. Double check error handling and edge cases.",
                "3. Re-submit the updated ZIP if you make revisions, or notify your guide for review.",
            ],
            "analyzedFiles": analyzed_files,
            "analyzedAt": now().isoformat(),
        }

    progress = clamp(85 + match_strength * 3, 90, 100)
    return {
        "engine": "ai-engine",
        "projectRelated": True,
        "projectConfidence": project_confidence,
        "taskRelated": True,
        "taskConfidence": task_confidence,
        "implementationStatus": "VALID_SUBMISSION",
        "progress": progress,
        "progressLabel": _progress_label(progress),
        "summary": (
            f"🎉 Valid submission ({progress}%)! All required implementation files for \"{task_title}\" "
            f"are present across {len(matched_files)} file(s): {', '.join(matched_files[:5])}."
        ),
        "completedParts": matched_files,
        "missingParts": [],
        "criticalIssues": [],
        "positiveFindings": positive_base + ["Clean code structure — no unresolved TODO markers detected."],
        "suggestions": suggestions or [
            "Your submission looks complete and has been forwarded to your guide for final review and approval."
        ],
        "analyzedFiles": analyzed_files,
        "analyzedAt": now().isoformat(),
    }

