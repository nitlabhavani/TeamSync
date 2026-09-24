"""Collaboration analyzer — how well the team works together."""
from __future__ import annotations

from utils.helpers import clamp, dedupe, now
from analyzers.chatAnalyzer import analyze_chat
from analyzers.taskAnalyzer import analyze_tasks


def analyze_collaboration(payload: dict) -> dict:
    chat = analyze_chat(payload)
    tasks = analyze_tasks(payload)

    chat_scores = [p["communicationScore"] for p in chat["participants"]] or [0]
    balance = 100 - min(100, (max(chat_scores) - min(chat_scores)))
    meetings = payload.get("meetings", [])
    files = payload.get("files", [])
    contributors = len({str(f.get("uploadedBy")) for f in files if f.get("uploadedBy")})
    members = len(payload.get("members", [])) or 1

    collaboration_score = clamp(
        0.35 * tasks["completionPercentage"]
        + 0.25 * balance
        + 0.20 * min(100, len(meetings) * 20)
        + 0.20 * (contributors / members * 100)
    )

    insights = list(chat["insights"]) + list(tasks["insights"])
    if contributors < members:
        insights.append("Not every member has uploaded work yet.")
    if not meetings:
        insights.append("No meetings recorded — schedule a regular sync.")

    return {
        "collaborationScore": collaboration_score,
        "balanceScore": clamp(balance),
        "chat": chat,
        "tasks": tasks,
        "meetings": len(meetings),
        "fileContributors": contributors,
        "insights": dedupe(insights),
        "generatedAt": now().isoformat(),
    }
