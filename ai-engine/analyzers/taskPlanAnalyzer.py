"""
STEP 18 — AI Task Intelligence / Smart Planning (subtask-plan generation).

Deliberately REUSES analyzers/taskExpansionAnalyzer.py's domain detection
and templates instead of duplicating a second domain-keyword dataset (spec:
"Reuse existing services/functions wherever possible"). This module only
adds what taskExpansionAnalyzer.py does not already produce: a per-subtask
breakdown with difficulty/hours/order, and a testing checklist.

Same "swap point" pattern and same honesty rules as taskExpansionAnalyzer.py:
rule-based/deterministic, never invents specifics the title/description
didn't imply, and a subtask/hour/effort figure is always presented as an
estimate, never a commitment.
"""
from __future__ import annotations

from typing import Any

from analyzers.taskExpansionAnalyzer import (
    DOMAIN_TEMPLATES,
    GENERIC_SUBTASKS,
    GENERIC_CRITERIA,
    _clean_subject,
    _detect_domain,
    _estimate_difficulty_from_length,
)

MIN_SUBTASKS = 3
MAX_SUBTASKS = 7
GENERIC_EFFORT_BY_DIFFICULTY = {"LOW": (1, 2), "MEDIUM": (3, 5), "HIGH": (6, 10)}


def _difficulty_for_subtask(index: int, total: int, overall_difficulty: str) -> str:
    """
    First and last subtasks (setup, testing/wrap-up) are usually lighter
    than the core implementation work in the middle — a simple, honest
    heuristic, not a claim about this specific project's actual complexity.
    """
    is_edge = index == 0 or index == total - 1
    if overall_difficulty == "HIGH":
        return "MEDIUM" if is_edge else "HIGH"
    if overall_difficulty == "LOW":
        return "LOW"
    return "LOW" if is_edge else "MEDIUM"


def generate_task_plan(payload: dict[str, Any]) -> dict[str, Any]:
    """
    payload: { title: str, description?: str }
    Returns: { domain, subtasks: [{title, difficulty, estimatedHours,
    dependsOnIndex}], acceptanceCriteria[], testingChecklist[],
    estimatedDifficulty, estimatedTotalEffort }.

    `dependsOnIndex` is a simple, honestly-labeled default: each subtask
    depends on the one before it (a linear chain) — a reasonable starting
    order, not a claim about a real discovered dependency graph (this
    module has no visibility into that; cross-TASK dependencies, which the
    project genuinely tracks via Task.dependencies, are handled by the
    Node orchestration layer in taskPlanService.js, not here).
    """
    title = str(payload.get("title") or "").strip()
    description = str(payload.get("description") or "").strip()
    subject = _clean_subject(title)
    subject_lower = subject[0].lower() + subject[1:] if subject else subject

    match = _detect_domain(title, description)
    if match:
        domain, subtask_templates, criteria_templates, difficulty, effort_range = match
    else:
        domain = "general"
        subtask_templates = GENERIC_SUBTASKS
        criteria_templates = GENERIC_CRITERIA
        difficulty = _estimate_difficulty_from_length(title, description)
        effort_range = GENERIC_EFFORT_BY_DIFFICULTY[difficulty]

    fmt = lambda s: s.format(subject=subject, subject_lower=subject_lower)

    raw_titles = [fmt(s) for s in subtask_templates][:MAX_SUBTASKS]
    if len(raw_titles) < MIN_SUBTASKS:
        extras = [fmt(s) for s in GENERIC_SUBTASKS if fmt(s) not in raw_titles]
        raw_titles += extras[: MIN_SUBTASKS - len(raw_titles)]

    lo, hi = effort_range
    total_mid_hours = (lo + hi) / 2
    per_subtask_hours = max(1, round(total_mid_hours / max(1, len(raw_titles))))

    subtasks = []
    for i, subtask_title in enumerate(raw_titles):
        subtasks.append(
            {
                "title": subtask_title,
                "difficulty": _difficulty_for_subtask(i, len(raw_titles), difficulty),
                "estimatedHours": per_subtask_hours,
                "dependsOnIndex": (i - 1) if i > 0 else None,
            }
        )

    acceptance_criteria = [fmt(s) for s in criteria_templates]
    # Reuses the acceptance criteria content rather than maintaining a
    # second, parallel domain-keyword dataset just for testing items.
    testing_checklist = [f"Verify: {c[0].lower() + c[1:] if c else c}" for c in acceptance_criteria]

    return {
        "domain": domain,
        "subtasks": subtasks,
        "acceptanceCriteria": acceptance_criteria,
        "testingChecklist": testing_checklist,
        "estimatedDifficulty": difficulty,
        "estimatedTotalEffort": f"{lo}-{hi} hours (AI estimate)",
    }
