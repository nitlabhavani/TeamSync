"""
Group chat analyzer.

ONLY group chat is processed. The Node backend never sends direct/private
messages, and this module additionally drops anything flagged as private.
"""
from __future__ import annotations

from collections import Counter, defaultdict

from utils.helpers import clamp, dedupe, make_evidence, now, parse_date

POSITIVE = {"great", "thanks", "good", "done", "nice", "agree", "well", "awesome", "ready"}
NEGATIVE = {"blocked", "stuck", "late", "issue", "bug", "problem", "delay", "confused", "fail"}
QUESTION_HINTS = ("?", "how ", "why ", "can we", "should we")

# ---------------------------------------------------------------------------
# STEP 3G — group-chat *project* analysis.
#
# analyze_chat() above stays untouched (participation/sentiment stats used
# by collaborationAnalyzer/performanceAnalyzer/reportGenerator already).
# analyze_project_chat() extends this module with the message-level
# classification Step 3 needs: which messages are actual project evidence
# (progress updates, blockers, task discussion) vs. noise ("hello").
# ---------------------------------------------------------------------------
PROGRESS_HINTS = (
    "completed", "finished", "done with", "pushed", "merged", "uploaded",
    "deployed", "implemented", "fixed", "working on", "started", "in progress",
)
BLOCKER_HINTS = (
    "blocked", "stuck", "can't", "cant", "cannot", "issue with", "error",
    "not working", "waiting on", "waiting for", "need help", "help with",
)
HELP_HINTS = ("need help", "can someone", "could someone", "anyone know", "help with", "help me")
TASK_WORD_HINTS = ("task", "module", "feature", "frontend", "backend", "api", "ui", "bug", "deploy", "test")

_NOISE = {"hi", "hello", "hey", "ok", "okay", "yes", "no", "thanks", "thank you", "lol", "haha", "k"}


def _is_meaningful(text: str) -> bool:
    """Distinguish real project discussion from small talk (STEP3G example:
    "frontend dashboard completed" vs "hello")."""
    stripped = text.strip().lower().strip("!.")
    if not stripped or stripped in _NOISE:
        return False
    return len(stripped.split()) >= 3 or any(h in stripped for h in PROGRESS_HINTS + BLOCKER_HINTS)


def analyze_chat(payload: dict) -> dict:
    messages = [m for m in payload.get("messages", []) if not m.get("private")]
    members = payload.get("members", [])

    per_user = defaultdict(lambda: {"count": 0, "chars": 0, "questions": 0, "answers": 0})
    sentiment = Counter()
    days = Counter()

    for msg in messages:
        sender = str(msg.get("sender") or msg.get("userId") or "unknown")
        text = str(msg.get("text") or "")
        stats = per_user[sender]
        stats["count"] += 1
        stats["chars"] += len(text) or int(msg.get("length") or 0)
        low = text.lower()
        if any(h in low for h in QUESTION_HINTS):
            stats["questions"] += 1
        else:
            stats["answers"] += 1
        words = set(low.split())
        if words & POSITIVE:
            sentiment["positive"] += 1
        elif words & NEGATIVE:
            sentiment["negative"] += 1
        else:
            sentiment["neutral"] += 1
        created = parse_date(msg.get("createdAt"))
        if created:
            days[created.date().isoformat()] += 1

    total = len(messages) or 1
    average = total / (len(members) or len(per_user) or 1)

    participants = []
    for member in members or [{"userId": uid} for uid in per_user]:
        uid = str(member.get("userId") or member.get("id"))
        stats = per_user.get(uid, {"count": 0, "chars": 0, "questions": 0, "answers": 0})
        participants.append(
            {
                "userId": uid,
                "name": member.get("name"),
                "messages": stats["count"],
                "share": round(stats["count"] / total * 100, 1),
                "questionsAsked": stats["questions"],
                "answersGiven": stats["answers"],
                "communicationScore": clamp(stats["count"] / average * 70 if average else 0),
            }
        )

    quiet = [p["name"] or p["userId"] for p in participants if p["communicationScore"] < 40]
    insights = []
    if quiet:
        insights.append(f"Low chat participation from: {', '.join(str(q) for q in quiet)}")
    if sentiment["negative"] > sentiment["positive"]:
        insights.append("Team sentiment is trending negative — several blockers were mentioned.")
    if total < 10:
        insights.append("Very little group discussion so far. Encourage daily stand-up updates.")

    return {
        "scope": "group_chat_only",
        "privateChatAnalysed": False,
        "messagesAnalyzed": len(messages),
        "activeDays": len(days),
        "dailyVolume": dict(days),
        "sentiment": dict(sentiment),
        "participants": participants,
        "insights": dedupe(insights),
        "generatedAt": now().isoformat(),
    }


def analyze_project_chat(payload: dict) -> dict:
    """
    STEP 3G — structured group-chat analysis for the Step 3 response.

    ONLY group chat is used (same filtering as analyze_chat: messages
    flagged `private` are dropped, and the Node backend is expected to
    never send direct/private messages here at all). Distinguishes real
    project evidence from small talk instead of just counting messages.
    """
    messages = [m for m in payload.get("messages", []) if not m.get("private")]

    if not messages:
        return {
            "scope": "group_chat_only",
            "privateChatAnalysed": False,
            "status": "insufficient_data",
            "summary": "No group chat messages are available to analyze.",
            "progressUpdates": [],
            "blockers": [],
            "unansweredQuestions": [],
            "taskDiscussions": [],
            "collaborationObservations": [],
            "riskSignals": [],
            "evidence": [],
            "generatedAt": now().isoformat(),
        }

    progress_updates, blockers, task_discussions = [], [], []
    questions, answered_after = [], set()

    for idx, msg in enumerate(messages):
        text = str(msg.get("text") or "").strip()
        if not text:
            continue
        sender = str(msg.get("sender") or msg.get("userId") or "unknown")
        created = parse_date(msg.get("createdAt"))
        low = text.lower()

        if not _is_meaningful(text):
            continue

        row = {"sender": sender, "text": text[:280], "createdAt": msg.get("createdAt")}

        if any(h in low for h in PROGRESS_HINTS):
            progress_updates.append(row)
        if any(h in low for h in BLOCKER_HINTS):
            blockers.append(
                {
                    **row,
                    "helpRequested": any(h in low for h in HELP_HINTS),
                }
            )
        if any(h in low for h in TASK_WORD_HINTS):
            task_discussions.append(row)
        if "?" in text:
            questions.append({"index": idx, "sender": sender, **row})
            # a reply from someone else within the next few messages counts as an answer
            for later in messages[idx + 1 : idx + 6]:
                if str(later.get("sender") or later.get("userId")) != sender and str(later.get("text") or "").strip():
                    answered_after.add(idx)
                    break

    unanswered_questions = [q for q in questions if q["index"] not in answered_after]

    collaboration_observations = []
    senders = Counter(str(m.get("sender") or m.get("userId") or "unknown") for m in messages)
    if len(senders) == 1:
        collaboration_observations.append("Only one member has posted in the group chat.")
    elif senders:
        top_sender, top_count = senders.most_common(1)[0]
        if top_count / len(messages) > 0.7:
            collaboration_observations.append(
                f"Chat is dominated by one member ({round(top_count / len(messages) * 100)}% of messages)."
            )
    if progress_updates:
        collaboration_observations.append(f"{len(progress_updates)} progress update(s) were shared in group chat.")

    risk_signals = []
    if blockers:
        risk_signals.append(f"{len(blockers)} blocker-related message(s) found in group chat.")
    if unanswered_questions:
        risk_signals.append(f"{len(unanswered_questions)} question(s) in group chat received no reply.")
    last_created = None
    for m in reversed(messages):
        last_created = parse_date(m.get("createdAt"))
        if last_created:
            break
    if last_created:
        idle_days = (now() - last_created).total_seconds() / 86400
        if idle_days >= 3:
            risk_signals.append(f"Group chat has been inactive for {int(idle_days)} day(s).")

    evidence = [
        make_evidence("chat", None, f"{len(messages)} group chat message(s) analyzed.", impact="neutral"),
    ]
    for b in blockers[:5]:
        evidence.append(make_evidence("chat", None, f"Blocker mentioned: \"{b['text'][:80]}\"", b.get("createdAt"), "negative"))
    for p in progress_updates[:5]:
        evidence.append(make_evidence("chat", None, f"Progress update: \"{p['text'][:80]}\"", p.get("createdAt"), "positive"))

    summary = (
        f"{len(messages)} group message(s) reviewed: {len(progress_updates)} progress update(s), "
        f"{len(blockers)} blocker mention(s), {len(unanswered_questions)} unanswered question(s)."
    )

    return {
        "scope": "group_chat_only",
        "privateChatAnalysed": False,
        "status": "ok",
        "summary": summary,
        "progressUpdates": progress_updates[:20],
        "blockers": blockers[:20],
        "unansweredQuestions": [
            {"sender": q["sender"], "text": q["text"], "createdAt": q["createdAt"]} for q in unanswered_questions[:20]
        ],
        "taskDiscussions": dedupe([d["text"] for d in task_discussions])[:20],
        "collaborationObservations": dedupe(collaboration_observations),
        "riskSignals": dedupe(risk_signals),
        "evidence": evidence,
        "generatedAt": now().isoformat(),
    }
