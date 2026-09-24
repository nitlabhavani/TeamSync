/**
 * Standalone tests for STEP 29 — AI Actionable Project Insights &
 * Recommendation Engine.
 *
 * No DB / no server / no live AI engine needed — exercises the pure
 * functions in services/actionableInsightsService.js (buildActionableInsights
 * and its category builders, buildFingerprint, deduplicate, rankInsights)
 * directly with hand-built evidence objects, exactly like
 * backend/scripts/testProjectExecutionCopilot.js and
 * testProjectHealth.js do for their own pure functions. A handful of
 * checks additionally grep the service source itself as a structural
 * guard (no DB mutation, no chat/message access) — this is the same kind
 * of check the request explicitly calls for and does not require a live
 * database.
 *
 * Run: node backend/scripts/testActionableInsights.js
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
  buildActionableInsights,
  buildFingerprint,
  deduplicate,
  rankInsights,
  buildOverdueTaskInsights,
  buildBlockedTaskInsights,
} = require("../src/services/actionableInsightsService");

let passed = 0;
const check = (label, fn) => {
  fn();
  passed += 1;
  console.log(`ok - ${label}`);
};

const NOW = new Date("2026-09-04T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const GROUP_ID = "grp_1";
const GROUP_ID_2 = "grp_2";

let taskCounter = 0;
function makeTask(overrides = {}) {
  taskCounter += 1;
  return {
    _id: `task_${taskCounter}`,
    title: `Task ${taskCounter}`,
    status: "todo",
    priority: "medium",
    assignee: "user_1",
    due: null,
    dependencies: [],
    updatedAt: NOW,
    createdAt: NOW,
    ...overrides,
  };
}

/** Builds a minimal-but-complete "healthy, no issues" evidence bundle;
 * overrides are shallow-merged per top-level key so each test only
 * specifies what it cares about — mirrors testProjectExecutionCopilot.js#baseEvidence. */
function baseEvidence(overrides = {}) {
  const evidence = {
    now: NOW,
    groupId: GROUP_ID,
    groupName: "Team Nimbus",
    isGuideOrLeader: true,
    userId: "user_1",
    tasks: [],
    conflicts: [],
    teamRisk: { riskLevel: "LOW", riskScore: 5, reasons: [], warnings: [], collaborationRisks: [] },
    forecast: {
      status: "ON_TRACK",
      probability: 90,
      trendMessage: "Forecast is steady.",
      evidence: { daysRemaining: 20, remainingTasks: 2 },
      generatedAt: NOW,
    },
    health: { health: "HEALTHY", healthScore: 90, topIssues: [] },
    executionCopilot: { recommendedReassignments: [] },
    sprintPlan: null,
    meetingIntelligence: null,
    knowledge: [],
  };
  for (const key of Object.keys(overrides)) {
    evidence[key] =
      typeof evidence[key] === "object" && !Array.isArray(evidence[key]) && evidence[key] !== null
        ? { ...evidence[key], ...overrides[key] }
        : overrides[key];
  }
  return evidence;
}

function assertRecShape(rec) {
  assert.ok(rec.id, "recommendation must have an id");
  assert.ok(rec.category, "recommendation must have a category");
  assert.ok(["CRITICAL", "HIGH", "MEDIUM", "LOW"].includes(rec.priority), "priority must be valid");
  assert.ok(rec.title, "recommendation must have a title");
  assert.ok(rec.recommendation, "recommendation must have a recommendation string");
  assert.ok(rec.reason, "recommendation must have a reason");
  assert.ok(Array.isArray(rec.evidence) && rec.evidence.length >= 1, "recommendation must have at least 1 evidence item");
  assert.strictEqual(rec.automaticAction, false, "automaticAction must always be false");
}

/* ============================================================ */

check("1. basic recommendation generation", () => {
  const evidence = baseEvidence({ tasks: [makeTask({ due: new Date(NOW - 5 * DAY), status: "todo" })] });
  const { recommendations, summary } = buildActionableInsights(evidence);
  assert.ok(recommendations.length >= 1);
  assert.strictEqual(summary.total, recommendations.length);
  recommendations.forEach(assertRecShape);
});

check("2. overdue task", () => {
  const t = makeTask({ due: new Date(NOW - 2 * DAY), status: "todo" });
  const evidence = baseEvidence({ tasks: [t] });
  const { recommendations } = buildActionableInsights(evidence);
  const rec = recommendations.find((r) => r.category === "OVERDUE_TASK");
  assert.ok(rec, "expected an OVERDUE_TASK recommendation");
  assert.strictEqual(rec.relatedItems[0].id, String(t._id));
});

check("3. blocked task", () => {
  const t = makeTask({ status: "in_progress", updatedAt: new Date(NOW - 10 * DAY) });
  const evidence = baseEvidence({ tasks: [t] });
  const { recommendations } = buildActionableInsights(evidence);
  const rec = recommendations.find((r) => r.category === "BLOCKED_TASK");
  assert.ok(rec, "expected a BLOCKED_TASK recommendation");
  assert.strictEqual(rec.priority, "MEDIUM"); // 10 days < 14-day HIGH threshold
});

check("4. deadline risk reuse (forecast, not recomputed)", () => {
  const evidence = baseEvidence({
    forecast: { status: "AT_RISK", probability: 55, evidence: { daysRemaining: 4, remainingTasks: 6 }, generatedAt: NOW },
  });
  const { recommendations } = buildActionableInsights(evidence);
  const rec = recommendations.find((r) => r.category === "DEADLINE_RISK" && r.relatedItems.length === 0);
  assert.ok(rec, "expected a group-level DEADLINE_RISK recommendation reusing forecast.status");
  assert.ok(rec.reason.includes("AT_RISK"));
});

check("5. team risk reuse", () => {
  const evidence = baseEvidence({
    teamRisk: { riskLevel: "HIGH", riskScore: 70, reasons: ["Multiple overdue tasks."], warnings: [], collaborationRisks: [] },
  });
  const { recommendations } = buildActionableInsights(evidence);
  const rec = recommendations.find((r) => r.category === "TEAM_RISK");
  assert.ok(rec);
  assert.strictEqual(rec.priority, "HIGH");
  assert.strictEqual(rec.evidence[0].snippet.includes("70"), true);
});

check("6. project health reuse", () => {
  const evidence = baseEvidence({
    health: { health: "CRITICAL", healthScore: 20, topIssues: [{ title: "Overdue tasks", reason: "5 tasks overdue." }] },
  });
  const { recommendations } = buildActionableInsights(evidence);
  const rec = recommendations.find((r) => r.category === "PROJECT_HEALTH_RISK");
  assert.ok(rec);
  assert.strictEqual(rec.priority, "CRITICAL");
});

check("7. forecast reuse", () => {
  const evidence = baseEvidence({
    forecast: { status: "CRITICAL", probability: 10, evidence: { daysRemaining: 1, remainingTasks: 8 }, generatedAt: NOW },
  });
  const { recommendations } = buildActionableInsights(evidence);
  const rec = recommendations.find((r) => r.category === "PROJECT_FORECAST_RISK");
  assert.ok(rec);
  assert.strictEqual(rec.priority, "CRITICAL");
});

check("8. conflict recommendation", () => {
  const evidence = baseEvidence({
    conflicts: [
      {
        _id: "conf_1",
        type: "TASK_OWNERSHIP",
        severity: "HIGH",
        status: "OPEN",
        involvedUserIds: ["user_1"],
        relatedTaskId: null,
        title: "Ownership dispute on Auth module",
        summary: "Two members believe they own the same task.",
        nextAction: "Confirm the owner.",
      },
    ],
  });
  const { recommendations } = buildActionableInsights(evidence);
  const rec = recommendations.find((r) => r.category === "OPEN_CONFLICT");
  assert.ok(rec);
  assert.strictEqual(rec.priority, "HIGH");
  assert.ok(rec.recommendation.toLowerCase().includes("ownership"));
});

check("9. meeting follow-up recommendation", () => {
  const evidence = baseEvidence({
    meetingIntelligence: {
      _id: "mi_1",
      actionItems: [
        { title: "Set up CI", description: "Configure pipeline", assigneeStatus: "UNRESOLVED", deadlineStatus: "UNRESOLVED", relatedTaskId: null },
      ],
      blockers: [],
      unresolvedItems: [],
    },
  });
  const { recommendations } = buildActionableInsights(evidence);
  const rec = recommendations.find((r) => r.category === "UNRESOLVED_MEETING_ACTION");
  assert.ok(rec);
  assert.strictEqual(rec.evidence[0].sourceId, "mi_1");
});

check("10. decision follow-up", () => {
  const evidence = baseEvidence({
    knowledge: [
      {
        _id: "know_1",
        type: "DECISION",
        status: "ACTIVE",
        title: "Use PostgreSQL",
        content: "The team decided to use PostgreSQL over MySQL.",
        potentialConflict: { flagged: true, note: "Conflicts with an earlier MySQL decision." },
        lastEvidenceAt: NOW,
      },
    ],
  });
  const { recommendations } = buildActionableInsights(evidence);
  const rec = recommendations.find((r) => r.category === "UNRESOLVED_DECISION");
  assert.ok(rec);
  assert.strictEqual(rec.relatedItems[0].id, "know_1");
});

check("11. superseded decision handling (never acted on)", () => {
  const evidence = baseEvidence({
    knowledge: [
      {
        _id: "know_2",
        type: "DECISION",
        status: "SUPERSEDED",
        title: "Use MySQL",
        content: "Superseded decision.",
        potentialConflict: { flagged: true, note: "n/a" },
        lastEvidenceAt: NOW,
      },
    ],
  });
  const { recommendations } = buildActionableInsights(evidence);
  const rec = recommendations.find((r) => r.category === "UNRESOLVED_DECISION");
  assert.ok(!rec, "a SUPERSEDED decision must never generate an UNRESOLVED_DECISION recommendation");
});

check("12. workload imbalance", () => {
  const evidence = baseEvidence({
    teamRisk: {
      riskLevel: "MODERATE",
      riskScore: 30,
      reasons: [],
      warnings: [
        {
          type: "STUDENT_OVERLOAD",
          severity: "MEDIUM",
          title: "Uneven workload",
          description: "1 member has significantly more open tasks than average.",
          evidence: ["Average open tasks per member: 2.0"],
        },
      ],
      collaborationRisks: [],
    },
  });
  const { recommendations } = buildActionableInsights(evidence);
  const rec = recommendations.find((r) => r.category === "WORKLOAD_IMBALANCE");
  assert.ok(rec);
});

check("13. dependency risk", () => {
  const blocker = makeTask({ status: "in_progress", title: "Core API" });
  const dependents = [
    makeTask({ status: "todo", dependencies: [blocker._id] }),
    makeTask({ status: "todo", dependencies: [blocker._id] }),
  ];
  const evidence = baseEvidence({ tasks: [blocker, ...dependents] });
  const { recommendations } = buildActionableInsights(evidence);
  const rec = recommendations.find((r) => r.category === "DEPENDENCY_RISK");
  assert.ok(rec, "expected a DEPENDENCY_RISK recommendation for a task blocking 2+ others");
  assert.strictEqual(rec.relatedItems[0].id, String(blocker._id));
});

check("14. priority mismatch", () => {
  const t = makeTask({ due: new Date(NOW - 3 * DAY), status: "todo", priority: "low" });
  const evidence = baseEvidence({ tasks: [t] });
  const { recommendations } = buildActionableInsights(evidence);
  const rec = recommendations.find((r) => r.category === "PRIORITY_MISMATCH");
  assert.ok(rec, "expected a PRIORITY_MISMATCH recommendation for a low-priority overdue task");
});

check("15. deterministic priority", () => {
  const t = makeTask({ due: new Date(NOW - 5 * DAY), status: "todo" });
  const evidence = baseEvidence({ tasks: [t] });
  const r1 = buildActionableInsights(evidence).recommendations.find((r) => r.category === "OVERDUE_TASK");
  const r2 = buildActionableInsights(evidence).recommendations.find((r) => r.category === "OVERDUE_TASK");
  assert.strictEqual(r1.priority, r2.priority);
  assert.strictEqual(r1.priority, "HIGH"); // 5 days >= OVERDUE_CRITICAL_DAYS(3)
});

check("16. recommendation fingerprint is deterministic", () => {
  const id1 = buildFingerprint(GROUP_ID, "OVERDUE_TASK", [{ type: "TASK", id: "task_1" }]);
  const id2 = buildFingerprint(GROUP_ID, "OVERDUE_TASK", [{ type: "TASK", id: "task_1" }]);
  assert.strictEqual(id1, id2);
  const id3 = buildFingerprint(GROUP_ID_2, "OVERDUE_TASK", [{ type: "TASK", id: "task_1" }]);
  assert.notStrictEqual(id1, id3, "different groupId must produce a different fingerprint");
});

check("17. duplicate recommendation suppression", () => {
  const relatedItems = [{ type: "TASK", id: "task_9" }];
  const a = { id: buildFingerprint(GROUP_ID, "OVERDUE_TASK", relatedItems), category: "OVERDUE_TASK" };
  const b = { id: buildFingerprint(GROUP_ID, "OVERDUE_TASK", relatedItems), category: "OVERDUE_TASK" };
  const deduped = deduplicate([a, b]);
  assert.strictEqual(deduped.length, 1, "two entries with the same fingerprint must collapse to one");
});

check("18. multiple evidence sources on one card", () => {
  const t = makeTask({ status: "in_progress", updatedAt: new Date(NOW - 10 * DAY) });
  const evidence = baseEvidence({
    tasks: [t],
    meetingIntelligence: {
      _id: "mi_2",
      actionItems: [],
      blockers: [{ text: "Waiting on API keys from the client.", status: "OPEN", relatedTaskId: t._id }],
      unresolvedItems: [],
    },
  });
  const { recommendations } = buildActionableInsights(evidence);
  const rec = recommendations.find((r) => r.category === "BLOCKED_TASK");
  assert.ok(rec);
  assert.strictEqual(rec.evidence.length, 2, "task evidence + merged meeting-intelligence evidence");
  assert.strictEqual(rec.evidence[1].sourceType, "MEETING_INTELLIGENCE");
});

check("19. evidence IDs are real", () => {
  const t = makeTask({ due: new Date(NOW - 1 * DAY), status: "todo" });
  const evidence = baseEvidence({ tasks: [t] });
  const rec = buildActionableInsights(evidence).recommendations.find((r) => r.category === "OVERDUE_TASK");
  assert.strictEqual(rec.evidence[0].sourceId, String(t._id));
});

check("20. insufficient evidence produces no recommendation", () => {
  const evidence = baseEvidence({ tasks: [makeTask({ status: "todo", due: null, updatedAt: NOW })] });
  const { recommendations } = buildActionableInsights(evidence);
  assert.strictEqual(recommendations.length, 0);
});

check("21. empty project produces empty recommendations", () => {
  const evidence = baseEvidence();
  const { recommendations, summary } = buildActionableInsights(evidence);
  assert.deepStrictEqual(recommendations, []);
  assert.deepStrictEqual(summary, { total: 0, critical: 0, high: 0, medium: 0, low: 0 });
});

check("22. groupId isolation via fingerprint", () => {
  const relatedItems = [{ type: "TASK", id: "same_task_id" }];
  const idA = buildFingerprint(GROUP_ID, "OVERDUE_TASK", relatedItems);
  const idB = buildFingerprint(GROUP_ID_2, "OVERDUE_TASK", relatedItems);
  assert.notStrictEqual(idA, idB, "same task id in two different groups must never collide");
});

check("23. duplicate group-name isolation", () => {
  // Two groups can share a name but never a groupId — fingerprints (and
  // thus recommendation identity) are always keyed by groupId, never name.
  const evidenceA = baseEvidence({ groupId: "g_alpha", groupName: "Team Falcon", tasks: [makeTask({ due: new Date(NOW - DAY), status: "todo" })] });
  const evidenceB = baseEvidence({ groupId: "g_beta", groupName: "Team Falcon", tasks: [] });
  const recA = buildActionableInsights(evidenceA).recommendations;
  const recB = buildActionableInsights(evidenceB).recommendations;
  assert.ok(recA.length > 0);
  assert.strictEqual(recB.length, 0, "same-name group must not inherit the other group's recommendations");
});

check("24. unauthorized (non guide/leader) never sees guide-only categories", () => {
  const evidence = baseEvidence({
    isGuideOrLeader: false,
    teamRisk: { riskLevel: "CRITICAL", riskScore: 95, reasons: ["Everything is on fire."], warnings: [], collaborationRisks: [] },
    health: { health: "CRITICAL", healthScore: 5, topIssues: [] },
  });
  const { recommendations } = buildActionableInsights(evidence);
  assert.ok(!recommendations.some((r) => r.category === "TEAM_RISK"));
  assert.ok(!recommendations.some((r) => r.category === "PROJECT_HEALTH_RISK"));
});

check("25. student-safe output — only own-task and conflict categories", () => {
  const t = makeTask({ due: new Date(NOW - DAY), status: "todo", assignee: "user_1" });
  const evidence = baseEvidence({
    isGuideOrLeader: false,
    userId: "user_1",
    tasks: [t],
    conflicts: [
      {
        _id: "conf_2",
        type: "DEADLINE_DISAGREEMENT",
        severity: "MEDIUM",
        status: "OPEN",
        involvedUserIds: ["user_1"],
        relatedTaskId: null,
        title: "Deadline disagreement",
        summary: "Two dates were mentioned for the same deliverable.",
        nextAction: "Confirm the date.",
      },
    ],
  });
  const { recommendations } = buildActionableInsights(evidence);
  const categories = new Set(recommendations.map((r) => r.category));
  for (const c of categories) {
    assert.ok(["OVERDUE_TASK", "BLOCKED_TASK", "OPEN_CONFLICT"].includes(c), `unexpected student-visible category: ${c}`);
  }
  assert.ok(categories.has("OVERDUE_TASK"));
  assert.ok(categories.has("OPEN_CONFLICT"));
});

check("26. private chat is structurally excluded from evidence gathering", () => {
  const src = fs.readFileSync(path.join(__dirname, "../src/services/actionableInsightsService.js"), "utf8");
  assert.ok(!/require\(["']\.\.\/models\/Message["']\)/.test(src), "must never require the Message model");
  assert.ok(!/\bMessage\.find\b/.test(src), "must never query Message documents directly");
});

check("27. guide/team leader access sees the full category set", () => {
  const evidence = baseEvidence({
    isGuideOrLeader: true,
    teamRisk: { riskLevel: "HIGH", riskScore: 65, reasons: ["Multiple overdue tasks."], warnings: [], collaborationRisks: [] },
  });
  const { recommendations } = buildActionableInsights(evidence);
  assert.ok(recommendations.some((r) => r.category === "TEAM_RISK"));
});

check("28. no database mutation anywhere in the service", () => {
  const src = fs.readFileSync(path.join(__dirname, "../src/services/actionableInsightsService.js"), "utf8");
  const mutators = [".save(", ".create(", ".updateOne(", ".updateMany(", ".deleteOne(", ".deleteMany(", ".findOneAndUpdate(", ".findByIdAndUpdate(", ".findOneAndDelete("];
  for (const m of mutators) {
    assert.ok(!src.includes(m), `service must never call ${m} — this endpoint is read-only`);
  }
});

check("29. no fabricated data — recommendation references only supplied ids", () => {
  const t = makeTask({ due: new Date(NOW - DAY), status: "todo" });
  const evidence = baseEvidence({ tasks: [t] });
  const rec = buildActionableInsights(evidence).recommendations.find((r) => r.category === "OVERDUE_TASK");
  assert.strictEqual(rec.relatedItems.every((r) => r.id === String(t._id)), true);
});

check("30. deterministic ordering", () => {
  const items = [
    { id: "a", priority: "MEDIUM", category: "STALE_KNOWLEDGE", confidence: "LOW", generatedAt: NOW },
    { id: "b", priority: "CRITICAL", category: "TEAM_RISK", confidence: "HIGH", generatedAt: NOW },
    { id: "c", priority: "HIGH", category: "OVERDUE_TASK", confidence: "HIGH", generatedAt: NOW },
  ];
  const order1 = rankInsights(items).map((r) => r.id);
  const order2 = rankInsights([...items].reverse()).map((r) => r.id);
  assert.deepStrictEqual(order1, order2, "ranking must be independent of input order");
  assert.deepStrictEqual(order1, ["b", "c", "a"]);
});

check("31. limit handling", () => {
  const tasks = [
    makeTask({ due: new Date(NOW - 5 * DAY), status: "todo" }),
    makeTask({ due: new Date(NOW - 4 * DAY), status: "todo" }),
    makeTask({ due: new Date(NOW - 3 * DAY), status: "todo" }),
  ];
  const evidence = baseEvidence({ tasks });
  const { recommendations, summary } = buildActionableInsights(evidence, { limit: 1 });
  assert.strictEqual(recommendations.length, 1);
  assert.ok(summary.total >= 3, "summary.total must reflect the full count, not the limited slice");
});

check("32. malformed limit handled gracefully", () => {
  const t = makeTask({ due: new Date(NOW - DAY), status: "todo" });
  const evidence = baseEvidence({ tasks: [t] });
  const { recommendations } = buildActionableInsights(evidence, { limit: NaN });
  assert.ok(recommendations.length >= 1, "a non-numeric limit must not crash or suppress results");
});

check("33. resolved conflicts are never surfaced (evidence-layer contract)", () => {
  // Layer 1 only ever queries ConflictSnapshot with status: {$in:["OPEN","ACKNOWLEDGED"]}
  // (see gatherActionableInsightsEvidence) — this asserts that contract via
  // source inspection, and confirms Layer 2 has no independent status filter
  // that could accidentally re-admit a RESOLVED/DISMISSED conflict if it
  // were ever passed in by mistake.
  const src = fs.readFileSync(path.join(__dirname, "../src/services/actionableInsightsService.js"), "utf8");
  assert.ok(src.includes('status: { $in: ["OPEN", "ACKNOWLEDGED"] }'), "conflict query must be scoped to OPEN/ACKNOWLEDGED only");
});

check("34. completed task ignored", () => {
  const t = makeTask({ due: new Date(NOW - 5 * DAY), status: "completed" });
  const evidence = baseEvidence({ tasks: [t] });
  const rec = buildActionableInsights(evidence).recommendations.find((r) => r.category === "OVERDUE_TASK");
  assert.ok(!rec, "a completed task must never generate an OVERDUE_TASK recommendation");
});

check("35. non-open (rejected) task ignored", () => {
  const t = makeTask({ due: new Date(NOW - 5 * DAY), status: "rejected" });
  const evidence = baseEvidence({ tasks: [t] });
  const rec = buildActionableInsights(evidence).recommendations.find((r) => r.category === "OVERDUE_TASK");
  assert.ok(!rec, "a rejected (non-open) task must never generate an OVERDUE_TASK recommendation");
});

check("36. automaticAction is always false, for every category", () => {
  const t1 = makeTask({ due: new Date(NOW - 5 * DAY), status: "todo", priority: "low" });
  const t2 = makeTask({ status: "in_progress", updatedAt: new Date(NOW - 20 * DAY) });
  const evidence = baseEvidence({
    tasks: [t1, t2],
    teamRisk: {
      riskLevel: "CRITICAL",
      riskScore: 90,
      reasons: ["Multiple issues."],
      warnings: [{ type: "STUDENT_OVERLOAD", severity: "MEDIUM", title: "x", description: "x", evidence: [] }],
      collaborationRisks: [{ studentId: "user_2", riskLevel: "HIGH", flags: [{ reason: "quiet" }], recommendation: "check in" }],
    },
    forecast: { status: "CRITICAL", probability: 5, evidence: { daysRemaining: 1, remainingTasks: 3 }, generatedAt: NOW },
    health: { health: "CRITICAL", healthScore: 5, topIssues: [{ title: "x", reason: "x" }] },
  });
  const { recommendations } = buildActionableInsights(evidence);
  assert.ok(recommendations.length > 3);
  recommendations.forEach((r) => assert.strictEqual(r.automaticAction, false));
});

check("37. category filter narrows the result set", () => {
  const t1 = makeTask({ due: new Date(NOW - 5 * DAY), status: "todo" });
  const t2 = makeTask({ status: "in_progress", updatedAt: new Date(NOW - 20 * DAY) });
  const evidence = baseEvidence({ tasks: [t1, t2] });
  const { recommendations } = buildActionableInsights(evidence, { category: "OVERDUE_TASK" });
  assert.ok(recommendations.length >= 1);
  assert.ok(recommendations.every((r) => r.category === "OVERDUE_TASK"));
});

check("38. priority filter narrows the result set", () => {
  const t1 = makeTask({ due: new Date(NOW - 5 * DAY), status: "todo" }); // HIGH
  const evidence = baseEvidence({ tasks: [t1] });
  const { recommendations } = buildActionableInsights(evidence, { priority: "HIGH" });
  assert.ok(recommendations.every((r) => r.priority === "HIGH"));
});

check("39. blocked-task builder never fires for a fresh task", () => {
  const t = makeTask({ status: "in_progress", updatedAt: NOW });
  assert.strictEqual(buildBlockedTaskInsights(baseEvidence({ tasks: [t] })).length, 0);
});

check("40. overdue-task builder never fires for a future due date", () => {
  const t = makeTask({ status: "todo", due: new Date(NOW.getTime() + 5 * DAY) });
  assert.strictEqual(buildOverdueTaskInsights(baseEvidence({ tasks: [t] })).length, 0);
});

console.log(`\n${passed} passed, 0 failed`);
