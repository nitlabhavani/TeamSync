/**
 * Standalone tests for STEP 24 — AI Conflict Detection & Resolution.
 * No DB / no server needed — exercises the pure functions in
 * services/conflictDetectionService.js directly, same style as
 * testSprintPlanner.js / testSmartTaskAssignmentService.js.
 *
 * Run: node backend/scripts/testConflictDetection.js
 */
const assert = require("assert");
const {
  normalizeMessage,
  isGroupMessage,
  belongsToGroup,
  detectTaskOwnershipConflict,
  detectConflictingInstructions,
  detectResponsibilityAmbiguity,
  detectDuplicateWork,
  detectUnresolvedBlocker,
  detectDeadlineDisagreement,
  detectPriorityDisagreement,
  detectRepeatedDisagreement,
  detectEscalationRisk,
  classifySeverity,
  buildConflictFingerprint,
  deduplicateConflicts,
  buildResolutionRecommendation,
  shapeForStudent,
  applyLifecycleTransition,
  sanitizeResolutionNote,
} = require("../src/services/conflictDetectionService");

let passed = 0;
const check = (label, fn) => {
  fn();
  passed += 1;
  console.log(`ok - ${label}`);
};

const NOW = new Date("2026-09-02T12:00:00Z");
const minutesFromNow = (n) => new Date(NOW.getTime() + n * 60000);
const daysFromNow = (n) => new Date(NOW.getTime() + n * 86400000);

let seq = 1;
/** Builds an already-normalized message object (as normalizeMessage would produce). */
function msg({ sender, text, at, group = "g1", conversation = null, deleted = false }) {
  return {
    id: `m${seq++}`,
    senderId: sender,
    text,
    lower: text.toLowerCase(),
    createdAt: at || minutesFromNow(seq),
    group: conversation ? null : group,
    conversation,
    deleted,
  };
}

function task(overrides = {}) {
  return {
    id: overrides.id || `t${seq++}`,
    title: overrides.title || "Task",
    status: overrides.status || "todo",
    priority: overrides.priority || "medium",
    due: overrides.due !== undefined ? overrides.due : null,
    assignee: overrides.assignee !== undefined ? overrides.assignee : null,
  };
}

/* =====================================================================
 * A. PRIVACY / GROUP ISOLATION
 * ===================================================================== */

check("A1 — group message is recognized as analyzable", () => {
  const m = msg({ sender: "u1", text: "hello team", group: "g1" });
  assert.strictEqual(isGroupMessage(m), true);
});

check("A2 — private (direct) message is ignored", () => {
  const m = msg({ sender: "u1", text: "hey, ownership stuff", conversation: "u1_u2" });
  assert.strictEqual(isGroupMessage(m), false);
});

check("A3 — a private message never contributes to a detected conflict", () => {
  const claimGroup = msg({ sender: "u1", text: "I will handle the API.", group: "g1" });
  const claimPrivate = msg({ sender: "u2", text: "I am handling the API.", conversation: "u2_u3" });
  const filtered = [claimGroup, claimPrivate].filter(isGroupMessage);
  const conflicts = detectTaskOwnershipConflict(filtered, { tasks: [] });
  // Only one real group-chat claim remains, so there is no second sender to conflict with.
  assert.strictEqual(conflicts.length, 0);
});

check("A4 — a message from a different group is ignored", () => {
  const m = msg({ sender: "u1", text: "anything", group: "g2" });
  assert.strictEqual(belongsToGroup(m, "g1"), false);
});

check("A5 — same-name groups are isolated by groupId, not name", () => {
  const m = msg({ sender: "u1", text: "anything", group: "groupObjectId-AAA" });
  // A second group that a human might call the same display name has a
  // completely different id — isolation must use the id, never a name.
  assert.strictEqual(belongsToGroup(m, "groupObjectId-BBB"), false);
  assert.strictEqual(belongsToGroup(m, "groupObjectId-AAA"), true);
});

check("A6 — missing groupId is rejected, never treated as a match", () => {
  const m = msg({ sender: "u1", text: "anything", group: "g1" });
  assert.strictEqual(belongsToGroup(m, undefined), false);
  assert.strictEqual(belongsToGroup(m, null), false);
});

check("A7 — a claim from another group is excluded even with a matching claim in the target group", () => {
  const inGroup = msg({ sender: "u1", text: "I will handle the API.", group: "g1" });
  const otherGroup = msg({ sender: "u2", text: "I am handling the API.", group: "g2" });
  const filtered = [inGroup, otherGroup].filter((m) => belongsToGroup(m, "g1"));
  const conflicts = detectTaskOwnershipConflict(filtered, { tasks: [] });
  assert.strictEqual(conflicts.length, 0);
});

/* =====================================================================
 * B. OWNERSHIP
 * ===================================================================== */

check("B1 — clear ownership conflict is detected", () => {
  const m1 = msg({ sender: "u1", text: "I will handle the API.", at: minutesFromNow(1) });
  const m2 = msg({ sender: "u2", text: "I am handling the API.", at: minutesFromNow(2) });
  const conflicts = detectTaskOwnershipConflict([m1, m2], { tasks: [] });
  assert.strictEqual(conflicts.length, 1);
  assert.strictEqual(conflicts[0].type, "TASK_OWNERSHIP");
  assert.deepStrictEqual(conflicts[0].involvedUserIds.sort(), ["u1", "u2"]);
});

check("B2 — same person restating ownership is not a conflict", () => {
  const m1 = msg({ sender: "u1", text: "I will handle the API." });
  const m2 = msg({ sender: "u1", text: "I am handling the API." });
  const conflicts = detectTaskOwnershipConflict([m1, m2], { tasks: [] });
  assert.strictEqual(conflicts.length, 0);
});

check("B3 — two owners for the same work conflict", () => {
  const m1 = msg({ sender: "u1", text: "I'll handle the login page." });
  const m2 = msg({ sender: "u2", text: "I am handling the login page." });
  const conflicts = detectTaskOwnershipConflict([m1, m2], { tasks: [] });
  assert.strictEqual(conflicts.length, 1);
});

check("B4 — ownership dispute resolves to a real task ID when one matches", () => {
  const m1 = msg({ sender: "u1", text: "I will handle the API integration." });
  const m2 = msg({ sender: "u2", text: "I am handling the API integration." });
  const t = task({ title: "API Integration" });
  const conflicts = detectTaskOwnershipConflict([m1, m2], { tasks: [t] });
  assert.strictEqual(conflicts[0].relatedTaskId, String(t.id));
});

check("B5 — ownership dispute without a matching task has no relatedTaskId", () => {
  const m1 = msg({ sender: "u1", text: "I will handle the API." });
  const m2 = msg({ sender: "u2", text: "I am handling the API." });
  const conflicts = detectTaskOwnershipConflict([m1, m2], { tasks: [] });
  assert.strictEqual(conflicts[0].relatedTaskId, null);
});

check("B6 — unrelated ownership statements about different work are not flagged", () => {
  const m1 = msg({ sender: "u1", text: "I will handle the API." });
  const m2 = msg({ sender: "u2", text: "I will handle the database." });
  const conflicts = detectTaskOwnershipConflict([m1, m2], { tasks: [] });
  assert.strictEqual(conflicts.length, 0);
});

/* =====================================================================
 * C. CONFLICTING INSTRUCTIONS
 * ===================================================================== */

check("C1 — a direct contradiction is detected", () => {
  const m1 = msg({ sender: "u1", text: "We agreed to use MongoDB.", at: minutesFromNow(1) });
  const m2 = msg({ sender: "u2", text: "No, we decided to use MySQL.", at: minutesFromNow(2) });
  const conflicts = detectConflictingInstructions([m1, m2]);
  assert.strictEqual(conflicts.length, 1);
  assert.strictEqual(conflicts[0].type, "CONFLICTING_INSTRUCTIONS");
});

check("C2 — a normal suggestion/question is ignored, not treated as a conflict", () => {
  const m1 = msg({ sender: "u1", text: "Should we use MongoDB?" });
  const m2 = msg({ sender: "u2", text: "I think MySQL may be better." });
  const conflicts = detectConflictingInstructions([m1, m2]);
  assert.strictEqual(conflicts.length, 0);
});

check("C3 — repeating the original decision does not multiply the same conflict", () => {
  const m1 = msg({ sender: "u1", text: "We will use MongoDB.", at: minutesFromNow(1) });
  const m2 = msg({ sender: "u2", text: "No, we decided to use MySQL.", at: minutesFromNow(2) });
  const m3 = msg({ sender: "u1", text: "We will use MongoDB.", at: minutesFromNow(3) });
  const conflicts = detectConflictingInstructions([m1, m2, m3]);
  assert.strictEqual(conflicts.length, 1);
});

check("C4 — unrelated instruction topics are not incorrectly combined", () => {
  const mongo = msg({ sender: "u1", text: "We will use MongoDB.", at: minutesFromNow(1) });
  const redis = msg({ sender: "u3", text: "We will use Redis.", at: minutesFromNow(2) });
  const contradiction = msg({ sender: "u2", text: "No, we decided to use MySQL.", at: minutesFromNow(3) });
  const conflicts = detectConflictingInstructions([mongo, redis, contradiction]);
  assert.strictEqual(conflicts.length, 1);
  assert.ok(conflicts[0].normalizedIssueKey.includes("mongodb") && conflicts[0].normalizedIssueKey.includes("mysql"));
});

/* =====================================================================
 * D. RESPONSIBILITY AMBIGUITY
 * ===================================================================== */

check("D1 — an assignment dispute is detected", () => {
  const m1 = msg({ sender: "u1", text: "I already assigned it to you." });
  const m2 = msg({ sender: "u2", text: "You never assigned this to me." });
  const conflicts = detectResponsibilityAmbiguity([m1, m2]);
  assert.strictEqual(conflicts.length, 1);
  assert.strictEqual(conflicts[0].normalizedIssueKey, "assignment-dispute");
});

check("D2 — a completion-responsibility dispute is detected", () => {
  const m1 = msg({ sender: "u1", text: "I already completed this." });
  const m2 = msg({ sender: "u2", text: "This is still not done." });
  const conflicts = detectResponsibilityAmbiguity([m1, m2]);
  assert.ok(conflicts.some((c) => c.normalizedIssueKey === "completion-dispute"));
});

check("D3 — a normal clarification question is ignored", () => {
  const m1 = msg({ sender: "u1", text: "Can you check on this task?" });
  const m2 = msg({ sender: "u2", text: "Sure, I'll look at it." });
  const conflicts = detectResponsibilityAmbiguity([m1, m2]);
  assert.strictEqual(conflicts.length, 0);
});

/* =====================================================================
 * E. DUPLICATE WORK
 * ===================================================================== */

check("E1 — overlapping tasks assigned to different members are flagged", () => {
  const t1 = task({ title: "User Authentication API", assignee: "u1" });
  const t2 = task({ title: "User Authentication Service", assignee: "u2" });
  const conflicts = detectDuplicateWork([t1, t2]);
  assert.strictEqual(conflicts.length, 1);
  assert.strictEqual(conflicts[0].type, "DUPLICATE_WORK");
});

check("E2 — clearly separate tasks are not flagged", () => {
  const t1 = task({ title: "User Authentication API", assignee: "u1" });
  const t2 = task({ title: "Payment Gateway Integration", assignee: "u2" });
  const conflicts = detectDuplicateWork([t1, t2]);
  assert.strictEqual(conflicts.length, 0);
});

check("E3 — the same member on overlapping tasks is not incorrectly flagged", () => {
  const t1 = task({ title: "User Authentication API", assignee: "u1" });
  const t2 = task({ title: "User Authentication Service", assignee: "u1" });
  const conflicts = detectDuplicateWork([t1, t2]);
  assert.strictEqual(conflicts.length, 0);
});

/* =====================================================================
 * F. BLOCKERS
 * ===================================================================== */

check("F1 — a repeated blocker is detected", () => {
  const m1 = msg({ sender: "u1", text: "The frontend is blocked because of the API.", at: minutesFromNow(1) });
  const m2 = msg({ sender: "u2", text: "Still waiting for the API.", at: minutesFromNow(2) });
  const conflicts = detectUnresolvedBlocker([m1, m2], { tasks: [] });
  assert.strictEqual(conflicts.length, 1);
  assert.strictEqual(conflicts[0].type, "UNRESOLVED_BLOCKER");
});

check("F2 — a one-time blocker mention alone is not flagged", () => {
  const m1 = msg({ sender: "u1", text: "The frontend is blocked because of the API." });
  const conflicts = detectUnresolvedBlocker([m1], { tasks: [] });
  assert.strictEqual(conflicts.length, 0);
});

check("F3 — a resolved blocker is not reopened", () => {
  const m1 = msg({ sender: "u1", text: "The frontend is blocked because of the API.", at: minutesFromNow(1) });
  const m2 = msg({ sender: "u2", text: "Still waiting for the API.", at: minutesFromNow(2) });
  const m3 = msg({ sender: "u3", text: "The API is ready now.", at: minutesFromNow(3) });
  const conflicts = detectUnresolvedBlocker([m1, m2, m3], { tasks: [] });
  assert.strictEqual(conflicts.length, 0);
});

check("F4 — a blocker ties to an actual existing task when one matches", () => {
  const t = task({ title: "API Integration" });
  const m1 = msg({ sender: "u1", text: "We are blocked because of the API integration.", at: minutesFromNow(1) });
  const m2 = msg({ sender: "u2", text: "Still waiting for the API integration.", at: minutesFromNow(2) });
  const conflicts = detectUnresolvedBlocker([m1, m2], { tasks: [t] });
  assert.strictEqual(conflicts[0].relatedTaskId, String(t.id));
});

/* =====================================================================
 * G. DEADLINES
 * ===================================================================== */

check("G1 — conflicting deadline claims are detected", () => {
  const m1 = msg({ sender: "u1", text: "The deadline is Friday." });
  const m2 = msg({ sender: "u2", text: "No, the due date is Wednesday." });
  const conflicts = detectDeadlineDisagreement([m1, m2], { tasks: [] });
  assert.strictEqual(conflicts.length, 1);
  assert.strictEqual(conflicts[0].type, "DEADLINE_DISAGREEMENT");
});

check("G2 — the stored Task due date is preferred as source of truth", () => {
  const dueDate = daysFromNow(5);
  const t = task({ title: "Login UI", due: dueDate });
  const m1 = msg({ sender: "u1", text: "Login UI deadline is Friday." });
  const m2 = msg({ sender: "u2", text: "No, Login UI due date is Wednesday." });
  const conflicts = detectDeadlineDisagreement([m1, m2], { tasks: [t] });
  assert.strictEqual(conflicts[0].storedDueDate.getTime(), dueDate.getTime());
});

check("G3 — no due date is fabricated when no task matches", () => {
  const m1 = msg({ sender: "u1", text: "The deadline is Friday." });
  const m2 = msg({ sender: "u2", text: "No, the due date is Wednesday." });
  const conflicts = detectDeadlineDisagreement([m1, m2], { tasks: [] });
  assert.strictEqual(conflicts[0].storedDueDate, null);
});

check("G4 — unrelated date mentions with no deadline keyword are ignored", () => {
  const m1 = msg({ sender: "u1", text: "I'll be free on Friday." });
  const m2 = msg({ sender: "u2", text: "Let's meet Wednesday." });
  const conflicts = detectDeadlineDisagreement([m1, m2], { tasks: [] });
  assert.strictEqual(conflicts.length, 0);
});

/* =====================================================================
 * H. PRIORITY
 * ===================================================================== */

check("H1 — conflicting priority claims are detected", () => {
  const t1 = task({ title: "Login Page", priority: "high" });
  const t2 = task({ title: "Payment Integration", priority: "medium" });
  const m1 = msg({ sender: "u1", text: "Login Page is the highest priority." });
  const m2 = msg({ sender: "u2", text: "Payment Integration is the top priority." });
  const conflicts = detectPriorityDisagreement([m1, m2], { tasks: [t1, t2] });
  assert.strictEqual(conflicts.length, 1);
  assert.strictEqual(conflicts[0].type, "PRIORITY_DISAGREEMENT");
});

check("H2 — the stored task priority values are preserved, not overridden", () => {
  const t1 = task({ title: "Login Page", priority: "high" });
  const t2 = task({ title: "Payment Integration", priority: "medium" });
  const m1 = msg({ sender: "u1", text: "Login Page is the highest priority." });
  const m2 = msg({ sender: "u2", text: "Payment Integration is the top priority." });
  const conflicts = detectPriorityDisagreement([m1, m2], { tasks: [t1, t2] });
  assert.strictEqual(conflicts[0].storedPriorities[String(t1.id)], "high");
  assert.strictEqual(conflicts[0].storedPriorities[String(t2.id)], "medium");
});

check("H3 — normal discussion without explicit priority claims is ignored", () => {
  const t1 = task({ title: "Login Page" });
  const m1 = msg({ sender: "u1", text: "I think login is quite important." });
  const m2 = msg({ sender: "u2", text: "Payment is also important." });
  const conflicts = detectPriorityDisagreement([m1, m2], { tasks: [t1] });
  assert.strictEqual(conflicts.length, 0);
});

/* =====================================================================
 * I. REPEATED DISAGREEMENT
 * ===================================================================== */

check("I1 — repeated unresolved disagreement is detected", () => {
  const m1 = msg({ sender: "u1", text: "No, that's not right." });
  const m2 = msg({ sender: "u2", text: "I disagree with that." });
  const m3 = msg({ sender: "u1", text: "That's wrong, we need to redo it." });
  const conflicts = detectRepeatedDisagreement([m1, m2, m3]);
  assert.strictEqual(conflicts.length, 1);
  assert.strictEqual(conflicts[0].type, "REPEATED_DISAGREEMENT");
});

check("I2 — a single or two-message healthy debate is not flagged", () => {
  const m1 = msg({ sender: "u1", text: "No, that's not right." });
  const m2 = msg({ sender: "u2", text: "I disagree with that." });
  const conflicts = detectRepeatedDisagreement([m1, m2]);
  assert.strictEqual(conflicts.length, 0);
});

check("I3 — additional evidence does not multiply the same disagreement conflict", () => {
  const m1 = msg({ sender: "u1", text: "No, that's not right." });
  const m2 = msg({ sender: "u2", text: "I disagree with that." });
  const m3 = msg({ sender: "u1", text: "That's wrong, we need to redo it." });
  const m4 = msg({ sender: "u2", text: "Incorrect, please redo it." });
  const conflicts = detectRepeatedDisagreement([m1, m2, m3, m4]);
  assert.strictEqual(conflicts.length, 1);
});

/* =====================================================================
 * J. ESCALATION RISK
 * ===================================================================== */

check("J1 — a repeated, multi-member unresolved issue escalates", () => {
  const candidate = {
    type: "UNRESOLVED_BLOCKER",
    involvedUserIds: ["u1", "u2"],
    sourceMessageIds: ["m1", "m2", "m3"],
    relatedTaskId: null,
  };
  const escalation = detectEscalationRisk([candidate], { tasks: [], now: NOW });
  assert.strictEqual(escalation.length, 1);
  assert.strictEqual(escalation[0].type, "ESCALATION_RISK");
});

check("J2 — a multi-member conflict tied to an imminent deadline escalates even with little evidence", () => {
  const t = task({ due: daysFromNow(1) });
  const candidate = {
    type: "REPEATED_DISAGREEMENT",
    involvedUserIds: ["u1", "u2"],
    sourceMessageIds: ["m1", "m2"],
    relatedTaskId: t.id,
  };
  const escalation = detectEscalationRisk([candidate], { tasks: [t], now: NOW });
  assert.strictEqual(escalation.length, 1);
});

check("J3 — emotional wording alone (no structural repeat/impact signal) does not create escalation risk", () => {
  // Escalation only ever looks at structural fields (type/members/evidence
  // count/deadline) — it never inspects message text/tone at all, so an
  // "emotional" ownership-type candidate with only one involved member
  // cannot escalate.
  const candidate = { type: "TASK_OWNERSHIP", involvedUserIds: ["u1"], sourceMessageIds: ["m1"], relatedTaskId: null };
  const escalation = detectEscalationRisk([candidate], { tasks: [], now: NOW });
  assert.strictEqual(escalation.length, 0);
});

/* =====================================================================
 * K. DEDUPLICATION
 * ===================================================================== */

check("K1 — the same conflict fingerprint deduplicates repeated detections", () => {
  const c1 = { type: "TASK_OWNERSHIP", involvedUserIds: ["u1", "u2"], relatedTaskId: "t1", normalizedIssueKey: "api", sourceMessageIds: ["m1"], evidence: ["e1"] };
  const c2 = { type: "TASK_OWNERSHIP", involvedUserIds: ["u1", "u2"], relatedTaskId: "t1", normalizedIssueKey: "api", sourceMessageIds: ["m2"], evidence: ["e2"] };
  const result = deduplicateConflicts([c1, c2], "g1");
  assert.strictEqual(result.length, 1);
});

check("K2 — different related tasks remain separate conflicts", () => {
  const c1 = { type: "TASK_OWNERSHIP", involvedUserIds: ["u1", "u2"], relatedTaskId: "t1", normalizedIssueKey: "api", sourceMessageIds: ["m1"], evidence: [] };
  const c2 = { type: "TASK_OWNERSHIP", involvedUserIds: ["u1", "u2"], relatedTaskId: "t2", normalizedIssueKey: "api", sourceMessageIds: ["m2"], evidence: [] };
  const result = deduplicateConflicts([c1, c2], "g1");
  assert.strictEqual(result.length, 2);
});

check("K3 — different groups produce different fingerprints", () => {
  const fpA = buildConflictFingerprint({ groupId: "g1", type: "TASK_OWNERSHIP", involvedUserIds: ["u1", "u2"], relatedTaskId: "t1", normalizedIssueKey: "api" });
  const fpB = buildConflictFingerprint({ groupId: "g2", type: "TASK_OWNERSHIP", involvedUserIds: ["u1", "u2"], relatedTaskId: "t1", normalizedIssueKey: "api" });
  assert.notStrictEqual(fpA, fpB);
});

check("K4 — new evidence merges into (updates) the existing conflict rather than being dropped", () => {
  const c1 = { type: "UNRESOLVED_BLOCKER", involvedUserIds: ["u1", "u2"], relatedTaskId: null, normalizedIssueKey: "api", sourceMessageIds: ["m1"], evidence: ["first mention"] };
  const c2 = { type: "UNRESOLVED_BLOCKER", involvedUserIds: ["u1", "u2"], relatedTaskId: null, normalizedIssueKey: "api", sourceMessageIds: ["m2"], evidence: ["second mention"] };
  const result = deduplicateConflicts([c1, c2], "g1");
  assert.strictEqual(result.length, 1);
  assert.deepStrictEqual(result[0].sourceMessageIds.sort(), ["m1", "m2"]);
  assert.deepStrictEqual(result[0].evidence.sort(), ["first mention", "second mention"]);
});

/* =====================================================================
 * L. SEVERITY
 * ===================================================================== */

check("L1 — low severity: no task, single member, no repeated evidence", () => {
  const c = { type: "TASK_OWNERSHIP", involvedUserIds: ["u1"], sourceMessageIds: ["m1"] };
  assert.strictEqual(classifySeverity(c, { task: null, now: NOW }), "LOW");
});

check("L2 — medium severity: tied to a real task with no urgent date", () => {
  const t = task({ due: daysFromNow(30) });
  const c = { type: "TASK_OWNERSHIP", involvedUserIds: ["u1"], sourceMessageIds: ["m1"] };
  assert.strictEqual(classifySeverity(c, { task: t, now: NOW }), "MEDIUM");
});

check("L3 — high severity: tied task is overdue (single member)", () => {
  const t = task({ due: daysFromNow(-2) });
  const c = { type: "DEADLINE_DISAGREEMENT", involvedUserIds: ["u1"], sourceMessageIds: ["m1"] };
  assert.strictEqual(classifySeverity(c, { task: t, now: NOW }), "HIGH");
});

check("L4 — critical severity: overdue task AND multiple members involved", () => {
  const t = task({ due: daysFromNow(-2) });
  const c = { type: "TASK_OWNERSHIP", involvedUserIds: ["u1", "u2"], sourceMessageIds: ["m1"] };
  assert.strictEqual(classifySeverity(c, { task: t, now: NOW }), "CRITICAL");
});

check("L5 — ESCALATION_RISK is always CRITICAL regardless of other fields", () => {
  const c = { type: "ESCALATION_RISK", involvedUserIds: ["u1"], sourceMessageIds: ["m1"] };
  assert.strictEqual(classifySeverity(c, { task: null, now: NOW }), "CRITICAL");
});

/* =====================================================================
 * M. STUDENT SAFETY
 * ===================================================================== */

check("M1 — student-safe output contains only the documented safe fields", () => {
  const conflict = {
    id: "c1",
    type: "TASK_OWNERSHIP",
    severity: "MEDIUM",
    relatedTaskId: "t1",
    title: "Task ownership unclear",
    summary: "safe summary",
    recommendation: "guide-only recommendation text",
    evidence: ["guide-only evidence"],
    involvedUserIds: ["u1", "u2"],
    nextAction: "Confirm task owner",
  };
  const shaped = shapeForStudent(conflict, "u1");
  assert.deepStrictEqual(Object.keys(shaped).sort(), ["conflictId", "nextAction", "relatedTaskId", "severity", "summary", "title", "type"].sort());
});

check("M2 — private/internal evidence and recommendation never appear in the student view", () => {
  const conflict = {
    id: "c1",
    type: "TASK_OWNERSHIP",
    severity: "MEDIUM",
    relatedTaskId: "t1",
    title: "t",
    summary: "s",
    recommendation: "guide-only",
    evidence: ["guide-only evidence"],
    involvedUserIds: ["u1"],
    nextAction: "n",
  };
  const shaped = shapeForStudent(conflict, "u1");
  assert.strictEqual(shaped.evidence, undefined);
  assert.strictEqual(shaped.recommendation, undefined);
  assert.strictEqual(shaped.involvedUserIds, undefined);
});

check("M3 — a member not involved in the conflict gets no data at all", () => {
  const conflict = { id: "c1", type: "TASK_OWNERSHIP", severity: "LOW", involvedUserIds: ["u1", "u2"], title: "t", summary: "s", nextAction: "n" };
  const shaped = shapeForStudent(conflict, "u3");
  assert.strictEqual(shaped, null);
});

/* =====================================================================
 * N. RESOLUTION LIFECYCLE
 * ===================================================================== */

check("N1 — OPEN -> ACKNOWLEDGED is a valid transition", () => {
  const result = applyLifecycleTransition("OPEN", "acknowledge");
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.status, "ACKNOWLEDGED");
});

check("N2 — ACKNOWLEDGED -> RESOLVED is a valid transition", () => {
  const result = applyLifecycleTransition("ACKNOWLEDGED", "resolve");
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.status, "RESOLVED");
});

check("N3 — OPEN -> DISMISSED is a valid transition", () => {
  const result = applyLifecycleTransition("OPEN", "dismiss");
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.status, "DISMISSED");
});

check("N4 — a resolution note is stored exactly as entered (trimmed), never fabricated", () => {
  assert.strictEqual(sanitizeResolutionNote("  Guide confirmed Bhavani as API owner.  "), "Guide confirmed Bhavani as API owner.");
  assert.strictEqual(sanitizeResolutionNote(undefined), "");
  assert.strictEqual(sanitizeResolutionNote(null), "");
});

check("N5 — resolving an already-resolved conflict is rejected, and the transition never touches evidence", () => {
  const again = applyLifecycleTransition("RESOLVED", "resolve");
  assert.strictEqual(again.ok, false);
  const ok = applyLifecycleTransition("OPEN", "resolve");
  assert.strictEqual(Object.prototype.hasOwnProperty.call(ok, "evidence"), false);
});

console.log(`\n${passed} passed, 0 failed`);
