"""
Step 15 — AI Team Risk & Early Warning System (AI-engine analyzer).

This is an additive, engine-side equivalent of
backend/src/services/teamRiskAnalyzer.js's deterministic scoring formula —
same category caps, same thresholds — kept here so the Python AI engine has
a rule-based analyzer for this feature too (per Step 15 Feature 9), the way
deadlineAnalyzer.py / performanceAnalyzer.py already exist alongside their
Node counterparts.

The Node backend is the source of truth at runtime (it must keep working
even when this engine is offline, exactly like every other analyzer here),
so this module is not required for the platform to function — it exists
for engine-side parity, standalone testing, and potential future callers.

Input: an `evidence` dict with the SAME shape gatherGroupEvidence() builds
in Node (tasks/submissions/collaboration/originality/perStudent/history).
No raw file contents, chat text, or plagiarism source material — only
counts and short labels — ever appears in this payload (Feature 17).
"""
from __future__ import annotations

from utils.helpers import clamp, dedupe, now

WARNING_RECOMMENDATIONS = {
    "DEADLINE_RISK": "Review the overdue tasks and redistribute work if necessary.",
    "TASK_STALL": "Check in with the assignee(s) — these tasks haven't moved in over a week.",
    "LOW_PROGRESS": "Discuss blockers with the team; consider re-scoping tasks that are lagging.",
    "SUBMISSION_REVIEW_BACKLOG": "Review pending submissions before assigning additional work.",
    "REPEATED_CHANGES_REQUESTED": "Ask the student to fully address the guide feedback before resubmitting.",
    "REPEATED_REJECTION": "Meet with the student to clarify expectations before the next submission.",
    "LOW_COLLABORATION": "Check whether the team is blocked and encourage a written status update.",
    "TEAM_IDLE": "Check whether the team is blocked and discuss pending tasks in the group chat.",
    "DUPLICATE_SUBMISSION_RISK": "Manually review and compare the flagged submissions before making an academic-integrity decision.",
    "STUDENT_OVERLOAD": "Consider redistributing upcoming tasks from heavily loaded members.",
}


def _classify_team_level(score: float, has_data: bool) -> str:
    if not has_data:
        return "INSUFFICIENT_DATA"
    if score >= 75:
        return "CRITICAL"
    if score >= 50:
        return "HIGH"
    if score >= 25:
        return "MODERATE"
    return "LOW"


def _classify_student_level(score: float) -> str:
    if score >= 70:
        return "CRITICAL"
    if score >= 45:
        return "AT_RISK"
    if score >= 20:
        return "NEEDS_ATTENTION"
    return "ON_TRACK"


def _score_deadline(tasks: dict, reasons: list, positives: list) -> int:
    total = tasks.get("total", 0)
    completed = tasks.get("completed", 0)
    overdue = tasks.get("overdue", 0)
    due_soon = tasks.get("dueSoonNoProgress", 0)
    stalled = tasks.get("stalled", 0)
    ratio = tasks.get("completionRatio")

    pts = 0
    if overdue > 0:
        pts += min(21, overdue * 7)
        reasons.append(f"{overdue} task(s) are overdue")
    if due_soon > 0:
        pts += min(9, due_soon * 3)
        reasons.append(f"{due_soon} task(s) due within 2 days with no progress started")
    if total >= 3 and ratio is not None:
        if ratio < 0.3:
            pts += 10
            reasons.append(f"Only {round(ratio * 100)}% of tasks are completed")
        elif ratio < 0.5:
            pts += 5
            reasons.append(f"Task completion is at {round(ratio * 100)}%, below halfway")
    if stalled > 0:
        pts += min(12, stalled * 4)
        reasons.append(f"{stalled} task(s) have had no update in over a week")
    if overdue == 0 and stalled == 0 and total > 0 and (ratio or 0) >= 0.5:
        positives.append(f"{completed} of {total} tasks completed with no overdue work")
    return min(35, pts)


def _score_submissions(sub: dict, reasons: list, positives: list) -> int:
    awaiting = sub.get("awaitingReview", 0)
    changes = sub.get("changesRequestedTasks", 0)
    repeated = sub.get("repeatedChangesTasks", 0)
    rejected = sub.get("rejected", 0)
    invalid = sub.get("wrongProjectOrUnreadable", 0)

    pts = 0
    if awaiting > 1:
        pts += min(10, (awaiting - 1) * 2)
        reasons.append(f"{awaiting} submissions are awaiting guide review")
    elif awaiting == 1:
        reasons.append("1 submission is awaiting guide review")
    if changes > 0:
        pts += min(18, changes * 6)
        reasons.append(f"{changes} task(s) sent back for changes")
    if repeated > 0:
        pts += min(16, repeated * 8)
        reasons.append(f"{repeated} task(s) have been sent back for changes more than once")
    if rejected > 0:
        pts += min(20, rejected * 10)
        reasons.append(f"{rejected} submission(s) rejected by the guide")
    if invalid > 0:
        pts += min(16, invalid * 8)
        reasons.append(f"{invalid} submission(s) flagged as wrong-project or unreadable")
    if pts == 0 and (awaiting + changes + rejected) == 0:
        positives.append("No submissions are stuck in review, changes-requested, or rejected")
    return min(30, pts)


def _score_collaboration(collab: dict, reasons: list, positives: list) -> int:
    this_week = collab.get("messagesThisWeek", 0)
    last_week = collab.get("messagesLastWeek", 0)
    days_since = collab.get("daysSinceActivity")
    is_idle = days_since is not None and days_since >= 5

    pts = 0
    if is_idle:
        pts = 12
        reasons.append(f"No group activity for {int(days_since)} days")
    elif last_week > 0:
        drop = (last_week - this_week) / last_week
        if drop >= 0.3:
            pts = 8
            reasons.append(f"Collaboration activity decreased {round(drop * 100)}% compared with last week")
        elif drop >= 0.1:
            pts = 4
            reasons.append(f"Collaboration activity decreased {round(drop * 100)}% compared with last week")
    if pts == 0 and not is_idle:
        positives.append("Team collaboration activity is steady or increasing")
    return min(15, pts)


def _score_originality(orig: dict, reasons: list) -> int:
    dup = orig.get("duplicateCount", 0)
    high = orig.get("highSeverityCount", 0)
    poss = orig.get("possibleSeverityCount", 0)
    if dup > 0:
        reasons.append(f"{dup} submission(s) flagged as a likely duplicate — requires guide review")
        return 10
    if high > 0:
        reasons.append(f"{high} submission(s) show high similarity to another submission")
        return min(10, high * 6)
    if poss > 0:
        reasons.append(f"{poss} submission(s) show possible similarity worth a look")
        return min(6, poss * 3)
    return 0


def _determine_trend(current_score: float, history: list) -> dict:
    if not history:
        return {"trend": "INSUFFICIENT_DATA", "previousScore": None, "message": "Insufficient historical data to determine a trend."}
    previous = history[0].get("score")
    delta = current_score - previous
    if abs(delta) <= 5:
        return {"trend": "STABLE", "previousScore": previous, "message": "Team risk has remained stable."}
    if delta < 0:
        return {"trend": "IMPROVING", "previousScore": previous, "message": f"Team risk decreased from {previous} to {current_score} this week."}
    return {"trend": "WORSENING", "previousScore": previous, "message": f"Team risk increased from {previous} to {current_score} this week."}


def analyze_team_risk(evidence: dict) -> dict:
    tasks = evidence.get("tasks", {})
    collab = evidence.get("collaboration", {})
    has_data = tasks.get("total", 0) > 0 or collab.get("messagesThisWeek", 0) > 0
    generated_at = evidence.get("generatedAt") or now().isoformat()

    if not has_data:
        return {
            "riskScore": 0,
            "riskLevel": "INSUFFICIENT_DATA",
            "confidence": "low",
            "reasons": ["No tasks or activity have been recorded for this group yet."],
            "criticalRisks": [],
            "warnings": [],
            "positiveSignals": [],
            "recommendations": ["Create and assign tasks to start tracking team risk."],
            "affectedStudents": [],
            "riskTrend": "INSUFFICIENT_DATA",
            "trendMessage": "Insufficient historical data to determine a trend.",
            "generatedAt": generated_at,
        }

    reasons: list = []
    positives: list = []
    a = _score_deadline(tasks, reasons, positives)
    b = _score_submissions(evidence.get("submissions", {}), reasons, positives)
    c = _score_collaboration(collab, reasons, positives)
    d = _score_originality(evidence.get("originality", {}), reasons)

    score = clamp(a + b + c + d)
    level = _classify_team_level(score, has_data)
    warnings = build_warnings(evidence)
    recommendations = dedupe([w["recommendation"] for w in warnings if w.get("recommendation")]) or [
        "Team is healthy — keep the current cadence."
    ]
    critical = [w["title"] for w in warnings if w["severity"] == "CRITICAL"]
    trend = _determine_trend(score, evidence.get("history", []))

    volume = tasks.get("total", 0) + collab.get("messagesThisWeek", 0) + collab.get("messagesLastWeek", 0)
    confidence = "high" if volume >= 15 else "medium" if volume >= 5 else "low"

    return {
        "riskScore": score,
        "riskLevel": level,
        "confidence": confidence,
        "reasons": dedupe(reasons),
        "criticalRisks": critical,
        "warnings": warnings,
        "positiveSignals": positives,
        "recommendations": recommendations,
        "affectedStudents": [],
        "riskTrend": trend["trend"],
        "previousScore": trend["previousScore"],
        "trendMessage": trend["message"],
        "generatedAt": generated_at,
    }


def build_warnings(evidence: dict) -> list:
    warnings = []

    def add(w_type, severity, title, description, ev):
        warnings.append(
            {
                "type": w_type,
                "severity": severity,
                "title": title,
                "description": description,
                "evidence": ev,
                "recommendation": WARNING_RECOMMENDATIONS.get(w_type, ""),
            }
        )

    tasks = evidence.get("tasks", {})
    overdue = tasks.get("overdue", 0)
    stalled = tasks.get("stalled", 0)
    ratio = tasks.get("completionRatio")
    total = tasks.get("total", 0)
    due_soon = tasks.get("dueSoonNoProgress", 0)

    if overdue > 0:
        sev = "CRITICAL" if overdue >= 4 else "HIGH" if overdue >= 2 else "MEDIUM"
        add("DEADLINE_RISK", sev, "Overdue tasks", f"{overdue} task(s) are past their due date.", [f"{overdue} overdue task(s)"])
    if stalled > 0:
        sev = "HIGH" if stalled >= 3 else "MEDIUM"
        add("TASK_STALL", sev, "Stalled tasks", f"{stalled} task(s) have not been updated in over a week.", [f"{stalled} stalled task(s)"])
    if total >= 3 and ratio is not None and ratio < 0.3:
        add("LOW_PROGRESS", "HIGH", "Low overall progress", f"Only {round(ratio * 100)}% of tasks are completed.", [f"{round(ratio * 100)}% completion across {total} tasks"])
    if due_soon > 0:
        add("DEADLINE_RISK", "MEDIUM", "Tasks due soon with no progress", f"{due_soon} task(s) due within 2 days haven't been started.", [f"{due_soon} task(s) due soon, not started"])

    sub = evidence.get("submissions", {})
    awaiting = sub.get("awaitingReview", 0)
    changes = sub.get("changesRequestedTasks", 0)
    repeated = sub.get("repeatedChangesTasks", 0)
    rejected = sub.get("rejected", 0)
    invalid = sub.get("wrongProjectOrUnreadable", 0)

    if awaiting > 2:
        add("SUBMISSION_REVIEW_BACKLOG", "HIGH" if awaiting >= 5 else "MEDIUM", "Submission review backlog", f"{awaiting} submissions are waiting for guide review.", [f"{awaiting} submission(s) awaiting review"])
    if repeated > 0:
        add("REPEATED_CHANGES_REQUESTED", "HIGH", "Repeated changes requested", f"{repeated} task(s) have been sent back for changes more than once.", [f"{repeated} task(s) with 2+ change requests"])
    if rejected > 0:
        add("REPEATED_REJECTION", "HIGH" if rejected >= 2 else "MEDIUM", "Rejected submissions", f"{rejected} submission(s) were rejected by the guide.", [f"{rejected} rejected submission(s)"])
    if invalid > 0:
        add("SUBMISSION_REVIEW_BACKLOG", "MEDIUM", "Invalid submissions detected", f"{invalid} submission(s) flagged as wrong-project or unreadable.", [f"{invalid} invalid submission(s)"])

    collab = evidence.get("collaboration", {})
    this_week = collab.get("messagesThisWeek", 0)
    last_week = collab.get("messagesLastWeek", 0)
    days_since = collab.get("daysSinceActivity")

    if days_since is not None and days_since >= 5:
        add("TEAM_IDLE", "CRITICAL" if days_since >= 10 else "HIGH", "Team is idle", f"No group activity for {int(days_since)} days.", [f"{int(days_since)} day(s) since last activity"])
    elif last_week > 0 and (last_week - this_week) / last_week >= 0.3:
        drop = round(((last_week - this_week) / last_week) * 100)
        add("LOW_COLLABORATION", "HIGH" if drop >= 60 else "MEDIUM", "Collaboration activity decreased", f"Team activity decreased {drop}% compared with last week.", [f"{this_week} messages this week vs {last_week} last week"])

    orig = evidence.get("originality", {})
    dup, high, poss = orig.get("duplicateCount", 0), orig.get("highSeverityCount", 0), orig.get("possibleSeverityCount", 0)
    if dup + high + poss > 0:
        sev = "HIGH" if dup > 0 else "MEDIUM" if high > 0 else "LOW"
        add("DUPLICATE_SUBMISSION_RISK", sev, "Originality check flagged submissions", "One or more submissions show similarity to another and need manual review — not proof of misconduct.", [f"{dup} duplicate, {high} high, {poss} possible"])

    per_student = evidence.get("perStudent", {}) or {}
    if len(per_student) >= 2:
        open_counts = [max(0, s.get("assigned", 0) - s.get("completed", 0)) for s in per_student.values()]
        avg_open = sum(open_counts) / len(open_counts) if open_counts else 0
        overloaded = [s for s in per_student.values() if max(0, s.get("assigned", 0) - s.get("completed", 0)) >= max(3, avg_open * 2)]
        if avg_open > 0 and overloaded:
            add("STUDENT_OVERLOAD", "MEDIUM", "Uneven workload distribution", f"{len(overloaded)} member(s) have significantly more open tasks than the team average.", [f"Average open tasks per member: {round(avg_open, 1)}"])

    return warnings


def analyze_student_risk(evidence: dict, student_id: str) -> dict:
    s = (evidence.get("perStudent") or {}).get(student_id)
    if not s or s.get("assigned", 0) == 0:
        return {
            "studentId": student_id,
            "riskScore": 0,
            "riskLevel": "ON_TRACK",
            "reasons": ["No tasks are currently assigned."],
            "overdueTasks": 0,
            "pendingSubmissions": 0,
            "changesRequested": 0,
            "recommendations": [],
        }

    score = 0
    reasons = []
    overdue = s.get("overdue", 0)
    changes = s.get("changesRequested", 0)
    rejected = s.get("rejected", 0)
    stalled = s.get("stalled", 0)
    pending = s.get("pendingSubmissionReview", 0)

    if overdue > 0:
        score += min(60, overdue * 20)
        reasons.append(f"{overdue} overdue task(s)")
    if changes > 0:
        score += min(30, changes * 15)
        reasons.append(f"{changes} submission(s) sent back for changes")
    if rejected > 0:
        score += min(50, rejected * 25)
        reasons.append(f"{rejected} submission(s) rejected")
    if stalled > 0:
        score += min(20, stalled * 10)
        reasons.append(f"{stalled} task(s) have not been updated in over a week")
    if pending > 0:
        reasons.append(f"{pending} submission(s) are awaiting guide review")

    score = clamp(score)
    level = _classify_student_level(score)
    recs = []
    if overdue > 0:
        recs.append("Prioritize completing the overdue task(s) before starting new work.")
    if changes > 0:
        recs.append("Address the guide's feedback fully before resubmitting.")
    if rejected > 0:
        recs.append("Discuss the rejected submission with the guide to realign on requirements.")
    if not reasons:
        reasons.append("Assigned tasks are progressing normally.")

    return {
        "studentId": student_id,
        "riskScore": score,
        "riskLevel": level,
        "reasons": reasons,
        "overdueTasks": overdue,
        "pendingSubmissions": pending,
        "changesRequested": changes,
        "recommendations": recs,
    }
