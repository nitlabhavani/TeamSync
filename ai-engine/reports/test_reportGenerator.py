"""Standalone tests for Step 14's weekly-narrative addition to
reportGenerator.generate_report(). No pytest / server / DB needed — pure
function tests against real (small, synthetic) payload dicts, the same
style as the existing analyzers/test_projectSubmissionAnalyzer.py.

Run: PYTHONPATH=ai-engine python3 ai-engine/reports/test_reportGenerator.py
"""
from __future__ import annotations

import os
import sys
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from reports.reportGenerator import generate_report  # noqa: E402

passed = 0


def check(label, fn):
    global passed
    fn()
    passed += 1
    print(f"ok - {label}")


def base_payload(**overrides):
    payload = {
        "period": "weekly",
        "groupId": "g1",
        "group": {"name": "Team Nimbus"},
        "students": [
            {"name": "Ramya", "tasksAssigned": 3, "tasksCompleted": 3, "messages": 12},
            {"name": "Bhavani", "tasksAssigned": 2, "tasksCompleted": 0, "messages": 1},
        ],
        "tasks": [
            {"id": "t1", "status": "done", "due": None},
            {"id": "t2", "status": "done", "due": None},
            {"id": "t3", "status": "todo", "due": None},
        ],
        "messages": [],
        "files": [],
    }
    payload.update(overrides)
    return payload


def test_1_normal_weekly_report():
    report = generate_report(base_payload())
    assert "narrative" in report, "weekly report must include a narrative block"
    n = report["narrative"]
    for key in ("summary", "highlights", "concerns", "recommendations", "teamTrend"):
        assert key in n, f"narrative missing key: {key}"
    assert isinstance(n["summary"], str) and len(n["summary"]) > 0
    assert "Team Nimbus" in n["summary"]


def test_2_monthly_report_has_no_narrative():
    report = generate_report(base_payload(period="monthly"))
    assert "narrative" not in report
    for key in ("period", "summary", "teamScore", "progress", "students", "collaborationScore", "recommendations"):
        assert key in report, f"pre-existing key missing: {key}"


def test_3_overdue_tasks_surface_as_concern():
    overdue_due = (datetime.now(timezone.utc) - timedelta(days=3)).isoformat()
    payload = base_payload(tasks=[
        {"id": "t1", "status": "todo", "due": overdue_due},
        {"id": "t2", "status": "done", "due": None},
    ])
    report = generate_report(payload)
    n = report["narrative"]
    assert any("overdue" in c.lower() or "missed" in c.lower() for c in n["concerns"] + [n["summary"]])


def test_4_similarity_warnings_surfaced():
    report = generate_report(base_payload(similarityWarnings=2))
    n = report["narrative"]
    assert any("similarity" in c.lower() for c in n["concerns"])
    assert any("similarity" in r.lower() for r in n["recommendations"])


def test_5_empty_group_does_not_crash():
    report = generate_report({
        "period": "weekly", "groupId": "g2", "group": {"name": "Empty Team"},
        "students": [], "tasks": [], "messages": [], "files": [],
    })
    assert "narrative" in report
    assert isinstance(report["narrative"]["summary"], str)


def test_6_missing_group_key_falls_back():
    payload = base_payload()
    del payload["group"]
    report = generate_report(payload)
    assert "narrative" in report
    assert "This team" in report["narrative"]["summary"]


check("Test 1: normal weekly report includes a narrative with summary/highlights/concerns/recommendations/teamTrend", test_1_normal_weekly_report)
check("Test 2: monthly/daily reports do not get a narrative block (weekly-only, additive)", test_2_monthly_report_has_no_narrative)
check("Test 3: overdue tasks (missed deadlines) surface as a concern", test_3_overdue_tasks_surface_as_concern)
check("Test 4: similarity warnings passed through payload are surfaced without inventing which files", test_4_similarity_warnings_surfaced)
check("Test 5: empty group (no students/tasks) does not crash", test_5_empty_group_does_not_crash)
check("Test 6: missing optional 'group' key falls back gracefully instead of raising", test_6_missing_group_key_falls_back)

print(f"\n{passed} test(s) passed (final).")
