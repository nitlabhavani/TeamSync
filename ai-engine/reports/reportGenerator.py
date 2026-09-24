"""Weekly / monthly AI report generator."""
from __future__ import annotations

from analyzers.collaborationAnalyzer import analyze_collaboration
from analyzers.deadlineAnalyzer import analyze_deadlines
from analyzers.performanceAnalyzer import analyze_performance
from recommendations.recommendationEngine import build_recommendations
from utils.helpers import now


def _build_weekly_narrative(period: str, deadlines: dict, performance: dict, collaboration: dict, payload: dict) -> dict:
    """Step 14, Feature 7/9 — deterministic, rule-based narrative built only
    from the metrics already computed above (never a separate ML model, and
    never inventing data the caller didn't supply). Mirrors
    backend/src/services/reportService.js's buildWeeklyNarrative so the two
    surfaces (Node fallback vs this AI-engine path) tell the same story —
    the Node backend prefers its own deterministic version and only reaches
    this endpoint if it is explicitly wired to /reports/generate, per the
    project's existing graceful-degrade contract (services/aiEngineClient.js).
    """
    missed = deadlines.get("missed", [])
    group_name = (payload.get("group") or {}).get("name") or "This team"

    highlights: list[str] = []
    concerns: list[str] = []
    recommendations: list[str] = []

    highlights.append(f"Task completion is at {deadlines['progress']}%.")
    if performance.get("teamScore") is not None:
        highlights.append(f"Team score is {performance['teamScore']}/100 ({performance.get('teamGrade', 'n/a')}).")
    if missed:
        concerns.append(f"{len(missed)} task(s) missed their deadline.")
        recommendations.append("Follow up on overdue tasks.")
    else:
        recommendations.append("Keep up the current pace — no overdue tasks this week.")

    similarity_flags = int(payload.get("similarityWarnings") or 0)
    if similarity_flags:
        concerns.append(f"{similarity_flags} submission(s) triggered a similarity/originality warning.")
        recommendations.append("Investigate flagged similarity warnings before approving those submissions.")

    awaiting_review = int(payload.get("awaitingReview") or 0)
    if awaiting_review:
        concerns.append(f"{awaiting_review} submission(s) are awaiting guide review.")
        recommendations.append("Review pending submissions.")

    team_trend = "declining" if len(missed) > 2 else "improving" if deadlines["progress"] >= 70 else "steady"

    summary = (
        f"{group_name} is {'progressing well' if team_trend == 'improving' else 'showing some slowdown' if team_trend == 'declining' else 'progressing steadily'} "
        f"this {period}. Overall task completion is {deadlines['progress']}%, with {collaboration.get('collaborationScore', 0)}% "
        "collaboration activity."
    )
    if missed:
        summary += f" {len(missed)} assignment(s) remain overdue."

    return {
        "summary": summary,
        "highlights": highlights[:8],
        "concerns": concerns[:8],
        "recommendations": recommendations[:8],
        "teamTrend": team_trend,
    }


def generate_report(payload: dict) -> dict:
    period = payload.get("period", "weekly")
    collaboration = analyze_collaboration(payload)
    performance = analyze_performance(payload)
    deadlines = analyze_deadlines(payload)
    metrics = {**collaboration, **performance}

    report = {
        "period": period,
        "groupId": payload.get("groupId"),
        "generatedAt": now().isoformat(),
        "summary": (
            f"{period.capitalize()} report: {deadlines['progress']}% of tasks complete, "
            f"team score {performance['teamScore']}/100 ({performance['teamGrade']}), "
            f"{len(deadlines['missed'])} missed deadline(s)."
        ),
        "teamScore": performance["teamScore"],
        "progress": deadlines["progress"],
        "prediction": deadlines["prediction"],
        "students": performance["students"],
        "collaborationScore": collaboration["collaborationScore"],
        "missedDeadlines": deadlines["missed"],
        "upcomingDeadlines": deadlines["upcoming"][:10],
        "recommendations": build_recommendations(payload, metrics),
    }

    # Step 14, Feature 7/9 — additive only. Every existing key above is
    # untouched; "narrative" is a new, optional key so any caller reading
    # the pre-Step-14 shape keeps working unchanged.
    if period == "weekly":
        report["narrative"] = _build_weekly_narrative(period, deadlines, performance, collaboration, payload)

    return report
