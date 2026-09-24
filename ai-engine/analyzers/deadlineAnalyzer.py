"""
Deadline analyzer.

Decides which reminders are due (5, 2, 1 and 0 days before the deadline),
flags missed deadlines and predicts overall project completion.
"""
from __future__ import annotations

from config.settings import settings
from utils.helpers import clamp, days_between, dedupe, make_evidence, now, parse_date

DONE = {"done", "completed"}


def _reminder_stage(days_left: float):
    for threshold in settings.reminder_days:
        if threshold <= days_left < threshold + 1:
            return threshold
    return None


def analyze_deadlines(payload: dict) -> dict:
    tasks = payload.get("tasks", [])
    current = now()
    upcoming, missed, reminders = [], [], []

    for task in tasks:
        due = parse_date(task.get("due"))
        if not due:
            continue
        status = str(task.get("status") or "todo")
        left = days_between(due, current)
        row = {
            "id": task.get("id"),
            "title": task.get("title"),
            "assignee": task.get("assignee"),
            "due": task.get("due"),
            "daysLeft": round(left, 2),
            "status": status,
        }
        if status in DONE:
            continue
        if left < 0:
            row["daysLate"] = abs(round(left, 2))
            missed.append(row)
            reminders.append({**row, "type": "overdue", "stage": "missed"})
        else:
            upcoming.append(row)
            stage = _reminder_stage(left)
            if stage is not None:
                reminders.append({**row, "type": "reminder", "stage": stage})

    total = len(tasks) or 1
    completed = sum(1 for t in tasks if str(t.get("status")) in DONE)
    progress = completed / total * 100

    project_due = parse_date(payload.get("expectedCompletion"))
    elapsed_ratio = None
    prediction = {"onTrack": True, "risk": "low", "predictedCompletion": None, "confidence": 60}
    if project_due:
        start = parse_date(payload.get("startDate")) or current
        total_days = max(1.0, days_between(project_due, start))
        elapsed = max(0.0, days_between(current, start))
        elapsed_ratio = min(1.0, elapsed / total_days)
        expected = elapsed_ratio * 100
        delta = progress - expected
        rate = progress / max(elapsed, 0.5)
        remaining_days = (100 - progress) / rate if rate > 0 else None
        prediction = {
            "onTrack": delta >= -10,
            "risk": "low" if delta >= -5 else "medium" if delta >= -20 else "high",
            "expectedProgress": clamp(expected),
            "actualProgress": clamp(progress),
            "predictedDaysRemaining": round(remaining_days, 1) if remaining_days else None,
            "willMeetDeadline": bool(remaining_days is not None and remaining_days <= max(0.0, days_between(project_due, current))),
            "confidence": clamp(50 + min(40, completed * 5)),
        }

    return {
        "upcoming": sorted(upcoming, key=lambda r: r["daysLeft"]),
        "missed": missed,
        "remindersDue": reminders,
        "reminderSchedule": list(settings.reminder_days),
        "progress": clamp(progress),
        "timeElapsedRatio": round(elapsed_ratio, 2) if elapsed_ratio is not None else None,
        "prediction": prediction,
        "generatedAt": current.isoformat(),
    }


def predict_project_completion(payload: dict, deadline_data: dict | None = None) -> dict:
    """
    STEP 3F — project/team completion prediction, reshaped into the Step 3
    contract (ON_TRACK / AT_RISK / BEHIND / INSUFFICIENT_DATA + reasons +
    confidence). Reuses analyze_deadlines() rather than recomputing task
    progress a second time.
    """
    tasks = payload.get("tasks", [])
    data = deadline_data if deadline_data is not None else analyze_deadlines(payload)

    if not tasks:
        return {
            "status": "INSUFFICIENT_DATA",
            "completionPercentage": None,
            "reasons": ["No tasks are recorded for this project yet."],
            "evidence": [],
            "confidence": "low",
            "generatedAt": data.get("generatedAt", now().isoformat()),
        }

    total = len(tasks)
    completed = sum(1 for t in tasks if str(t.get("status")) in DONE)
    overdue = len(data.get("missed", []))
    upcoming_soon = [u for u in data.get("upcoming", []) if u.get("daysLeft", 999) <= 2]
    completion_pct = data.get("progress")
    prediction = data.get("prediction", {})

    evidence = [
        make_evidence("task", None, f"{completed} of {total} task(s) marked completed.", impact="positive" if completed else "neutral"),
    ]
    if overdue:
        evidence.append(make_evidence("task", None, f"{overdue} task(s) are past their deadline.", impact="negative"))
    if upcoming_soon:
        evidence.append(make_evidence("task", None, f"{len(upcoming_soon)} task(s) are due within 2 days.", impact="negative"))

    reasons = []
    has_deadline_model = bool(payload.get("expectedCompletion"))

    if not has_deadline_model:
        # No project deadline/start date to compare progress against — we can
        # still report raw completion percentage, but calling it ON_TRACK or
        # BEHIND would be inventing a timeline we don't have.
        status = "INSUFFICIENT_DATA"
        reasons.append("No project start/expected-completion date was provided, so schedule risk cannot be estimated.")
        if overdue:
            status = "BEHIND"
            reasons = [f"{overdue} task(s) are already overdue."]
        confidence = "low"
    else:
        risk = prediction.get("risk", "low")
        on_track = prediction.get("onTrack", True)
        if overdue and risk == "high":
            status = "BEHIND"
        elif risk == "high" or (overdue and not on_track):
            status = "AT_RISK"
        elif risk == "medium":
            status = "AT_RISK"
        elif on_track:
            status = "ON_TRACK"
        else:
            status = "AT_RISK"

        if overdue:
            reasons.append(f"{overdue} task(s) remain overdue.")
        if upcoming_soon:
            reasons.append(f"{len(upcoming_soon)} task(s) are due within 2 days.")
        expected = prediction.get("expectedProgress")
        actual = prediction.get("actualProgress")
        if expected is not None and actual is not None:
            reasons.append(f"Actual progress is {actual}% versus an expected {expected}% at this point in the timeline.")
        if not reasons:
            reasons.append("Task completion is tracking with the project timeline.")
        confidence = "medium" if completed >= 3 or total >= 5 else "low"

    return {
        "status": status,
        "completionPercentage": completion_pct,
        "reasons": dedupe(reasons),
        "evidence": evidence,
        "confidence": confidence,
        "predictedDaysRemaining": prediction.get("predictedDaysRemaining"),
        "generatedAt": data.get("generatedAt", now().isoformat()),
    }
