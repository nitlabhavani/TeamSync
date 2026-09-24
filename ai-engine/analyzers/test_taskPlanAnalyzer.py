"""
STEP 18 — tests for analyzers/taskPlanAnalyzer.generate_task_plan.

Run: python ai-engine/analyzers/test_taskPlanAnalyzer.py
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, ".."))

from analyzers.taskPlanAnalyzer import generate_task_plan

passed = 0


def check(label, fn):
    global passed
    fn()
    passed += 1
    print(f"ok - {label}")


def _assert(cond, msg="assertion failed"):
    if not cond:
        raise AssertionError(msg)


# 1 — returns 3-7 subtasks
def test_subtask_count_in_range():
    r = generate_task_plan({"title": "Login page"})
    _assert(3 <= len(r["subtasks"]) <= 7, f"expected 3-7 subtasks, got {len(r['subtasks'])}")


check("returns between 3 and 7 subtasks", test_subtask_count_in_range)


# 2 — every subtask has the required shape
def test_subtask_shape():
    r = generate_task_plan({"title": "Build settings page"})
    for st in r["subtasks"]:
        _assert(st["title"], "subtask must have a non-empty title")
        _assert(st["difficulty"] in ("LOW", "MEDIUM", "HIGH"), f"bad difficulty: {st['difficulty']}")
        _assert(isinstance(st["estimatedHours"], int) and st["estimatedHours"] >= 1, "estimatedHours must be a positive int")
        _assert("dependsOnIndex" in st, "missing dependsOnIndex")


check("every subtask has title/difficulty/estimatedHours/dependsOnIndex", test_subtask_shape)


# 3 — suggested order/dependencies: first subtask has no dependency, rest form a simple chain
def test_dependency_chain():
    r = generate_task_plan({"title": "Login page"})
    subtasks = r["subtasks"]
    _assert(subtasks[0]["dependsOnIndex"] is None, "first subtask must not depend on anything")
    for i in range(1, len(subtasks)):
        _assert(subtasks[i]["dependsOnIndex"] == i - 1, f"subtask {i} should depend on subtask {i-1}")


check("subtasks form a valid, acyclic suggested order", test_dependency_chain)


# 4 — acceptance criteria present
def test_acceptance_criteria():
    r = generate_task_plan({"title": "Login page"})
    _assert(len(r["acceptanceCriteria"]) > 0, "acceptanceCriteria must not be empty")


check("acceptance criteria are generated", test_acceptance_criteria)


# 5 — testing checklist present and derived from acceptance criteria (not a separate fabrication)
def test_testing_checklist_derived():
    r = generate_task_plan({"title": "Login page"})
    _assert(len(r["testingChecklist"]) == len(r["acceptanceCriteria"]), "testing checklist should map 1:1 to acceptance criteria")
    _assert(all(item.startswith("Verify:") for item in r["testingChecklist"]), "every checklist item should start with 'Verify:'")


check("testing checklist is generated and derived from acceptance criteria", test_testing_checklist_derived)


# 6 — effort always labeled as an AI estimate
def test_effort_labeled():
    r = generate_task_plan({"title": "Payment integration"})
    _assert("AI estimate" in r["estimatedTotalEffort"])


check("total effort is always labeled as an AI estimate", test_effort_labeled)


# 7 — domain reuse: payments vs bugfix differ (proves it's genuinely reusing taskExpansionAnalyzer's domains)
def test_domain_reuse_differs_by_domain():
    bug = generate_task_plan({"title": "Fix crash on logout"})
    pay = generate_task_plan({"title": "Stripe checkout integration"})
    _assert(bug["estimatedDifficulty"] == "LOW")
    _assert(pay["estimatedDifficulty"] == "HIGH")
    _assert(bug["subtasks"][0]["title"] != pay["subtasks"][0]["title"])


check("reuses taskExpansionAnalyzer's domain detection (different domains -> different plans)", test_domain_reuse_differs_by_domain)


# 8 — unrecognized title -> generic, non-fabricated plan
def test_generic_fallback():
    r = generate_task_plan({"title": "Quarterly retrospective notes"})
    _assert(r["domain"] == "general")
    _assert(3 <= len(r["subtasks"]) <= 7)


check("unrecognized title falls back to the generic (non-fabricated) plan", test_generic_fallback)


# 9 — deterministic
def test_deterministic():
    a = generate_task_plan({"title": "Login page", "description": "Add SSO"})
    b = generate_task_plan({"title": "Login page", "description": "Add SSO"})
    _assert(a == b, "identical input must produce identical output")


check("plan generation is deterministic for identical input", test_deterministic)


# 10 — never invents unrelated technology
def test_no_fabricated_tech():
    r = generate_task_plan({"title": "Update documentation"})
    text = " ".join([s["title"] for s in r["subtasks"]] + r["acceptanceCriteria"]).lower()
    for forbidden in ("kubernetes", "graphql", "blockchain", "postgres"):
        _assert(forbidden not in text, f"must not invent unrelated technology: {forbidden}")


check("does not invent technologies/specifics not implied by the title", test_no_fabricated_tech)

print(f"\n{passed} passed")
