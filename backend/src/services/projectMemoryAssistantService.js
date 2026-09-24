/**
 * STEP 28 — AI PROJECT MEMORY ASSISTANT / CONTEXTUAL PROJECT Q&A.
 *
 * A grounded retrieval + deterministic response layer over data that
 * already exists in this codebase. This module NEVER calls an external
 * LLM/API, NEVER invents project facts, and NEVER re-implements scoring
 * that already lives elsewhere.
 *
 * ------------------------------------------------------------------------
 * REUSE, NOT DUPLICATION
 *
 *   - Text-similarity uses conflictDetectionService.normalizeSubject /
 *     subjectTokens / tokenOverlap UNCHANGED (Step 24/27) — no second
 *     token-overlap implementation.
 *   - Project Knowledge / Decision Memory is read from the already-
 *     persisted ProjectKnowledge collection (Step 27) — this module never
 *     re-extracts or re-classifies chat messages itself.
 *   - Meeting Intelligence is read from the already-persisted
 *     MeetingIntelligenceSnapshot collection (Step 26) — meeting analysis
 *     is NEVER re-run here.
 *   - Conflicts are read from the already-persisted ConflictSnapshot
 *     collection (Step 24) — conflicts are NEVER re-detected or
 *     auto-resolved here.
 *   - Project Health / Forecast / Team Risk / Execution Copilot / Sprint
 *     Planner answers call the EXISTING services
 *     (projectHealthService.getProjectHealth, projectForecastService.
 *     runProjectForecast, teamRiskAnalyzer.analyzeGroupRisk,
 *     projectExecutionCopilotService.getExecutionCopilot,
 *     sprintPlannerService.buildSprintPreview) with `persist:false` where
 *     supported — their formulas are never duplicated, and answering a
 *     question never creates a new snapshot document or notification.
 *   - Tasks are read directly from the existing Task model — never a
 *     second task store.
 *
 * ------------------------------------------------------------------------
 * PRIVACY / GROUP ISOLATION
 *
 * Every DB-touching function in this module takes a `groupId` and scopes
 * every query by `group: groupId` (never a group name). This module never
 * reads chat Message documents at all (grounding sources are Project
 * Knowledge, Meeting Intelligence, Conflict Snapshots and Tasks only), so
 * private/direct messages can never be exposed through it. Authorization
 * (member vs guide/team-leader) is decided by the caller (controller),
 * exactly like every other AI controller in this codebase — this module
 * takes an explicit `isGuideOrLeader` flag and a `userId` and shapes its
 * own output accordingly; it never re-derives authorization itself.
 *
 * ------------------------------------------------------------------------
 * GROUNDING GUARANTEE
 *
 * Every fact in an answer is traceable to a real, already-persisted
 * record referenced in `evidence[]`. If no sufficient evidence is found,
 * the answer is always the literal INSUFFICIENT_DATA response — this
 * module never falls back to general knowledge (spec §12).
 */

const ProjectKnowledge = require("../models/ProjectKnowledge");
const MeetingIntelligenceSnapshot = require("../models/MeetingIntelligenceSnapshot");
const ConflictSnapshot = require("../models/ConflictSnapshot");
const Task = require("../models/Task");
const {
  normalizeSubject,
  subjectTokens,
  tokenOverlap,
  shapeForStudent: shapeConflictForStudent,
} = require("./conflictDetectionService");
const { shapeForStudent: shapeKnowledgeForStudent } = require("./projectKnowledgeService");

const DONE_STATUSES = ["done", "completed"];
const MAX_EVIDENCE = 6;

/* ============================================================
 * LAYER 1 — intent classification (pure, deterministic)
 * ============================================================ */

const INTENTS = [
  "PROJECT_OVERVIEW",
  "DECISIONS",
  "RECENT_DECISIONS",
  "DECISION_REASON",
  "TASK_STATUS",
  "TASK_ASSIGNMENT",
  "DEADLINES",
  "BLOCKERS",
  "RISKS",
  "CONFLICTS",
  "MEETING_SUMMARY",
  "MEETING_ACTION_ITEMS",
  "FOLLOW_UPS",
  "PROJECT_HEALTH",
  "PROJECT_FORECAST",
  "SPRINT_STATUS",
  "KNOWLEDGE_SEARCH",
  "UNKNOWN",
];

// Ordered, most-specific-first. Each entry: { intent, re }.
const INTENT_RULES = [
  { intent: "DECISION_REASON", re: /\b(why (?:did|do|does|was|were)\b|reason(?:s)? (?:for|behind)|what was the reasoning)/i },
  { intent: "RECENT_DECISIONS", re: /\b(recent|latest|last)\b.*\bdecision/i },
  { intent: "SPRINT_STATUS", re: /\bsprint\b/i },
  { intent: "PROJECT_FORECAST", re: /\b(forecast|on track|on-track|will we finish|likely to finish|projected completion|probability of finishing)\b/i },
  { intent: "PROJECT_HEALTH", re: /\b(project health|health score|how healthy|health command center)\b/i },
  { intent: "MEETING_ACTION_ITEMS", re: /\b(action item|action-item)s?\b/i },
  { intent: "MEETING_SUMMARY", re: /\b(last meeting|recent meeting|meeting summary|what happened in (?:the|our) meeting|meeting notes|group discussion|chat discussion|last (?:group )?discussion|summarize (?:the )?(?:last )?(?:group )?discussion)\b/i },
  { intent: "FOLLOW_UPS", re: /\bfollow[\s-]?up/i },
  { intent: "CONFLICTS", re: /\bconflict|disagreement|dispute\b/i },
  { intent: "BLOCKERS", re: /\bblocker|blocked|stuck|can'?t proceed|cannot proceed\b/i },
  { intent: "DEADLINES", re: /\bdeadline|due date|overdue|when is .* due|what'?s due\b/i },
  { intent: "TASK_ASSIGNMENT", re: /\b(who(?:'s| is)? (?:working on|assigned to|doing|handling)|who owns|assigned to)\b/i },
  { intent: "TASK_STATUS", re: /\b(task status|status of .*\btask\b|is .* (?:done|complete|finished)|how is .* (?:going|progressing)|which tasks?)\b/i },
  { intent: "RISKS", re: /\b(risk|who needs support|who needs help|needs support|who is struggling)\b/i },
  { intent: "DECISIONS", re: /\bdecision|decided|what did we decide|what have we decided\b/i },
  { intent: "PROJECT_OVERVIEW", re: /\b(overview|how is (?:the|our|my) (?:project|team)|status of (?:the )?project|project status|summary of the project|how are (?:we|the team) doing|how'?s (?:it|the team) going|how (?:is|are) (?:the|my|our) team doing)\b/i },
  { intent: "KNOWLEDGE_SEARCH", re: /\b(requirement|convention|technical choice|constraint|assumption|resolved issue)\b/i },
];

/** @param {string} question raw question text
 *  @returns {string} one of INTENTS, always defined ("UNKNOWN" as fallback) */
function classifyIntent(question) {
  const q = String(question || "").trim();
  if (!q) return "UNKNOWN";
  for (const rule of INTENT_RULES) {
    if (rule.re.test(q)) return rule.intent;
  }
  return "UNKNOWN";
}

/* ============================================================
 * LAYER 2 — normalization / keyword extraction (pure)
 * ============================================================ */

// Question-only filler words that are never useful search terms. This is a
// LOCAL list for cleaning up search phrases before hitting the DB — it does
// NOT replace/duplicate conflictDetectionService's STOPWORDS list, which is
// used unchanged for the actual token-overlap similarity computation below.
const QUESTION_FILLER = new Set([
  "what", "when", "who", "why", "how", "did", "do", "does", "we", "our",
  "us", "there", "any", "currently", "current", "please", "tell", "me",
  "about", "was", "were", "have", "has", "had", "can", "you", "show",
]);

/** Normalizes and strips question-filler words, producing a compact
 * keyword phrase usable as a DB search string. Never invents new words —
 * this only removes noise from what the user actually typed. */
function normalizeQuestion(question) {
  return String(question || "").trim().replace(/\s+/g, " ");
}

function extractKeywords(question) {
  return normalizeSubject(question)
    .replace(/[?]/g, "")
    .split(/\s+/)
    .filter((t) => t && !QUESTION_FILLER.has(t));
}

/* ============================================================
 * LAYER 3 — ranking + confidence (pure). Reuses
 * conflictDetectionService.subjectTokens/tokenOverlap unchanged.
 * ============================================================ */

/**
 * @param {Array<{text: string}>} items plain objects with a `text` field
 *   to compare against the question (the caller decides what `text` is —
 *   e.g. title+content for knowledge, decision text for meetings, etc.)
 * @param {string} question raw question
 * @returns {Array} same items, each decorated with `_overlap` (0-1),
 *   sorted by `_overlap` descending (stable for ties).
 */
function rankByOverlap(items, question) {
  const qTokens = subjectTokens(question);
  return items
    .map((item, idx) => ({
      ...item,
      _overlap: qTokens.length ? tokenOverlap(qTokens, subjectTokens(item.text || "")) : 0,
      _idx: idx,
    }))
    .sort((a, b) => b._overlap - a._overlap || a._idx - b._idx);
}

/**
 * Deterministic, transparent confidence — never presented as an ML
 * probability (spec §11).
 * @param {number} topOverlap 0-1 overlap of the best-matching evidence
 * @param {number} evidenceCount how many evidence items support the answer
 * @param {boolean} exact true when the best match is a strong/authoritative
 *   direct hit (e.g. an exact task/knowledge/meeting record match, not just
 *   a partial keyword overlap)
 */
function classifyConfidence({ topOverlap = 0, evidenceCount = 0, exact = false } = {}) {
  if (evidenceCount === 0) return "INSUFFICIENT_DATA";
  if (exact || topOverlap >= 0.5) return "HIGH";
  if (topOverlap >= 0.25 || evidenceCount >= 2) return "MEDIUM";
  // evidenceCount > 0 here (guarded above) — a real record was found and
  // is being shown, so this is at worst a weak keyword match, never
  // "no data" (spec §11: INSUFFICIENT_DATA means no evidence at all).
  return "LOW";
}

/* ============================================================
 * LAYER 4 — evidence shaping (pure). Every shaper only ever reads
 * fields that already exist on the real record — never fabricates one.
 * ============================================================ */

function knowledgeToEvidence(doc) {
  return {
    sourceType: "PROJECT_KNOWLEDGE",
    sourceId: String(doc._id || doc.id),
    label: `${doc.type} — ${doc.status}`,
    snippet: (doc.content || "").slice(0, 220),
  };
}

function meetingToEvidence(snapshot, label, snippet) {
  return {
    sourceType: "MEETING_INTELLIGENCE",
    sourceId: String(snapshot._id || snapshot.id),
    label,
    snippet: String(snippet || "").slice(0, 220),
  };
}

function taskToEvidence(task, label) {
  return {
    sourceType: "TASK",
    sourceId: String(task._id || task.id),
    label: label || `Task — ${task.status}`,
    snippet: (task.title || "").slice(0, 220),
  };
}

function conflictToEvidence(conflict) {
  return {
    sourceType: "CONFLICT",
    sourceId: String(conflict._id || conflict.id),
    label: `${conflict.type} — ${conflict.status}`,
    snippet: (conflict.summary || conflict.title || "").slice(0, 220),
  };
}

function intelligenceServiceToEvidence(sourceType, groupId, label, snippet) {
  return {
    sourceType,
    sourceId: String(groupId),
    label,
    snippet: String(snippet || "").slice(0, 220),
  };
}

/* ============================================================
 * LAYER 5 — DB-touching retrieval (group-scoped only)
 * ============================================================ */

/** ACTIVE knowledge (+ SUPERSEDED when includeHistory) for this group only.
 * Students get the Step 27 student-safe shape; CANDIDATE items are never
 * surfaced to anyone through this assistant (they are unconfirmed). */
async function retrieveKnowledge(groupId, { includeHistory = false, isGuideOrLeader = false } = {}) {
  const statuses = includeHistory ? ["ACTIVE", "SUPERSEDED"] : ["ACTIVE"];
  const docs = await ProjectKnowledge.find({ group: groupId, status: { $in: statuses } })
    .sort("-updatedAt")
    .limit(200)
    .lean();
  if (isGuideOrLeader) return docs;
  return docs.map(shapeKnowledgeForStudent).filter(Boolean);
}

/** Most recent MeetingIntelligenceSnapshot for this group, or null. Guide/
 * team-leader only — mirrors meetingIntelligenceController.js exactly
 * (there is no student-safe shape for full meeting analysis in Step 26). */
async function retrieveLatestMeetingIntelligence(groupId) {
  return MeetingIntelligenceSnapshot.findOne({ group: groupId }).sort("-createdAt").lean();
}

async function retrieveRecentMeetingIntelligence(groupId, limit = 5) {
  return MeetingIntelligenceSnapshot.find({ group: groupId }).sort("-createdAt").limit(limit).lean();
}

/** Conflicts scoped to this group. Guide/leader see everything; a student
 * only ever sees conflicts that involve them, in the Step 24 student-safe
 * shape (never another member's conflict). */
async function retrieveConflicts(groupId, { userId, isGuideOrLeader = false, statuses = null } = {}) {
  const filter = { group: groupId };
  if (statuses) filter.status = { $in: statuses };
  const docs = await ConflictSnapshot.find(filter).sort("-createdAt").limit(100).lean();
  if (isGuideOrLeader) return docs;
  return docs.map((c) => shapeConflictForStudent(c, userId)).filter(Boolean);
}

/** Tasks scoped to this group. A plain student only ever sees their own
 * assigned tasks (mirrors taskController.list's existing privacy rule);
 * guide/team-leader see the whole group's tasks, matching the broader
 * access already granted to them by every other AI panel in this
 * codebase (Sprint Planner, Execution Copilot, Project Health, etc.). */
async function retrieveTasks(groupId, { userId, isGuideOrLeader = false } = {}) {
  const filter = { group: groupId };
  if (!isGuideOrLeader) filter.assignee = userId;
  return Task.find(filter).populate("assignee", "name").sort({ due: 1, updatedAt: -1 }).lean();
}

/* ============================================================
 * LAYER 6 — per-intent answer builders. Each returns
 * { answer, evidence, confidence, relatedItems, limitations }.
 * Never invents wording beyond simple, deterministic templating over
 * real retrieved fields.
 * ============================================================ */

const NO_EVIDENCE_ANSWER = "I couldn't find enough project information to answer that.";

function insufficientResult(limitations = []) {
  return { answer: NO_EVIDENCE_ANSWER, evidence: [], confidence: "INSUFFICIENT_DATA", relatedItems: [], limitations };
}

function restrictedResult(message) {
  return {
    answer: message,
    evidence: [],
    confidence: "INSUFFICIENT_DATA",
    relatedItems: [],
    limitations: ["This information is only available to the guide or team leader."],
  };
}

// Generic words that appear in "list all decisions"-style questions but
// carry no specific entity to search for (e.g. "what decisions were
// made?"). Used to tell a genuinely generic listing request apart from a
// specific-but-unmatched one (e.g. "what did we decide about Kubernetes?")
// so the latter is NEVER answered with an unrelated decision (spec §12).
const GENERIC_DECISION_WORDS = new Set([
  "decision", "decisions", "made", "project", "recent", "recently", "latest", "last", "history", "historical",
]);

async function answerDecisions(groupId, question, { includeHistory = false, isGuideOrLeader = false, allowFullListingFallback = true } = {}) {
  const items = await retrieveKnowledge(groupId, { includeHistory, isGuideOrLeader });
  const decisionLike = items.filter((i) => ["DECISION", "TECHNICAL_CHOICE"].includes(i.type));
  if (!decisionLike.length) return insufficientResult();

  const keywords = extractKeywords(question);
  const contentKeywords = keywords.filter((k) => !GENERIC_DECISION_WORDS.has(k) && k.length > 2);
  const ranked = rankByOverlap(
    decisionLike.map((d) => ({ ...d, text: `${d.title} ${d.content}` })),
    keywords.join(" ")
  );
  const relevant = keywords.length ? ranked.filter((r) => r._overlap > 0) : ranked;
  const isSpecificQuestion = contentKeywords.length > 0;
  if (!relevant.length && (isSpecificQuestion || !allowFullListingFallback)) {
    // A specific ("why did we choose X" / "what did we decide about X")
    // question that matches nothing is NEVER answered from an unrelated
    // decision — spec §12 forbids fabricating/guessing about the actual
    // entity asked about, even if other, unrelated decisions exist. A
    // genuinely generic listing question ("what decisions were made?")
    // still falls through to the full current-decision listing below.
    return insufficientResult();
  }
  const top = (relevant.length ? relevant : ranked).slice(0, MAX_EVIDENCE);
  if (!top.length) return insufficientResult();

  const activeOnes = top.filter((t) => t.status === "ACTIVE");
  const supersededOnes = top.filter((t) => t.status === "SUPERSEDED");

  const lines = [];
  activeOnes.forEach((d) => lines.push(`Current: "${d.title}" — ${d.content}`));
  if (includeHistory) {
    supersededOnes.forEach((d) => lines.push(`Historical (superseded): "${d.title}" — ${d.content}`));
  }
  if (!lines.length) return insufficientResult();

  // A generic "what decisions were made" question with no specific entity
  // to filter by is answered from the FULL set of current decisions — the
  // DECISIONS intent already scoped the source correctly (decision-type
  // knowledge only), so this is a confident, on-topic listing even without
  // a keyword overlap boost (spec §11 — evidence-based, not ML-probability).
  const isFullListing = !keywords.length || !relevant.length;

  return {
    answer: lines.join("\n"),
    evidence: top.map(knowledgeToEvidence),
    confidence: classifyConfidence({ topOverlap: top[0]._overlap, evidenceCount: top.length, exact: isFullListing }),
    relatedItems: top.slice(1).map((d) => ({ type: "PROJECT_KNOWLEDGE", id: String(d._id || d.id), title: d.title })),
    limitations: includeHistory ? [] : ["Only current (ACTIVE) decisions are shown — ask about history to see superseded ones."],
  };
}

async function answerDecisionReason(groupId, question, opts) {
  // A "why" question about a decision is answered from the SAME decision
  // record's own content — this module never invents a causal explanation
  // that isn't already part of the stored knowledge text (spec §12: never
  // "Redis was chosen because it is fast" unless that reasoning is itself
  // the recorded content).
  const result = await answerDecisions(groupId, question, { ...opts, includeHistory: true, allowFullListingFallback: false });
  if (result.confidence === "INSUFFICIENT_DATA") {
    return insufficientResult();
  }
  return result;
}

async function answerKnowledgeSearch(groupId, question, { isGuideOrLeader = false } = {}) {
  const items = await retrieveKnowledge(groupId, { includeHistory: false, isGuideOrLeader });
  if (!items.length) return insufficientResult();

  const keywords = extractKeywords(question);
  const ranked = rankByOverlap(items.map((d) => ({ ...d, text: `${d.title} ${d.content}` })), keywords.join(" "));
  const relevant = ranked.filter((r) => r._overlap > 0).slice(0, MAX_EVIDENCE);
  if (!relevant.length) return insufficientResult();

  const lines = relevant.map((d) => `${d.type}: "${d.title}" — ${d.content}`);
  return {
    answer: lines.join("\n"),
    evidence: relevant.map(knowledgeToEvidence),
    confidence: classifyConfidence({ topOverlap: relevant[0]._overlap, evidenceCount: relevant.length }),
    relatedItems: relevant.slice(1).map((d) => ({ type: "PROJECT_KNOWLEDGE", id: String(d._id || d.id), title: d.title })),
    limitations: [],
  };
}

async function answerTaskStatus(groupId, question, { userId, isGuideOrLeader = false } = {}) {
  const tasks = await retrieveTasks(groupId, { userId, isGuideOrLeader });
  if (!tasks.length) return { answer: "No matching task was found in this group.", evidence: [], confidence: "INSUFFICIENT_DATA", relatedItems: [], limitations: [] };

  const keywords = extractKeywords(question);
  const ranked = rankByOverlap(tasks.map((t) => ({ ...t, text: `${t.title} ${t.description || ""}` })), keywords.join(" "));
  const relevant = keywords.length ? ranked.filter((r) => r._overlap > 0) : ranked;
  const top = relevant.slice(0, MAX_EVIDENCE);
  if (!top.length) return { answer: "No matching task was found in this group.", evidence: [], confidence: "INSUFFICIENT_DATA", relatedItems: [], limitations: [] };

  const lines = top.map((t) => {
    const assigneeName = t.assignee?.name || "Unassigned";
    const due = t.due ? new Date(t.due).toLocaleDateString() : "no due date";
    return `"${t.title}" — status: ${t.status}, assignee: ${assigneeName}, due: ${due}`;
  });

  return {
    answer: lines.join("\n"),
    evidence: top.map((t) => taskToEvidence(t, `Task — ${t.status}`)),
    confidence: classifyConfidence({ topOverlap: top[0]._overlap, evidenceCount: top.length, exact: !keywords.length }),
    relatedItems: top.slice(1).map((t) => ({ type: "TASK", id: String(t._id || t.id), title: t.title })),
    limitations: isGuideOrLeader ? [] : ["Only your own assigned tasks are shown."],
  };
}

async function answerTaskAssignment(groupId, question, opts) {
  const result = await answerTaskStatus(groupId, question, opts);
  if (result.confidence === "INSUFFICIENT_DATA") return result;
  return { ...result, answer: result.answer.replace(/status: [^,]+, /g, "") };
}

async function answerDeadlines(groupId, question, { userId, isGuideOrLeader = false } = {}) {
  const tasks = await retrieveTasks(groupId, { userId, isGuideOrLeader });
  const now = new Date();
  const withDue = tasks.filter((t) => t.due);
  const wantsOverdue = /overdue/i.test(question);

  const filtered = wantsOverdue
    ? withDue.filter((t) => !DONE_STATUSES.includes(t.status) && new Date(t.due) < now)
    : withDue.filter((t) => !DONE_STATUSES.includes(t.status));

  if (!filtered.length) {
    return {
      answer: wantsOverdue ? "No tasks are currently overdue." : "No matching task was found in this group.",
      evidence: [],
      confidence: wantsOverdue ? "HIGH" : "INSUFFICIENT_DATA",
      relatedItems: [],
      limitations: isGuideOrLeader ? [] : ["Only your own assigned tasks are checked."],
    };
  }

  const top = filtered.sort((a, b) => new Date(a.due) - new Date(b.due)).slice(0, MAX_EVIDENCE);
  const lines = top.map((t) => {
    const assigneeName = t.assignee?.name || "Unassigned";
    const due = new Date(t.due).toLocaleDateString();
    const overdueTag = new Date(t.due) < now && !DONE_STATUSES.includes(t.status) ? " (overdue)" : "";
    return `"${t.title}" — due ${due}${overdueTag}, assignee: ${assigneeName}, status: ${t.status}`;
  });

  return {
    answer: lines.join("\n"),
    evidence: top.map((t) => taskToEvidence(t, `Task — due ${new Date(t.due).toLocaleDateString()}`)),
    confidence: "HIGH",
    relatedItems: top.slice(1).map((t) => ({ type: "TASK", id: String(t._id || t.id), title: t.title })),
    limitations: isGuideOrLeader ? [] : ["Only your own assigned tasks are shown."],
  };
}

async function answerBlockers(groupId, question, { userId, isGuideOrLeader = false } = {}) {
  const evidence = [];
  const lines = [];

  // Source A — Step 24 unresolved-blocker conflicts (real DB records).
  const conflicts = await retrieveConflicts(groupId, {
    userId,
    isGuideOrLeader,
    statuses: ["OPEN", "ACKNOWLEDGED"],
  });
  const blockerConflicts = conflicts.filter((c) => c.type === "UNRESOLVED_BLOCKER");
  blockerConflicts.forEach((c) => {
    lines.push(`${c.title} — ${c.summary}`);
    evidence.push(conflictToEvidence(c));
  });

  // Source B — Step 26 Meeting Intelligence open blockers (guide/leader only).
  if (isGuideOrLeader) {
    const snapshot = await retrieveLatestMeetingIntelligence(groupId);
    const openMeetingBlockers = (snapshot?.blockers || []).filter((b) => b.status === "OPEN");
    openMeetingBlockers.forEach((b) => {
      lines.push(`${b.text} (from the latest meeting analysis)`);
      evidence.push(meetingToEvidence(snapshot, "Meeting blocker — OPEN", b.text));
    });
  }

  if (!lines.length) {
    return {
      answer: "No open blockers were found in the available project information.",
      evidence: [],
      confidence: "INSUFFICIENT_DATA",
      relatedItems: [],
      limitations: isGuideOrLeader ? [] : ["Meeting-level blocker analysis is only available to the guide or team leader."],
    };
  }

  return {
    answer: lines.slice(0, MAX_EVIDENCE).join("\n"),
    evidence: evidence.slice(0, MAX_EVIDENCE),
    confidence: classifyConfidence({ topOverlap: 1, evidenceCount: lines.length, exact: true }),
    relatedItems: [],
    limitations: isGuideOrLeader ? [] : ["Meeting-level blocker analysis is only available to the guide or team leader."],
  };
}

async function answerConflicts(groupId, { userId, isGuideOrLeader = false } = {}) {
  const conflicts = await retrieveConflicts(groupId, { userId, isGuideOrLeader, statuses: ["OPEN", "ACKNOWLEDGED"] });
  if (!conflicts.length) return { answer: "No open conflicts were found.", evidence: [], confidence: "HIGH", relatedItems: [], limitations: [] };

  const top = conflicts.slice(0, MAX_EVIDENCE);
  const lines = top.map((c) => `${c.title} (${c.severity || "unrated"}) — ${c.summary}`);
  return {
    answer: lines.join("\n"),
    evidence: top.map(conflictToEvidence),
    confidence: "HIGH",
    relatedItems: top.slice(1).map((c) => ({ type: "CONFLICT", id: String(c._id || c.id), title: c.title })),
    limitations: isGuideOrLeader ? [] : ["Only conflicts that involve you are shown."],
  };
}

async function answerMeetingSummary(groupId, { isGuideOrLeader = false } = {}) {
  if (!isGuideOrLeader) return restrictedResult("Meeting Intelligence is only available to the guide or team leader.");
  const snapshot = await retrieveLatestMeetingIntelligence(groupId);
  if (!snapshot) {
    try {
      const Message = require("../models/Message");
      const { summarizeConversation } = require("./aiService");
      const messages = await Message.find({ group: groupId })
        .sort({ createdAt: -1 })
        .limit(50)
        .populate("sender", "name")
        .lean();
      if (messages && messages.length > 0) {
        const chatSum = summarizeConversation(messages.reverse());
        if (chatSum && chatSum.messageCount > 0) {
          const parts = [`Summary of recent team discussion (${chatSum.messageCount} messages, sentiment: ${chatSum.sentiment}):`];
          if (chatSum.topics && chatSum.topics.length) {
            parts.push(`• Key discussion topics: ${chatSum.topics.map((t) => t.word).join(", ")}`);
          }
          if (chatSum.openQuestions && chatSum.openQuestions.length) {
            parts.push(`• Open questions: "${chatSum.openQuestions.slice(0, 2).join('", "')}"`);
          }
          if (chatSum.followUps && chatSum.followUps.length) {
            parts.push(`• Suggested follow-ups: ${chatSum.followUps.join("; ")}`);
          }
          return {
            answer: parts.join("\n"),
            evidence: [intelligenceServiceToEvidence("CHAT_SUMMARY", groupId, "Recent Group Discussion", `${messages.length} messages analyzed`)],
            confidence: "MEDIUM",
            relatedItems: [],
            limitations: [],
          };
        }
      }
    } catch {
      // ignore
    }
    return { answer: "No meeting intelligence is available for this project.", evidence: [], confidence: "INSUFFICIENT_DATA", relatedItems: [], limitations: [] };
  }
  const headline = snapshot.summary?.headline || snapshot.summary?.summary || "";
  if (!headline) {
    return { answer: "No meeting intelligence is available for this project.", evidence: [], confidence: "INSUFFICIENT_DATA", relatedItems: [], limitations: [] };
  }
  return {
    answer: headline,
    evidence: [meetingToEvidence(snapshot, "Meeting summary", headline)],
    confidence: "HIGH",
    relatedItems: [],
    limitations: [],
  };
}

async function answerMeetingActionItems(groupId, { isGuideOrLeader = false } = {}) {
  if (!isGuideOrLeader) return restrictedResult("Meeting Intelligence is only available to the guide or team leader.");
  const snapshot = await retrieveLatestMeetingIntelligence(groupId);
  const items = snapshot?.actionItems || [];
  if (!items.length) {
    return { answer: "No meeting intelligence is available for this project.", evidence: [], confidence: "INSUFFICIENT_DATA", relatedItems: [], limitations: [] };
  }
  const top = items.slice(0, MAX_EVIDENCE);
  const lines = top.map((a) => `${a.title} — assignee: ${a.assigneeName || "unassigned"}, deadline: ${a.deadline || "none"}`);
  return {
    answer: lines.join("\n"),
    evidence: top.map((a) => meetingToEvidence(snapshot, "Meeting action item", a.title)),
    confidence: "HIGH",
    relatedItems: [],
    limitations: [],
  };
}

async function answerFollowUps(groupId, { isGuideOrLeader = false } = {}) {
  if (!isGuideOrLeader) return restrictedResult("Meeting Intelligence is only available to the guide or team leader.");
  const snapshot = await retrieveLatestMeetingIntelligence(groupId);
  const items = snapshot?.followUps || [];
  if (!items.length) {
    return { answer: "No meeting intelligence is available for this project.", evidence: [], confidence: "INSUFFICIENT_DATA", relatedItems: [], limitations: [] };
  }
  const top = items.slice(0, MAX_EVIDENCE);
  return {
    answer: top.map((f) => f.text).join("\n"),
    evidence: top.map((f) => meetingToEvidence(snapshot, "Meeting follow-up", f.text)),
    confidence: "HIGH",
    relatedItems: [],
    limitations: [],
  };
}

async function answerProjectHealth(group, { isGuideOrLeader = false } = {}) {
  if (!isGuideOrLeader) return restrictedResult("Project Health is only available to the guide or team leader.");
  const { getProjectHealth } = require("./projectHealthService");
  try {
    const result = await getProjectHealth(group, { persist: false });
    if (!result || result.status === "INSUFFICIENT_DATA") return insufficientResult();
    return {
      answer: `Project health is ${result.status} (score ${result.healthScore}/100).`,
      evidence: [intelligenceServiceToEvidence("PROJECT_HEALTH", group._id, "Project Health Command Center", `${result.status} — ${result.healthScore}/100`)],
      confidence: "HIGH",
      relatedItems: [],
      limitations: [],
    };
  } catch {
    return insufficientResult();
  }
}

async function answerProjectForecast(group, { isGuideOrLeader = false } = {}) {
  if (!isGuideOrLeader) return restrictedResult("Project Forecast is only available to the guide or team leader.");
  const { runProjectForecast } = require("./projectForecastService");
  try {
    const result = await runProjectForecast(group, { persist: false });
    if (!result || result.status === "INSUFFICIENT_DATA") return insufficientResult();
    return {
      answer: `The project is currently ${result.probability}% likely to finish on time (${result.status}).`,
      evidence: [intelligenceServiceToEvidence("PROJECT_FORECAST", group._id, "Project Forecast", `${result.probability}% — ${result.status}`)],
      confidence: "HIGH",
      relatedItems: [],
      limitations: [],
    };
  } catch {
    return insufficientResult();
  }
}

async function answerRisks(group, questionOrOpts = "", maybeOpts = {}) {
  const opts = (typeof questionOrOpts === "object" && questionOrOpts !== null) ? questionOrOpts : maybeOpts;
  const question = typeof questionOrOpts === "string" ? questionOrOpts : "";
  const { isGuideOrLeader = false } = opts;

  if (!isGuideOrLeader) return restrictedResult("Team Risk is only available to the guide or team leader.");
  const { analyzeGroupRisk } = require("./teamRiskAnalyzer");
  try {
    const result = await analyzeGroupRisk(group, { persist: false });
    if (!result || !result.riskLevel) return insufficientResult();

    const isSupportQuery = /\b(support|help|struggling)\b/i.test(question);
    if (isSupportQuery && result.studentRisks && result.studentRisks.length > 0) {
      const atRisk = result.studentRisks.filter((s) => s.riskLevel !== "ON_TRACK");
      if (!atRisk.length) {
        return {
          answer: "All team members are currently on track. No students currently require urgent intervention.",
          evidence: [intelligenceServiceToEvidence("TEAM_RISK", group._id, "Team Risk - Member Status", "All members on track")],
          confidence: "HIGH",
          relatedItems: [],
          limitations: [],
        };
      }

      let nameMap = new Map();
      try {
        const User = require("../models/User");
        const users = await User.find({ _id: { $in: atRisk.map((s) => s.studentId) } }).select("name").lean();
        nameMap = new Map(users.map((u) => [String(u._id), u.name]));
      } catch {
        if (Array.isArray(group.members)) {
          group.members.forEach((m) => {
            if (m && m._id && m.name) nameMap.set(String(m._id), m.name);
          });
        }
      }

      const lines = atRisk.map((s) => {
        const name = nameMap.get(String(s.studentId)) || "Team member";
        const reasonsStr = (s.reasons && s.reasons.length) ? s.reasons.join(", ") : s.riskLevel;
        return `• ${name} (${s.riskLevel}): ${reasonsStr}`;
      });

      return {
        answer: `The following team member(s) may need support:\n${lines.join("\n")}`,
        evidence: [intelligenceServiceToEvidence("TEAM_RISK", group._id, "Team Risk - Support Analysis", `${atRisk.length} member(s) flagged`)],
        confidence: "HIGH",
        relatedItems: [],
        limitations: [],
      };
    }

    return {
      answer: `Current team risk level is ${result.riskLevel}${result.riskScore != null ? ` (score ${result.riskScore}/100)` : ""}.`,
      evidence: [intelligenceServiceToEvidence("TEAM_RISK", group._id, "Team Risk", result.riskLevel)],
      confidence: "HIGH",
      relatedItems: [],
      limitations: [],
    };
  } catch {
    return insufficientResult();
  }
}

async function answerSprintStatus(group, { isGuideOrLeader = false } = {}) {
  if (!isGuideOrLeader) return restrictedResult("Sprint planning is only available to the guide or team leader.");
  const { buildSprintPreview } = require("./sprintPlannerService");
  try {
    const result = await buildSprintPreview(group, {});
    if (!result || result.error) return insufficientResult();
    const count = result.selectedTasks?.length ?? result.plannedTasks?.length ?? 0;
    return {
      answer: count
        ? `The current sprint preview includes ${count} task(s).`
        : "No sprint tasks are currently planned.",
      evidence: [intelligenceServiceToEvidence("SPRINT_PLANNER", group._id, "Sprint Planner", `${count} task(s)`)],
      confidence: count ? "HIGH" : "INSUFFICIENT_DATA",
      relatedItems: [],
      limitations: [],
    };
  } catch {
    return insufficientResult();
  }
}

async function answerProjectOverview(groupId, group, { userId, isGuideOrLeader = false } = {}) {
  const [knowledge, tasks] = await Promise.all([
    retrieveKnowledge(groupId, { includeHistory: false, isGuideOrLeader }),
    retrieveTasks(groupId, { userId, isGuideOrLeader }),
  ]);

  const decisions = knowledge.filter((k) => ["DECISION", "TECHNICAL_CHOICE"].includes(k.type)).length;
  const now = new Date();
  const overdue = tasks.filter((t) => !DONE_STATUSES.includes(t.status) && t.due && new Date(t.due) < now).length;
  const total = tasks.length;
  const completed = tasks.filter((t) => DONE_STATUSES.includes(t.status)).length;

  if (!total && !decisions) return insufficientResult();

  const parts = [];
  if (total) parts.push(`${completed}/${total} task(s) completed${overdue ? `, ${overdue} overdue` : ""}.`);
  if (decisions) parts.push(`${decisions} recorded project decision(s).`);

  const evidence = [];
  if (total) evidence.push(intelligenceServiceToEvidence("TASK_SUMMARY", groupId, "Task summary", `${completed}/${total} completed`));
  if (decisions) evidence.push(intelligenceServiceToEvidence("KNOWLEDGE_SUMMARY", groupId, "Decision summary", `${decisions} decisions`));

  const limitations = isGuideOrLeader ? [] : ["Task counts reflect only your own assigned tasks."];

  return {
    answer: parts.join(" "),
    evidence,
    confidence: "MEDIUM",
    relatedItems: [],
    limitations,
  };
}

/* ============================================================
 * LAYER 7 — orchestration (the only exported entry point besides
 * the pure helpers above)
 * ============================================================ */

/**
 * @param {object} params
 * @param {object} params.group mongoose Group document (req.group) — used
 *   for reused Health/Forecast/Risk/Sprint services, which need the full
 *   document, not just an id.
 * @param {string} params.userId authenticated user id (req.user._id)
 * @param {boolean} params.isGuideOrLeader authorization flag decided by
 *   the caller/controller — this module never re-derives it.
 * @param {string} params.question raw question text
 * @returns {Promise<object>} the structured, grounded response
 */
async function askProjectMemory({ group, userId, isGuideOrLeader = false, question }) {
  const groupId = group._id || group;
  const q = normalizeQuestion(question);

  if (!q || q.length < 2) {
    return {
      success: true,
      groupId: String(groupId),
      intent: "UNKNOWN",
      answer: "Please ask a specific question about project decisions, tasks, meetings, risks, or status.",
      confidence: "INSUFFICIENT_DATA",
      evidence: [],
      relatedItems: [],
      limitations: ["Empty or too-short question."],
    };
  }
  // Guard against pathologically long input — never treated as a query
  // language / code, always plain text passed only into safe Mongo
  // regex/equality filters via the retrieval layer above.
  const safeQuestion = q.slice(0, 500);

  const intent = classifyIntent(safeQuestion);
  const ctx = { userId, isGuideOrLeader };
  let result;

  switch (intent) {
    case "DECISION_REASON":
      result = await answerDecisionReason(groupId, safeQuestion, ctx);
      break;
    case "RECENT_DECISIONS":
      result = await answerDecisions(groupId, safeQuestion, { ...ctx, includeHistory: false });
      break;
    case "DECISIONS":
      result = await answerDecisions(groupId, safeQuestion, { ...ctx, includeHistory: /histor|superseded|old|previous/i.test(safeQuestion) });
      break;
    case "KNOWLEDGE_SEARCH":
      result = await answerKnowledgeSearch(groupId, safeQuestion, ctx);
      break;
    case "TASK_ASSIGNMENT":
      result = await answerTaskAssignment(groupId, safeQuestion, ctx);
      break;
    case "TASK_STATUS":
      result = await answerTaskStatus(groupId, safeQuestion, ctx);
      break;
    case "DEADLINES":
      result = await answerDeadlines(groupId, safeQuestion, ctx);
      break;
    case "BLOCKERS":
      result = await answerBlockers(groupId, safeQuestion, ctx);
      break;
    case "CONFLICTS":
      result = await answerConflicts(groupId, ctx);
      break;
    case "MEETING_SUMMARY":
      result = await answerMeetingSummary(groupId, ctx);
      break;
    case "MEETING_ACTION_ITEMS":
      result = await answerMeetingActionItems(groupId, ctx);
      break;
    case "FOLLOW_UPS":
      result = await answerFollowUps(groupId, ctx);
      break;
    case "PROJECT_HEALTH":
      result = await answerProjectHealth(group, ctx);
      break;
    case "PROJECT_FORECAST":
      result = await answerProjectForecast(group, ctx);
      break;
    case "RISKS":
      result = await answerRisks(group, safeQuestion, ctx);
      break;
    case "SPRINT_STATUS":
      result = await answerSprintStatus(group, ctx);
      break;
    case "PROJECT_OVERVIEW":
      result = await answerProjectOverview(groupId, group, ctx);
      break;
    default:
      // UNKNOWN — try a last-resort grounded knowledge search before
      // giving up, since a lot of real questions won't match a specific
      // intent regex but are still genuinely knowledge-search-shaped.
      result = await answerKnowledgeSearch(groupId, safeQuestion, ctx);
      if (result.confidence === "INSUFFICIENT_DATA") {
        result = insufficientResult();
      }
      break;
  }

  return {
    success: true,
    groupId: String(groupId),
    intent,
    answer: result.answer,
    confidence: result.confidence,
    evidence: result.evidence,
    relatedItems: result.relatedItems,
    limitations: result.limitations,
  };
}

module.exports = {
  // constants
  INTENTS,
  NO_EVIDENCE_ANSWER,
  // pure functions (unit-testable, no DB)
  classifyIntent,
  normalizeQuestion,
  extractKeywords,
  rankByOverlap,
  classifyConfidence,
  knowledgeToEvidence,
  taskToEvidence,
  conflictToEvidence,
  meetingToEvidence,
  // DB-touching
  retrieveKnowledge,
  retrieveLatestMeetingIntelligence,
  retrieveRecentMeetingIntelligence,
  retrieveConflicts,
  retrieveTasks,
  answerDecisions,
  answerTaskStatus,
  answerDeadlines,
  answerBlockers,
  answerConflicts,
  answerMeetingSummary,
  answerMeetingActionItems,
  answerFollowUps,
  answerProjectOverview,
  // orchestrator
  askProjectMemory,
};
