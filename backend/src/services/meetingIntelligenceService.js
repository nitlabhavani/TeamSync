/**
 * STEP 26 — AI MEETING INTELLIGENCE.
 *
 * Transforms ACTUAL group meeting/chat content into structured project
 * intelligence: summary, decisions, action items, blockers, unresolved
 * items, follow-ups, priority/responsibility changes, risks, conflicting
 * decisions, and an evidence-based meeting outcome/effectiveness read.
 *
 * ------------------------------------------------------------------------
 * REUSE, NOT DUPLICATION (spec Phase 2 / Phase 14 / Phase 25)
 *
 *   - Action-item extraction reuses Step 16's aiService.extractMeetingActionItems
 *     UNCHANGED, called once per group message so every item keeps its
 *     source message id. aiService.js is never modified.
 *   - Topic extraction reuses aiService.summarizeConversation UNCHANGED.
 *   - Privacy filtering reuses conflictDetectionService.isGroupMessage /
 *     belongsToGroup UNCHANGED (Step 24) — the exact same "has group, no
 *     conversation" rule, not a re-implementation of it.
 *   - "Unresolved items" / "conflicting decisions" reuse
 *     conflictDetectionService.runDetectors UNCHANGED (Step 24's own
 *     detector functions) and only ever READ existing ConflictSnapshot
 *     records (by the same buildConflictFingerprint used in Step 24) to
 *     report whether a surfaced issue is already being tracked. This module
 *     NEVER creates/updates a ConflictSnapshot — see Phase 14.
 *   - Task priority values reuse Task.TASK_PRIORITIES (Step 1) — no new
 *     priority scale is invented.
 *
 * New, additive detection in THIS file (does not exist anywhere else):
 * decision-vs-suggestion classification, blocker extraction (single
 * mention — distinct from Step 24's UNRESOLVED_BLOCKER, which requires
 * repetition), follow-ups, priority-change / responsibility-change
 * mentions, risk mentions, outcome classification, health signals, and the
 * meeting-effectiveness score.
 *
 * ------------------------------------------------------------------------
 * PRIVACY / GROUP ISOLATION
 *
 * gatherMeetingEvidence is the ONLY place this module touches the DB for
 * messages. It queries `Message.find({ group: groupId, ... })` — a filter
 * private/direct messages never match, since sendDirectMessage sets
 * `conversation` and leaves `group` unset (see Message.js) — and then
 * additionally re-filters every result through isGroupMessage/belongsToGroup
 * (Step 24's own privacy guard) as defense-in-depth. Isolation key is
 * ALWAYS the groupId ObjectId, never a group name, so two same-name groups
 * can never see each other's messages.
 *
 * ------------------------------------------------------------------------
 * SAFETY
 *
 * Nothing in this file creates a Task, sends a notification, or mutates
 * any Step 1-25 document. It only reads Message/Task/User/Meeting and
 * (read-only) ConflictSnapshot, and writes its own
 * MeetingIntelligenceSnapshot record. Task creation from an extracted
 * action item is an explicit, separate, human-confirmed action left to
 * Part 2 (reusing meetingController.convertActionItems' existing
 * guide/leader-authorized pathway) — see STEP26_PART1_REPORT.md.
 */
const Message = require("../models/Message");
const Task = require("../models/Task");
const Meeting = require("../models/Meeting");
const ConflictSnapshot = require("../models/ConflictSnapshot");
const MeetingIntelligenceSnapshot = require("../models/MeetingIntelligenceSnapshot");
const { TASK_PRIORITIES } = require("../models/Task");
const { extractMeetingActionItems, summarizeConversation } = require("./aiService");
const {
  isGroupMessage,
  belongsToGroup,
  runDetectors,
  buildConflictFingerprint,
} = require("./conflictDetectionService");

/* ============================================================
 * Guards / constants
 * ============================================================ */

// Hard caps on analysis input size (spec Phase 21/48/50 — "oversized time window").
const MAX_WINDOW_MESSAGES = 500;
const MAX_WINDOW_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const DEFAULT_MEETING_WINDOW_MS = 60 * 60 * 1000; // 1 hour, used only when a
// saved Meeting is analyzed without explicit startTime/endTime overrides.

/* ============================================================
 * LAYER 2A — decision extraction (pure)
 * ============================================================ */

const DECISION_VERBS_RE =
  /\b(agreed|decided|final decision|we will\b|we'll\b|confirmed|finaliz(?:ed|ing)|chose|settled on|going with|it'?s (?:decided|final))\b/i;
const SUGGESTION_RE =
  /\b(maybe|could we|might|what if|perhaps|how about|possibly|let'?s consider|i think we should consider|thoughts on|open to)\b/i;
const UNCLEAR_DECISION_RE = /\b(not sure|undecided|still deciding|haven'?t decided|no decision yet|need to think)\b/i;

/** SUGGESTION vs DECISION vs UNCLEAR (spec Phase 7). A trailing question
 * mark always means the statement is a question, not a settled decision. */
function classifyStatement(text) {
  const t = String(text || "").trim();
  if (/\?\s*$/.test(t)) return "UNCLEAR";
  if (UNCLEAR_DECISION_RE.test(t)) return "UNCLEAR";
  const hasDecision = DECISION_VERBS_RE.test(t);
  const hasSuggestion = SUGGESTION_RE.test(t);
  if (hasDecision && !hasSuggestion) return "DECISION";
  if (hasSuggestion) return "SUGGESTION";
  return null; // not decision-relevant at all — excluded from every count
}

/** @param {Array} messages normalized group messages
 * @returns {{decisions: Array, decisionCandidateCount: number}} */
function extractDecisions(messages) {
  const decisions = [];
  let decisionCandidateCount = 0;
  messages.forEach((m) => {
    const cls = classifyStatement(m.text);
    if (!cls) return;
    if (cls === "SUGGESTION") return; // spec Phase 7: never treat a suggestion as a decision
    decisionCandidateCount += 1; // DECISION or UNCLEAR both count toward decision-clarity denominator
    if (cls !== "DECISION") return;
    decisions.push({
      decision: m.text.trim(),
      classification: "DECISION",
      sourceMessageIds: [m.id],
      confidence: 0.8,
    });
  });
  return { decisions, decisionCandidateCount };
}

/* ============================================================
 * LAYER 2B — action-item extraction (reuses Step 16, adds assignee/
 * deadline validation + task priority mapping + source evidence)
 * ============================================================ */

const PRIORITY_MAP = { HIGH: "high", MEDIUM: "medium", LOW: "low" };
const CRITICAL_HINT_RE = /\b(critical|blocker)\b/i;

/** Maps Step 16's HIGH/MEDIUM/LOW heuristic onto the REAL Task.priority
 * enum (spec Phase 11) — never invents a new priority scale. */
function mapPriority(rawPriority, sourceSentence) {
  if (CRITICAL_HINT_RE.test(sourceSentence || "")) return "critical";
  const mapped = PRIORITY_MAP[rawPriority] || "medium";
  return TASK_PRIORITIES.includes(mapped) ? mapped : "medium";
}

/**
 * Runs Step 16's extractMeetingActionItems on EACH message individually
 * (rather than the whole window as one blob) purely so every extracted
 * item keeps a real sourceMessageId — the extraction logic itself is
 * 100% Step 16's, untouched.
 *
 * @param {Array} messages normalized group messages
 * @param {Array<{_id, name}>} members TRUSTED group member list (never
 *   client input — same contract as aiService.extractMeetingActionItems)
 * @param {Array} tasks this group's tasks (for existing-task cross-reference)
 */
function extractActionItemsFromMessages(messages, members, tasks) {
  const items = [];
  messages.forEach((m) => {
    const { actionItems } = extractMeetingActionItems(m.text, { members });
    actionItems.forEach((raw) => {
      const memberMatch = raw.owner ? members.find((mem) => mem.name === raw.owner) : null;
      const relatedTask = findReferencedTask(raw.action, tasks);
      items.push({
        title: raw.action.slice(0, 140),
        description: raw.action,
        assignee: memberMatch ? memberMatch._id : null,
        assigneeName: raw.owner || null,
        // spec Phase 9: never guess — only a name matched against this
        // group's REAL member list counts as resolved.
        assigneeStatus: memberMatch ? "RESOLVED" : "UNRESOLVED",
        deadline: raw.deadline,
        // spec Phase 10: ambiguous/absent deadline is UNRESOLVED, never fabricated.
        deadlineStatus: raw.deadline ? "RESOLVED" : "UNRESOLVED",
        priority: mapPriority(raw.priority, raw.source),
        relatedTaskId: relatedTask ? relatedTask.id : null,
        sourceMessageId: m.id,
        confidence: raw.confidence,
      });
    });
  });
  return items;
}

/** Only ever matches an EXISTING task in THIS group by title containment —
 * never invents/guesses a task id (spec Phase 16). Deliberately simple
 * (exact case-insensitive substring) rather than reusing Step 24's
 * token-overlap scoring, to keep this a distinct, conservative check. */
function findReferencedTask(text, tasks = []) {
  const low = String(text || "").toLowerCase();
  return tasks.find((t) => t.title && t.title.length > 3 && low.includes(t.title.toLowerCase())) || null;
}

/* ============================================================
 * LAYER 2C — blockers, follow-ups, priority/responsibility changes, risks
 * ============================================================ */

const BLOCKER_MENTION_RE =
  /\b(blocked|blocking|can'?t continue|cannot continue|waiting for|waiting on|preventing|is stuck|are stuck)\b/i;
const BLOCKER_RESOLVE_RE = /\b(unblocked|resolved|fixed|no longer blocked|ready now|is ready now|is done now)\b/i;

/** Single-mention-capable blocker extraction (spec Phase 12) — distinct
 * from Step 24's UNRESOLVED_BLOCKER conflict, which only fires on a
 * REPEATED mention (see conflictDetectionService.detectUnresolvedBlocker).
 * A blocker mentioned even once is still real, evidence-backed information
 * a meeting summary should surface. */
function extractBlockers(messages, tasks) {
  const sorted = [...messages].sort((a, b) => a.createdAt - b.createdAt);
  const blockers = [];
  sorted.forEach((m) => {
    if (!BLOCKER_MENTION_RE.test(m.text)) return;
    const resolvedLater = sorted.some((o) => o.createdAt > m.createdAt && BLOCKER_RESOLVE_RE.test(o.text));
    const relatedTask = findReferencedTask(m.text, tasks);
    blockers.push({
      text: m.text.trim(),
      relatedTaskId: relatedTask ? relatedTask.id : null, // spec Phase 12: never guess a task id
      sourceMessageIds: [m.id],
      status: resolvedLater ? "RESOLVED" : "OPEN",
    });
  });
  return blockers;
}

const FOLLOWUP_RE =
  /\b(follow[- ]?up|circle back|revisit|let'?s discuss (?:this )?(?:next|later)|come back to this|pick this up (?:next|later))\b/i;

function extractFollowUps(messages) {
  return messages.filter((m) => FOLLOWUP_RE.test(m.text)).map((m) => ({ text: m.text.trim(), sourceMessageIds: [m.id] }));
}

const PRIORITY_CHANGE_RE =
  /\b(change(?:d|s)? (?:the )?priority|now (?:high|medium|low|critical) priority|re-?prioriti[sz](?:e|ed|ing)|bump(?:ed|ing)? (?:the )?priority|priority (?:is now|has changed|changed to))\b/i;

function extractPriorityChanges(messages) {
  return messages.filter((m) => PRIORITY_CHANGE_RE.test(m.text)).map((m) => ({ text: m.text.trim(), sourceMessageIds: [m.id] }));
}

const RESPONSIBILITY_CHANGE_RE =
  /\b(reassign(?:ed|ing)?|now responsible for|handing (?:this |it )?over to|taking over (?:this|that|it)|instead,? \w+(?: \w+)? will (?:handle|own|do))\b/i;

function extractResponsibilityChanges(messages) {
  return messages
    .filter((m) => RESPONSIBILITY_CHANGE_RE.test(m.text))
    .map((m) => ({ text: m.text.trim(), sourceMessageIds: [m.id] }));
}

const RISK_RE =
  /\b(\brisk\b|could delay|might miss|concerned about|worried that|may not (?:be able to|make it)|potential issue|at risk|risk of)\b/i;

function extractRisks(messages) {
  return messages.filter((m) => RISK_RE.test(m.text)).map((m) => ({ text: m.text.trim(), sourceMessageIds: [m.id] }));
}

/* ============================================================
 * LAYER 2D — unresolved items (open questions + Step 24 detector reuse)
 * ============================================================ */

/**
 * Combines two evidence-backed sources of "discussed but not resolved":
 *   1. Open questions — any group message ending in "?" that was never
 *      followed by an answer is, structurally, unresolved.
 *   2. Step 24's OWN detectors (runDetectors, unchanged) run over this same
 *      message/task window — never a re-implementation of that scoring.
 * For (2), each candidate is cross-referenced (READ-ONLY) against already
 * persisted ConflictSnapshot records via the SAME fingerprint function
 * Step 24 uses, so a Meeting Intelligence reader can see whether an issue
 * is already being tracked — without ever creating/mutating a
 * ConflictSnapshot itself (spec Phase 14).
 */
async function extractUnresolvedItems(messages, tasks, groupId) {
  const openQuestions = messages
    .filter((m) => /\?\s*$/.test(m.text.trim()))
    .map((m) => ({ type: "OPEN_QUESTION", text: m.text.trim(), sourceMessageIds: [m.id], existingConflictId: null, existingConflictStatus: null }));

  const candidates = runDetectors(messages, tasks);
  const conflicts = [];
  for (const c of candidates) {
    const fingerprint = buildConflictFingerprint({
      groupId,
      type: c.type,
      involvedUserIds: c.involvedUserIds,
      relatedTaskId: c.relatedTaskId,
      normalizedIssueKey: c.normalizedIssueKey,
    });
    // eslint-disable-next-line no-await-in-loop -- small, bounded per-analysis candidate list
    const existing = await ConflictSnapshot.findOne({ group: groupId, fingerprint }).select("_id status").lean();
    conflicts.push({
      type: c.type,
      title: c.title,
      summary: c.summary,
      sourceMessageIds: c.sourceMessageIds,
      relatedTaskId: c.relatedTaskId || null,
      existingConflictId: existing ? existing._id : null,
      existingConflictStatus: existing ? existing.status : null,
    });
  }

  const unresolvedItems = [
    ...openQuestions,
    ...conflicts.map((c) => ({
      type: c.type,
      text: c.summary,
      sourceMessageIds: c.sourceMessageIds,
      existingConflictId: c.existingConflictId,
      existingConflictStatus: c.existingConflictStatus,
    })),
  ];

  return { unresolvedItems, conflicts };
}

/* ============================================================
 * LAYER 2E — summary, outcome, health signals, effectiveness
 * ============================================================ */

/** Structured summary (spec Phase 6) — topics reuse aiService.summarizeConversation
 * UNCHANGED; headline/summary text are built only from what was actually
 * detected, never from unrelated historical group messages (the caller
 * already scoped `messages` to the requested meeting/window). */
function buildSummary(messages, decisions, actionItems) {
  if (!messages.length) {
    return { headline: "No meeting content available", topics: [], summary: "" };
  }
  const { topics } = summarizeConversation(messages);
  const topicWords = topics.map((t) => t.word);

  const headline =
    decisions.length > 0
      ? decisions[0].decision.slice(0, 120)
      : actionItems.length > 0
      ? `${actionItems.length} action item(s) discussed`
      : "Discussion with no confirmed decisions or action items";

  const parts = [];
  if (decisions.length) parts.push(`${decisions.length} decision(s) were made.`);
  if (actionItems.length) parts.push(`${actionItems.length} action item(s) were identified.`);
  if (!decisions.length && !actionItems.length) parts.push("No explicit decisions or action items were detected.");

  return { headline, topics: topicWords, summary: parts.join(" ") };
}

/** Evidence-based outcome classification (spec Phase 17) — never
 * "productive" just because messages exist. */
function classifyOutcome({ messageCount, decisionsCount, actionItemCount, unresolvedCount, openBlockerCount }) {
  if (messageCount === 0) return "INSUFFICIENT_DATA";
  const hasAnyEvidence = decisionsCount > 0 || actionItemCount > 0 || unresolvedCount > 0 || openBlockerCount > 0;
  if (!hasAnyEvidence) return "INSUFFICIENT_DATA";
  if (openBlockerCount > 0 && decisionsCount === 0 && actionItemCount === 0) return "BLOCKED";
  if (unresolvedCount > 0 && decisionsCount === 0 && actionItemCount === 0) return "UNRESOLVED";
  if (unresolvedCount > 0 || openBlockerCount > 0) return "PARTIALLY_RESOLVED";
  return "PRODUCTIVE";
}

/** Transparent, non-psychological signals only (spec Phase 18) — counts,
 * never a claim about a specific person's engagement/state. */
function computeHealthSignals({ decisions, actionItems, unresolvedItems, blockers, followUps }) {
  const assignedActionItemCount = actionItems.filter((a) => a.assigneeStatus === "RESOLVED").length;
  const deadlineDefinedActionItemCount = actionItems.filter((a) => a.deadlineStatus === "RESOLVED").length;
  const openBlockerCount = blockers.filter((b) => b.status === "OPEN").length;
  return {
    decisionsCount: decisions.length,
    actionItemCount: actionItems.length,
    unresolvedItemCount: unresolvedItems.length,
    blockerCount: blockers.length,
    openBlockerCount,
    assignedActionItemCount,
    deadlineDefinedActionItemCount,
    followUpCount: followUps.length,
    ownershipClarity: actionItems.length ? round2(assignedActionItemCount / actionItems.length) : "INSUFFICIENT_DATA",
  };
}

const round2 = (n) => Math.round(n * 100) / 100;

/** Transparent, evidence-based effectiveness score (spec Phase 19) — NOT a
 * second Team Performance score (no psychological/behavioral inputs, only
 * counts already computed above). Returns "INSUFFICIENT_DATA" when there is
 * nothing to score. Formula documented in STEP26_PART1_REPORT.md. */
function computeEffectiveness({ decisionCandidateCount, decisionsCount, actionItemCount, assignedActionItemCount, deadlineDefinedActionItemCount, blockerCount, resolvedBlockerCount }) {
  const hasEvidence = decisionCandidateCount + actionItemCount + blockerCount > 0;
  if (!hasEvidence) return "INSUFFICIENT_DATA";

  const decisionClarity = decisionCandidateCount ? round2(decisionsCount / decisionCandidateCount) : null;
  const ownershipClarity = actionItemCount ? round2(assignedActionItemCount / actionItemCount) : null;
  const deadlineClarity = actionItemCount ? round2(deadlineDefinedActionItemCount / actionItemCount) : null;
  const blockerResolution = blockerCount ? round2(resolvedBlockerCount / blockerCount) : null;

  const dims = [decisionClarity, ownershipClarity, deadlineClarity, blockerResolution].filter((v) => v !== null);
  const overall = dims.length ? Math.round((dims.reduce((s, v) => s + v, 0) / dims.length) * 100) : null;

  return { decisionClarity, ownershipClarity, deadlineClarity, blockerResolution, overall, dimensionsUsed: dims.length };
}

/* ============================================================
 * LAYER 1 — evidence gathering (DB access, group-scoped only)
 * ============================================================ */

/** Plain-object normalization, mirrors conflictDetectionService.normalizeMessage
 * exactly (kept local/duplicated on purpose: it is a 6-line pure mapping,
 * not a scoring formula, and importing a private helper across modules
 * would be more fragile than this one small mirrored function). */
function normalizeMessage(msg) {
  if (!msg) return null;
  return {
    id: msg._id || msg.id,
    senderId: msg.sender ? String(msg.sender._id || msg.sender) : null,
    text: String(msg.text || "").trim(),
    lower: String(msg.text || "").trim().toLowerCase(),
    createdAt: msg.createdAt ? new Date(msg.createdAt) : new Date(),
    group: msg.group ? String(msg.group) : null,
    conversation: msg.conversation || null,
    deleted: Boolean(msg.deleted),
  };
}

/**
 * ONLY place in this module that queries messages. `groupId` is always an
 * ObjectId (never a name) and every returned message is re-verified with
 * isGroupMessage/belongsToGroup (Step 24, unchanged) before being handed to
 * any extractor — a private/direct message or a message from a
 * different/same-name group can never leak in here.
 */
async function gatherMeetingEvidence(groupId, { startTime, endTime, limit = MAX_WINDOW_MESSAGES } = {}) {
  const rawMessages = await Message.find({
    group: groupId,
    deleted: false,
    createdAt: { $gte: startTime, $lte: endTime },
  })
    .sort("createdAt")
    .limit(limit)
    .lean();

  const messages = rawMessages
    .map(normalizeMessage)
    .filter((m) => isGroupMessage(m) && belongsToGroup(m, groupId))
    .map((m) => ({ ...m, id: String(m.id) }));

  const rawTasks = await Task.find({ group: groupId }).lean();
  const tasks = rawTasks.map((t) => ({
    id: String(t._id),
    title: t.title,
    status: t.status,
    priority: t.priority,
    due: t.due || null,
    assignee: t.assignee || null,
  }));

  return { messages, tasks };
}

/**
 * Resolves the (startTime, endTime) window to analyze.
 *   - Explicit startTime/endTime always win.
 *   - Otherwise, if a saved Meeting is given, default to a window starting
 *     at the meeting's scheduled time and running for its durationMins (or
 *     one hour, whichever is longer) — a documented default, never an
 *     invented meeting boundary (spec Phase 4).
 */
function resolveWindow({ meeting, startTime, endTime }) {
  if (startTime && endTime) {
    return { startTime: new Date(startTime), endTime: new Date(endTime) };
  }
  if (meeting) {
    const start = new Date(meeting.when);
    const durationMs = Math.max((meeting.durationMins || 30) * 60000, DEFAULT_MEETING_WINDOW_MS);
    return { startTime: start, endTime: new Date(start.getTime() + durationMs) };
  }
  return { startTime: null, endTime: null };
}

/* ============================================================
 * LAYER 3 — orchestration + persistence
 * ============================================================ */

/**
 * @param {object} group   Mongoose Group doc (needs ._id)
 * @param {Array}  members  trusted group member list [{_id, name}]
 * @param {{meetingId?, startTime?, endTime?, persist?, userId?}} opts
 */
async function analyzeMeetingIntelligence(group, members, opts = {}) {
  const groupId = group._id;
  let meeting = null;
  if (opts.meetingId) {
    meeting = await Meeting.findOne({ _id: opts.meetingId, group: groupId });
    if (!meeting) return { error: "MEETING_NOT_FOUND" };
  }

  const { startTime, endTime } = resolveWindow({ meeting, startTime: opts.startTime, endTime: opts.endTime });
  if (!startTime || !endTime) return { error: "WINDOW_REQUIRED" };
  if (!(startTime instanceof Date) || Number.isNaN(startTime.getTime()) || !(endTime instanceof Date) || Number.isNaN(endTime.getTime())) {
    return { error: "INVALID_WINDOW" };
  }
  if (startTime >= endTime) return { error: "START_AFTER_END" };
  if (endTime.getTime() - startTime.getTime() > MAX_WINDOW_MS) return { error: "WINDOW_TOO_LARGE" };

  const { messages, tasks } = await gatherMeetingEvidence(groupId, { startTime, endTime });

  const { decisions, decisionCandidateCount } = extractDecisions(messages);
  const actionItems = extractActionItemsFromMessages(messages, members, tasks);
  const blockers = extractBlockers(messages, tasks);
  const followUps = extractFollowUps(messages);
  const priorityChanges = extractPriorityChanges(messages);
  const responsibilityChanges = extractResponsibilityChanges(messages);
  const risks = extractRisks(messages);
  const { unresolvedItems, conflicts } = await extractUnresolvedItems(messages, tasks, groupId);
  const summary = buildSummary(messages, decisions, actionItems);

  const openBlockerCount = blockers.filter((b) => b.status === "OPEN").length;
  const resolvedBlockerCount = blockers.length - openBlockerCount;

  const outcome = classifyOutcome({
    messageCount: messages.length,
    decisionsCount: decisions.length,
    actionItemCount: actionItems.length,
    unresolvedCount: unresolvedItems.length,
    openBlockerCount,
  });

  const healthSignals = computeHealthSignals({ decisions, actionItems, unresolvedItems, blockers, followUps });
  const effectiveness = computeEffectiveness({
    decisionCandidateCount,
    decisionsCount: decisions.length,
    actionItemCount: actionItems.length,
    assignedActionItemCount: healthSignals.assignedActionItemCount,
    deadlineDefinedActionItemCount: healthSignals.deadlineDefinedActionItemCount,
    blockerCount: blockers.length,
    resolvedBlockerCount,
  });

  const result = {
    group: groupId,
    meeting: meeting ? meeting._id : null,
    scope: { startTime, endTime },
    sourceMessageIds: messages.map((m) => m.id),
    generatedAt: new Date(),
    summary,
    decisions,
    actionItems,
    blockers,
    unresolvedItems,
    followUps,
    priorityChanges,
    responsibilityChanges,
    risks,
    conflicts,
    outcome,
    healthSignals,
    effectiveness,
  };

  if (opts.persist === false) return result;

  const created = await MeetingIntelligenceSnapshot.create({ ...result, generatedBy: opts.userId || null });
  return created;
}

module.exports = {
  // constants
  MAX_WINDOW_MESSAGES,
  MAX_WINDOW_MS,
  // pure functions (unit-testable, no DB)
  classifyStatement,
  extractDecisions,
  mapPriority,
  extractActionItemsFromMessages,
  findReferencedTask,
  extractBlockers,
  extractFollowUps,
  extractPriorityChanges,
  extractResponsibilityChanges,
  extractRisks,
  buildSummary,
  classifyOutcome,
  computeHealthSignals,
  computeEffectiveness,
  normalizeMessage,
  resolveWindow,
  // DB-touching
  gatherMeetingEvidence,
  extractUnresolvedItems,
  analyzeMeetingIntelligence,
};
