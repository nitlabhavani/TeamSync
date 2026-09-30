"""
TeamSync AI Engine
==================

Flask service that performs every AI/analytics duty of the platform:

* reads GROUP chat only (private chat is never analysed)
* reads uploaded task files, ZIP archives and project folders
* detects missing project components and suggests improvements
* evaluates participation, collaboration and performance per student
* tracks task completion, monitors deadlines and raises reminders/warnings
* predicts overall project completion
* generates weekly and monthly reports plus AI recommendations

Run:  python app.py     (default http://127.0.0.1:8000)
"""
from __future__ import annotations

import os

from flask import Flask, jsonify, request
from flask_cors import CORS

from config.settings import settings
from analyzers.chatAnalyzer import analyze_chat
from analyzers.fileAnalyzer import analyze_file
from analyzers.taskAnalyzer import analyze_tasks
from analyzers.messageTaskAnalyzer import detect_tasks_from_message
from analyzers.collaborationAnalyzer import analyze_collaboration
from analyzers.performanceAnalyzer import analyze_performance, analyze_project_performance
from analyzers.hybridAnalyzer import build_hybrid_result
from analyzers.deadlineAnalyzer import analyze_deadlines
from analyzers.projectSubmissionAnalyzer import analyze_task_submission
from analyzers.teamRiskAnalyzer import analyze_team_risk
from analyzers.taskExpansionAnalyzer import expand_task
from analyzers.taskPlanAnalyzer import generate_task_plan
from recommendations.recommendationEngine import build_recommendations
from reports.reportGenerator import generate_report
from notifications.alertGenerator import build_alerts
from planning.projectPlanner import generate_project_plan
from utils.responses import ok, fail

app = Flask(__name__)
CORS(app, origins=settings.allowed_origins)


@app.before_request
def _check_key():
    """Optional shared-secret guard between the Node backend and this engine."""
    if request.path in ("/", "/health") or not settings.api_key:
        return None
    if request.headers.get("X-AI-Engine-Key") != settings.api_key:
        return fail("Invalid AI engine key", 401)
    return None


@app.route("/", methods=["GET", "HEAD"])
def root():
    return ok({"service": "teamsync-ai-engine", "version": "1.0.0", "status": "up"})


@app.route("/health", methods=["GET", "HEAD"])
def health():
    return ok({"service": "teamsync-ai-engine", "version": "1.0.0", "status": "up"})


@app.post("/analyze/chat")
def chat():
    """Group chat only — the payload must never contain private messages."""
    return ok(analyze_chat(request.get_json(silent=True) or {}))


@app.post("/analyze/file")
def file_analysis():
    return ok(analyze_file(request.get_json(silent=True) or {}))


@app.post("/analyze/tasks")
def tasks():
    return ok(analyze_tasks(request.get_json(silent=True) or {}))


@app.post("/analyze/message-task")
def message_task():
    """
    Group-chat automatic task assignment: analyzes ONE chat message and
    decides whether it contains a clear, actionable task assignment to a
    real group member (see analyzers/messageTaskAnalyzer.py for the safety
    rules — an assignee is only ever someone present in the `members` list
    the caller supplies, i.e. the group's real roster).

    Body: { text, members: [{id, name}], currentDate? }
    """
    payload = request.get_json(silent=True) or {}
    if not str(payload.get("text") or "").strip():
        return fail("text is required", 400)
    return ok(detect_tasks_from_message(payload))


@app.post("/analyze/collaboration")
def collaboration():
    payload = request.get_json(silent=True) or {}
    data = analyze_collaboration(payload)
    data["recommendations"] = build_recommendations(payload, data)
    return ok(data)


@app.post("/analyze/performance")
def performance():
    return ok(analyze_performance(request.get_json(silent=True) or {}))


@app.post("/analyze/project-performance")
def project_performance():
    """
    STEP 3 — evidence-based student work analysis, AI score, performance
    prediction, project completion prediction, group-chat analysis,
    per-file evidence, warnings (with duplicate suppression) and
    recommendations, combined into one response.

    Extends the existing analyzer set (chatAnalyzer, fileAnalyzer,
    taskAnalyzer, deadlineAnalyzer, performanceAnalyzer, alertGenerator,
    recommendationEngine) rather than adding a parallel analysis system —
    see analyzers/performanceAnalyzer.py:analyze_project_performance.

    Optional `studentId` in the payload narrows the response to one
    student's analysis (student_analysis / performance_prediction /
    file_analysis become single-item lists) while still returning the
    shared chat_analysis / project_completion_prediction / warnings for
    context. Group chat only — the Node backend must never send private
    messages here (see analyzers/chatAnalyzer.py).
    """
    payload = request.get_json(silent=True) or {}
    return ok(analyze_project_performance(payload))


@app.post("/analyze/performance-hybrid")
def performance_hybrid():
    """
    STEP 5C — Hybrid AI: wraps Step 3's evidence/rule-based analysis
    (analyze_student_work / score_student / predict_student_performance,
    all unmodified) alongside the OPTIONAL Random Forest ML signal from
    Step 5B. See analyzers/hybridAnalyzer.py for full behavior.

    Body: { ...same shape as /analyze/project-performance..., "studentId":
    required, "mlFeatures": optional dict }. As of Step 5F, mlFeatures is
    checked against the TeamSync 15-feature schema first (real TeamSync
    telemetry, e.g. taskCompletionRatio, meaningfulChatMessageCount, ...,
    scored by the SYNTHETIC-DEVELOPMENT-DATA-trained model at
    ai-engine/models/student_performance_rf_synthetic_dev/ — see
    analyzers/hybridAnalyzer.py for the not-production-data warning that
    accompanies every such prediction), then falls back to the UCI schema
    (unchanged Step 5B behavior). If mlFeatures matches neither schema,
    ML_PREDICTION is "ML_NOT_APPLICABLE" — Step 3's result is still
    returned in full and is unaffected either way.
    """
    payload = request.get_json(silent=True) or {}
    student_id = payload.get("studentId")
    if not student_id:
        return fail("studentId is required", 400)
    ml_features = payload.get("mlFeatures")
    return ok(build_hybrid_result(payload, str(student_id), ml_features))


@app.post("/analyze/deadlines")
def deadlines():
    payload = request.get_json(silent=True) or {}
    data = analyze_deadlines(payload)
    data["alerts"] = build_alerts(payload, data)
    return ok(data)


@app.post("/recommendations")
def recommendations():
    payload = request.get_json(silent=True) or {}
    return ok({"recommendations": build_recommendations(payload, payload.get("metrics", {}))})


@app.post("/reports/generate")
def reports():
    return ok(generate_report(request.get_json(silent=True) or {}))


@app.post("/analyze/project-plan")
def project_plan():
    """
    STEP 1 of the project-planning AI: turn a guide's project title +
    description (+ deadline + members) into a structured plan (modules,
    phases, tasks with dependencies, milestones, suggested assignments).

    Deliberately rule-based/deterministic for now — see planning/projectPlanner.py
    for why, and the "swap point" note there for where a real ML/LLM step
    would later plug in without changing this route or its response shape.
    """
    payload = request.get_json(silent=True) or {}
    if not payload.get("projectTitle") and not payload.get("projectDescription"):
        return fail("projectTitle or projectDescription is required", 400)
    return ok(generate_project_plan(payload))


@app.post("/analyze/task-submission")
def task_submission():
    """
    STEP 9 — Student Task Page ZIP submission analysis.

    Body: { taskTitle, taskDescription, taskModule, referenceProject:
    {identifiers, serviceFiles, modelFiles, routeTokens}, files: [{relPath,
    ext, size, content}], fileCount, ignoredCount, secretFileCount }.

    The Node backend has already safely extracted the ZIP, filtered out
    node_modules/.git/dist/build/__pycache__/.venv/binaries, excluded
    .env/secret files entirely, and truncated file contents — this endpoint
    only ever receives a bounded, preprocessed, secret-free manifest, never
    a raw ZIP, and never executes anything.

    See analyzers/projectSubmissionAnalyzer.py for the full decision logic
    (project identity -> task relevance -> implementation classification).
    """
    payload = request.get_json(silent=True) or {}
    if not payload.get("files"):
        return fail("files is required", 400)
    return ok(analyze_task_submission(payload))


@app.post("/analyze/team-risk")
def team_risk():
    """
    Step 15 — AI Team Risk & Early Warning System (engine-side equivalent).

    Body: an `evidence` object with the same shape
    backend/src/services/teamRiskAnalyzer.js#gatherGroupEvidence builds
    (tasks/submissions/collaboration/originality/perStudent/history counts
    only — no raw chat text, file contents, or plagiarism source material).

    The Node backend computes this itself by default (so the platform keeps
    working even when this engine is offline, exactly like every other
    analyzer here); this endpoint exists for engine-side parity and testing.
    """
    payload = request.get_json(silent=True) or {}
    if not payload:
        return fail("evidence payload is required", 400)
    return ok(analyze_team_risk(payload))


@app.post("/analyze/task-expansion")
def task_expansion():
    """
    STEP 17 — Feature 2: AI-Expanded Task Description.

    Turns a short guide-entered task title (+ optional short description)
    into a structured draft (description, subtasks, acceptance criteria,
    difficulty, effort estimate). Deliberately rule-based/deterministic —
    see analyzers/taskExpansionAnalyzer.py for why, same "swap point"
    pattern as planning/projectPlanner.py.

    This is a SUGGESTION ONLY — the Node backend never overwrites an
    existing task's title/description with this; the guide must explicitly
    accept it (see taskController.expandTask / the frontend "Use
    Suggestion" button).
    """
    payload = request.get_json(silent=True) or {}
    if not payload.get("title"):
        return fail("title is required", 400)
    return ok(expand_task(payload))


@app.post("/analyze/task-plan")
def task_plan():
    """
    STEP 18 — AI Task Intelligence / Smart Planning. Generates a subtask
    breakdown (with per-subtask difficulty/hours/order), acceptance
    criteria, and a testing checklist from a task title (+ optional short
    description). Deliberately rule-based/deterministic — see
    analyzers/taskPlanAnalyzer.py (which reuses
    analyzers/taskExpansionAnalyzer.py's domain detection rather than
    duplicating it).

    SUGGESTION ONLY — the Node backend never writes this to a task until
    the guide/leader explicitly applies it (see
    taskController.generateTaskPlan / applyTaskPlan and the frontend
    "Apply Plan" button).
    """
    payload = request.get_json(silent=True) or {}
    if not payload.get("title"):
        return fail("title is required", 400)
    return ok(generate_task_plan(payload))


@app.errorhandler(404)
def not_found(_):
    return fail("Endpoint not found", 404)


@app.errorhandler(Exception)
def crash(err):  # pragma: no cover
    app.logger.exception(err)
    return fail(str(err), 500)


if __name__ == "__main__":
    app.run(host=settings.host, port=settings.port, debug=settings.debug)
