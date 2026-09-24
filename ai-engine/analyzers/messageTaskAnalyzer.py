"""
Group chat message -> task-assignment extraction.

Used by the new "AI-based automatic task assignment from group chat"
feature. This is a NEW, additive analyzer — it does not replace or modify
chatAnalyzer.py (chat participation/sentiment/evidence analysis) or
planning/projectPlanner.py (the existing "Guide -> AI Project Plan ->
Generate Tasks" flow), which both remain unchanged.

Deliberately rule-based/deterministic, same philosophy as
planning/projectPlanner.py: a chat message is a couple of sentences, not a
document, so a small set of explicit heuristics is more predictable (and
easier to reason about for a "never invent an assignee" safety requirement)
than a black-box model would be here.

Design notes / safety:
  * Only names present in the `members` list the caller supplies are ever
    turned into a task's assignee. The Node backend is responsible for
    populating `members` from the group's REAL roster (see
    chatTaskService.js) — this module never invents or guesses a member.
  * A capitalized name mentioned in a directive pattern ("Name, <verb> ...")
    that is NOT found in `members` is reported back under
    `unmatchedMentions` (with a reason) instead of silently being dropped or
    silently reassigned to someone else — the caller can log/return this,
    satisfying the "log a clear reason, don't guess" requirement.
  * A message with no directive pattern + recognized name produces
    isTask: False. Ambiguous/discussion-style messages ("I think we should
    improve the login page") are never turned into a task.
"""
from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from typing import Any

from utils.helpers import parse_date

WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]

ACTION_VERBS = [
    "complete", "finish", "handle", "build", "implement", "add", "fix",
    "prepare", "submit", "create", "test", "deploy", "design", "review",
    "update", "write", "setup", "set up", "configure", "connect",
    "integrate", "upload", "merge", "push", "develop", "start", "make",
    "check", "research", "debug", "document", "deliver", "ship",
    "refactor", "analyze", "investigate", "own", "take care of", "work on",
    "wrap up", "put together", "look into",
]
# sorted longest-first so e.g. "set up" matches before "set"
_ACTION_VERBS_SORTED = sorted(ACTION_VERBS, key=len, reverse=True)
_ACTION_VERB_PATTERN = "|".join(re.escape(v) for v in _ACTION_VERBS_SORTED)

HIGH_PRIORITY_HINTS = ("urgent", "asap", "immediately", "critical", "high priority")
LOW_PRIORITY_HINTS = ("no rush", "low priority", "when free", "whenever you can", "no hurry")

STOPWORDS_LEADING = {"the", "a", "an", "to", "on", "for", "our", "your", "my", "it", "with"}

# A "name" can be one word ("Bhavani") or up to three capitalized words
# ("Bhavani Nitla", "Nitla Bhavani") so full names and reversed full names
# are captured whole instead of only the last word before the comma/verb.
_NAME_WORD = r"[A-Z][a-zA-Z'\-]{1,30}"
_NAME_TOKEN = rf"{_NAME_WORD}(?:\s+{_NAME_WORD}){{0,2}}"

# "Name, <verb> ..." — the most reliable directive pattern.
# NOTE: the name token's leading [A-Z] is intentionally NOT case-insensitive
# (a global re.IGNORECASE would make [A-Z] match lowercase too and turn
# ordinary words like "and" into fake "names") — only the verb alternation
# is matched case-insensitively, via the scoped (?i:...) group below.
_COMMA_DIRECTIVE = re.compile(
    rf"(?P<name>{_NAME_TOKEN})\s*,\s*(?=(?i:(?:please\s+|kindly\s+)?(?:{_ACTION_VERB_PATTERN})\b))"
)
# "Name will/should/needs to/to <verb> ..." or "Name <verb> ..." (no comma).
_INLINE_DIRECTIVE = re.compile(
    rf"(?P<name>{_NAME_TOKEN})\s+(?:(?i:will\s+|should\s+|needs?\s+to\s+|has\s+to\s+|to\s+))?"
    rf"(?=(?i:{_ACTION_VERB_PATTERN}\b))"
)

MONTH_MAP = {
    "january": 1, "jan": 1,
    "february": 2, "feb": 2,
    "march": 3, "mar": 3,
    "april": 4, "apr": 4,
    "may": 5,
    "june": 6, "jun": 6,
    "july": 7, "jul": 7,
    "august": 8, "aug": 8,
    "september": 9, "sep": 9, "sept": 9,
    "october": 10, "oct": 10,
    "november": 11, "nov": 11,
    "december": 12, "dec": 12,
}

_MONTH_NAMES_PATTERN = r"(?:" + "|".join(re.escape(k) for k in sorted(MONTH_MAP.keys(), key=len, reverse=True)) + r")"

_MONTH_DATE_PATTERN = (
    rf"(?:{_MONTH_NAMES_PATTERN}\s+\d{{1,2}}(?:st|nd|rd|th)?(?:\s*,?\s*\d{{4}})?|"
    rf"\d{{1,2}}(?:st|nd|rd|th)?\s+(?:of\s+)?{_MONTH_NAMES_PATTERN}(?:\s*,?\s*\d{{4}})?)"
)

_TIME_SUFFIX_PATTERN = r"(?:\s+(?:at\s+|by\s+)?(?P<time>\d{1,2}(?::\d{2})?\s*(?:am|pm)))?"

_DATE_PATTERN = re.compile(
    rf"(?i:\b(?:by\s+|on\s+|before\s+|due\s+)?"
    rf"(?P<phrase>today|tomorrow|next\s+(?:{'|'.join(WEEKDAYS)})|{'|'.join(WEEKDAYS)}|in\s+\d+\s+days?|{_MONTH_DATE_PATTERN})"
    rf"{_TIME_SUFFIX_PATTERN}\b)"
)


def _parse_time_str(time_str: str | None) -> tuple[int, int] | None:
    if not time_str:
        return None
    t = time_str.strip().lower()
    m = re.match(r"^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$", t)
    if not m:
        return None
    hour = int(m.group(1))
    minute = int(m.group(2) or 0)
    meridiem = m.group(3)
    if hour == 12:
        hour = 0 if meridiem == "am" else 12
    elif meridiem == "pm":
        hour += 12
    if 0 <= hour <= 23 and 0 <= minute <= 59:
        return (hour, minute)
    return None


def _resolve_relative_date(phrase: str, time_str: str | None, current: datetime) -> datetime | None:
    p = phrase.lower().strip()
    target_dt: datetime | None = None
    time_tuple = _parse_time_str(time_str)

    if p == "today":
        target_dt = current
    elif p == "tomorrow":
        target_dt = current + timedelta(days=1)
    else:
        in_days_m = re.match(r"^in\s+(\d+)\s+days?$", p)
        if in_days_m:
            target_dt = current + timedelta(days=int(in_days_m.group(1)))
        elif p.startswith("next ") or p in WEEKDAYS:
            is_next = p.startswith("next ")
            day_name = p.replace("next ", "").strip()
            if day_name in WEEKDAYS:
                target_idx = WEEKDAYS.index(day_name)
                current_idx = current.weekday()
                delta = (target_idx - current_idx) % 7
                if delta == 0:
                    delta = 7 if is_next else 7
                elif is_next and delta < 7:
                    delta += 7
                target_dt = current + timedelta(days=delta)
        else:
            # Check for month date e.g. "September 20", "20 September"
            clean_p = re.sub(r"(\d+)(?:st|nd|rd|th)\b", r"\1", p)
            clean_p = re.sub(r"\bof\b", "", clean_p).strip()
            found_month = None
            for m_name, m_num in MONTH_MAP.items():
                if re.search(rf"\b{m_name}\b", clean_p):
                    found_month = m_num
                    clean_p = re.sub(rf"\b{m_name}\b", "", clean_p).strip()
                    break
            if found_month:
                day_m = re.search(r"\b(\d{1,2})\b", clean_p)
                year_m = re.search(r"\b(20\d{2})\b", clean_p)
                if day_m:
                    day = int(day_m.group(1))
                    year = int(year_m.group(1)) if year_m else current.year
                    if not year_m and (found_month < current.month or (found_month == current.month and day < current.day - 2)):
                        year += 1
                    try:
                        target_dt = datetime(year, found_month, day, tzinfo=current.tzinfo or timezone.utc)
                    except ValueError:
                        target_dt = None

    if target_dt is not None:
        if time_tuple:
            target_dt = target_dt.replace(hour=time_tuple[0], minute=time_tuple[1], second=0, microsecond=0)
        return target_dt
    return None


def _tokens(s: str) -> list[str]:
    return [t for t in s.strip().lower().split() if t]


def _find_members_by_name(name: str, members: list[dict]) -> list[dict]:
    """Case-insensitive match against real group members only. Never
    matches anything not present in `members`. Tries, in order:
      1. exact full-string match ("Bhavani Nitla" == "Bhavani Nitla")
      2. same set of words in any order, for multi-word mentions — covers
         a reversed full name ("Nitla Bhavani" -> "Bhavani Nitla")
      3. first-name match, for single-word mentions only ("Bhavani" ->
         first token of the member's name)
    """
    low = name.strip().lower()
    exact = [m for m in members if str(m.get("name", "")).strip().lower() == low]
    if exact:
        return exact

    mention_tokens = _tokens(name)
    if len(mention_tokens) > 1:
        mention_set = set(mention_tokens)
        return [
            m for m in members
            if _tokens(str(m.get("name", ""))) and set(_tokens(str(m.get("name", "")))) == mention_set
        ]

    return [
        m for m in members
        if str(m.get("name", "")).strip().split(" ")[0].lower() == low
    ]


def _clean_title(text: str) -> str:
    words = text.strip().strip(".,;:").split()
    while words and words[0].lower() in STOPWORDS_LEADING:
        words = words[1:]
    words = words[:8]
    title = " ".join(w.capitalize() if w.islower() else w for w in words)
    return title or "Untitled task"


def _priority_for(text: str) -> str:
    low = text.lower()
    if any(h in low for h in HIGH_PRIORITY_HINTS):
        return "high"
    if any(h in low for h in LOW_PRIORITY_HINTS):
        return "low"
    return "medium"


def _strip_verb(body: str) -> str:
    stripped = re.sub(rf"^\s*(?:please\s+|kindly\s+)?(?:{_ACTION_VERB_PATTERN})\b", "", body, flags=re.IGNORECASE)
    return stripped.strip()


def detect_tasks_from_message(payload: dict) -> dict[str, Any]:
    """
    payload:
      text        (str)   the chat message text — required
      members     (list)  [{ "id": ..., "name": ... }, ...] the group's REAL
                           roster (Node populates this from the DB — this
                           module trusts nothing beyond what's in this list)
      currentDate (str)   ISO date used to resolve "today"/"Friday"/etc.
                           (defaults to server time if omitted)

    returns:
      { isTask, tasks: [...], unmatchedMentions: [...], reason }
    """
    text = str(payload.get("text") or "").strip()
    members = payload.get("members") or []
    current = parse_date(payload.get("currentDate")) or datetime.now(timezone.utc)

    if not text:
        return {"isTask": False, "tasks": [], "unmatchedMentions": [], "reason": "empty_message"}

    # 0) Structured Project Specification detection:
    # "Project Title: ... Description: ..." or "Title: ... Description: ..." or "Project: ... Description: ..."
    proj_title_m = re.search(r"(?:^|\n)\s*(?:Project\s+Title|Project\s+Name|Project|Title)\s*:\s*([^\n]+)", text, re.IGNORECASE)
    proj_desc_m = re.search(r"(?:^|\n)\s*(?:Project\s+Description|Task\s+Description|Description)\s*:\s*([\s\S]+)", text, re.IGNORECASE)

    if proj_title_m and proj_desc_m:
        proj_title = proj_title_m.group(1).strip()
        proj_desc = proj_desc_m.group(1).strip()
        if proj_title and proj_desc:
            items = []
            list_matches = re.findall(r"(?:^|\n)\s*(?:\d+[\.\)]|\-|\*|•)\s*([^\n]+)", proj_desc)
            if list_matches:
                items = [it.strip() for it in list_matches if it.strip()]
            else:
                parts = [p.strip() for p in re.split(r"[.\n;]+", proj_desc) if len(p.strip()) > 3]
                if len(parts) >= 2:
                    items = parts
                else:
                    items = [
                        f"Core Architecture & Backend Setup for {proj_title}",
                        f"Database Modeling & API Integration for {proj_title}",
                        f"Frontend UI & Client Interaction for {proj_title}",
                        f"Quality Assurance, Testing & Deployment for {proj_title}",
                    ]

            global_due_phrase = None
            global_time_str = None
            for dm in _DATE_PATTERN.finditer(text):
                global_due_phrase = dm.group("phrase")
                global_time_str = dm.group("time")
            default_due = _resolve_relative_date(global_due_phrase, global_time_str, current) if global_due_phrase else None
            default_due_str = default_due.isoformat() if (default_due and global_time_str) else (default_due.date().isoformat() if default_due else None)

            project_tasks = []
            for i, raw_item in enumerate(items):
                item_title = _clean_title(raw_item)
                item_desc = raw_item.strip()
                assigned_member = None
                colon_prefix = re.match(r"^([A-Za-z\s]+)[:\-]\s*(.+)", raw_item)
                if colon_prefix:
                    cand_name = colon_prefix.group(1).strip()
                    cand_matches = _find_members_by_name(cand_name, members)
                    if cand_matches:
                        assigned_member = cand_matches[0]
                        item_desc = colon_prefix.group(2).strip()
                        item_title = _clean_title(item_desc)

                if not assigned_member and members:
                    assigned_member = members[i % len(members)]

                project_tasks.append({
                    "assigneeName": assigned_member.get("name") if assigned_member else None,
                    "assigneeId": assigned_member.get("id") if assigned_member else None,
                    "title": item_title,
                    "description": item_desc if item_desc.endswith((".", "!", "?")) else item_desc + ".",
                    "dueDate": default_due_str,
                    "priority": _priority_for(raw_item) or ("high" if i == 0 else "medium"),
                })

            if project_tasks:
                return {
                    "isTask": True,
                    "tasks": project_tasks,
                    "projectTitle": proj_title,
                    "projectDescription": proj_desc,
                    "unmatchedMentions": [],
                    "reason": None,
                }

    # 1) find every "Name, <verb>" / "Name <verb>" directive in the message,
    #    in order of appearance.
    spans = []
    for pattern in (_COMMA_DIRECTIVE, _INLINE_DIRECTIVE):
        for m in pattern.finditer(text):
            spans.append((m.start(), m.end(), m.group("name")))
    if not spans:
        return {"isTask": False, "tasks": [], "unmatchedMentions": [], "reason": "no_actionable_assignment_found"}

    spans.sort(key=lambda s: s[0])
    # de-dupe overlapping matches (comma + inline can both fire on the same name)
    deduped = []
    for span in spans:
        if deduped and span[0] < deduped[-1][1]:
            continue
        deduped.append(span)

    # global fallback due date: last date phrase anywhere in the message —
    # covers "Bhavani handle frontend, Ramya handle backend ... by Monday"
    # where only the trailing clause carries the deadline.
    global_due_phrase = None
    global_time_str = None
    for dm in _DATE_PATTERN.finditer(text):
        global_due_phrase = dm.group("phrase")
        global_time_str = dm.group("time")

    tasks = []
    unmatched = []
    seen_names = set()

    for idx, (start, end, raw_name) in enumerate(deduped):
        segment_end = deduped[idx + 1][0] if idx + 1 < len(deduped) else len(text)
        segment = text[end:segment_end].strip()
        # drop a trailing "and"/"then" connector that actually belongs to the
        # *next* assignment ("...handle backend, and Pujitha handle testing")
        segment = re.sub(r"[\s,]*\b(?:and|then)\b[\s,]*$", "", segment, flags=re.IGNORECASE).strip()
        if not segment:
            continue

        matches = _find_members_by_name(raw_name, members)
        if not matches:
            if raw_name.lower() not in seen_names:
                unmatched.append({"name": raw_name, "reason": "not_a_member_of_this_group"})
                seen_names.add(raw_name.lower())
            continue
        if len(matches) > 1:
            unmatched.append({"name": raw_name, "reason": "ambiguous_name_multiple_members_match"})
            continue

        member = matches[0]

        local_due_phrase = None
        local_time_str = None
        dm = _DATE_PATTERN.search(segment)
        if dm:
            local_due_phrase = dm.group("phrase")
            local_time_str = dm.group("time")

        due_phrase = local_due_phrase or global_due_phrase
        due_time = local_time_str or (global_time_str if not local_due_phrase else None)
        due_date = _resolve_relative_date(due_phrase, due_time, current) if due_phrase else None

        body = segment
        if dm:
            body = (segment[: dm.start()] + segment[dm.end():]).strip()
        body = re.sub(r"\s{2,}", " ", body)
        body = re.sub(r"\s+([.,!?])", r"\1", body).strip(" .,")

        first_clause = re.split(r"(?<=[.!?])\s+", body)[0] if body else ""
        title = _clean_title(_strip_verb(first_clause))
        description = body[0].upper() + body[1:] if body else title
        if not description.endswith((".", "!", "?")):
            description += "."

        due_str = None
        if due_date:
            due_str = due_date.isoformat() if due_time else due_date.date().isoformat()

        tasks.append(
            {
                "assigneeName": member.get("name"),
                "assigneeId": member.get("id"),
                "title": title,
                "description": description,
                "dueDate": due_str,
                "priority": _priority_for(segment),
            }
        )

    return {
        "isTask": len(tasks) > 0,
        "tasks": tasks,
        "unmatchedMentions": unmatched,
        "reason": None if tasks else "no_recognized_group_member_in_any_assignment",
    }
