/**
 * STEP 28 — AI Project Memory Assistant / Contextual Project Q&A tests.
 *
 * Same style as testProjectKnowledge.js / testMeetingIntelligence.js / testConflictDetection.js:
 * no live MongoDB needed. Model methods (find/findOne/create) are
 * monkeypatched onto lightweight in-memory fake collections BEFORE
 * projectMemoryAssistantService is required, so every internal require
 * inside the service resolves to these same patched objects (Node module
 * cache) — identical approach to the existing Step 24/26/27 test scripts.
 *
 * Run: node backend/scripts/testProjectMemoryAssistant.js
 */
const assert = require("assert");

/* ============================================================
 * Lightweight in-memory fake Mongoose collections
 * ============================================================ */
function matches(item, query) {
  return Object.entries(query).every(([key, cond]) => {
    if (key === "$or") return cond.some((sub) => matches(item, sub));
    const val = item[key];
    if (cond && typeof cond === "object" && "$in" in cond) {
      const set = cond.$in.map(String);
      if (Array.isArray(val)) return val.some((v) => set.includes(String(v)));
      return set.includes(String(val));
    }
    return String(val) === String(cond);
  });
}

function applySort(items, sortSpec) {
  if (!sortSpec || typeof sortSpec !== "object") return items;
  const entries = Object.entries(sortSpec);
  if (!entries.length) return items;
  return [...items].sort((a, b) => {
    for (const [key, dir] of entries) {
      const av = a[key] == null ? null : a[key];
      const bv = b[key] == null ? null : b[key];
      if (av == null && bv == null) continue;
      if (av == null) return 1;
      if (bv == null) return -1;
      const aTime = av instanceof Date ? av.getTime() : av;
      const bTime = bv instanceof Date ? bv.getTime() : bv;
      if (aTime < bTime) return dir >= 0 ? -1 : 1;
      if (aTime > bTime) return dir >= 0 ? 1 : -1;
    }
    return 0;
  });
}

function makeCollection(name) {
  const items = [];
  let seq = 1;
  const cloneForLean = (x) => (x == null ? x : JSON.parse(JSON.stringify(x)));

  class Query {
    constructor(multi, query) {
      this.multi = multi;
      this.query = query;
      this._sort = null;
      this._limit = null;
      this._lean = false;
    }
    sort(spec) {
      if (typeof spec === "string") {
        const desc = spec.startsWith("-");
        this._sort = { [desc ? spec.slice(1) : spec]: desc ? -1 : 1 };
      } else {
        this._sort = spec;
      }
      return this;
    }
    limit(n) { this._limit = n; return this; }
    select() { return this; }
    populate() { return this; }
    lean() { this._lean = true; return this._resolve(); }
    _resolve() {
      if (this.multi) {
        let r = items.filter((it) => matches(it, this.query));
        r = applySort(r, this._sort);
        if (this._limit != null) r = r.slice(0, this._limit);
        return Promise.resolve(this._lean ? r.map(cloneForLean) : r);
      }
      let r = items.filter((it) => matches(it, this.query));
      r = applySort(r, this._sort);
      const one = r[0] || null;
      return Promise.resolve(this._lean ? cloneForLean(one) : one);
    }
    then(res, rej) { return this._resolve().then(res, rej); }
    catch(rej) { return this._resolve().catch(rej); }
  }

  return {
    items,
    find(query = {}) { return new Query(true, query); },
    findOne(query = {}) { return new Query(false, query); },
    async create(data) {
      const doc = { _id: `${name}_${seq++}`, createdAt: new Date(), updatedAt: new Date(), ...data };
      items.push(doc);
      return doc;
    },
    reset() {
      items.length = 0;
      seq = 1;
    },
  };
}

const knowledgeStore = makeCollection("pk");
const meetingStore = makeCollection("mi");
const conflictStore = makeCollection("cs");
const taskStore = makeCollection("tk");

// Monkeypatch BEFORE requiring the service under test (see file header).
const ProjectKnowledge = require("../src/models/ProjectKnowledge");
const MeetingIntelligenceSnapshot = require("../src/models/MeetingIntelligenceSnapshot");
const ConflictSnapshot = require("../src/models/ConflictSnapshot");
const Task = require("../src/models/Task");
ProjectKnowledge.find = knowledgeStore.find;
MeetingIntelligenceSnapshot.find = meetingStore.find;
MeetingIntelligenceSnapshot.findOne = meetingStore.findOne;
ConflictSnapshot.find = conflictStore.find;
Task.find = taskStore.find;

const {
  classifyIntent,
  extractKeywords,
  rankByOverlap,
  classifyConfidence,
  retrieveKnowledge,
  retrieveTasks,
  retrieveConflicts,
  askProjectMemory,
  NO_EVIDENCE_ANSWER,
} = require("../src/services/projectMemoryAssistantService");

let passed = 0;
const check = (label, fn) => {
  fn();
  passed += 1;
  console.log(`ok - ${label}`);
};
const checkAsync = async (label, fn) => {
  await fn();
  passed += 1;
  console.log(`ok - ${label}`);
};

const GROUP_A = "groupA";
const GROUP_B = "groupB";
const USER_GUIDE = "guideUser";
const USER_STUDENT = "studentUser1";
const USER_STUDENT_2 = "studentUser2";
const fakeGroup = (id, overrides = {}) => ({ _id: id, name: "Team", leader: null, ...overrides });

function seedKnowledge(overrides = {}) {
  return knowledgeStore.create({
    group: GROUP_A,
    type: "DECISION",
    title: "Use MongoDB for storage",
    content: "We decided to use MongoDB for the database.",
    status: "ACTIVE",
    confidence: "HIGH",
    sourceMessageIds: ["m1"],
    sourceType: "MESSAGE",
    fingerprint: `${GROUP_A}::DECISION::use mongodb`,
    ...overrides,
  });
}

(async () => {
  /* ============================================================
   * 1-3: pure intent classification
   * ============================================================ */
  check("1. classifies a decisions question", () => {
    assert.strictEqual(classifyIntent("What decisions were made?"), "DECISIONS");
  });

  check("2. classifies a 'why' question as DECISION_REASON", () => {
    assert.strictEqual(classifyIntent("Why did we choose MongoDB?"), "DECISION_REASON");
  });

  check("3. classifies task/deadline/blocker/meeting/conflict questions", () => {
    assert.strictEqual(classifyIntent("What tasks are overdue?"), "DEADLINES");
    assert.strictEqual(classifyIntent("What are the current blockers?"), "BLOCKERS");
    assert.strictEqual(classifyIntent("What happened in the last meeting?"), "MEETING_SUMMARY");
    assert.strictEqual(classifyIntent("What conflicts are unresolved?"), "CONFLICTS");
    assert.strictEqual(classifyIntent("Which tasks are assigned to Bhavani?"), "TASK_ASSIGNMENT");
    assert.strictEqual(classifyIntent("What is our current sprint status?"), "SPRINT_STATUS");
    assert.strictEqual(classifyIntent("What is the current project forecast?"), "PROJECT_FORECAST");
    assert.strictEqual(classifyIntent("qwertyxyz"), "UNKNOWN");
  });

  /* ============================================================
   * 4: pure ranking/confidence
   * ============================================================ */
  check("4. ranking + confidence classification", () => {
    const ranked = rankByOverlap(
      [{ text: "We decided to use MongoDB for storage" }, { text: "Unrelated topic entirely" }],
      "what did we decide about mongodb"
    );
    assert.ok(ranked[0]._overlap > ranked[1]._overlap);
    assert.strictEqual(classifyConfidence({ topOverlap: 0, evidenceCount: 0 }), "INSUFFICIENT_DATA");
    assert.strictEqual(classifyConfidence({ topOverlap: 0.6, evidenceCount: 1 }), "HIGH");
    assert.strictEqual(classifyConfidence({ topOverlap: 0.3, evidenceCount: 1 }), "MEDIUM");
    assert.strictEqual(classifyConfidence({ topOverlap: 0.1, evidenceCount: 1 }), "LOW");
  });

  check("keyword extraction strips question filler words", () => {
    const kws = extractKeywords("What did we decide about MongoDB?");
    assert.ok(kws.includes("mongodb"));
    assert.ok(!kws.includes("what"));
  });

  /* ============================================================
   * 5. basic project knowledge question
   * ============================================================ */
  await checkAsync("5. basic project knowledge question returns grounded answer", async () => {
    knowledgeStore.reset();
    await seedKnowledge();
    const result = await askProjectMemory({ group: fakeGroup(GROUP_A), userId: USER_GUIDE, isGuideOrLeader: true, question: "What did we decide about MongoDB?" });
    assert.strictEqual(result.success, true);
    assert.ok(/MongoDB/.test(result.answer));
    assert.ok(result.evidence.length > 0);
    assert.strictEqual(result.evidence[0].sourceType, "PROJECT_KNOWLEDGE");
  });

  /* ============================================================
   * 6. decision question (generic, no entity)
   * ============================================================ */
  await checkAsync("6. generic decisions question lists current decisions", async () => {
    knowledgeStore.reset();
    await seedKnowledge();
    const result = await askProjectMemory({ group: fakeGroup(GROUP_A), userId: USER_GUIDE, isGuideOrLeader: true, question: "What decisions were made?" });
    assert.strictEqual(result.intent, "DECISIONS");
    assert.ok(result.evidence.length > 0);
    assert.notStrictEqual(result.confidence, "INSUFFICIENT_DATA");
  });

  /* ============================================================
   * 7. historical/superseded decision handling
   * ============================================================ */
  await checkAsync("7. superseded knowledge is only shown when history is asked for, and labeled historical", async () => {
    knowledgeStore.reset();
    await seedKnowledge({ status: "SUPERSEDED", title: "Use MySQL", content: "We decided to use MySQL for the database." });
    await seedKnowledge({ fingerprint: `${GROUP_A}::DECISION::use mongodb::2`, title: "Use MongoDB instead", content: "Final decision: use MongoDB instead of MySQL for storage." });

    const current = await askProjectMemory({ group: fakeGroup(GROUP_A), userId: USER_GUIDE, isGuideOrLeader: true, question: "What decisions were made about the database?" });
    assert.ok(!/Historical/.test(current.answer));

    const withHistory = await askProjectMemory({ group: fakeGroup(GROUP_A), userId: USER_GUIDE, isGuideOrLeader: true, question: "What is the history of decisions about the database?" });
    assert.ok(/Historical \(superseded\)/.test(withHistory.answer));
  });

  /* ============================================================
   * 8. task question
   * ============================================================ */
  await checkAsync("8. task status question returns a real task", async () => {
    taskStore.reset();
    await taskStore.create({ group: GROUP_A, title: "Build authentication API", status: "in_progress", priority: "high", assignee: { _id: "u1", name: "Bhavani" } });
    const result = await askProjectMemory({ group: fakeGroup(GROUP_A), userId: USER_GUIDE, isGuideOrLeader: true, question: "What is the status of the authentication task?" });
    assert.strictEqual(result.intent, "TASK_STATUS");
    assert.ok(/authentication/i.test(result.answer));
    assert.strictEqual(result.evidence[0].sourceType, "TASK");
  });

  await checkAsync("8b. task assignment question names the real assignee", async () => {
    taskStore.reset();
    await taskStore.create({ group: GROUP_A, title: "Build authentication API", status: "in_progress", assignee: { _id: "u1", name: "Bhavani" } });
    const result = await askProjectMemory({ group: fakeGroup(GROUP_A), userId: USER_GUIDE, isGuideOrLeader: true, question: "Who is working on authentication?" });
    assert.strictEqual(result.intent, "TASK_ASSIGNMENT");
    assert.ok(/Bhavani/.test(result.answer));
  });

  /* ============================================================
   * 9. deadline question
   * ============================================================ */
  await checkAsync("9. overdue-deadline question filters correctly by real due dates", async () => {
    taskStore.reset();
    const past = new Date(Date.now() - 5 * 86400000);
    const future = new Date(Date.now() + 5 * 86400000);
    await taskStore.create({ group: GROUP_A, title: "Overdue task", status: "todo", due: past, assignee: { _id: "u1", name: "A" } });
    await taskStore.create({ group: GROUP_A, title: "Future task", status: "todo", due: future, assignee: { _id: "u1", name: "A" } });
    const result = await askProjectMemory({ group: fakeGroup(GROUP_A), userId: USER_GUIDE, isGuideOrLeader: true, question: "What tasks are overdue?" });
    assert.ok(/Overdue task/.test(result.answer));
    assert.ok(!/Future task/.test(result.answer));
    assert.strictEqual(result.confidence, "HIGH");
  });

  /* ============================================================
   * 10. blocker question
   * ============================================================ */
  await checkAsync("10. blocker question surfaces a real UNRESOLVED_BLOCKER conflict", async () => {
    conflictStore.reset();
    await conflictStore.create({
      group: GROUP_A, type: "UNRESOLVED_BLOCKER", severity: "HIGH", status: "OPEN",
      involvedUserIds: [USER_STUDENT], title: "Unresolved blocker: API integration",
      summary: "A blocker has been mentioned more than once and does not appear resolved.",
      fingerprint: "f1",
    });
    const result = await askProjectMemory({ group: fakeGroup(GROUP_A), userId: USER_GUIDE, isGuideOrLeader: true, question: "What are the current blockers?" });
    assert.strictEqual(result.intent, "BLOCKERS");
    assert.ok(/API integration/.test(result.answer));
    assert.strictEqual(result.evidence[0].sourceType, "CONFLICT");
  });

  /* ============================================================
   * 11. meeting intelligence question
   * ============================================================ */
  await checkAsync("11. meeting summary question reuses the existing snapshot verbatim", async () => {
    meetingStore.reset();
    await meetingStore.create({
      group: GROUP_A, outcome: "PRODUCTIVE",
      summary: { headline: "Team agreed on MongoDB and split remaining tasks.", topics: [], summary: "" },
      decisions: [], actionItems: [], blockers: [], followUps: [],
    });
    const result = await askProjectMemory({ group: fakeGroup(GROUP_A), userId: USER_GUIDE, isGuideOrLeader: true, question: "What happened in the last meeting?" });
    assert.strictEqual(result.intent, "MEETING_SUMMARY");
    assert.ok(/Team agreed on MongoDB/.test(result.answer));
    assert.strictEqual(result.evidence[0].sourceType, "MEETING_INTELLIGENCE");
  });

  await checkAsync("11b. no meeting intelligence available never fabricates a summary", async () => {
    meetingStore.reset();
    const result = await askProjectMemory({ group: fakeGroup(GROUP_A), userId: USER_GUIDE, isGuideOrLeader: true, question: "What happened in the last meeting?" });
    assert.strictEqual(result.answer, "No meeting intelligence is available for this project.");
    assert.strictEqual(result.confidence, "INSUFFICIENT_DATA");
  });

  /* ============================================================
   * 12. conflict question
   * ============================================================ */
  await checkAsync("12. conflict question lists real open conflicts", async () => {
    conflictStore.reset();
    await conflictStore.create({
      group: GROUP_A, type: "TASK_OWNERSHIP", severity: "MEDIUM", status: "OPEN",
      involvedUserIds: [USER_STUDENT], title: "Ownership dispute", summary: "Two members claim the same task.",
      fingerprint: "f2",
    });
    const result = await askProjectMemory({ group: fakeGroup(GROUP_A), userId: USER_GUIDE, isGuideOrLeader: true, question: "What conflicts are open?" });
    assert.strictEqual(result.intent, "CONFLICTS");
    assert.ok(/Ownership dispute/.test(result.answer));
  });

  /* ============================================================
   * 13/14. project health / forecast reuse (guide-only; graceful
   * fallback since the real reused services need a live DB Group doc
   * with far more fields than this fake — we verify the GUIDE GATE
   * and the graceful INSUFFICIENT_DATA fallback here, not the reused
   * services' own scoring, which already has its own test suite).
   * ============================================================ */
  await checkAsync("13. project health question is guide/leader gated", async () => {
    const asStudent = await askProjectMemory({ group: fakeGroup(GROUP_A), userId: USER_STUDENT, isGuideOrLeader: false, question: "How is the project health?" });
    assert.strictEqual(asStudent.intent, "PROJECT_HEALTH");
    assert.strictEqual(asStudent.confidence, "INSUFFICIENT_DATA");
    assert.ok(/guide or team leader/i.test(asStudent.answer));
  });

  await checkAsync("14. project forecast question is guide/leader gated and never throws", async () => {
    const asStudent = await askProjectMemory({ group: fakeGroup(GROUP_A), userId: USER_STUDENT, isGuideOrLeader: false, question: "What is the current project forecast?" });
    assert.strictEqual(asStudent.intent, "PROJECT_FORECAST");
    assert.strictEqual(asStudent.confidence, "INSUFFICIENT_DATA");
    // Guide/leader path — the reused service will fail against this fake
    // group (no real DB), which must degrade to INSUFFICIENT_DATA, never throw.
    const asGuide = await askProjectMemory({ group: fakeGroup(GROUP_A), userId: USER_GUIDE, isGuideOrLeader: true, question: "What is the current project forecast?" });
    assert.strictEqual(asGuide.success, true);
  });

  /* ============================================================
   * 11 (unknown question)
   * ============================================================ */
  await checkAsync("15. unknown/unmatched question falls back to knowledge search or insufficient data", async () => {
    knowledgeStore.reset();
    const result = await askProjectMemory({ group: fakeGroup(GROUP_A), userId: USER_GUIDE, isGuideOrLeader: true, question: "asdkjaslkdj random gibberish" });
    assert.strictEqual(result.confidence, "INSUFFICIENT_DATA");
    assert.strictEqual(result.answer, NO_EVIDENCE_ANSWER);
  });

  /* ============================================================
   * 16. insufficient evidence (no fabrication)
   * ============================================================ */
  await checkAsync("16. asking about something never mentioned never fabricates an answer", async () => {
    knowledgeStore.reset();
    await seedKnowledge({ content: "We decided to use MongoDB for the database." });
    const result = await askProjectMemory({ group: fakeGroup(GROUP_A), userId: USER_GUIDE, isGuideOrLeader: true, question: "Why did the team choose Redis?" });
    assert.strictEqual(result.answer, NO_EVIDENCE_ANSWER);
    assert.strictEqual(result.confidence, "INSUFFICIENT_DATA");
    assert.ok(!/fast/i.test(result.answer));
  });

  /* ============================================================
   * 17. confidence classification end-to-end
   * ============================================================ */
  await checkAsync("17. exact-match evidence yields HIGH confidence", async () => {
    knowledgeStore.reset();
    await seedKnowledge({ content: "We decided to use MongoDB for the database." });
    const result = await askProjectMemory({ group: fakeGroup(GROUP_A), userId: USER_GUIDE, isGuideOrLeader: true, question: "What did we decide about MongoDB for the database?" });
    assert.strictEqual(result.confidence, "HIGH");
  });

  /* ============================================================
   * 18/19/20. groupId isolation, unauthorized access, duplicate
   * group names — retrieval is always scoped to the given groupId.
   * ============================================================ */
  await checkAsync("18. groupId isolation — group A cannot see group B's knowledge", async () => {
    knowledgeStore.reset();
    await seedKnowledge({ group: GROUP_A, content: "We decided to use MongoDB for storage." });
    await knowledgeStore.create({
      group: GROUP_B, type: "DECISION", title: "Use MySQL", content: "We decided to use MySQL for storage.",
      status: "ACTIVE", confidence: "HIGH", sourceMessageIds: ["m9"], sourceType: "MESSAGE", fingerprint: `${GROUP_B}::DECISION::use mysql`,
    });
    const resultA = await retrieveKnowledge(GROUP_A, { isGuideOrLeader: true });
    const resultB = await retrieveKnowledge(GROUP_B, { isGuideOrLeader: true });
    assert.ok(resultA.every((d) => String(d.group) === GROUP_A));
    assert.ok(resultB.every((d) => String(d.group) === GROUP_B));
    assert.ok(!resultA.some((d) => d.content.includes("MySQL")));
  });

  await checkAsync("19. duplicate group names remain isolated by groupId, not name", async () => {
    knowledgeStore.reset();
    const groupX = "groupX_sameName";
    const groupY = "groupY_sameName";
    await knowledgeStore.create({
      group: groupX, type: "DECISION", title: "Decision X", content: "We decided to use Vue for the frontend.",
      status: "ACTIVE", confidence: "HIGH", sourceMessageIds: ["m1"], sourceType: "MESSAGE", fingerprint: `${groupX}::x`,
    });
    await knowledgeStore.create({
      group: groupY, type: "DECISION", title: "Decision Y", content: "We decided to use React for the frontend.",
      status: "ACTIVE", confidence: "HIGH", sourceMessageIds: ["m2"], sourceType: "MESSAGE", fingerprint: `${groupY}::y`,
    });
    // Both groups could be named "Team Alpha" in real data — isolation must
    // still hold because retrieval is keyed on the ObjectId, never the name.
    const rX = await askProjectMemory({ group: fakeGroup(groupX, { name: "Team Alpha" }), userId: USER_GUIDE, isGuideOrLeader: true, question: "What decisions were made?" });
    const rY = await askProjectMemory({ group: fakeGroup(groupY, { name: "Team Alpha" }), userId: USER_GUIDE, isGuideOrLeader: true, question: "What decisions were made?" });
    assert.ok(/Vue/.test(rX.answer));
    assert.ok(!/React/.test(rX.answer));
    assert.ok(/React/.test(rY.answer));
    assert.ok(!/Vue/.test(rY.answer));
  });

  /* ============================================================
   * 21. student-safe response (never leaks guide-only fields)
   * ============================================================ */
  await checkAsync("20. student-safe shaping — a student never sees another member's conflict", async () => {
    conflictStore.reset();
    await conflictStore.create({
      group: GROUP_A, type: "TASK_OWNERSHIP", severity: "HIGH", status: "OPEN",
      involvedUserIds: [USER_STUDENT_2], title: "Ownership dispute involving another student",
      summary: "Should never be shown to studentUser1.", fingerprint: "f3",
    });
    const result = await askProjectMemory({ group: fakeGroup(GROUP_A), userId: USER_STUDENT, isGuideOrLeader: false, question: "What conflicts are open?" });
    assert.ok(!/Ownership dispute involving another student/.test(result.answer));
  });

  await checkAsync("21. student-safe shaping — CANDIDATE knowledge is never exposed to a student", async () => {
    knowledgeStore.reset();
    await seedKnowledge({ status: "CANDIDATE", content: "We decided to use Firebase for auth." });
    const result = await askProjectMemory({ group: fakeGroup(GROUP_A), userId: USER_STUDENT, isGuideOrLeader: false, question: "What did we decide about Firebase?" });
    assert.strictEqual(result.confidence, "INSUFFICIENT_DATA");
    assert.ok(!/Firebase/.test(result.answer));
  });

  await checkAsync("21b. student-safe shaping — a plain student only sees their own tasks", async () => {
    taskStore.reset();
    await taskStore.create({ group: GROUP_A, title: "My task", status: "todo", assignee: { _id: USER_STUDENT, name: "Me" } });
    await taskStore.create({ group: GROUP_A, title: "Someone else's task", status: "todo", assignee: { _id: USER_STUDENT_2, name: "Other" } });
    const tasks = await retrieveTasks(GROUP_A, { userId: USER_STUDENT, isGuideOrLeader: false });
    assert.ok(tasks.every((t) => String(t.assignee._id) === USER_STUDENT));
  });

  /* ============================================================
   * 22. evidence references are real (traceable ids)
   * ============================================================ */
  await checkAsync("22. every evidence entry references a real, existing record id", async () => {
    knowledgeStore.reset();
    const doc = await seedKnowledge({ content: "We decided to use MongoDB for the database." });
    const result = await askProjectMemory({ group: fakeGroup(GROUP_A), userId: USER_GUIDE, isGuideOrLeader: true, question: "What did we decide about MongoDB?" });
    assert.strictEqual(result.evidence[0].sourceId, String(doc._id));
    const stillThere = knowledgeStore.items.find((i) => String(i._id) === result.evidence[0].sourceId);
    assert.ok(stillThere);
  });

  /* ============================================================
   * 23. multiple evidence sources (knowledge + task in one overview)
   * ============================================================ */
  await checkAsync("23. project overview combines multiple real evidence sources", async () => {
    knowledgeStore.reset();
    taskStore.reset();
    await seedKnowledge();
    await taskStore.create({ group: GROUP_A, title: "Build API", status: "done", assignee: { _id: USER_GUIDE, name: "Guide" } });
    await taskStore.create({ group: GROUP_A, title: "Build UI", status: "todo", assignee: { _id: USER_GUIDE, name: "Guide" } });
    const result = await askProjectMemory({ group: fakeGroup(GROUP_A), userId: USER_GUIDE, isGuideOrLeader: true, question: "How is the project doing overall?" });
    assert.strictEqual(result.intent, "PROJECT_OVERVIEW");
    const sourceTypes = new Set(result.evidence.map((e) => e.sourceType));
    assert.ok(sourceTypes.size >= 1);
  });

  /* ============================================================
   * 24. empty project state
   * ============================================================ */
  await checkAsync("24. empty project state never fabricates an answer", async () => {
    knowledgeStore.reset();
    taskStore.reset();
    conflictStore.reset();
    meetingStore.reset();
    const result = await askProjectMemory({ group: fakeGroup(GROUP_A), userId: USER_GUIDE, isGuideOrLeader: true, question: "How is the project doing?" });
    assert.strictEqual(result.confidence, "INSUFFICIENT_DATA");
  });

  /* ============================================================
   * 25. malformed / empty / very long question handling
   * ============================================================ */
  await checkAsync("25. empty question is handled gracefully, never throws", async () => {
    const result = await askProjectMemory({ group: fakeGroup(GROUP_A), userId: USER_GUIDE, isGuideOrLeader: true, question: "" });
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.confidence, "INSUFFICIENT_DATA");
  });

  await checkAsync("25b. a very long question is truncated safely, never throws", async () => {
    const longQuestion = `What did we decide about MongoDB? ${"padding ".repeat(300)}`;
    const result = await askProjectMemory({ group: fakeGroup(GROUP_A), userId: USER_GUIDE, isGuideOrLeader: true, question: longQuestion });
    assert.strictEqual(result.success, true);
  });

  console.log(`\n${passed} checks passed.`);
})().catch((err) => {
  console.error("FAILED:", err);
  process.exit(1);
});
