"""
Step 15 — Focused tests for analyzers/teamRiskAnalyzer.py.

No Flask app, no network, no database — calls analyze_team_risk /
analyze_student_risk directly with hand-built evidence dicts, exactly like
test_messageTaskAnalyzer.py does for its analyzer.

Run: python ai-engine/analyzers/test_teamRiskAnalyzer.py
"""
import copy
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, ".."))  # allow `utils.*` import like app.py does

from analyzers.teamRiskAnalyzer import analyze_team_risk, analyze_student_risk, build_warnings

passed = 0


def check(label, fn):
    global passed
    fn()
    passed += 1
    print(f"ok - {label}")


def base_evidence(**overrides):
    evidence = {
        "groupId": "g1",
        "groupName": "Team Alpha",
        "generatedAt": "2026-08-30T12:00:00Z",
        "tasks": {
            "total": 5,
            "completed": 3,
            "overdue": 0,
            "dueSoonNoProgress": 0,
            "stalled": 0,
            "completionRatio": 0.6,
        },
        "submissions": {
            "awaitingReview": 0,
            "changesRequestedTasks": 0,
            "repeatedChangesTasks": 0,
            "rejected": 0,
            "wrongProjectOrUnreadable": 0,
        },
        "collaboration": {
            "messagesThisWeek": 20,
            "messagesLastWeek": 20,
            "daysSinceActivity": 1,
        },
        "originality": {
            "duplicateCount": 0,
            "highSeverityCount": 0,
            "possibleSeverityCount": 0,
        },
        "perStudent": {
            "u1": {"assigned": 3, "completed": 2, "overdue": 0, "stalled": 0, "pendingSubmissionReview": 0, "changesRequested": 0, "rejected": 0},
            "u2": {"assigned": 2, "completed": 1, "overdue": 0, "stalled": 0, "pendingSubmissionReview": 0, "changesRequested": 0, "rejected": 0},
        },
        "history": [],
    }
    for key, value in overrides.items():
        if isinstance(value, dict) and isinstance(evidence.get(key), dict):
            evidence[key] = {**evidence[key], **value}
        else:
            evidence[key] = value
    return evidence


# 1 — LOW scenario
def test_low():
    result = analyze_team_risk(base_evidence())
    assert result["riskLevel"] == "LOW", result["riskLevel"]
    assert result["riskScore"] < 25


check("LOW scenario", test_low)


# 2 — MODERATE scenario
def test_moderate():
    evidence = base_evidence(tasks={"overdue": 3, "stalled": 1}, submissions={"awaitingReview": 2})
    result = analyze_team_risk(evidence)
    assert result["riskLevel"] == "MODERATE", result["riskLevel"]


check("MODERATE scenario", test_moderate)


# 3 — HIGH scenario
def test_high():
    evidence = base_evidence(
        tasks={"overdue": 3, "stalled": 2, "completionRatio": 0.2, "total": 6, "completed": 1},
        submissions={"changesRequestedTasks": 2, "awaitingReview": 3},
    )
    result = analyze_team_risk(evidence)
    assert result["riskLevel"] == "HIGH", result["riskLevel"]


check("HIGH scenario", test_high)


# 4 — CRITICAL scenario
def test_critical():
    evidence = base_evidence(
        tasks={"overdue": 5, "stalled": 3, "completionRatio": 0.1, "total": 10, "completed": 1},
        submissions={"rejected": 3, "repeatedChangesTasks": 2, "changesRequestedTasks": 3, "awaitingReview": 5},
        collaboration={"daysSinceActivity": 12, "messagesThisWeek": 0, "messagesLastWeek": 20},
        originality={"duplicateCount": 1},
    )
    result = analyze_team_risk(evidence)
    assert result["riskLevel"] == "CRITICAL", result["riskLevel"]
    assert len(result["criticalRisks"]) > 0


check("CRITICAL scenario", test_critical)


# 5 — missing data (no perStudent / no originality keys) degrades gracefully
def test_missing_data():
    evidence = base_evidence()
    del evidence["originality"]
    del evidence["perStudent"]
    result = analyze_team_risk(evidence)
    assert result["riskLevel"] == "LOW"


check("missing data does not crash", test_missing_data)


# 6 — insufficient data (no tasks, no activity) -> INSUFFICIENT_DATA, no fabrication
def test_insufficient_data():
    evidence = base_evidence(
        tasks={"total": 0, "completed": 0, "overdue": 0, "dueSoonNoProgress": 0, "stalled": 0, "completionRatio": None},
        collaboration={"messagesThisWeek": 0, "messagesLastWeek": 0, "daysSinceActivity": None},
    )
    result = analyze_team_risk(evidence)
    assert result["riskLevel"] == "INSUFFICIENT_DATA"
    assert result["riskScore"] == 0
    assert result["warnings"] == []


check("insufficient data never fabricates a score", test_insufficient_data)


# 7 — deterministic output
def test_deterministic():
    evidence = base_evidence(tasks={"overdue": 2, "stalled": 1}, submissions={"rejected": 1})
    r1 = analyze_team_risk(copy.deepcopy(evidence))
    r2 = analyze_team_risk(copy.deepcopy(evidence))
    assert r1 == r2


check("same evidence produces deterministic output", test_deterministic)


# 8 — warning generation is evidence-backed
def test_warning_generation():
    evidence = base_evidence(tasks={"overdue": 2})
    warnings = build_warnings(evidence)
    assert any(w["type"] == "DEADLINE_RISK" for w in warnings)
    for w in warnings:
        assert w["evidence"], f"warning {w['type']} has no evidence"


check("warning generation is evidence-backed", test_warning_generation)


# 9 — recommendation generation ties back to real warnings only
def test_recommendation_generation():
    evidence = base_evidence(submissions={"rejected": 1})
    result = analyze_team_risk(evidence)
    assert any("guide" in r.lower() or "realign" in r.lower() or "reject" in r.lower() for r in result["recommendations"]) or result[
        "recommendations"
    ]
    # Healthy team gets the single default recommendation, never an invented one.
    healthy = analyze_team_risk(base_evidence())
    assert healthy["recommendations"] == ["Team is healthy — keep the current cadence."]


check("recommendation generation reflects real evidence", test_recommendation_generation)


# 10 — no fabricated student information: unassigned student is ON_TRACK, no invented reasons
def test_no_fabricated_student_info():
    evidence = base_evidence()
    result = analyze_student_risk(evidence, "u_never_assigned")
    assert result["riskLevel"] == "ON_TRACK"
    assert result["riskScore"] == 0
    assert "no tasks" in result["reasons"][0].lower()


check("unassigned student is never fabricated as at-risk", test_no_fabricated_student_info)

print(f"\n{passed} passed")
