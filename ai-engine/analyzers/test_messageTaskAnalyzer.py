"""
Step 7 — Focused tests for messageTaskAnalyzer.detect_tasks_from_message.

Root cause under test: the name-matching regex used to capture only the
single capitalized word immediately before the comma/verb, so a full name
like "Bhavani Nitla, complete X" resolved the mention as just "Nitla" and
never matched a real member (same bug existed in the Node fallback,
aiService.detectMessageTasks). Fixed by widening the name token to accept
1-3 capitalized words and by matching multi-word mentions against a
member's name as a set of words (so a reversed full name also resolves).

Run: python ai-engine/analyzers/test_messageTaskAnalyzer.py
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, ".."))  # allow `utils.*` import like app.py does

from analyzers.messageTaskAnalyzer import detect_tasks_from_message

CURRENT = "2026-08-19T00:00:00Z"  # a Wednesday

MEMBERS = [
    {"id": "u1", "name": "Bhavani Nitla"},
    {"id": "u2", "name": "Ramya Rao"},
    {"id": "u3", "name": "Pujitha"},
    {"id": "u4", "name": "Bhavani Rao"},
]

passed = 0


def check(label, fn):
    global passed
    fn()
    passed += 1
    print(f"ok - {label}")


def run():
    check("full name assignment resolves to the real member", lambda: (
        _assert_single_task("Bhavani Nitla, complete the frontend login page by tomorrow.", "u1")
    ))

    check("reversed full name resolves to the same real member", lambda: (
        _assert_single_task("Nitla Bhavani, complete the frontend login page.", "u1")
    ))

    def _single_first_name():
        r = detect_tasks_from_message({"text": "Pujitha, complete testing.", "members": MEMBERS, "currentDate": CURRENT})
        assert r["isTask"] is True
        assert r["tasks"][0]["assigneeId"] == "u3"
    check("first-name-only mention resolves when unambiguous", _single_first_name)

    def _ambiguous_first_name():
        r = detect_tasks_from_message({"text": "Bhavani, complete the frontend.", "members": MEMBERS, "currentDate": CURRENT})
        assert r["isTask"] is False
        assert r["unmatchedMentions"][0]["reason"] == "ambiguous_name_multiple_members_match"
    check("ambiguous first name (two members share it) is never guessed", _ambiguous_first_name)

    def _multiple_full_names():
        r = detect_tasks_from_message({
            "text": "Bhavani Nitla handle frontend, Ramya Rao handle backend, Pujitha handle testing by Monday.",
            "members": MEMBERS,
            "currentDate": CURRENT,
        })
        assert len(r["tasks"]) == 3
        assert [t["assigneeId"] for t in r["tasks"]] == ["u1", "u2", "u3"]
    check("multiple full-name assignments each create a separate task", _multiple_full_names)

    def _discussion():
        r = detect_tasks_from_message({"text": "Let's discuss the frontend design tomorrow.", "members": MEMBERS, "currentDate": CURRENT})
        assert r["isTask"] is False
    check("discussion-style message is never a task", _discussion)

    def _non_member():
        r = detect_tasks_from_message({"text": "Rahul handle backend.", "members": MEMBERS, "currentDate": CURRENT})
        assert r["isTask"] is False
        assert r["unmatchedMentions"][0]["reason"] == "not_a_member_of_this_group"
    check("non-member mention is reported, not silently reassigned", _non_member)

    def _deadline_tomorrow():
        r = detect_tasks_from_message({"text": "Bhavani Nitla, complete the login page by tomorrow.", "members": MEMBERS, "currentDate": CURRENT})
        assert r["isTask"] is True
        assert r["tasks"][0]["dueDate"] == "2026-08-20"
    check("deadline extraction for 'by tomorrow'", _deadline_tomorrow)

    def _deadline_in_3_days():
        r = detect_tasks_from_message({"text": "Bhavani Nitla, finish the API integration in 3 days.", "members": MEMBERS, "currentDate": CURRENT})
        assert r["isTask"] is True
        assert r["tasks"][0]["dueDate"] == "2026-08-22"
    check("deadline extraction for 'in 3 days'", _deadline_in_3_days)

    def _deadline_september_20():
        r = detect_tasks_from_message({"text": "Bhavani Nitla, submit the report on September 20.", "members": MEMBERS, "currentDate": CURRENT})
        assert r["isTask"] is True
        assert r["tasks"][0]["dueDate"] == "2026-09-20"
    check("deadline extraction for 'on September 20'", _deadline_september_20)

    def _deadline_before_friday():
        r = detect_tasks_from_message({"text": "Bhavani Nitla, complete this task before Friday.", "members": MEMBERS, "currentDate": CURRENT})
        assert r["isTask"] is True
        assert r["tasks"][0]["dueDate"] == "2026-08-21"
    check("deadline extraction for 'before Friday'", _deadline_before_friday)

    def _deadline_next_monday_at_5pm():
        r = detect_tasks_from_message({"text": "Bhavani Nitla, finish the frontend by next Monday at 5 PM.", "members": MEMBERS, "currentDate": CURRENT})
        assert r["isTask"] is True
        assert "17:00:00" in r["tasks"][0]["dueDate"]
        assert r["tasks"][0]["dueDate"].startswith("2026-08-")
    check("deadline extraction with time 'next Monday at 5 PM'", _deadline_next_monday_at_5pm)

    def _no_deadline():
        r = detect_tasks_from_message({"text": "Bhavani Nitla, complete the login page.", "members": MEMBERS, "currentDate": CURRENT})
        assert r["isTask"] is True
        assert r["tasks"][0]["dueDate"] is None
    check("no fabricated deadline when message contains no deadline", _no_deadline)

    print(f"\n{passed} test(s) passed.")


def _assert_single_task(text, expected_id):
    r = detect_tasks_from_message({"text": text, "members": MEMBERS, "currentDate": CURRENT})
    assert r["isTask"] is True
    assert len(r["tasks"]) == 1
    assert r["tasks"][0]["assigneeId"] == expected_id


def test_message_task_analyzer_suite():
    run()


if __name__ == "__main__":
    run()
