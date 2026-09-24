"""
Step 9 — Focused tests for projectSubmissionAnalyzer.analyze_task_submission.

Run: python ai-engine/analyzers/test_projectSubmissionAnalyzer.py
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, ".."))  # allow `utils.*` import like app.py does

from analyzers.projectSubmissionAnalyzer import analyze_task_submission

passed = 0


def check(label, fn):
    global passed
    fn()
    passed += 1
    print(f"ok - {label}")


REFERENCE = {
    "identifiers": ["teamsync", "chattaskservice", "chattaskextractionservice", "aiengineclient", "task"],
    "serviceFiles": ["chatTaskService.js", "chatTaskExtractionService.js", "aiEngineClient.js"],
    "modelFiles": ["Task.js", "Group.js", "User.js"],
    "routeTokens": ["tasks", "submit", "groups", "chat"],
}

TASK = {
    "taskTitle": "Implement AI task assignment",
    "taskDescription": "Add automatic task assignment from group chat messages using the AI engine.",
    "taskModule": "Backend / AI",
}


def _file(rel, content=""):
    return {"relPath": rel, "ext": os.path.splitext(rel)[1], "size": len(content), "content": content}


def run():
    check("Test 1: correct project + correct task implementation -> VALID_SUBMISSION", lambda: (
        _assert(
            files=[
                _file("backend/src/services/chatTaskService.js", "function assignTaskFromMessage() { /* full implementation */ return true; }"),
                _file("backend/src/services/chatTaskExtractionService.js", "function resolveAssignee() { return member; }"),
                _file("backend/src/services/aiEngineClient.js", "const analyzeMessageTask = () => callEngine('/analyze/message-task');"),
            ],
            expect_project_related=True,
            expect_task_related=True,
            expect_status="VALID_SUBMISSION",
        )
    ))

    check("Test 2: correct project, unrelated implementation (CSS only) -> PROJECT_RELATED_TASK_NOT_IMPLEMENTED", lambda: (
        _assert(
            files=[
                # Recognisably TeamSync AI (matches a real model + the
                # backend package identity) but nothing touching the
                # chat-task-assignment feature the task actually asks for.
                _file("backend/src/models/User.js", "const userSchema = new mongoose.Schema({ name: String, email: String });"),
                _file("backend/package.json", '{"name": "teamsync-ai-backend"}'),
                _file("frontend/src/styles/theme.css", ".button { color: blue; }"),
            ],
            expect_project_related=True,
            expect_task_related=False,
            expect_status="PROJECT_RELATED_TASK_NOT_IMPLEMENTED",
        )
    ))

    check("Test 3: completely unrelated project -> WRONG_PROJECT", lambda: (
        _assert(
            files=[
                _file("attendance/src/StudentAttendance.java", "public class StudentAttendance { void markPresent() {} }"),
                _file("attendance/README.md", "College Attendance Management System"),
            ],
            expect_project_related=False,
            expect_task_related=False,
            expect_status="WRONG_PROJECT",
        )
    ))

    check("Test 4: partial implementation with TODO -> PARTIAL_PROGRESS", lambda: (
        _assert(
            files=[
                _file("backend/src/services/chatTaskService.js", "function assignTaskFromMessage() { // TODO: finish assignment logic\n}"),
            ],
            expect_project_related=True,
            expect_task_related=True,
            expect_status="PARTIAL_PROGRESS",
        )
    ))

    check("Test 5: excellent implementation across many files -> VALID_SUBMISSION", lambda: (
        _assert(
            files=[
                _file("backend/src/services/chatTaskService.js", "function assignTaskFromMessage() { return doFullAssignment(); }"),
                _file("backend/src/services/chatTaskExtractionService.js", "function resolveAssignee(candidate, members) { return member; }"),
                _file("backend/src/services/aiEngineClient.js", "const analyzeMessageTask = (p) => callEngine('/analyze/message-task', p);"),
                _file("backend/src/models/Task.js", "sourceMessageId: { type: ObjectId, ref: 'Message' }"),
            ],
            expect_project_related=True,
            expect_task_related=True,
            expect_status="VALID_SUBMISSION",
        )
    ))

    check("WRONG_PROJECT never claims taskRelated true", lambda: (
        _assert(
            files=[_file("randomapp/index.html", "<h1>Totally different app</h1>")],
            expect_project_related=False,
            expect_task_related=False,
            expect_status="WRONG_PROJECT",
        )
    ))

    check("Empty file list is handled without crashing", lambda: (
        _assert(files=[], expect_project_related=False, expect_task_related=False, expect_status="WRONG_PROJECT")
    ))

    # --- Step 13 additions: taskConfidence / progressLabel / feedback categories ---

    check("Step 13: VALID_SUBMISSION has progressLabel Complete/Nearly Complete + positiveFindings, no criticalIssues", lambda: (
        _assert_step13(
            files=[
                _file("backend/src/services/chatTaskService.js", "function assignTaskFromMessage() { return doFullAssignment(); }"),
                _file("backend/src/services/chatTaskExtractionService.js", "function resolveAssignee(candidate, members) { return member; }"),
                _file("backend/src/services/aiEngineClient.js", "const analyzeMessageTask = (p) => callEngine('/analyze/message-task', p);"),
                _file("backend/src/models/Task.js", "sourceMessageId: { type: ObjectId, ref: 'Message' }"),
            ],
            expect_no_critical=True,
            expect_has_positive=True,
            expect_progress_label_in={"Nearly Complete", "Complete"},
        )
    ))

    check("Step 13: WRONG_PROJECT has a criticalIssue and taskConfidence 0", lambda: (
        _assert_step13(
            files=[_file("randomapp/index.html", "<h1>Totally different app</h1>")],
            expect_no_critical=False,
            expect_has_positive=False,
            expect_progress_label_in={"Not Started"},
            expect_task_confidence_zero=True,
        )
    ))

    check("Step 13: PARTIAL_PROGRESS has progressLabel In Progress", lambda: (
        _assert_step13(
            files=[
                _file("backend/src/services/chatTaskService.js", "function assignTaskFromMessage() { // TODO: finish assignment logic\n}"),
            ],
            expect_no_critical=True,
            expect_has_positive=True,
            expect_progress_label_in={"In Progress"},
        )
    ))

    print(f"\n{passed} passed")


def _assert_step13(files, expect_no_critical, expect_has_positive, expect_progress_label_in, expect_task_confidence_zero=False):
    payload = {**TASK, "referenceProject": REFERENCE, "files": files, "fileCount": len(files)}
    result = analyze_task_submission(payload)
    assert isinstance(result.get("criticalIssues"), list)
    assert isinstance(result.get("positiveFindings"), list)
    assert 0 <= result["taskConfidence"] <= 100
    assert result["progressLabel"] in {"Not Started", "In Progress", "Nearly Complete", "Complete"}
    if expect_no_critical:
        assert result["criticalIssues"] == [], f"expected no criticalIssues, got {result['criticalIssues']}"
    else:
        assert len(result["criticalIssues"]) > 0, "expected at least one criticalIssue"
    if expect_has_positive:
        assert len(result["positiveFindings"]) > 0, "expected at least one positiveFinding"
    else:
        assert result["positiveFindings"] == []
    assert result["progressLabel"] in expect_progress_label_in, (
        f"progressLabel: expected one of {expect_progress_label_in}, got {result['progressLabel']}"
    )
    if expect_task_confidence_zero:
        assert result["taskConfidence"] == 0


def _assert(files, expect_project_related, expect_task_related, expect_status):
    payload = {**TASK, "referenceProject": REFERENCE, "files": files, "fileCount": len(files)}
    result = analyze_task_submission(payload)
    assert result["projectRelated"] == expect_project_related, (
        f"projectRelated: expected {expect_project_related}, got {result['projectRelated']} ({result})"
    )
    assert result["taskRelated"] == expect_task_related, (
        f"taskRelated: expected {expect_task_related}, got {result['taskRelated']} ({result})"
    )
    assert result["implementationStatus"] == expect_status, (
        f"implementationStatus: expected {expect_status}, got {result['implementationStatus']} ({result})"
    )
    assert 0 <= result["projectConfidence"] <= 100
    assert 0 <= result["progress"] <= 100
    assert isinstance(result["analyzedFiles"], list)


if __name__ == "__main__":
    run()
