/**
 * STEP 27 — AI PROJECT KNOWLEDGE & DECISION MEMORY.
 *
 * Turns confirmed GROUP-chat statements and Step 26 Meeting Intelligence
 * outputs into a small, searchable set of durable project knowledge
 * records (decisions, requirements, technical choices, conventions,
 * resolved issues, meeting outcomes, important context) — NOT an
 * unrestricted copy of chat history (spec Core Principle §8).
 *
 * ------------------------------------------------------------------------
 * REUSE, NOT DUPLICATION (spec Phase 2/10/14)
 *
 *   - Privacy filtering reuses conflictDetectionService.isGroupMessage /
 *     belongsToGroup UNCHANGED (Step 24) — the exact same "has group, no
 *     conversation" rule used everywhere else in this codebase.
 *   - Subject/token-overlap comparison (used for supersession + potential-
 *     conflict detection) reuses conflictDetectionService.normalizeSubject /
 *     subjectTokens / tokenOverlap UNCHANGED — no second text-similarity
 *     implementation.
 *   - Meeting analysis itself is NEVER re-run here. Knowledge candidates
 *     from a meeting are read from an ALREADY-PERSISTED
 *     MeetingIntelligenceSnapshot (Step 26's own output) — see
 *     extractKnowledgeFromMeeting. This module only persists/searches/
 *     reuses that output; it does not analyze messages a second time for
 *     the meeting path.
 *   - Structural conflicts are never scored here a second time. When a
 *     candidate potentially conflicts with an existing ACTIVE decision,
 *     this module only ever *links* to an existing Step 24 ConflictSnapshot
 *     if one already exists for overlapping evidence (see
 *     linkExistingConflictSnapshot) — it never creates a new
 *     ConflictSnapshot record.
 *
 * ------------------------------------------------------------------------
 * PRIVACY / GROUP ISOLATION (spec Phase 5/28/29)
 *
 * gatherKnowledgeEvidence is the ONLY place this module queries messages,
 * and it does so with `Message.find({ group: groupId, ... })` — a filter
 * private/direct messages never match (see Message.js: sendDirectMessage
 * sets `conversation` and leaves `group` unset) — then additionally
 * re-filters every result through isGroupMessage/belongsToGroup as
 * defense-in-depth, exactly like conflictDetectionService and
 * meetingIntelligenceService already do. Isolation key is ALWAYS the
 * groupId ObjectId, never a group name.
 *
 * ------------------------------------------------------------------------
 * CONSERVATIVE PERSISTENCE (spec Phase 11/30)
 *
 * Every automatically-extracted candidate is persisted with status
 * CANDIDATE — never auto-promoted to ACTIVE. Only an explicit
 * confirmKnowledge(...) call (guide/team-leader, see
 * projectKnowledgeController.js) moves a record to ACTIVE, and only that
 * confirmation ever mutates another record's status (to SUPERSEDED).
 * Nothing here fabricates knowledge, a source id, a date, or a confidence
 * value — every candidate with insufficient evidence is rejected before it
 * ever reaches the database (see validateKnowledgeEvidence).
 */
const Message = require("../models/Message");
const ProjectKnowledge = require("../models/ProjectKnowledge");
const ConflictSnapshot = require("../models/ConflictSnapshot");
const { KNOWLEDGE_TYPES, KNOWLEDGE_STATUSES } = ProjectKnowledge;
const {
  isGroupMessage,
  belongsToGroup,
  normalizeSubject,
  subjectTokens,
  tokenOverlap,
} = require("./conflictDetectionService");

/* ============================================================
 * Guards / constants
 * ============================================================ */

// Hard cap on how many group messages one extraction run can scan — never
// the full chat history (spec Phase 33 — bounded, user-triggered only).
const MAX_EXTRACTION_MESSAGES = 300;
const MIN_CONTENT_LENGTH = 8; // rejects near-empty candidates as insufficient evidence
// Below this, two knowledge items are considered unrelated subjects — used
// as the conservative floor for both supersession and potential-conflict
// checks (spec Phase 13: "do not automatically supersede based on weak
// similarity").
const SUBJECT_OVERLAP_THRESHOLD = 0.34;

/* ============================================================
 * LAYER 2A — classification (pure, spec Phase 6/7/8/9)
 * ============================================================ */

const DECISION_VERBS_RE =
  /\b(agreed|decided|final decision|we will\b|we'll\b|confirmed|finaliz(?:ed|ing)|chose|settled on|going with|it'?s (?:decided|final))\b/i;
const SUGGESTION_RE =
  /\b(maybe|could we|might|what if|perhaps|how about|possibly|let'?s consider|i think we should consider|thoughts on|open to|i think|i suggest|i'd suggest)\b/i;
const UNCLEAR_RE = /\b(not sure|undecided|still deciding|haven'?t decided|no decision yet|need to think)\b/i;

const REQUIREMENT_RE =
  /\b(must (?:show|support|allow|include|have|be able to|be)|should be able to|needs? to (?:support|show|allow|have|include)|we must\b|the (?:system|dashboard|application|app|api)\s+(?:must|should|needs? to))\b/i;

const TECH_CATEGORY_RE =
  /\b(database|mongodb|mysql|postgres(?:ql)?|sqlite|framework|react|vue(?:\.js)?|angular|node(?:\.js)?|express|django|flask|jwt|oauth|authentication|auth|api|rest(?:ful)?|graphql|deployment|docker|kubernetes|aws|azure|gcp|frontend|front-end|backend|back-end|firebase|redis|typescript|javascript)\b/i;

const CONVENTION_RE =
  /\b(all apis? should|all endpoints? should|we (?:always|never)\b|use \w+ for \w+|as a (?:project )?convention|convention is|keep .* out of|isolation key|naming convention|coding standard)\b/i;

const RESOLVED_ISSUE_RE =
  /\b(issue (?:is |has been )?resolved|no longer an issue|(?:bug|issue|problem) (?:is |has been |was )?(?:now )?fixed|resolved the (?:issue|bug|problem)|fixed the (?:issue|bug|problem))\b/i;

/**
 * Classifies a single piece of text into a knowledge type candidate, or
 * returns null when the text is not knowledge-relevant at all (spec
 * Phase 6: casual conversation, questions, and unresolved musings never
 * become candidates). A trailing question mark always means "not settled".
 * Suggestions ("I think...", "maybe...") are explicitly excluded from ever
 * becoming a DECISION, even when a decision verb also appears earlier in
 * the same sentence — the presence of hedging language wins (spec Phase 6:
 * "Suggestions may become candidates but must not be stored as confirmed
 * decisions automatically" — this project takes the conservative reading
 * and does not store them as any knowledge type automatically).
 *
 * @returns {{type: string, confidence: "HIGH"|"MEDIUM"|"LOW"}|null}
 */
function classifyKnowledgeCandidate(text) {
  const t = String(text || "").trim();
  if (!t) return null;
  if (/\?\s*$/.test(t)) return null;
  if (UNCLEAR_RE.test(t)) return null;
  if (SUGGESTION_RE.test(t)) return null;

  if (RESOLVED_ISSUE_RE.test(t)) return { type: "RESOLVED_ISSUE", confidence: "HIGH" };

  // Explicit decision language wins over a generic "use X for Y" convention
  // phrasing — "we agreed to use MongoDB for the database" IS a decision,
  // not a standing convention, even though it contains "use ... for ...".
  const hasDecisionVerb = DECISION_VERBS_RE.test(t);
  if (hasDecisionVerb) {
    return TECH_CATEGORY_RE.test(t)
      ? { type: "TECHNICAL_CHOICE", confidence: "HIGH" }
      : { type: "DECISION", confidence: "HIGH" };
  }

  if (CONVENTION_RE.test(t)) return { type: "PROJECT_CONVENTION", confidence: "HIGH" };
  if (REQUIREMENT_RE.test(t)) return { type: "REQUIREMENT", confidence: "MEDIUM" };

  return null;
}

/** First sentence (or ~90 chars) of content, used as a knowledge title
 * when the caller doesn't supply one. Never invents wording — this is a
 * truncation of the actual source text, nothing else. */
function deriveTitle(content) {
  const c = String(content || "").trim();
  const firstSentence = c.split(/(?<=[.!?])\s/)[0] || c;
  if (firstSentence.length <= 90) return firstSentence;
  return `${firstSentence.slice(0, 87).trim()}...`;
}

/* ============================================================
 * LAYER 2B — extraction from a single group message (pure)
 * ============================================================ */

/**
 * @param {{id:string, text:string, senderId?:string}} message normalized
 *   group message (already privacy-filtered by the caller — see
 *   gatherKnowledgeEvidence)
 * @returns {object|null} an unpersisted knowledge candidate, or null
 */
function extractKnowledgeFromMessage(message) {
  if (!message || !message.text) return null;
  const cls = classifyKnowledgeCandidate(message.text);
  if (!cls) return null;
  const content = message.text.trim();
  return {
    type: cls.type,
    title: deriveTitle(content),
    content,
    confidence: cls.confidence,
    sourceMessageIds: [String(message.id)],
    sourceMeetingId: null,
    sourceMeetingIntelligenceId: null,
    sourceType: "MESSAGE",
  };
}

/* ============================================================
 * LAYER 2C — extraction from an existing Meeting Intelligence result
 * (spec Phase 10 — reuses Step 26's OWN output, never re-analyzes)
 * ============================================================ */

/**
 * @param {object} snapshot an already-persisted (or persist:false result)
 *   MeetingIntelligenceSnapshot-shaped object — see
 *   meetingIntelligenceService.analyzeMeetingIntelligence.
 * @returns {Array<object>} unpersisted knowledge candidates
 */
function extractKnowledgeFromMeeting(snapshot) {
  if (!snapshot) return [];
  const candidates = [];
  const meetingId = snapshot.meeting || null;
  const snapshotId = snapshot._id || snapshot.id || null;

  (snapshot.decisions || [])
    .filter((d) => d.classification === "DECISION" && d.decision)
    .forEach((d) => {
      candidates.push({
        type: TECH_CATEGORY_RE.test(d.decision) ? "TECHNICAL_CHOICE" : "DECISION",
        title: deriveTitle(d.decision),
        content: d.decision.trim(),
        confidence: d.confidence >= 0.75 ? "HIGH" : d.confidence >= 0.5 ? "MEDIUM" : "LOW",
        sourceMessageIds: (d.sourceMessageIds || []).map(String),
        sourceMeetingId: meetingId,
        sourceMeetingIntelligenceId: snapshotId,
        sourceType: "MEETING_INTELLIGENCE",
      });
    });

  // Meeting outcome itself becomes IMPORTANT_CONTEXT — a durable summary
  // of what happened, not a decision (spec Phase 10 "important outcomes").
  if (snapshot.summary?.summary || snapshot.summary?.headline) {
    const content = (snapshot.summary.summary || snapshot.summary.headline || "").trim();
    if (content.length >= MIN_CONTENT_LENGTH) {
      candidates.push({
        type: "MEETING_OUTCOME",
        title: snapshot.summary.headline ? snapshot.summary.headline.trim() : deriveTitle(content),
        content,
        confidence: "MEDIUM",
        sourceMessageIds: (snapshot.sourceMessageIds || []).map(String),
        sourceMeetingId: meetingId,
        sourceMeetingIntelligenceId: snapshotId,
        sourceType: "MEETING_INTELLIGENCE",
      });
    }
  }

  // Follow-ups become IMPORTANT_CONTEXT — genuinely useful for later
  // reuse/search, never fabricated (they are copied verbatim from Step 26's
  // own extraction, not re-derived).
  (snapshot.followUps || []).forEach((f) => {
    if (!f.text || f.text.trim().length < MIN_CONTENT_LENGTH) return;
    candidates.push({
      type: "IMPORTANT_CONTEXT",
      title: deriveTitle(f.text),
      content: f.text.trim(),
      confidence: "MEDIUM",
      sourceMessageIds: (f.sourceMessageIds || []).map(String),
      sourceMeetingId: meetingId,
      sourceMeetingIntelligenceId: snapshotId,
      sourceType: "MEETING_INTELLIGENCE",
    });
  });

  return candidates;
}

/* ============================================================
 * LAYER 2D — normalization, evidence validation, fingerprinting,
 * deduplication (pure, spec Phase 4/12/30)
 * ============================================================ */

/** Trims/caps fields and de-duplicates source references. Never adds a
 * field the candidate didn't already have — no fabrication (spec Phase 30). */
function normalizeKnowledge(candidate) {
  if (!candidate) return null;
  const content = String(candidate.content || "").trim().slice(0, 2000);
  const title = String(candidate.title || deriveTitle(content) || "").trim().slice(0, 300);
  const tags = [...new Set((candidate.tags || []).map((t) => String(t).trim().toLowerCase()).filter(Boolean))];
  return {
    ...candidate,
    type: KNOWLEDGE_TYPES.includes(candidate.type) ? candidate.type : null,
    title,
    content,
    confidence: ["HIGH", "MEDIUM", "LOW"].includes(candidate.confidence) ? candidate.confidence : "MEDIUM",
    sourceMessageIds: [...new Set((candidate.sourceMessageIds || []).map(String))],
    sourceMeetingId: candidate.sourceMeetingId ? String(candidate.sourceMeetingId) : null,
    sourceMeetingIntelligenceId: candidate.sourceMeetingIntelligenceId ? String(candidate.sourceMeetingIntelligenceId) : null,
    tags,
  };
}

/**
 * Evidence-based guard (spec Phase 30). A candidate is only ever valid
 * when it can be traced to something real:
 *   - MESSAGE / MEETING_INTELLIGENCE candidates need at least one real
 *     source message id OR a source meeting reference.
 *   - MANUAL candidates (a guide/leader typing a decision directly) are
 *     evidenced by the confirming user's own action — no message id
 *     required, but content must be non-trivial.
 * @returns {{valid: boolean, reason?: string}}
 */
function validateKnowledgeEvidence(candidate) {
  if (!candidate) return { valid: false, reason: "INSUFFICIENT_EVIDENCE" };
  if (!candidate.type || !KNOWLEDGE_TYPES.includes(candidate.type)) {
    return { valid: false, reason: "INSUFFICIENT_EVIDENCE" };
  }
  if (!candidate.content || candidate.content.trim().length < MIN_CONTENT_LENGTH) {
    return { valid: false, reason: "INSUFFICIENT_EVIDENCE" };
  }
  if (candidate.sourceType === "MANUAL") return { valid: true };
  const hasMessages = Array.isArray(candidate.sourceMessageIds) && candidate.sourceMessageIds.length > 0;
  const hasMeeting = Boolean(candidate.sourceMeetingId || candidate.sourceMeetingIntelligenceId);
  if (!hasMessages && !hasMeeting) return { valid: false, reason: "INSUFFICIENT_EVIDENCE" };
  return { valid: true };
}

/** Deterministic identity for deduplication (spec Phase 12). Built only
 * from stable fields — group, type, and the normalized (lowercased,
 * whitespace-collapsed) content — never from a source message id alone,
 * so the exact same statement said/extracted twice always maps to the
 * same fingerprint and updates one record instead of creating a duplicate. */
function buildKnowledgeFingerprint({ groupId, type, content }) {
  const normalizedContent = normalizeSubject(content).replace(/\s+/g, " ");
  return [String(groupId), type, normalizedContent].join("::");
}

/** Merges same-fingerprint candidates from a single extraction batch,
 * unioning source evidence (never dropped, never duplicated — spec
 * Phase 12), mirroring conflictDetectionService.deduplicateConflicts. */
function deduplicateKnowledge(candidates, groupId) {
  const byFingerprint = new Map();
  candidates.forEach((c) => {
    const fingerprint = buildKnowledgeFingerprint({ groupId, type: c.type, content: c.content });
    if (!byFingerprint.has(fingerprint)) {
      byFingerprint.set(fingerprint, { ...c, fingerprint, sourceMessageIds: [...new Set(c.sourceMessageIds)] });
      return;
    }
    const existing = byFingerprint.get(fingerprint);
    existing.sourceMessageIds = [...new Set([...existing.sourceMessageIds, ...c.sourceMessageIds])];
  });
  return [...byFingerprint.values()];
}

/* ============================================================
 * LAYER 2E — supersession & potential-conflict detection (pure,
 * spec Phase 13/14). Reuses conflictDetectionService's own
 * subject/token-overlap helpers unchanged (see file header).
 * ============================================================ */

const SUPERSESSION_LANGUAGE_RE =
  /\b(instead of|replaces?|superseded?|no longer using|switch(?:ing|ed)? from|final decision:.*instead|now using .* instead)\b/i;

/**
 * Only ever supersedes on STRONG evidence: explicit supersession language
 * AND meaningful subject overlap with an existing ACTIVE item of the same
 * type (spec Phase 13 — "do not automatically supersede based on weak
 * similarity"). Returns the single best match, or null.
 * @param {object} candidate normalized knowledge candidate
 * @param {Array} existingActiveItems ACTIVE ProjectKnowledge docs (same group+type)
 */
function detectSupersession(candidate, existingActiveItems = []) {
  if (!candidate || !SUPERSESSION_LANGUAGE_RE.test(candidate.content)) return null;
  const candidateTokens = subjectTokens(candidate.content);
  if (!candidateTokens.length) return null;

  let best = null;
  existingActiveItems
    .filter((item) => item.type === candidate.type)
    .forEach((item) => {
      const overlap = tokenOverlap(candidateTokens, subjectTokens(item.content));
      if (overlap >= SUBJECT_OVERLAP_THRESHOLD && (!best || overlap > best.overlap)) {
        best = { knowledgeId: item._id || item.id, overlap };
      }
    });
  return best;
}

/**
 * Flags a candidate as a POTENTIAL_CONFLICT (never auto-resolved — spec
 * Phase 14) when it shares a subject with an existing ACTIVE decision but
 * does NOT use explicit supersession language (that case is handled by
 * detectSupersession instead) and its content actually differs. Only
 * DECISION / TECHNICAL_CHOICE items are compared — requirements,
 * conventions, etc. are not adversarial in the same way.
 */
function detectPotentialConflict(candidate, existingActiveItems = []) {
  if (!candidate) return null;
  if (!["DECISION", "TECHNICAL_CHOICE"].includes(candidate.type)) return null;
  if (SUPERSESSION_LANGUAGE_RE.test(candidate.content)) return null; // handled as supersession instead

  const candidateTokens = subjectTokens(candidate.content);
  if (!candidateTokens.length) return null;

  let best = null;
  existingActiveItems
    .filter((item) => item.type === candidate.type)
    .forEach((item) => {
      if (normalizeSubject(item.content) === normalizeSubject(candidate.content)) return; // identical, not a conflict
      const overlap = tokenOverlap(candidateTokens, subjectTokens(item.content));
      if (overlap >= SUBJECT_OVERLAP_THRESHOLD && (!best || overlap > best.overlap)) {
        best = { knowledgeId: item._id || item.id, overlap };
      }
    });
  return best;
}

/* ============================================================
 * LAYER 2F — search (pure, spec Phase 15). Used both directly (unit
 * tests, in-memory filtering) and to keep the DB query in
 * listGroupKnowledge conceptually identical to this predicate.
 * ============================================================ */

/** @param {Array} items plain knowledge-like objects {title, content, type, status}
 *  @param {{q?: string, type?: string, status?: string, page?: number, limit?: number}} params */
function searchKnowledge(items = [], { q = "", type = "", status = "", page = 1, limit = 20 } = {}) {
  const needle = String(q || "").trim().toLowerCase();
  let results = items.filter((item) => {
    if (type && item.type !== type) return false;
    if (status && item.status !== status) return false;
    if (needle) {
      const haystack = `${item.title || ""} ${item.content || ""}`.toLowerCase();
      if (!haystack.includes(needle)) return false;
    }
    return true;
  });
  const total = results.length;
  const safePage = Math.max(1, Number(page) || 1);
  const safeLimit = Math.min(Math.max(1, Number(limit) || 20), 100);
  const start = (safePage - 1) * safeLimit;
  results = results.slice(start, start + safeLimit);
  return { items: results, total, page: safePage, limit: safeLimit };
}

/** Mongo-query equivalent of searchKnowledge's filtering (pure/testable —
 * returns a query object, does not touch the DB). Always scopes by
 * groupId (spec Phase 15/28/29 — group name is never used for isolation). */
const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function buildKnowledgeFilter({ groupId, q, type, status }) {
  const filter = { group: groupId };
  if (type && KNOWLEDGE_TYPES.includes(type)) filter.type = type;
  if (status && KNOWLEDGE_STATUSES.includes(status)) filter.status = status;
  const needle = String(q || "").trim();
  if (needle) {
    const re = new RegExp(escapeRe(needle), "i");
    filter.$or = [{ title: re }, { content: re }, { tags: re }];
  }
  return filter;
}

/* ============================================================
 * LAYER 3A — evidence gathering (DB access, group-scoped only,
 * spec Phase 5/28/33)
 * ============================================================ */

/**
 * @param {string} groupId
 * @param {{sinceDate?: Date, limit?: number}} opts
 */
async function gatherKnowledgeEvidence(groupId, { sinceDate = null, limit = MAX_EXTRACTION_MESSAGES } = {}) {
  const query = { group: groupId, deleted: false };
  if (sinceDate) query.createdAt = { $gte: sinceDate };

  const rawMessages = await Message.find(query).sort("-createdAt").limit(limit).lean();

  return rawMessages
    .map((m) => ({
      id: String(m._id),
      senderId: m.sender ? String(m.sender) : null,
      text: String(m.text || "").trim(),
      group: m.group ? String(m.group) : null,
      conversation: m.conversation || null,
      deleted: Boolean(m.deleted),
      createdAt: m.createdAt,
    }))
    .filter((m) => isGroupMessage(m) && belongsToGroup(m, groupId))
    .reverse(); // chronological order
}

/**
 * Best-effort link to an ALREADY-EXISTING ConflictSnapshot that shares at
 * least one source message with the flagged candidate (spec Phase 14 —
 * never creates a new ConflictSnapshot from here). Returns null when
 * nothing matches; never fabricates a link.
 */
async function linkExistingConflictSnapshot(groupId, sourceMessageIds = []) {
  if (!sourceMessageIds.length) return null;
  const match = await ConflictSnapshot.findOne({
    group: groupId,
    status: { $in: ["OPEN", "ACKNOWLEDGED"] },
    sourceMessageIds: { $in: sourceMessageIds },
  })
    .select("_id")
    .lean();
  return match ? String(match._id) : null;
}

/* ============================================================
 * LAYER 3B — orchestration + persistence (spec Phase 11/12/13/14)
 * ============================================================ */

/**
 * Runs classification + dedup + supersession/conflict detection over a
 * batch of candidates and persists each as a CANDIDATE record (or updates
 * the matching existing record's evidence — never creates unlimited
 * duplicates). Never auto-promotes anything to ACTIVE (spec Phase 11).
 *
 * @param {string} groupId
 * @param {Array<object>} rawCandidates unpersisted candidates (from
 *   extractKnowledgeFromMessage / extractKnowledgeFromMeeting)
 * @param {{userId?: string}} opts
 * @returns {Promise<{created: Array, updated: Array, rejected: Array}>}
 */
async function persistKnowledgeCandidates(groupId, rawCandidates, opts = {}) {
  const normalized = rawCandidates.map(normalizeKnowledge).filter(Boolean);
  const rejected = [];
  const valid = [];
  normalized.forEach((c) => {
    const check = validateKnowledgeEvidence(c);
    if (!check.valid) {
      rejected.push({ candidate: c, reason: check.reason });
    } else {
      valid.push(c);
    }
  });

  const deduped = deduplicateKnowledge(valid, groupId);

  const existingActiveItems = await ProjectKnowledge.find({ group: groupId, status: "ACTIVE" }).lean();

  const created = [];
  const updated = [];

  for (const candidate of deduped) {
    const fingerprint = buildKnowledgeFingerprint({ groupId, type: candidate.type, content: candidate.content });
    // eslint-disable-next-line no-await-in-loop -- small, bounded batch per extraction run
    const existing = await ProjectKnowledge.findOne({ group: groupId, fingerprint });

    if (existing) {
      existing.sourceMessageIds = [...new Set([...(existing.sourceMessageIds || []).map(String), ...candidate.sourceMessageIds])];
      existing.evidenceCount = (existing.evidenceCount || 1) + 1;
      existing.lastEvidenceAt = new Date();
      // eslint-disable-next-line no-await-in-loop
      await existing.save();
      updated.push(existing);
      continue;
    }

    const supersession = detectSupersession(candidate, existingActiveItems);
    const conflict = supersession ? null : detectPotentialConflict(candidate, existingActiveItems);

    let potentialConflict = { flagged: false, withKnowledgeId: null, existingConflictId: null, note: "" };
    if (conflict) {
      // eslint-disable-next-line no-await-in-loop
      const existingConflictId = await linkExistingConflictSnapshot(groupId, candidate.sourceMessageIds);
      potentialConflict = {
        flagged: true,
        withKnowledgeId: conflict.knowledgeId,
        existingConflictId,
        note: "Potential conflict with an existing project decision.",
      };
    }

    // eslint-disable-next-line no-await-in-loop
    const doc = await ProjectKnowledge.create({
      group: groupId,
      type: candidate.type,
      title: candidate.title,
      content: candidate.content,
      status: "CANDIDATE",
      confidence: candidate.confidence,
      sourceMessageIds: candidate.sourceMessageIds,
      sourceMeetingId: candidate.sourceMeetingId,
      sourceMeetingIntelligenceId: candidate.sourceMeetingIntelligenceId,
      sourceType: candidate.sourceType,
      createdBy: opts.userId || null,
      fingerprint,
      supersedesKnowledgeId: supersession ? supersession.knowledgeId : null,
      potentialConflict,
      tags: candidate.tags || [],
    });
    created.push(doc);
  }

  return { created, updated, rejected };
}

/**
 * Guide/team-leader-only confirmation (spec Phase 11/17). Moves a
 * CANDIDATE to ACTIVE. If the candidate carries a detected
 * supersedesKnowledgeId, the OLD record is moved to SUPERSEDED at THIS
 * point — never automatically, never before a human confirms the new
 * decision (spec Phase 13).
 */
async function confirmKnowledgeItem(groupId, knowledgeId, userId) {
  const doc = await ProjectKnowledge.findOne({ _id: knowledgeId, group: groupId });
  if (!doc) return { error: "NOT_FOUND" };
  if (!["CANDIDATE", "SUPERSEDED", "ARCHIVED"].includes(doc.status) && doc.status !== "ACTIVE") {
    return { error: "INVALID_STATUS" };
  }
  doc.status = "ACTIVE";
  doc.confirmedBy = userId || null;
  doc.confirmedAt = new Date();

  if (doc.supersedesKnowledgeId) {
    const old = await ProjectKnowledge.findOne({ _id: doc.supersedesKnowledgeId, group: groupId, status: "ACTIVE" });
    if (old) {
      old.status = "SUPERSEDED";
      old.supersededByKnowledgeId = doc._id;
      await old.save();
    }
  }

  await doc.save();
  return { doc };
}

/** Guide/team-leader-only archive (spec Phase 18). Never deletes. */
async function archiveKnowledgeItem(groupId, knowledgeId, userId) {
  const doc = await ProjectKnowledge.findOne({ _id: knowledgeId, group: groupId });
  if (!doc) return { error: "NOT_FOUND" };
  doc.status = "ARCHIVED";
  doc.archivedBy = userId || null;
  doc.archivedAt = new Date();
  await doc.save();
  return { doc };
}

/** Guide/team-leader-only manual supersession (spec Phase 17/24 — explicit
 * control, e.g. correcting a mis-detected/missed supersession). Never
 * deletes the old record. */
async function markSupersededManually(groupId, oldKnowledgeId, newKnowledgeId, userId) {
  const [oldDoc, newDoc] = await Promise.all([
    ProjectKnowledge.findOne({ _id: oldKnowledgeId, group: groupId }),
    ProjectKnowledge.findOne({ _id: newKnowledgeId, group: groupId }),
  ]);
  if (!oldDoc || !newDoc) return { error: "NOT_FOUND" };
  oldDoc.status = "SUPERSEDED";
  oldDoc.supersededByKnowledgeId = newDoc._id;
  newDoc.supersedesKnowledgeId = oldDoc._id;
  if (newDoc.status === "CANDIDATE") {
    newDoc.status = "ACTIVE";
    newDoc.confirmedBy = userId || null;
    newDoc.confirmedAt = new Date();
  }
  await Promise.all([oldDoc.save(), newDoc.save()]);
  return { oldDoc, newDoc };
}

/** Guide/team-leader-only manual candidate (spec Phase 17 — e.g. recording
 * a decision that never appeared verbatim in chat). Evidenced by the
 * creating user's own action (sourceType MANUAL) — never message ids the
 * caller didn't actually provide. */
async function createManualKnowledge(groupId, input, userId) {
  const candidate = normalizeKnowledge({ ...input, sourceMessageIds: [], sourceType: "MANUAL" });
  const check = validateKnowledgeEvidence(candidate);
  if (!check.valid) return { error: check.reason };

  const fingerprint = buildKnowledgeFingerprint({ groupId, type: candidate.type, content: candidate.content });
  const existing = await ProjectKnowledge.findOne({ group: groupId, fingerprint });
  if (existing) return { error: "DUPLICATE", doc: existing };

  const doc = await ProjectKnowledge.create({
    group: groupId,
    type: candidate.type,
    title: candidate.title,
    content: candidate.content,
    status: "CANDIDATE",
    confidence: candidate.confidence,
    sourceMessageIds: [],
    sourceType: "MANUAL",
    createdBy: userId || null,
    fingerprint,
    tags: candidate.tags || [],
  });
  return { doc };
}

/** DB-backed search/list (spec Phase 15) — mirrors searchKnowledge's
 * filtering semantics via buildKnowledgeFilter, with real pagination. */
async function listGroupKnowledge(groupId, { q, type, status, page = 1, limit = 20 } = {}) {
  const filter = buildKnowledgeFilter({ groupId, q, type, status });
  const safePage = Math.max(1, Number(page) || 1);
  const safeLimit = Math.min(Math.max(1, Number(limit) || 20), 100);

  const [items, total] = await Promise.all([
    ProjectKnowledge.find(filter)
      .sort("-createdAt")
      .skip((safePage - 1) * safeLimit)
      .limit(safeLimit),
    ProjectKnowledge.countDocuments(filter),
  ]);

  return { items, total, page: safePage, limit: safeLimit };
}

/* ============================================================
 * LAYER 2G — student-safe shaping (spec Phase 27)
 * ============================================================ */

/** Students never see internal confidence reasoning, conflict-review
 * detail, or CANDIDATE items still under guide review — only approved
 * (ACTIVE) and its historical trail (SUPERSEDED, so they can see what
 * changed), never ARCHIVED noise or raw internal ids beyond what's needed
 * to navigate. */
function shapeForStudent(item) {
  if (!item) return null;
  if (!["ACTIVE", "SUPERSEDED"].includes(item.status)) return null;
  return {
    knowledgeId: String(item._id || item.id),
    type: item.type,
    title: item.title,
    content: item.content,
    status: item.status,
    tags: item.tags || [],
    sourceMeetingId: item.sourceMeetingId ? String(item.sourceMeetingId) : null,
    supersededByKnowledgeId: item.supersededByKnowledgeId ? String(item.supersededByKnowledgeId) : null,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

module.exports = {
  // constants
  MAX_EXTRACTION_MESSAGES,
  MIN_CONTENT_LENGTH,
  SUBJECT_OVERLAP_THRESHOLD,
  // pure functions (unit-testable, no DB)
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
  buildKnowledgeFilter,
  deriveTitle,
  shapeForStudent,
  // DB-touching
  gatherKnowledgeEvidence,
  linkExistingConflictSnapshot,
  persistKnowledgeCandidates,
  confirmKnowledgeItem,
  archiveKnowledgeItem,
  markSupersededManually,
  createManualKnowledge,
  listGroupKnowledge,
};
