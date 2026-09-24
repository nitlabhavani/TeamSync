/**
 * STEP 27 — AI Project Knowledge & Decision Memory tests.
 *
 * Mostly pure-function tests, same style as testConflictDetection.js /
 * testMeetingIntelligence.js — no live MongoDB needed. DB-touching
 * functions (gatherKnowledgeEvidence, persistKnowledgeCandidates,
 * confirmKnowledgeItem, archiveKnowledgeItem, listGroupKnowledge) are
 * exercised against lightweight in-memory fake collections that are
 * monkeypatched onto the already-loaded Message/ProjectKnowledge/
 * ConflictSnapshot model objects BEFORE projectKnowledgeService is
 * required — identical approach to testMeetingIntelligence.js /
 * testSameNameGroupIsolation.js, so every internal require inside the
 * service resolves to these same patched objects (Node module cache).
 *
 * Run: node backend/scripts/testProjectKnowledge.js
 */
const assert = require("assert");

/* ============================================================
 * Lightweight in-memory fake Mongoose collections
 * ============================================================ */
function matches(item, query) {
  return Object.entries(query).every(([key, cond]) => {
    if (key === "$or") return cond.some((sub) => matches(item, sub));
    const val = item[key];
    if (cond instanceof RegExp) {
      if (Array.isArray(val)) return val.some((v) => cond.test(String(v)));
      return cond.test(String(val ?? ""));
    }
    if (cond && typeof cond === "object" && "$in" in cond) {
      const set = cond.$in.map(String);
      if (Array.isArray(val)) return val.some((v) => set.includes(String(v)));
      return set.includes(String(val));
    }
    if (cond && typeof cond === "object" && "$gte" in cond) return val >= cond.$gte;
    return String(val) === String(cond);
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
      this._skip = 0;
      this._limit = null;
      this._lean = false;
    }
    sort() { return this; }
    skip(n) { this._skip = n; return this; }
    limit(n) { this._limit = n; return this; }
    select() { return this; }
    lean() { this._lean = true; return this._resolve(); }
    _resolve() {
      if (this.multi) {
        let r = items.filter((it) => matches(it, this.query));
        r = r.slice(this._skip, this._limit != null ? this._skip + this._limit : undefined);
        return Promise.resolve(this._lean ? r.map(cloneForLean) : r);
      }
      const r = items.find((it) => matches(it, this.query)) || null;
      return Promise.resolve(this._lean ? cloneForLean(r) : r);
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
      doc.save = async function save() {
        doc.updatedAt = new Date();
        return doc;
      };
      items.push(doc);
      return doc;
    },
    async countDocuments(query = {}) {
      return items.filter((it) => matches(it, query)).length;
    },
    reset() {
      items.length = 0;
      seq = 1;
    },
  };
}

const messageStore = makeCollection("msg");
const knowledgeStore = makeCollection("pk");
const conflictStore = makeCollection("cs");

// Monkeypatch BEFORE requiring the service (see file header).
const Message = require("../src/models/Message");
const ProjectKnowledge = require("../src/models/ProjectKnowledge");
const ConflictSnapshot = require("../src/models/ConflictSnapshot");
Message.find = messageStore.find;
ProjectKnowledge.find = knowledgeStore.find;
ProjectKnowledge.findOne = knowledgeStore.findOne;
ProjectKnowledge.create = knowledgeStore.create;
ProjectKnowledge.countDocuments = knowledgeStore.countDocuments;
ConflictSnapshot.findOne = conflictStore.findOne;

const {
  classifyKnowledgeCandidate,
  extractKnowledgeFromMessage,
  extractKnowledgeFromMeeting,
  normalizeKnowledge,
  validateKnowledgeEvidence,
  detectSupersession,
  detectPotentialConflict,
  buildKnowledgeFingerprint,
  deduplicateKnowledge,
  searchKnowledge,
  shapeForStudent,
  gatherKnowledgeEvidence,
  persistKnowledgeCandidates,
  confirmKnowledgeItem,
  archiveKnowledgeItem,
  listGroupKnowledge,
} = require("../src/services/projectKnowledgeService");
const { canRequestRecommendation } = require("../src/services/smartTaskAssignmentService");

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

/* ============================================================
 * 1-6: classification
 * ============================================================ */
check("1. explicit decision detection", () => {
  const r = classifyKnowledgeCandidate("We decided to launch the beta next Friday.");
  assert.strictEqual(r.type, "DECISION");
  assert.strictEqual(r.confidence, "HIGH");
});

check("2. suggestion not treated as a confirmed decision", () => {
  assert.strictEqual(classifyKnowledgeCandidate("I think MongoDB might be better for this."), null);
  assert.strictEqual(classifyKnowledgeCandidate("Maybe we should use Redis?"), null);
  assert.strictEqual(classifyKnowledgeCandidate("What if we use Postgres instead?"), null);
});

check("3. requirement detection", () => {
  const r = classifyKnowledgeCandidate("The dashboard must show real-time task status.");
  assert.strictEqual(r.type, "REQUIREMENT");
});

check("4. technical choice detection", () => {
  const r = classifyKnowledgeCandidate("We agreed to use MongoDB for the database.");
  assert.strictEqual(r.type, "TECHNICAL_CHOICE");
});

check("5. project convention detection", () => {
  const r = classifyKnowledgeCandidate("As a project convention, we keep private chat out of AI analysis.");
  assert.strictEqual(r.type, "PROJECT_CONVENTION");
});

check("6. resolved issue detection", () => {
  const r = classifyKnowledgeCandidate("The login bug is now fixed.");
  assert.strictEqual(r.type, "RESOLVED_ISSUE");
});

check("6b. casual conversation is not knowledge-relevant", () => {
  assert.strictEqual(classifyKnowledgeCandidate("haha yeah sounds good"), null);
  assert.strictEqual(classifyKnowledgeCandidate("Are we meeting today?"), null);
});

/* ============================================================
 * 7: meeting decision conversion (reuses Step 26 output, never re-analyzes)
 * ============================================================ */
check("7. meeting decision conversion", () => {
  const snapshot = {
    _id: "snap1",
    group: "gA",
    meeting: "meet1",
    sourceMessageIds: ["m1", "m2", "m3"],
    summary: { headline: "Productive planning session", summary: "Team finalized the sprint scope." },
    decisions: [
      { decision: "We decided to use MongoDB for the database.", classification: "DECISION", sourceMessageIds: ["m1"], confidence: 0.8 },
      { decision: "Maybe we could add Redis later.", classification: "SUGGESTION", sourceMessageIds: ["m2"], confidence: 0.4 },
    ],
    followUps: [{ text: "Follow up with the design team about the new mockups.", sourceMessageIds: ["m3"] }],
  };
  const candidates = extractKnowledgeFromMeeting(snapshot);
  const types = candidates.map((c) => c.type);
  assert.ok(types.includes("TECHNICAL_CHOICE")); // the MongoDB decision
  assert.ok(types.includes("MEETING_OUTCOME"));
  assert.ok(types.includes("IMPORTANT_CONTEXT"));
  // the SUGGESTION-classified decision must never become knowledge
  assert.ok(!candidates.some((c) => c.content.includes("Redis later")));
  candidates.forEach((c) => assert.strictEqual(c.sourceMeetingIntelligenceId, "snap1"));
});

/* ============================================================
 * 8: normalization
 * ============================================================ */
check("8. normalization", () => {
  const n = normalizeKnowledge({
    type: "DECISION",
    content: "  We decided to use MongoDB.  ",
    sourceMessageIds: ["m1", "m1", "m2"],
    tags: [" Backend ", "backend"],
  });
  assert.strictEqual(n.content, "We decided to use MongoDB.");
  assert.strictEqual(n.title, "We decided to use MongoDB.");
  assert.deepStrictEqual(n.sourceMessageIds.sort(), ["m1", "m2"]);
  assert.deepStrictEqual(n.tags, ["backend"]);
});

/* ============================================================
 * 9: fingerprint generation
 * ============================================================ */
check("9. fingerprint generation is deterministic", () => {
  const fp1 = buildKnowledgeFingerprint({ groupId: "gA", type: "DECISION", content: "We decided to use MongoDB." });
  const fp2 = buildKnowledgeFingerprint({ groupId: "gA", type: "DECISION", content: "We decided to use MongoDB." });
  const fp3 = buildKnowledgeFingerprint({ groupId: "gA", type: "DECISION", content: "We decided to use MySQL." });
  const fp4 = buildKnowledgeFingerprint({ groupId: "gB", type: "DECISION", content: "We decided to use MongoDB." });
  assert.strictEqual(fp1, fp2);
  assert.notStrictEqual(fp1, fp3);
  assert.notStrictEqual(fp1, fp4); // group isolation baked into the fingerprint itself
});

/* ============================================================
 * 10: deduplication
 * ============================================================ */
check("10. deduplication merges same-fingerprint candidates", () => {
  const candidates = [
    { type: "DECISION", content: "We decided to use MongoDB.", sourceMessageIds: ["m1"] },
    { type: "DECISION", content: "We decided to use MongoDB.", sourceMessageIds: ["m2"] },
  ];
  const deduped = deduplicateKnowledge(candidates, "gA");
  assert.strictEqual(deduped.length, 1);
  assert.deepStrictEqual(deduped[0].sourceMessageIds.sort(), ["m1", "m2"]);
});

/* ============================================================
 * 11-12: supersession
 * ============================================================ */
check("11. supersession on strong evidence", () => {
  const existing = [{ _id: "k1", type: "TECHNICAL_CHOICE", content: "We decided to use MySQL for the database." }];
  const candidate = { type: "TECHNICAL_CHOICE", content: "Final decision: use MongoDB for the database instead of MySQL." };
  const result = detectSupersession(candidate, existing);
  assert.ok(result);
  assert.strictEqual(result.knowledgeId, "k1");
});

check("12. weak similarity is never auto-superseded", () => {
  const existing = [{ _id: "k1", type: "TECHNICAL_CHOICE", content: "We decided to use MySQL for the database." }];
  // no explicit supersession language at all
  const noLanguage = { type: "TECHNICAL_CHOICE", content: "We decided to use MongoDB for the database." };
  assert.strictEqual(detectSupersession(noLanguage, existing), null);
  // supersession language present but subject barely overlaps
  const unrelated = { type: "TECHNICAL_CHOICE", content: "We will switch the deployment pipeline instead of the old script." };
  assert.strictEqual(detectSupersession(unrelated, existing), null);
});

/* ============================================================
 * 13: conflict detection against an old decision
 * ============================================================ */
check("13. potential conflict flagged without explicit supersession language", () => {
  const existing = [{ _id: "k1", type: "DECISION", content: "Final decision: use MongoDB for the database." }];
  const candidate = { type: "DECISION", content: "Final decision: use PostgreSQL for the database." };
  const result = detectPotentialConflict(candidate, existing);
  assert.ok(result);
  assert.strictEqual(result.knowledgeId, "k1");
});

/* ============================================================
 * 14-15: privacy — private message rejection, group message validation
 * ============================================================ */
/* ============================================================
 * 18-21: search — pagination, keyword, status, type filtering
 * ============================================================ */
const SEARCH_FIXTURE = [
  { title: "Use MongoDB", content: "We decided to use MongoDB for the database.", type: "TECHNICAL_CHOICE", status: "ACTIVE" },
  { title: "Dashboard requirement", content: "The dashboard must show live status.", type: "REQUIREMENT", status: "ACTIVE" },
  { title: "Old MySQL decision", content: "We decided to use MySQL.", type: "TECHNICAL_CHOICE", status: "SUPERSEDED" },
  { title: "Sprint outcome", content: "Sprint planning was productive.", type: "MEETING_OUTCOME", status: "CANDIDATE" },
];

check("18. pagination", () => {
  const page1 = searchKnowledge(SEARCH_FIXTURE, { page: 1, limit: 2 });
  const page2 = searchKnowledge(SEARCH_FIXTURE, { page: 2, limit: 2 });
  assert.strictEqual(page1.total, 4);
  assert.strictEqual(page1.items.length, 2);
  assert.strictEqual(page2.items.length, 2);
  assert.notDeepStrictEqual(page1.items, page2.items);
});

check("19. keyword search filtering", () => {
  const r = searchKnowledge(SEARCH_FIXTURE, { q: "mongodb" });
  assert.strictEqual(r.items.length, 1);
  assert.strictEqual(r.items[0].title, "Use MongoDB");
});

check("20. status filtering", () => {
  const r = searchKnowledge(SEARCH_FIXTURE, { status: "SUPERSEDED" });
  assert.strictEqual(r.items.length, 1);
  assert.strictEqual(r.items[0].title, "Old MySQL decision");
});

check("21. type filtering", () => {
  const r = searchKnowledge(SEARCH_FIXTURE, { type: "TECHNICAL_CHOICE" });
  assert.strictEqual(r.items.length, 2);
});

/* ============================================================
 * 23: confirmation authorization (reuses smartTaskAssignmentService's
 * existing guide/leader helper — no second permission system, spec Phase 31)
 * ============================================================ */
check("23. confirmation authorization mirrors guide/team-leader-only gate", () => {
  assert.strictEqual(canRequestRecommendation({ isGuide: true, groupLeaderId: "leader1", userId: "someoneElse" }), true);
  assert.strictEqual(canRequestRecommendation({ isGuide: false, groupLeaderId: "leader1", userId: "leader1" }), true);
  assert.strictEqual(canRequestRecommendation({ isGuide: false, groupLeaderId: "leader1", userId: "student2" }), false);
});

/* ============================================================
 * 24: student-safe shaping
 * ============================================================ */
check("24. student-safe shaping hides candidates and internal fields", () => {
  const candidate = { _id: "k1", type: "DECISION", title: "t", content: "c", status: "CANDIDATE", confidence: "HIGH" };
  const active = { _id: "k2", type: "DECISION", title: "t2", content: "c2", status: "ACTIVE", tags: ["x"], createdAt: new Date(), updatedAt: new Date() };
  const archived = { _id: "k3", type: "DECISION", title: "t3", content: "c3", status: "ARCHIVED" };
  assert.strictEqual(shapeForStudent(candidate), null);
  assert.strictEqual(shapeForStudent(archived), null);
  const shaped = shapeForStudent(active);
  assert.ok(shaped);
  assert.strictEqual(shaped.status, "ACTIVE");
  assert.strictEqual(shaped.confidence, undefined); // never exposes internal confidence reasoning
});

/* ============================================================
 * 25: missing evidence handling
 * ============================================================ */
check("25. missing evidence is rejected, never fabricated", () => {
  assert.strictEqual(validateKnowledgeEvidence(null).valid, false);
  assert.strictEqual(validateKnowledgeEvidence({ type: "DECISION", content: "ok", sourceType: "MESSAGE", sourceMessageIds: [] }).valid, false);
  assert.strictEqual(validateKnowledgeEvidence({ type: "DECISION", content: "hi", sourceType: "MESSAGE", sourceMessageIds: ["m1"] }).valid, false); // too short
  assert.strictEqual(
    validateKnowledgeEvidence({ type: "DECISION", content: "We decided to use MongoDB.", sourceType: "MESSAGE", sourceMessageIds: ["m1"] }).valid,
    true
  );
  assert.strictEqual(
    validateKnowledgeEvidence({ type: "DECISION", content: "We decided to use MongoDB.", sourceType: "MANUAL", sourceMessageIds: [] }).valid,
    true
  ); // manual entries are evidenced by the confirming user's own action
});

/* ============================================================
 * Async / DB-touching tests (14, 15, 16, 17, 22, plus end-to-end persist)
 * ============================================================ */
(async () => {
  // ---- 14/15: private message rejection + group message validation ----
  messageStore.reset();
  await messageStore.create({ group: "gA", conversation: null, text: "We decided to use MongoDB for the database.", deleted: false, sender: "u1" });
  await messageStore.create({ group: null, conversation: "u1_u2", text: "We decided to elope to Goa.", deleted: false, sender: "u1" }); // private DM
  await messageStore.create({ group: "gB", conversation: null, text: "We decided to use Postgres for the database.", deleted: false, sender: "u2" }); // other group

  await checkAsync("14. private/direct messages never become knowledge evidence", async () => {
    const evidence = await gatherKnowledgeEvidence("gA");
    assert.strictEqual(evidence.length, 1);
    assert.ok(!evidence.some((m) => m.text.includes("elope")));
  });

  await checkAsync("15. group message validation — only THIS group's messages", async () => {
    const evidence = await gatherKnowledgeEvidence("gA");
    assert.ok(!evidence.some((m) => m.text.includes("Postgres"))); // belongs to gB, not gA
    evidence.forEach((m) => assert.strictEqual(m.group, "gA"));
  });

  // ---- 16: same-name group isolation ----
  knowledgeStore.reset();
  await checkAsync("16. same-name group isolation", async () => {
    const GROUP_A = "groupIdA";
    const GROUP_B = "groupIdB"; // both groups are named "Team Alpha" in the UI — isolation must use the id, never the name
    await persistKnowledgeCandidates(GROUP_A, [
      { type: "DECISION", title: "t", content: "We decided to use MongoDB for the database.", confidence: "HIGH", sourceMessageIds: ["m1"], sourceType: "MESSAGE" },
    ]);
    await persistKnowledgeCandidates(GROUP_B, [
      { type: "DECISION", title: "t", content: "We decided to use MySQL for the database.", confidence: "HIGH", sourceMessageIds: ["m2"], sourceType: "MESSAGE" },
    ]);
    const listA = await listGroupKnowledge(GROUP_A, {});
    const listB = await listGroupKnowledge(GROUP_B, {});
    assert.strictEqual(listA.total, 1);
    assert.strictEqual(listB.total, 1);
    assert.ok(listA.items[0].content.includes("MongoDB"));
    assert.ok(listB.items[0].content.includes("MySQL"));
    assert.ok(!listA.items.some((i) => i.content.includes("MySQL")));
    assert.ok(!listB.items.some((i) => i.content.includes("MongoDB")));
  });

  // ---- 17: cross-group knowledge rejection ----
  await checkAsync("17. cross-group knowledge access is rejected", async () => {
    const listA = await listGroupKnowledge("groupIdA", {});
    const itemFromA = listA.items[0];
    const result = await confirmKnowledgeItem("groupIdB", itemFromA._id, "someUser"); // wrong group
    assert.strictEqual(result.error, "NOT_FOUND");
  });

  // ---- 22: archive behavior ----
  await checkAsync("22. archive never deletes, only changes status", async () => {
    const listA = await listGroupKnowledge("groupIdA", {});
    const itemFromA = listA.items[0];
    const result = await archiveKnowledgeItem("groupIdA", itemFromA._id, "guideUser");
    assert.strictEqual(result.doc.status, "ARCHIVED");
    assert.ok(result.doc.archivedAt);
    const stillThere = knowledgeStore.items.find((i) => i._id === itemFromA._id);
    assert.ok(stillThere); // never deleted
  });

  // ---- end-to-end: dedup on repeat + confirm triggers supersession flip ----
  knowledgeStore.items.length = 0;
  await checkAsync("end-to-end: repeat mention updates evidence, never duplicates", async () => {
    const groupId = "groupIdE2E";
    const c1 = { type: "DECISION", title: "t", content: "We decided to use MongoDB for storage.", confidence: "HIGH", sourceMessageIds: ["m1"], sourceType: "MESSAGE" };
    const c2 = { type: "DECISION", title: "t", content: "We decided to use MongoDB for storage.", confidence: "HIGH", sourceMessageIds: ["m2"], sourceType: "MESSAGE" };
    await persistKnowledgeCandidates(groupId, [c1]);
    const { created, updated } = await persistKnowledgeCandidates(groupId, [c2]);
    assert.strictEqual(created.length, 0);
    assert.strictEqual(updated.length, 1);
    assert.strictEqual(updated[0].evidenceCount, 2);
  });

  await checkAsync("end-to-end: confirming a superseding decision archives the old one", async () => {
    const groupId = "groupIdSupersede";
    const { created: firstBatch } = await persistKnowledgeCandidates(groupId, [
      { type: "TECHNICAL_CHOICE", title: "t", content: "We decided to use MySQL for the database.", confidence: "HIGH", sourceMessageIds: ["m1"], sourceType: "MESSAGE" },
    ]);
    await confirmKnowledgeItem(groupId, firstBatch[0]._id, "guideUser"); // must be ACTIVE before it can be superseded

    const { created: secondBatch } = await persistKnowledgeCandidates(groupId, [
      { type: "TECHNICAL_CHOICE", title: "t", content: "Final decision: use MongoDB instead of MySQL for the database.", confidence: "HIGH", sourceMessageIds: ["m2"], sourceType: "MESSAGE" },
    ]);
    assert.strictEqual(secondBatch[0].supersedesKnowledgeId?.toString(), firstBatch[0]._id.toString());

    await confirmKnowledgeItem(groupId, secondBatch[0]._id, "guideUser");
    const oldOne = knowledgeStore.items.find((i) => i._id === firstBatch[0]._id);
    assert.strictEqual(oldOne.status, "SUPERSEDED");
    assert.strictEqual(oldOne.supersededByKnowledgeId.toString(), secondBatch[0]._id.toString());
  });

  console.log(`\n${passed} checks passed.`);
})().catch((err) => {
  console.error("FAILED:", err);
  process.exit(1);
});
