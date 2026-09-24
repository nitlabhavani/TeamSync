"""
STEP 17 — Feature 2: AI-Expanded Task Description.

Turns a guide-entered task title (+ optional short description) into a
structured draft: a fuller description, suggested subtasks, and acceptance
criteria — the same "swap point" shape as planning/projectPlanner.py.

IMPORTANT — deliberately rule-based/deterministic (keyword + heuristic
driven), NOT machine learning, for the same reason projectPlanner.py is:
there is no trained model or dataset for this yet. `_detect_domain` is the
natural place a real NLP/LLM step would later plug in without changing this
module's output shape, the Flask route, or anything downstream.

This module NEVER fabricates specifics about the group/project it doesn't
have — it only elaborates on the task title/description it was given.
"""
from __future__ import annotations

import re
from typing import Any

MIN_TITLE_WORDS = 1

# Each entry: keywords -> (domain, subtasks, acceptance_criteria, difficulty, effort_hours)
DOMAIN_TEMPLATES = [
    (
        {"login", "signin", "sign in", "auth", "authentication", "signup", "sign up", "register"},
        "auth",
        [
            "Create the {subject} UI",
            "Add form validation",
            "Connect authentication API",
            "Handle loading/error states",
            "Test successful and failed {subject_lower} flows",
        ],
        [
            "User can enter the required credentials",
            "Invalid input shows validation messages",
            "Successful {subject_lower} redirects correctly",
            "Authentication failures are handled gracefully",
            "UI works on desktop and mobile",
        ],
        "MEDIUM",
        (4, 6),
    ),
    (
        {"page", "screen", "view", "ui", "dashboard", "layout"},
        "ui_page",
        [
            "Build the {subject} layout/markup",
            "Wire up the required data/state",
            "Add responsive styling",
            "Handle empty/loading/error states",
            "Test on desktop and mobile viewports",
        ],
        [
            "{subject} renders correctly with real data",
            "Layout is responsive on desktop and mobile",
            "Empty and loading states are handled",
            "No console errors in the browser",
        ],
        "MEDIUM",
        (3, 5),
    ),
    (
        {"api", "endpoint", "route", "backend", "server", "controller"},
        "backend_api",
        [
            "Define the request/response contract",
            "Implement the {subject}",
            "Add input validation",
            "Add error handling and standard error responses",
            "Write basic tests for success and failure cases",
        ],
        [
            "Endpoint returns the documented response shape",
            "Invalid input is rejected with a clear error",
            "Errors follow the project's existing error format",
            "Authorization is enforced where required",
        ],
        "MEDIUM",
        (4, 7),
    ),
    (
        {"database", "schema", "model", "migration", "table", "collection"},
        "data_model",
        [
            "Design the {subject}",
            "Add validation/constraints",
            "Write the migration or seed script if needed",
            "Update any services/queries that read or write this data",
            "Test with representative sample data",
        ],
        [
            "{subject} matches the documented fields/types",
            "Required fields are validated",
            "Existing data/queries are not broken",
        ],
        "MEDIUM",
        (3, 6),
    ),
    (
        {"payment", "checkout", "billing", "stripe", "invoice", "subscription"},
        "payments",
        [
            "Integrate the payment provider for {subject}",
            "Handle success, failure and pending payment states",
            "Add server-side verification (never trust the client alone)",
            "Log/record transactions for audit purposes",
            "Test with sandbox/test payment credentials",
        ],
        [
            "A successful payment is verified server-side, not just client-side",
            "Failed/declined payments show a clear message and do not silently succeed",
            "No raw card details are logged or stored",
            "Sandbox test transactions complete end-to-end",
        ],
        "HIGH",
        (8, 14),
    ),
    (
        {"security", "encrypt", "vulnerability", "penetration", "audit"},
        "security",
        [
            "Scope exactly what {subject} covers",
            "Implement the change with least-privilege in mind",
            "Add/adjust automated checks where feasible",
            "Document the change for the guide/team",
        ],
        [
            "The specific risk described in the title is mitigated",
            "No new secrets/credentials are exposed in code or logs",
            "Change is reviewed before merging",
        ],
        "HIGH",
        (6, 10),
    ),
    (
        {"test", "testing", "qa", "unit test", "integration test"},
        "testing",
        [
            "Identify the cases {subject} needs to cover",
            "Write the tests",
            "Run the full suite and confirm nothing else broke",
            "Document how to run the new tests",
        ],
        [
            "New tests actually fail when the behavior is broken (not a false pass)",
            "Existing tests still pass",
            "Coverage includes at least one failure/edge case, not only the happy path",
        ],
        "LOW",
        (2, 4),
    ),
    (
        {"bug", "fix", "issue", "error", "crash", "broken"},
        "bugfix",
        [
            "Reproduce the issue described by {subject}",
            "Identify the root cause",
            "Apply the fix",
            "Add a regression test so it doesn't come back",
            "Verify the original steps no longer reproduce the issue",
        ],
        [
            "The originally reported behavior no longer occurs",
            "A regression test exists for this bug",
            "No unrelated behavior changed",
        ],
        "LOW",
        (1, 3),
    ),
    (
        {"deploy", "deployment", "ci", "cd", "pipeline", "docker", "infra", "infrastructure"},
        "devops",
        [
            "Define the steps {subject} needs to perform",
            "Implement/configure the pipeline or infra change",
            "Test it against a non-production environment first",
            "Document the rollback plan",
        ],
        [
            "The pipeline/infra change runs successfully end-to-end",
            "There is a documented way to roll back",
            "No secrets are committed to version control",
        ],
        "MEDIUM",
        (3, 6),
    ),
]

GENERIC_SUBTASKS = [
    "Break {subject} down into concrete steps",
    "Implement the core functionality",
    "Handle edge cases and errors",
    "Test the result manually",
]
GENERIC_CRITERIA = [
    "{subject} behaves as described in the task title",
    "No existing functionality is broken",
]


def _clean_subject(title: str) -> str:
    subject = re.sub(r"\s+", " ", title or "").strip()
    return subject or "this task"


def _detect_domain(title: str, description: str) -> tuple[str, list[str], list[str], str, tuple[int, int]] | None:
    """
    SWAP POINT: keyword matching today; a real NLP/LLM classification step
    could replace this without changing anything downstream (same contract:
    domain key + subtask/criteria templates + difficulty + effort range).
    """
    text = f"{title} {description}".lower()
    for keywords, domain, subtasks, criteria, difficulty, effort in DOMAIN_TEMPLATES:
        if any(kw in text for kw in keywords):
            return domain, subtasks, criteria, difficulty, effort
    return None


def _estimate_difficulty_from_length(title: str, description: str) -> str:
    words = len(f"{title} {description}".split())
    if words <= 4:
        return "LOW"
    if words <= 12:
        return "MEDIUM"
    return "HIGH"


def expand_task(payload: dict[str, Any]) -> dict[str, Any]:
    """
    payload: { title: str, description?: str }
    Returns: { description, subtasks[], acceptanceCriteria[], estimatedDifficulty,
               estimatedEffort } — estimatedEffort is always suffixed
    "(AI estimate)" so it is never mistaken for a firm commitment.
    """
    title = str(payload.get("title") or "").strip()
    description = str(payload.get("description") or "").strip()
    subject = _clean_subject(title)
    subject_lower = subject[0].lower() + subject[1:] if subject else subject

    match = _detect_domain(title, description)
    if match:
        domain, subtask_templates, criteria_templates, difficulty, effort_range = match
    else:
        domain = "general"
        subtask_templates = GENERIC_SUBTASKS
        criteria_templates = GENERIC_CRITERIA
        difficulty = _estimate_difficulty_from_length(title, description)
        effort_range = {"LOW": (1, 2), "MEDIUM": (3, 5), "HIGH": (6, 10)}[difficulty]

    fmt = lambda s: s.format(subject=subject, subject_lower=subject_lower)

    base_description = description or f"Build/implement {subject_lower}."
    generated_description = base_description if description else (
        f"{base_description} This covers the core functionality implied by the "
        f"title, validation/error handling, and verifying it works end-to-end."
    )

    lo, hi = effort_range
    return {
        "domain": domain,
        "description": generated_description,
        "subtasks": [fmt(s) for s in subtask_templates],
        "acceptanceCriteria": [fmt(s) for s in criteria_templates],
        "estimatedDifficulty": difficulty,
        "estimatedEffort": f"{lo}-{hi} hours (AI estimate)",
    }
