"""
STEP 17 — Feature 2: tests for analyzers/taskExpansionAnalyzer.expand_task.

Run: python ai-engine/analyzers/test_taskExpansionAnalyzer.py
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, ".."))  # allow `utils.*` import like app.py does

from analyzers.taskExpansionAnalyzer import expand_task

passed = 0


def check(label, fn):
    global passed
    fn()
    passed += 1
    print(f"ok - {label}")


def _assert(cond, msg):
    if not cond:
        raise AssertionError(msg)


# 1 — short task title produces a structured draft
def test_short_title_structured_draft():
    r = expand_task({"title": "Login page"})
    _assert(r["description"], "description must not be empty")
    _assert(len(r["subtasks"]) > 0, "subtasks must not be empty")
    _assert(len(r["acceptanceCriteria"]) > 0, "acceptanceCriteria must not be empty")


check("short task title produces a structured draft", test_short_title_structured_draft)


# 2 — title + existing description: description is preserved, not discarded
def test_preserves_existing_description():
    r = expand_task({"title": "Login page", "description": "Custom guide-written description."})
    _assert(r["description"] == "Custom guide-written description.", "must preserve the guide's own description text")


check("title + existing description is preserved verbatim", test_preserves_existing_description)


# 3 — structured output has all required keys
def test_structured_output():
    r = expand_task({"title": "Build settings page"})
    for key in ("description", "subtasks", "acceptanceCriteria", "estimatedDifficulty", "estimatedEffort"):
        _assert(key in r, f"missing key: {key}")


check("structured output contains all required fields", test_structured_output)


# 4 — multiple subtasks
def test_multiple_subtasks():
    r = expand_task({"title": "Login page"})
    _assert(len(r["subtasks"]) >= 3, f"expected several subtasks, got {len(r['subtasks'])}")


check("returns multiple subtasks for a recognized domain", test_multiple_subtasks)


# 5 — acceptance criteria present and domain-relevant
def test_acceptance_criteria_relevant():
    r = expand_task({"title": "Login page"})
    joined = " ".join(r["acceptanceCriteria"]).lower()
    _assert("valid" in joined or "credential" in joined, "auth-domain criteria should mention validation/credentials")


check("acceptance criteria are relevant to the detected domain", test_acceptance_criteria_relevant)


# 6 — effort is always labeled as an AI estimate, never presented as exact
def test_effort_labeled():
    r = expand_task({"title": "Payment integration"})
    _assert("AI estimate" in r["estimatedEffort"], "effort must be labeled as an AI estimate")
    _assert(r["estimatedDifficulty"] in ("LOW", "MEDIUM", "HIGH", "UNKNOWN"), "difficulty must be a known label")


check("effort is always labeled as an AI estimate, never exact", test_effort_labeled)


# 7 — domain detection differentiates categories (bugfix vs payments)
def test_domain_differentiation():
    bug = expand_task({"title": "Fix crash on logout"})
    pay = expand_task({"title": "Stripe checkout integration"})
    _assert(bug["estimatedDifficulty"] == "LOW", "a simple bugfix should be scored LOW effort/difficulty")
    _assert(pay["estimatedDifficulty"] == "HIGH", "payment integration should be scored HIGH difficulty")
    _assert(bug["subtasks"] != pay["subtasks"], "different domains must not produce identical subtasks")


check("different task domains produce different templates", test_domain_differentiation)


# 8 — no keyword match -> generic fallback template, not fabricated specifics
def test_generic_fallback_template():
    r = expand_task({"title": "Quarterly retrospective notes"})
    _assert(r["domain"] == "general", "unmatched title should use the generic template")
    _assert(len(r["subtasks"]) > 0, "generic template must still return non-empty subtasks")


check("unrecognized title falls back to the generic (non-fabricated) template", test_generic_fallback_template)


# 9 — never claims a specific skill/technology not implied by the title
def test_no_fabricated_specifics():
    r = expand_task({"title": "Update documentation"})
    text = " ".join(r["subtasks"] + r["acceptanceCriteria"]).lower()
    for forbidden in ("kubernetes", "graphql", "react native", "postgres"):
        _assert(forbidden not in text, f"must not invent unrelated technology: {forbidden}")


check("does not invent technologies/specifics not implied by the title", test_no_fabricated_specifics)


# 10 — deterministic: same input -> same output every time
def test_deterministic():
    a = expand_task({"title": "Login page", "description": "Add SSO"})
    b = expand_task({"title": "Login page", "description": "Add SSO"})
    _assert(a == b, "identical input must produce identical output")


check("expansion is deterministic for identical input", test_deterministic)

print(f"\n{passed} passed")
