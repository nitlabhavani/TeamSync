"""Rule-based recommendation engine for guides and students."""
from __future__ import annotations

from utils.helpers import dedupe


def build_recommendations(payload: dict, metrics: dict) -> list[str]:
    out: list[str] = []
    tasks = metrics.get("tasks", {}) or {}
    chat = metrics.get("chat", {}) or {}

    if metrics.get("collaborationScore", 100) < 50:
        out.append("Collaboration is weak — assign paired tasks and require daily group updates.")
    if tasks.get("overdueTasks"):
        out.append("Reassign or re-plan the overdue tasks; some deadlines have already passed.")
    if tasks.get("completionPercentage", 100) < 40:
        out.append("Project progress is behind schedule — break large tasks into smaller milestones.")
    for insight in list(chat.get("insights", [])) + list(tasks.get("insights", [])):
        out.append(insight)
    for student in metrics.get("students", []):
        if student.get("overallScore", 100) < 45:
            out.append(f"{student.get('name')} needs guidance — low participation and task completion.")
    if not out:
        out.append("The team is on track. Keep documenting progress and updating task statuses.")
    return dedupe(out)[:12]


# ---------------------------------------------------------------------------
# STEP 3K — Step 3 recommendations, built from evidence-based student work
# analysis, predictions and warnings rather than generic advice. Extends
# build_recommendations() above (still used by the existing
# /analyze/collaboration, /analyze/deadlines, /recommendations,
# /reports/generate endpoints) instead of replacing it.
# ---------------------------------------------------------------------------
def build_step3_recommendations(student_work: list[dict], warnings: list[dict], project_prediction: dict) -> list[str]:
    out: list[str] = []

    for work in student_work:
        name = work.get("name") or work.get("studentId")
        for task in work.get("overdueWork", []):
            if task.get("daysLate", 0) >= 5:
                out.append(f"Break down '{task.get('title')}' ({name}) into smaller tasks — it is significantly overdue.")
            else:
                out.append(f"Prioritize '{task.get('title')}' for {name} — the deadline has passed.")
        if work.get("remainingWork") and not work.get("inProgressWork") and not work.get("completedWork"):
            out.append(f"Ask {name} to update task status/progress — no activity is recorded yet.")

    for warning in warnings:
        if warning.get("status") != "active":
            continue
        if warning["type"] == "BLOCKER_UNRESOLVED":
            out.append("Resolve the unresolved blocker raised in group chat before it delays dependent tasks.")
        elif warning["type"] == "TASK_AT_RISK":
            out.append("Upload missing project evidence (files or a chat update) for the at-risk task.")
        elif warning["type"] == "LOW_PROGRESS":
            out.append("Coordinate with the team member showing low progress evidence in the next check-in.")

    if project_prediction.get("status") == "BEHIND":
        out.append("Re-plan the project schedule — the team is behind based on current task completion.")
    elif project_prediction.get("status") == "AT_RISK":
        out.append("Clarify task ownership and prioritize approaching deadlines to avoid falling further behind.")

    if not out:
        out.append("No urgent action items — evidence shows the team is keeping up with assigned work.")

    return dedupe(out)[:15]
