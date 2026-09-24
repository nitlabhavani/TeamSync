"""Task analyzer — completion, workload balance and bottlenecks."""
from __future__ import annotations

from collections import Counter, defaultdict

from utils.helpers import clamp, dedupe, now, parse_date

DONE = {"done", "completed"}


def analyze_tasks(payload: dict) -> dict:
    tasks = payload.get("tasks", [])
    members = {str(m.get("userId") or m.get("id")): m for m in payload.get("students", payload.get("members", []))}

    per_user = defaultdict(lambda: {"assigned": 0, "completed": 0, "overdue": 0, "onTime": 0})
    status_counts = Counter()
    overdue = []
    current = now()

    for task in tasks:
        status = str(task.get("status") or "todo")
        status_counts[status] += 1
        uid = str(task.get("assignee") or "")
        stats = per_user[uid]
        stats["assigned"] += 1
        due = parse_date(task.get("due"))
        completed_at = parse_date(task.get("completedAt"))
        if status in DONE:
            stats["completed"] += 1
            if not due or (completed_at and completed_at <= due):
                stats["onTime"] += 1
        elif due and due < current:
            stats["overdue"] += 1
            overdue.append(
                {
                    "id": task.get("id"),
                    "title": task.get("title"),
                    "due": task.get("due"),
                    "assignee": members.get(uid, {}).get("name", uid),
                    "daysLate": int((current - due).days),
                }
            )

    total = len(tasks) or 1
    completed = sum(1 for t in tasks if str(t.get("status")) in DONE)

    loads = [v["assigned"] for v in per_user.values()] or [0]
    imbalance = max(loads) - min(loads)
    insights = []
    if imbalance >= 3:
        insights.append("Workload is unbalanced — redistribute tasks across the team.")
    if overdue:
        insights.append(f"{len(overdue)} task(s) are past their deadline.")
    if status_counts.get("guide_review", 0) > 3:
        insights.append("Several submissions are waiting for guide review.")

    return {
        "totalTasks": len(tasks),
        "completedTasks": completed,
        "pendingTasks": len(tasks) - completed,
        "completionPercentage": clamp(completed / total * 100),
        "statusBreakdown": dict(status_counts),
        "overdueTasks": overdue,
        "workload": [
            {
                "userId": uid,
                "name": members.get(uid, {}).get("name", uid),
                **stats,
                "completionRate": clamp(stats["completed"] / (stats["assigned"] or 1) * 100),
                "workloadPercentage": clamp(stats["assigned"] / total * 100),
            }
            for uid, stats in per_user.items()
            if uid
        ],
        "insights": dedupe(insights),
        "generatedAt": now().isoformat(),
    }
