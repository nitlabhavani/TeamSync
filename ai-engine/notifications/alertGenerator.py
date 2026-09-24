"""Builds the alert payloads the Node backend turns into emails/notifications."""
from __future__ import annotations

from utils.helpers import now

MESSAGES = {
    5: "Deadline in 5 days — plan the remaining work.",
    2: "Deadline in 2 days — finish and submit soon.",
    1: "Deadline tomorrow — submit your task.",
    0: "Deadline is today — submit immediately.",
}


def build_alerts(payload: dict, deadline_data: dict) -> list[dict]:
    alerts = []
    for item in deadline_data.get("remindersDue", []):
        if item.get("type") == "overdue":
            alerts.append(
                {
                    "severity": "high",
                    "channel": "email",
                    "taskId": item.get("id"),
                    "assignee": item.get("assignee"),
                    "title": f"Missed deadline: {item.get('title')}",
                    "message": f"This task is {item.get('daysLate')} day(s) overdue. Update the guide immediately.",
                }
            )
        else:
            stage = item.get("stage")
            alerts.append(
                {
                    "severity": "medium" if stage and stage > 1 else "high",
                    "channel": "email",
                    "taskId": item.get("id"),
                    "assignee": item.get("assignee"),
                    "stage": stage,
                    "title": f"Reminder: {item.get('title')}",
                    "message": MESSAGES.get(stage, "Upcoming deadline."),
                }
            )
    return alerts


# ---------------------------------------------------------------------------
# STEP 3H / 3I — evidence-based warning system with duplicate prevention.
#
# build_alerts() above is left untouched (it powers the existing
# /analyze/deadlines endpoint / email reminders). generate_warnings() is the
# Step 3 extension: broader warning types built from the full Step 3
# evidence (student work + chat), plus suppression of duplicate warnings
# already raised — either by this same AI engine on a previous run, or
# manually by the guide — unless there is new evidence.
# ---------------------------------------------------------------------------
WARNING_TYPES = {"TASK_AT_RISK", "TASK_OVERDUE", "LOW_PROGRESS", "BLOCKER_UNRESOLVED"}


def _same_issue(a: dict, b: dict) -> bool:
    return (
        str(a.get("studentId")) == str(b.get("studentId"))
        and str(a.get("taskId")) == str(b.get("taskId"))
        and a.get("type") == b.get("type")
    )


def _already_warned(candidate: dict, existing_alerts: list[dict], manual_warnings: list[dict]) -> dict | None:
    """Return the matching prior warning/manual-warning if one covers the
    same student+task+type with no materially new evidence, else None."""
    for prior in list(existing_alerts) + list(manual_warnings):
        if _same_issue(candidate, prior):
            return prior
    return None


def generate_warnings(
    group_id,
    student_work: list[dict],
    performance_predictions: list[dict],
    chat_analysis: dict,
    existing_alerts: list[dict] | None = None,
    manual_warnings: list[dict] | None = None,
) -> list[dict]:
    """
    STEP 3H — generate TASK_AT_RISK / TASK_OVERDUE / LOW_PROGRESS /
    BLOCKER_UNRESOLVED warnings from Step 3 evidence.

    STEP 3I — before emitting a warning, check `existing_alerts` (AI-raised
    warnings from a previous analysis run) and `manual_warnings` (guide-
    entered warnings, if the caller has them) for the same student+task+type.
    If one already exists, the new warning is suppressed and the prior
    warning's id is referenced instead — unless the evidence indicates the
    situation materially changed (currently: an overdue task getting later
    still, since that is the one signal Step 3 can measure objectively
    without guessing at intent).
    """
    existing_alerts = existing_alerts or []
    manual_warnings = manual_warnings or []
    warnings: list[dict] = []
    timestamp = now().isoformat()

    for work in student_work:
        student_id = work.get("studentId")
        if work.get("status") == "insufficient_data":
            continue

        for task in work.get("overdueWork", []):
            candidate = {
                "type": "TASK_OVERDUE",
                "groupId": group_id,
                "studentId": student_id,
                "taskId": task.get("id"),
                "severity": "high",
                "message": f"Task '{task.get('title')}' is {task.get('daysLate')} day(s) overdue.",
                "evidence": [f"Task status is not completed and due date has passed by {task.get('daysLate')} day(s)."],
                "generatedAt": timestamp,
                "status": "active",
            }
            prior = _already_warned(candidate, existing_alerts, manual_warnings)
            if prior and prior.get("daysLate", task.get("daysLate", 0)) >= task.get("daysLate", 0):
                candidate["status"] = "suppressed_duplicate"
                candidate["previousWarningRef"] = prior.get("id") or prior.get("_id")
            warnings.append(candidate)

        # TASK_AT_RISK: assigned task with little/no progress evidence and an
        # approaching deadline (STEP3H example 1 — task N days old, low
        # progress evidence, deadline approaching).
        has_supporting_evidence = any(e.get("source") in ("file", "chat") for e in work.get("evidence", []))
        for task in work.get("remainingWork", []):
            if not has_supporting_evidence:
                candidate = {
                    "type": "TASK_AT_RISK",
                    "groupId": group_id,
                    "studentId": student_id,
                    "taskId": task.get("id"),
                    "severity": "medium",
                    "message": f"Assigned task '{task.get('title')}' has no recorded progress evidence yet.",
                    "evidence": ["No file upload or group-chat progress update found for this task."],
                    "generatedAt": timestamp,
                    "status": "active",
                }
                prior = _already_warned(candidate, existing_alerts, manual_warnings)
                if prior:
                    candidate["status"] = "suppressed_duplicate"
                    candidate["previousWarningRef"] = prior.get("id") or prior.get("_id")
                warnings.append(candidate)

    for prediction, work in zip(performance_predictions, student_work):
        if prediction.get("status") in ("AT_RISK", "BEHIND") and work.get("status") != "insufficient_data":
            negative_count = sum(1 for e in work.get("evidence", []) if e.get("impact") == "negative")
            if negative_count >= 2:
                candidate = {
                    "type": "LOW_PROGRESS",
                    "groupId": group_id,
                    "studentId": work.get("studentId"),
                    "taskId": None,
                    "severity": "medium" if prediction["status"] == "AT_RISK" else "high",
                    "message": f"Repeated lack of progress evidence for {work.get('name') or work.get('studentId')}.",
                    "evidence": prediction.get("reasons", []),
                    "generatedAt": timestamp,
                    "status": "active",
                }
                prior = _already_warned(candidate, existing_alerts, manual_warnings)
                if prior:
                    candidate["status"] = "suppressed_duplicate"
                    candidate["previousWarningRef"] = prior.get("id") or prior.get("_id")
                warnings.append(candidate)

    for blocker in chat_analysis.get("blockers", []) if chat_analysis else []:
        if not blocker.get("resolved"):
            candidate = {
                "type": "BLOCKER_UNRESOLVED",
                "groupId": group_id,
                "studentId": blocker.get("sender"),
                "taskId": None,
                "severity": "medium",
                "message": "A task-related blocker mentioned in group chat appears unresolved.",
                "evidence": [f"Chat message: \"{blocker.get('text', '')[:120]}\""],
                "generatedAt": timestamp,
                "status": "active",
            }
            prior = _already_warned(candidate, existing_alerts, manual_warnings)
            if prior:
                candidate["status"] = "suppressed_duplicate"
                candidate["previousWarningRef"] = prior.get("id") or prior.get("_id")
            warnings.append(candidate)

    return warnings
