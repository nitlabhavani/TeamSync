"""
Performance analyzer.

Produces a per-student performance card:
  participation, task completion, communication, collaboration,
  overall score, grade and rank.
"""
from __future__ import annotations

from config.settings import settings
from utils.helpers import clamp, dedupe, has_min_evidence, make_evidence, now, parse_date
from analyzers.chatAnalyzer import analyze_chat
from analyzers.taskAnalyzer import analyze_tasks

DONE = {"done", "completed"}
IN_PROGRESS = {"in_progress", "submitted", "ai_review", "guide_review", "review", "changes_requested"}


def _grade(score: int) -> str:
    if score >= 85:
        return "Excellent"
    if score >= 70:
        return "Good"
    if score >= 55:
        return "Average"
    if score >= 40:
        return "Needs Improvement"
    return "At Risk"


def analyze_performance(payload: dict) -> dict:
    chat = analyze_chat(payload)
    tasks = analyze_tasks(payload)
    files = payload.get("files", [])
    members = payload.get("members", []) or [
        {"userId": p["userId"], "name": p["name"]} for p in chat["participants"]
    ]

    comm = {p["userId"]: p for p in chat["participants"]}
    work = {w["userId"]: w for w in tasks["workload"]}

    cards = []
    for member in members:
        uid = str(member.get("userId") or member.get("id"))
        c = comm.get(uid, {})
        w = work.get(uid, {})
        uploads = sum(1 for f in files if str(f.get("uploadedBy")) == uid)

        communication = clamp(c.get("communicationScore", 0))
        completion = clamp(w.get("completionRate", 0))
        participation = clamp(
            0.4 * communication + 0.3 * min(100, uploads * 25) + 0.3 * min(100, w.get("assigned", 0) * 20)
        )
        collaboration = clamp(
            0.5 * participation + 0.3 * communication + 0.2 * min(100, c.get("answersGiven", 0) * 10)
        )
        overall = clamp(
            settings.weight_participation * participation
            + settings.weight_task_completion * completion
            + settings.weight_communication * communication
            + settings.weight_collaboration * collaboration
        )

        cards.append(
            {
                "userId": uid,
                "name": member.get("name"),
                "email": member.get("email"),
                "isLeader": bool(member.get("isLeader")),
                "participationScore": participation,
                "taskCompletionScore": completion,
                "communicationScore": communication,
                "collaborationScore": collaboration,
                "overallScore": overall,
                "grade": _grade(overall),
                "tasksAssigned": w.get("assigned", 0),
                "tasksCompleted": w.get("completed", 0),
                "tasksOverdue": w.get("overdue", 0),
                "filesUploaded": uploads,
                "messagesSent": c.get("messages", 0),
            }
        )

    cards.sort(key=lambda c: c["overallScore"], reverse=True)
    for index, card in enumerate(cards, start=1):
        card["rank"] = index

    team = clamp(sum(c["overallScore"] for c in cards) / (len(cards) or 1))
    return {
        "teamScore": team,
        "teamGrade": _grade(team),
        "students": cards,
        "topPerformer": cards[0]["name"] if cards else None,
        "atRisk": [c["name"] for c in cards if c["overallScore"] < 45],
        "generatedAt": now().isoformat(),
    }


def _student_tasks(payload: dict, student_id: str) -> list[dict]:
    return [t for t in payload.get("tasks", []) if str(t.get("assignee")) == str(student_id)]


def _chat_evidence_for_student(payload: dict, student_id: str, task_titles: list[str]) -> list[dict]:
    """Group-chat messages that count as explicit progress evidence for this
    student — i.e. the message is theirs, is meaningful (not small talk),
    and references one of their assigned task titles. This mirrors STEP3A's
    rule: don't infer completion from chat unless it's explicitly evidence."""
    from analyzers.chatAnalyzer import _is_meaningful  # local import avoids a cycle at module load

    hits = []
    lower_titles = [t.lower() for t in task_titles if t]
    for msg in payload.get("messages", []):
        if msg.get("private"):
            continue
        sender = str(msg.get("sender") or msg.get("userId") or "")
        if sender != str(student_id):
            continue
        text = str(msg.get("text") or "")
        if not _is_meaningful(text):
            continue
        low = text.lower()
        if any(title and title in low for title in lower_titles) or any(
            h in low for h in ("completed", "finished", "done with", "pushed", "uploaded", "working on")
        ):
            hits.append({"text": text[:200], "createdAt": msg.get("createdAt")})
    return hits


def analyze_student_work(payload: dict, student_id: str) -> dict:
    """
    STEP 3A / 3C — evidence-based work breakdown + quality observations for
    one student. Extends this (existing) performance analyzer rather than
    introducing a second student/work analyzer.
    """
    tasks = _student_tasks(payload, student_id)
    members = {str(m.get("userId") or m.get("id")): m for m in payload.get("members", [])}
    member = members.get(str(student_id), {})
    files = [f for f in payload.get("files", []) if str(f.get("uploadedBy")) == str(student_id)]
    current = now()

    if not tasks:
        return {
            "studentId": student_id,
            "name": member.get("name"),
            "status": "insufficient_data",
            "completedWork": [],
            "inProgressWork": [],
            "remainingWork": [],
            "overdueWork": [],
            "evidence": [],
            "qualityObservations": [],
            "possibleIssues": ["No tasks are assigned to this student."],
            "suggestions": ["Assign at least one task before requesting a work analysis."],
            "generatedAt": current.isoformat(),
        }

    completed, in_progress, remaining, overdue = [], [], [], []
    evidence: list[dict] = []
    task_titles = [t.get("title", "") for t in tasks]
    chat_hits = _chat_evidence_for_student(payload, student_id, task_titles)

    for task in tasks:
        status = str(task.get("status") or "todo")
        due = parse_date(task.get("due"))
        row = {"id": task.get("id"), "title": task.get("title"), "status": status, "due": task.get("due")}

        if status in DONE:
            completed.append(row)
            evidence.append(make_evidence("task", task.get("id"), f"Task '{task.get('title')}' is marked completed.", task.get("completedAt"), "positive"))
        elif due and due < current:
            overdue.append({**row, "daysLate": int((current - due).days)})
            evidence.append(make_evidence("task", task.get("id"), f"Task '{task.get('title')}' is overdue by {int((current - due).days)} day(s).", None, "negative"))
        elif status in IN_PROGRESS or (task.get("progress") or 0) > 0:
            in_progress.append({**row, "progress": task.get("progress")})
            evidence.append(make_evidence("task", task.get("id"), f"Task '{task.get('title')}' has status '{status}' with recorded progress.", None, "neutral"))
        else:
            remaining.append(row)

    # Files relevant to this student's tasks count as progress evidence.
    relevant_files = []
    for f in files:
        matched_task = next((t for t in tasks if str(t.get("id")) == str(f.get("taskId"))), None)
        if matched_task or not f.get("taskId"):
            relevant_files.append(f)
            evidence.append(make_evidence("file", f.get("id") or f.get("filename"), f"File '{f.get('filename') or f.get('name')}' uploaded by this student.", f.get("uploadedAt"), "positive"))

    for hit in chat_hits:
        evidence.append(make_evidence("chat", None, f"Progress mentioned in group chat: \"{hit['text']}\"", hit.get("createdAt"), "positive"))

    quality_observations, possible_issues, suggestions = [], [], []
    if completed:
        quality_observations.append(f"{len(completed)} assigned task(s) are marked completed.")
    if relevant_files and completed:
        quality_observations.append("Completed tasks are backed by uploaded files.")
    if completed and not relevant_files and not chat_hits:
        possible_issues.append("Tasks are marked completed but no supporting file or chat evidence was found.")
        suggestions.append("Upload the deliverable or note completion in group chat so progress is verifiable.")
    if overdue:
        possible_issues.append(f"{len(overdue)} task(s) are overdue.")
        suggestions.append("Prioritize and update the overdue task(s), or flag a blocker if stuck.")
    if remaining and not in_progress and not completed:
        possible_issues.append("No evidence of progress on any assigned task yet.")
        suggestions.append("Move at least one task to in-progress and share an update in group chat.")
    if not files and not chat_hits and not completed:
        possible_issues.append("Required task evidence (files or chat updates) is missing.")

    status = "ok" if has_min_evidence(tasks) else "insufficient_data"

    return {
        "studentId": student_id,
        "name": member.get("name"),
        "status": status,
        "completedWork": completed,
        "inProgressWork": in_progress,
        "remainingWork": remaining,
        "overdueWork": overdue,
        "evidence": evidence,
        "qualityObservations": dedupe(quality_observations),
        "possibleIssues": dedupe(possible_issues),
        "suggestions": dedupe(suggestions),
        "generatedAt": current.isoformat(),
    }


def score_student(work: dict) -> dict:
    """
    STEP 3D — explainable AI/performance score for one student, derived
    from analyze_student_work() evidence via weighted categories (reusing
    the same category weights already defined in config.settings so this
    stays consistent with the rest of the engine's scoring, rather than
    inventing a second weighting scheme).
    """
    if work.get("status") == "insufficient_data":
        return {
            "score": None,
            "status": "insufficient_data",
            "confidence": "low",
            "evidence": {},
            "reasons": work.get("possibleIssues") or ["Not enough evidence to compute a score."],
        }

    completed = len(work["completedWork"])
    overdue = len(work["overdueWork"])
    in_progress = len(work["inProgressWork"])
    remaining = len(work["remainingWork"])
    total = completed + overdue + in_progress + remaining or 1
    files = sum(1 for e in work["evidence"] if e["source"] == "file")
    chat_evidence = sum(1 for e in work["evidence"] if e["source"] == "chat")

    completion_component = clamp(completed / total * 100)
    progress_component = clamp((completed + 0.5 * in_progress) / total * 100)
    deadline_component = clamp(100 - (overdue / total * 100))
    evidence_component = clamp(min(100, (files + chat_evidence) * 20))

    score = clamp(
        0.40 * completion_component
        + 0.25 * progress_component
        + 0.20 * deadline_component
        + 0.15 * evidence_component
    )

    if score >= 80:
        status = "excellent"
    elif score >= 60:
        status = "good"
    elif score >= 40:
        status = "needs_attention"
    else:
        status = "at_risk"

    reasons = []
    reasons.append(f"{completed} of {total} assigned task(s) completed ({completion_component}%).")
    if overdue:
        reasons.append(f"{overdue} task(s) overdue, reducing the deadline-adherence component.")
    if files or chat_evidence:
        reasons.append(f"{files} relevant file(s) and {chat_evidence} chat progress update(s) found as supporting evidence.")
    else:
        reasons.append("No supporting file or chat evidence was found for this student's work.")

    confidence = "high" if total >= 4 else "medium" if total >= 2 else "low"

    return {
        "score": score,
        "status": status,
        "confidence": confidence,
        "evidence": {
            "completedTasks": completed,
            "overdueTasks": overdue,
            "inProgressTasks": in_progress,
            "remainingTasks": remaining,
            "relevantFiles": files,
            "chatProgressUpdates": chat_evidence,
        },
        "reasons": reasons,
    }


def predict_student_performance(work: dict, score: dict) -> dict:
    """
    STEP 3E — evidence-based performance prediction for one student.
    Categories: ON_TRACK / AT_RISK / BEHIND / INSUFFICIENT_DATA.
    """
    if work.get("status") == "insufficient_data" or score.get("status") == "insufficient_data":
        return {
            "status": "INSUFFICIENT_DATA",
            "reasons": ["Not enough task/activity evidence to predict performance."],
            "evidence": [],
            "confidence": "low",
        }

    overdue = len(work["overdueWork"])
    remaining = len(work["remainingWork"])
    in_progress = len(work["inProgressWork"])
    completed = len(work["completedWork"])
    total = overdue + remaining + in_progress + completed or 1

    reasons = []
    if overdue >= 2:
        status = "BEHIND"
        reasons.append(f"{overdue} assigned task(s) remain overdue.")
    elif overdue == 1:
        status = "AT_RISK"
        reasons.append("1 assigned task is overdue.")
    elif remaining and not in_progress and not completed:
        status = "AT_RISK"
        reasons.append("No evidence of progress exists on any remaining task.")
    elif completed / total >= 0.6:
        status = "ON_TRACK"
        reasons.append(f"{completed} of {total} task(s) completed with no overdue work.")
    else:
        status = "AT_RISK"
        reasons.append("Task completion is below the halfway point with work still outstanding.")

    # Approaching-deadline signal from the remaining evidence rows already
    # collected on the work object (negative-impact task evidence).
    negative_task_evidence = [e for e in work["evidence"] if e["source"] == "task" and e["impact"] == "negative"]
    if negative_task_evidence and status == "ON_TRACK":
        status = "AT_RISK"
    for e in negative_task_evidence[:3]:
        reasons.append(e["observation"])

    confidence = score.get("confidence", "low")

    return {
        "status": status,
        "reasons": dedupe(reasons),
        "evidence": work["evidence"],
        "confidence": confidence,
    }


def analyze_project_performance(payload: dict) -> dict:
    """
    STEP 3J — top-level Step 3 orchestrator. Combines student work analysis,
    scoring, performance prediction, project completion prediction, group
    chat analysis, per-file evidence, warnings and recommendations into one
    response, calling the existing analyzers rather than recomputing logic.

    Defensive by design (STEP3N): missing groupId/members/tasks/etc. never
    raises — every section either produces real evidence-based output or an
    explicit "insufficient_data" state.
    """
    from analyzers.chatAnalyzer import analyze_project_chat
    from analyzers.fileAnalyzer import analyze_student_file
    from analyzers.deadlineAnalyzer import predict_project_completion
    from notifications.alertGenerator import generate_warnings
    from recommendations.recommendationEngine import build_step3_recommendations

    if not isinstance(payload, dict):
        payload = {}

    group_id = payload.get("groupId")
    members = payload.get("members") or []
    tasks = payload.get("tasks") or []
    files = payload.get("files") or []
    requested_student = payload.get("studentId")

    # De-duplicate members by userId — defends against the same student
    # appearing twice in the payload (STEP3N: duplicate records).
    seen_ids = set()
    unique_members = []
    for m in members:
        uid = str(m.get("userId") or m.get("id") or "")
        if uid and uid not in seen_ids:
            seen_ids.add(uid)
            unique_members.append(m)
    members = unique_members

    if requested_student:
        members = [m for m in members if str(m.get("userId") or m.get("id")) == str(requested_student)]

    student_ids = [str(m.get("userId") or m.get("id")) for m in members if m.get("userId") or m.get("id")]
    if requested_student:
        student_ids = [str(requested_student)]
    else:
        # Also cover students who have tasks but weren't listed in `members`.
        for t in tasks:
            aid = str(t.get("assignee") or "")
            if aid and aid not in student_ids:
                student_ids.append(aid)

    student_analysis, ai_scores, performance_predictions, file_analysis = [], [], [], []

    for sid in student_ids:
        work = analyze_student_work(payload, sid)
        score = score_student(work)
        prediction = predict_student_performance(work, score)
        work["aiScore"] = score
        student_analysis.append(work)
        ai_scores.append({"studentId": sid, **score})
        performance_predictions.append({"studentId": sid, **prediction})

        student_task_ids = {str(t.get("id")) for t in _student_tasks(payload, sid)}
        for f in files:
            if str(f.get("uploadedBy")) != sid:
                continue
            matched_task = next((t for t in tasks if str(t.get("id")) == str(f.get("taskId"))), None) if str(f.get("taskId")) in student_task_ids else None
            file_analysis.append(analyze_student_file(f, matched_task))

    chat_analysis = analyze_project_chat(payload)
    project_completion = predict_project_completion(payload)

    warnings = generate_warnings(
        group_id,
        student_analysis,
        performance_predictions,
        chat_analysis,
        existing_alerts=payload.get("previousWarnings") or [],
        manual_warnings=payload.get("manualWarnings") or [],
    )
    recommendations = build_step3_recommendations(student_analysis, warnings, project_completion)

    data_sufficiency = {
        "hasTasks": bool(tasks),
        "hasChat": bool(payload.get("messages")),
        "hasFiles": bool(files),
        "hasMembers": bool(members),
        "hasProjectDeadline": bool(payload.get("expectedCompletion")),
        "studentsAnalyzed": len(student_analysis),
        "studentsWithInsufficientData": sum(1 for w in student_analysis if w.get("status") == "insufficient_data"),
    }

    return {
        "groupId": group_id,
        "studentAnalysis": student_analysis,
        "performancePrediction": performance_predictions,
        "projectCompletionPrediction": project_completion,
        "chatAnalysis": chat_analysis,
        "fileAnalysis": file_analysis,
        "warnings": warnings,
        "recommendations": recommendations,
        "dataSufficiency": data_sufficiency,
        "generatedAt": now().isoformat(),
    }
