/**
 * STEP 24 — AI Conflict Detection & Resolution.
 *
 * Deterministic, evidence-based rules — no AI-engine call. Documented
 * decision (see STEP24_REPORT.md): the signals this feature needs
 * (explicit contradictions, repeated blocker mentions, ownership claims,
 * stored Task fields) are structured and auditable; a rule-based approach
 * keeps every conflict traceable to specific message IDs and stored task
 * fields, which matters for an assistive, human-reviewed feature like this
 * far more than semantic fluency would.
 *
 * PRIVACY: every function in this file only ever operates on messages the
 * caller has already filtered to a single group's GROUP chat (see
 * isGroupMessage/belongsToGroup, and gatherGroupConflictEvidence's
 * Message.find({ group: groupId }) — the same field private/direct
 * messages never set). Nothing here ever queries by `conversation`.
 *
 * Architecture (mirrors sprintPlannerService.js / teamRiskAnalyzer.js):
 *   LAYER 1 — evidence gathering (DB access, group-scoped only)
 *   LAYER 2 — pure detection/classification functions (no DB, testable)
 *   LAYER 3 — orchestration + persistence (dedup, notify)
 *
 * NEUTRAL LANGUAGE: every string this module ever produces (title,
 * summary, evidence line, recommendation) describes the SITUATION, never a
 * person — no blame, no personality/mental-health language. Nothing here
 * interpolates raw message text into a summary, only counts/subjects/task
 * titles.
 */
const Message = require("../models/Message");
const Task = require("../models/Task");
const ConflictSnapshot = require("../models/ConflictSnapshot");
const { notifyUsers } = require("./notificationService");

const RECENT_MESSAGE_LIMIT = 60; // incremental analysis — never the full chat history (spec §40)

/* ============================================================
 * LAYER 2A — message normalization & privacy guards (pure)
 * ============================================================ */

/** Plain-object normalization — accepts a Mongoose doc or lean object. */
function normalizeMessage(msg) {
  if (!msg) return null;
  return {
    id: String(msg._id || msg.id),
    senderId: msg.sender ? String(msg.sender._id || msg.sender) : null,
    text: String(msg.text || "").trim(),
    lower: String(msg.text || "").trim().toLowerCase(),
    createdAt: msg.createdAt ? new Date(msg.createdAt) : new Date(),
    group: msg.group ? String(msg.group) : null,
    conversation: msg.conversation || null,
    deleted: Boolean(msg.deleted),
  };
}

/** A message is eligible for conflict analysis ONLY if it is a real GROUP
 * chat message — has `group` set and `conversation` unset. Mirrors exactly
 * how Message.js itself distinguishes the two (see chatController.js:
 * sendGroupMessage sets group+no conversation; sendDirectMessage sets
 * conversation+no group). Never inferred from message text. */
function isGroupMessage(msg) {
  if (!msg) return false;
  return Boolean(msg.group) && !msg.conversation && !msg.deleted;
}

/** Isolation is always by groupId, NEVER group name (spec §2/§41). */
function belongsToGroup(msg, groupId) {
  return Boolean(msg?.group) && String(msg.group) === String(groupId);
}

/* ============================================================
 * shared text helpers
 * ============================================================ */

const STOPWORDS = new Set(["the", "a", "an", "this", "that", "it", "to", "for", "of", "on", "in", "is", "are", "will", "be"]);

function normalizeSubject(raw) {
  return String(raw || "")
    .toLowerCase()
    .replace(/[.!?,]+$/g, "")
    .trim();
}

function subjectTokens(subject) {
  return normalizeSubject(subject)
    .split(/\s+/)
    .filter((t) => t && !STOPWORDS.has(t));
}

function tokenOverlap(aTokens, bTokens) {
  if (!aTokens.length || !bTokens.length) return 0;
  const setB = new Set(bTokens);
  const shared = aTokens.filter((t) => setB.has(t)).length;
  return shared / Math.min(aTokens.length, bTokens.length);
}

/** Finds an actual, existing task whose title overlaps the given subject —
 * never invents a task association (spec §9-A/§14). */
function matchTask(subject, tasks = []) {
  const subjTokens = subjectTokens(subject);
  if (!subjTokens.length) return null;
  let best = null;
  let bestScore = 0;
  tasks.forEach((t) => {
    const score = tokenOverlap(subjTokens, subjectTokens(t.title));
    if (score > bestScore && score >= 0.5) {
      bestScore = score;
      best = t;
    }
  });
  return best;
}

/* ============================================================
 * LAYER 2B — detection functions (pure; operate on already
 * group-filtered, normalized messages)
 * ============================================================ */

const OWNERSHIP_CLAIM_RE = /\bi(?:'ll| will|'m| am)\s+(?:be\s+)?(?:handling|handle|doing|do|taking|take|own|owning)\s+(.+)/i;

function detectTaskOwnershipConflict(messages, { tasks = [] } = {}) {
  const claims = [];
  messages.forEach((m) => {
    const match = m.text.match(OWNERSHIP_CLAIM_RE);
    if (!match) return;
    claims.push({ senderId: m.senderId, subject: normalizeSubject(match[1]), messageId: m.id, createdAt: m.createdAt });
  });

  const bySubject = new Map();
  claims.forEach((c) => {
    // Group by token-overlap rather than exact string match so "the API"
    // and "the API integration" are recognized as the same claim.
    let bucket = null;
    for (const key of bySubject.keys()) {
      if (tokenOverlap(subjectTokens(c.subject), subjectTokens(key)) >= 0.5) {
        bucket = key;
        break;
      }
    }
    if (!bucket) bucket = c.subject;
    if (!bySubject.has(bucket)) bySubject.set(bucket, []);
    bySubject.get(bucket).push(c);
  });

  const conflicts = [];
  bySubject.forEach((group, subject) => {
    const distinctSenders = [...new Set(group.map((g) => g.senderId))];
    if (distinctSenders.length < 2) return; // same person restating ownership is not a conflict
    const task = matchTask(subject, tasks);
    conflicts.push({
      type: "TASK_OWNERSHIP",
      involvedUserIds: distinctSenders,
      relatedTaskId: task ? String(task.id) : null,
      sourceMessageIds: group.map((g) => g.messageId),
      normalizedIssueKey: subject,
      title: task ? `Task ownership unclear: ${task.title}` : "Task ownership unclear",
      summary: "Multiple members stated they are handling the same work. Ownership has not been explicitly confirmed.",
      evidence: ["Two or more members claimed responsibility for the same work in group chat."],
    });
  });
  return conflicts;
}

const POSITIVE_DECISION_RE = /\b(?:we agreed to use|we decided to use|we will use|let'?s use|use)\s+([a-z0-9_+.\-]+)/i;
const NEGATION_DECISION_RE = /\bno,?\s+(?:we\s+)?(?:decided|agreed)?\s*(?:to use\s+)?(?:use\s+)?([a-z0-9_+.\-]+)/i;
const SOFT_SUGGESTION_RE = /\b(?:should we|what about|maybe|i think|perhaps|could)\b/i;

function detectConflictingInstructions(messages) {
  const positives = [];
  const negations = [];
  messages.forEach((m) => {
    if (SOFT_SUGGESTION_RE.test(m.text)) return; // healthy discussion, not an instruction
    const isNegation = /^\s*no[,.]?\b/i.test(m.text);
    if (isNegation) {
      const match = m.text.match(NEGATION_DECISION_RE);
      if (match) negations.push({ senderId: m.senderId, value: match[1].toLowerCase(), messageId: m.id, createdAt: m.createdAt });
      return;
    }
    const match = m.text.match(POSITIVE_DECISION_RE);
    if (match) positives.push({ senderId: m.senderId, value: match[1].toLowerCase(), messageId: m.id, createdAt: m.createdAt });
  });

  const conflicts = [];
  negations.forEach((neg) => {
    const contradicted = positives.find(
      (pos) => pos.senderId !== neg.senderId && pos.value !== neg.value && pos.createdAt <= neg.createdAt
    );
    if (!contradicted) return;
    conflicts.push({
      type: "CONFLICTING_INSTRUCTIONS",
      involvedUserIds: [...new Set([contradicted.senderId, neg.senderId])],
      relatedTaskId: null,
      sourceMessageIds: [contradicted.messageId, neg.messageId],
      normalizedIssueKey: `${contradicted.value}|${neg.value}`,
      title: "Conflicting instructions",
      summary: "The discussion contains contradictory instructions or decisions that have not been resolved.",
      evidence: [`One message states "${contradicted.value}" and a later message states "${neg.value}" instead.`],
    });
  });
  return conflicts;
}

const NOT_ASSIGNED_RE = /\b(?:you never assigned|it was never assigned|no one assigned|not assigned to me|i wasn'?t assigned)\b/i;
const ASSIGNED_CLAIM_RE = /\bi (?:already )?assigned\b/i;
const NOT_COMPLETED_RE = /\b(?:still not done|isn'?t done|not (?:yet )?(?:done|completed|finished))\b/i;
const COMPLETED_CLAIM_RE = /\b(?:i|it|this) (?:already )?(?:completed|finished|is done|was completed)\b/i;

function detectResponsibilityAmbiguity(messages) {
  const conflicts = [];

  const assignedClaims = messages.filter((m) => ASSIGNED_CLAIM_RE.test(m.text));
  const notAssignedClaims = messages.filter((m) => NOT_ASSIGNED_RE.test(m.text));
  if (assignedClaims.length && notAssignedClaims.length) {
    const a = assignedClaims[0];
    const b = notAssignedClaims.find((x) => x.senderId !== a.senderId) || notAssignedClaims[0];
    if (b.senderId !== a.senderId) {
      conflicts.push({
        type: "RESPONSIBILITY_AMBIGUITY",
        involvedUserIds: [...new Set([a.senderId, b.senderId])],
        relatedTaskId: null,
        sourceMessageIds: [a.id, b.id],
        normalizedIssueKey: "assignment-dispute",
        title: "Task assignment unclear",
        summary: "Members disagree about whether this work was actually assigned.",
        evidence: ["One member says the work was assigned; another says it was not."],
      });
    }
  }

  const completedClaims = messages.filter((m) => COMPLETED_CLAIM_RE.test(m.text));
  const notCompletedClaims = messages.filter((m) => NOT_COMPLETED_RE.test(m.text));
  if (completedClaims.length && notCompletedClaims.length) {
    const a = completedClaims[0];
    const b = notCompletedClaims.find((x) => x.senderId !== a.senderId) || notCompletedClaims[0];
    if (b.senderId !== a.senderId) {
      conflicts.push({
        type: "RESPONSIBILITY_AMBIGUITY",
        involvedUserIds: [...new Set([a.senderId, b.senderId])],
        relatedTaskId: null,
        sourceMessageIds: [a.id, b.id],
        normalizedIssueKey: "completion-dispute",
        title: "Task completion status unclear",
        summary: "Members disagree about whether this work has actually been completed.",
        evidence: ["One member reports the work as complete; another reports it is not."],
      });
    }
  }

  return conflicts;
}

/** Structured, task-driven — not message-dependent (spec §9-D). */
function detectDuplicateWork(tasks = []) {
  const open = tasks.filter((t) => t.status !== "done" && t.status !== "completed");
  const conflicts = [];
  const seen = new Set();
  for (let i = 0; i < open.length; i += 1) {
    for (let j = i + 1; j < open.length; j += 1) {
      const a = open[i];
      const b = open[j];
      const key = [a.id, b.id].sort().join("|");
      if (seen.has(key)) continue;
      if (!a.assignee || !b.assignee || String(a.assignee) === String(b.assignee)) continue;
      const score = tokenOverlap(subjectTokens(a.title), subjectTokens(b.title));
      if (score < 0.6) continue;
      seen.add(key);
      conflicts.push({
        type: "DUPLICATE_WORK",
        involvedUserIds: [...new Set([String(a.assignee), String(b.assignee)])],
        relatedTaskId: String(a.id),
        sourceMessageIds: [],
        normalizedIssueKey: key,
        title: `Possible duplicate work: ${a.title}`,
        summary: `"${a.title}" and "${b.title}" appear to overlap and are assigned to different members.`,
        evidence: [`Two open tasks with similar titles are assigned to different members.`],
      });
    }
  }
  return conflicts;
}

const BLOCKER_RE = /\b(?:blocked|blocking|can'?t continue|cannot continue|still waiting|cannot proceed|can'?t proceed)\b/i;
const BLOCKER_SUBJECT_RE = /\b(?:because of|because|due to|on|for)\s+(?:the\s+)?([a-z0-9 _\-]{2,40})/i;
const RESOLVE_RE = /\b(?:unblocked|resolved|fixed|no longer blocked|ready now|is ready|is done now)\b/i;

function detectUnresolvedBlocker(messages, { tasks = [] } = {}) {
  const sorted = [...messages].sort((a, b) => a.createdAt - b.createdAt);
  const mentions = [];
  sorted.forEach((m) => {
    if (!BLOCKER_RE.test(m.text)) return;
    const subjectMatch = m.text.match(BLOCKER_SUBJECT_RE);
    mentions.push({ ...m, subject: subjectMatch ? normalizeSubject(subjectMatch[1]) : null });
  });
  if (mentions.length < 2) return []; // one-time blocker is not necessarily a conflict (spec test 25)

  // Group mentions by subject overlap (or "general" bucket if no subject captured).
  const buckets = new Map();
  mentions.forEach((m) => {
    const key = m.subject || "general";
    let bucket = null;
    for (const existing of buckets.keys()) {
      if (existing === "general" || key === "general") continue;
      if (tokenOverlap(subjectTokens(key), subjectTokens(existing)) >= 0.5) {
        bucket = existing;
        break;
      }
    }
    if (!bucket) bucket = key;
    if (!buckets.has(bucket)) buckets.set(bucket, []);
    buckets.get(bucket).push(m);
  });

  const conflicts = [];
  buckets.forEach((group, subject) => {
    if (group.length < 2) return;
    const lastMentionAt = group[group.length - 1].createdAt;
    const resolvedAfter = sorted.some((m) => RESOLVE_RE.test(m.text) && m.createdAt > lastMentionAt);
    if (resolvedAfter) return; // resolved blocker is not reopened (spec test 26)

    const task = subject !== "general" ? matchTask(subject, tasks) : null;
    conflicts.push({
      type: "UNRESOLVED_BLOCKER",
      involvedUserIds: [...new Set(group.map((g) => g.senderId))],
      relatedTaskId: task ? String(task.id) : null,
      sourceMessageIds: group.map((g) => g.id),
      normalizedIssueKey: subject,
      title: task ? `Unresolved blocker: ${task.title}` : "Unresolved blocker",
      summary: "A blocker has been mentioned more than once and does not appear to be resolved yet.",
      evidence: [`The same blocker was referenced ${group.length} times without a follow-up resolution message.`],
    });
  });
  return conflicts;
}

const DEADLINE_KEYWORD_RE = /\b(?:deadline|due|finish by|complete by|delivering by)\b/i;
const DATE_TOKEN_RE = /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?|\d{4}-\d{2}-\d{2})\b/i;

function detectDeadlineDisagreement(messages, { tasks = [] } = {}) {
  const claims = [];
  messages.forEach((m) => {
    if (!DEADLINE_KEYWORD_RE.test(m.text)) return;
    const dateMatch = m.text.match(DATE_TOKEN_RE);
    if (!dateMatch) return;
    claims.push({ senderId: m.senderId, date: dateMatch[1].toLowerCase(), messageId: m.id, createdAt: m.createdAt, text: m.text });
  });

  const conflicts = [];
  for (let i = 0; i < claims.length; i += 1) {
    for (let j = i + 1; j < claims.length; j += 1) {
      const a = claims[i];
      const b = claims[j];
      if (a.senderId === b.senderId || a.date === b.date) continue;
      const task = matchTask(`${a.text} ${b.text}`, tasks);
      conflicts.push({
        type: "DEADLINE_DISAGREEMENT",
        involvedUserIds: [...new Set([a.senderId, b.senderId])],
        relatedTaskId: task ? String(task.id) : null,
        sourceMessageIds: [a.messageId, b.messageId],
        normalizedIssueKey: [a.date, b.date].sort().join("|"),
        title: "Deadline disagreement",
        summary: task
          ? `Group chat mentions conflicting dates; the task's stored due date should be treated as the source of truth.`
          : "Group chat contains conflicting statements about a deadline.",
        evidence: [`Different dates ("${a.date}" and "${b.date}") were mentioned as the deadline.`],
        // The AI never invents or overrides a due date — it only ever
        // reports the actual stored value alongside the disagreement.
        storedDueDate: task?.due || null,
      });
      return conflicts; // one clear pairing is enough evidence; avoid combinatorial duplicates
    }
  }
  return conflicts;
}

const PRIORITY_KEYWORD_RE = /\b(highest priority|top priority|most important|most urgent)\b/i;

function detectPriorityDisagreement(messages, { tasks = [] } = {}) {
  const claims = [];
  messages.forEach((m) => {
    if (!PRIORITY_KEYWORD_RE.test(m.text)) return;
    // Subject = whatever task-like noun phrase appears in the same message,
    // matched against real task titles — never invented.
    const task = matchTask(m.text, tasks);
    claims.push({ senderId: m.senderId, messageId: m.id, createdAt: m.createdAt, task });
  });

  const conflicts = [];
  for (let i = 0; i < claims.length; i += 1) {
    for (let j = i + 1; j < claims.length; j += 1) {
      const a = claims[i];
      const b = claims[j];
      if (a.senderId === b.senderId) continue;
      if (!a.task || !b.task || String(a.task.id) === String(b.task.id)) continue;
      conflicts.push({
        type: "PRIORITY_DISAGREEMENT",
        involvedUserIds: [...new Set([a.senderId, b.senderId])],
        relatedTaskId: String(a.task.id),
        sourceMessageIds: [a.messageId, b.messageId],
        normalizedIssueKey: [a.task.id, b.task.id].sort().join("|"),
        title: "Priority disagreement",
        summary: "Different members named different tasks as the top priority. The project's stored task priorities should be confirmed against this.",
        evidence: [`"${a.task.title}" and "${b.task.title}" were each named as top priority by different members.`],
        storedPriorities: { [String(a.task.id)]: a.task.priority, [String(b.task.id)]: b.task.priority },
      });
      return conflicts;
    }
  }
  return conflicts;
}

const DISAGREEMENT_MARKER_RE = /\b(?:no,|that'?s not right|i disagree|that'?s wrong|incorrect,)\b/i;

function detectRepeatedDisagreement(messages) {
  const markers = messages.filter((m) => DISAGREEMENT_MARKER_RE.test(m.text) && !SOFT_SUGGESTION_RE.test(m.text));
  if (markers.length < 3) return []; // require a real back-and-forth, not one disagreement (spec test 36)

  const senders = [...new Set(markers.map((m) => m.senderId))];
  if (senders.length < 2) return [];

  return [
    {
      type: "REPEATED_DISAGREEMENT",
      involvedUserIds: senders,
      relatedTaskId: null,
      sourceMessageIds: markers.map((m) => m.id),
      normalizedIssueKey: "repeated-disagreement",
      title: "Repeated unresolved disagreement",
      summary: "The same disagreement has recurred multiple times without a recorded resolution.",
      evidence: [`${markers.length} messages show recurring disagreement between members without resolution.`],
    },
  ];
}

/** Escalation is derived from OTHER candidates' structural signals only —
 * never from raw message sentiment/emotional wording (spec §9-I). */
function detectEscalationRisk(candidateConflicts = [], { tasks = [], now = new Date() } = {}) {
  const escalating = candidateConflicts.filter((c) => {
    if (c.type !== "UNRESOLVED_BLOCKER" && c.type !== "REPEATED_DISAGREEMENT") return false;
    const multipleMembers = (c.involvedUserIds || []).length >= 2;
    const repeatedEvidence = (c.sourceMessageIds || []).length >= 3;
    const task = c.relatedTaskId ? tasks.find((t) => String(t.id) === String(c.relatedTaskId)) : null;
    const deadlineImpact = task?.due ? new Date(task.due) <= new Date(now.getTime() + 2 * 86400000) : false;
    return multipleMembers && (repeatedEvidence || deadlineImpact);
  });
  if (!escalating.length) return [];

  const involvedUserIds = [...new Set(escalating.flatMap((c) => c.involvedUserIds))];
  const sourceMessageIds = [...new Set(escalating.flatMap((c) => c.sourceMessageIds))];
  return [
    {
      type: "ESCALATION_RISK",
      involvedUserIds,
      relatedTaskId: escalating.find((c) => c.relatedTaskId)?.relatedTaskId || null,
      sourceMessageIds,
      normalizedIssueKey: "escalation",
      title: "Collaboration issue affecting project execution",
      summary: "An unresolved issue is now affecting multiple members and/or project timing and may need Guide/Team Leader attention.",
      evidence: [`${escalating.length} unresolved issue(s) show signs of affecting project execution.`],
    },
  ];
}

/* ============================================================
 * LAYER 2C — severity, fingerprint, dedup, recommendations
 * ============================================================ */

/** Categorical, evidence-based (spec §10) — not a numeric score. */
function classifySeverity(conflict, { task = null, now = new Date() } = {}) {
  if (conflict.type === "ESCALATION_RISK") return "CRITICAL";

  const multipleMembers = (conflict.involvedUserIds || []).length >= 2;
  const overdue = task?.due ? new Date(task.due) < now : false;
  const dueSoon = task?.due ? new Date(task.due) - now <= 2 * 86400000 && !overdue : false;
  const repeatedEvidence = (conflict.sourceMessageIds || []).length >= 3;

  if (overdue && multipleMembers) return "CRITICAL";
  if (task && (overdue || dueSoon)) return "HIGH";
  if (conflict.type === "UNRESOLVED_BLOCKER" && repeatedEvidence) return "HIGH";
  if (task || multipleMembers) return "MEDIUM";
  return "LOW";
}

/** Deterministic identity for deduplication (spec §11). Never message text
 * alone — built only from stable fields (group, type, sorted member ids,
 * related task, normalized issue key). */
function buildConflictFingerprint({ groupId, type, involvedUserIds = [], relatedTaskId = null, normalizedIssueKey = "" }) {
  const sortedUsers = [...new Set(involvedUserIds.map(String))].sort().join(",");
  return [String(groupId), type, sortedUsers, relatedTaskId ? String(relatedTaskId) : "none", normalizedIssueKey || ""].join("::");
}

/** Merges same-fingerprint candidates from a single detection pass into one
 * record, unioning evidence/messages/members (never dropped, never
 * duplicated in the persisted collection — spec §11). */
function deduplicateConflicts(candidates, groupId) {
  const byFingerprint = new Map();
  candidates.forEach((c) => {
    const fingerprint = buildConflictFingerprint({
      groupId,
      type: c.type,
      involvedUserIds: c.involvedUserIds,
      relatedTaskId: c.relatedTaskId,
      normalizedIssueKey: c.normalizedIssueKey,
    });
    if (!byFingerprint.has(fingerprint)) {
      byFingerprint.set(fingerprint, { ...c, fingerprint, involvedUserIds: [...new Set(c.involvedUserIds)], sourceMessageIds: [...new Set(c.sourceMessageIds)] });
      return;
    }
    const existing = byFingerprint.get(fingerprint);
    existing.involvedUserIds = [...new Set([...existing.involvedUserIds, ...c.involvedUserIds])];
    existing.sourceMessageIds = [...new Set([...existing.sourceMessageIds, ...c.sourceMessageIds])];
    existing.evidence = [...new Set([...(existing.evidence || []), ...(c.evidence || [])])];
  });
  return [...byFingerprint.values()];
}

const RECOMMENDATION_TEMPLATES = {
  TASK_OWNERSHIP: { recommendation: "Confirm one owner for the task and update the existing task assignment.", nextAction: "Confirm task owner" },
  CONFLICTING_INSTRUCTIONS: { recommendation: "Ask the Guide/Team Leader to confirm the final implementation decision.", nextAction: "Confirm final decision" },
  RESPONSIBILITY_AMBIGUITY: { recommendation: "Review the task assignment and confirm responsibility in the group chat.", nextAction: "Confirm responsibility" },
  DUPLICATE_WORK: { recommendation: "Check whether the overlapping work should be merged or divided.", nextAction: "Review overlapping tasks" },
  UNRESOLVED_BLOCKER: { recommendation: "Identify the dependency owner and set a concrete unblock action.", nextAction: "Unblock dependency" },
  DEADLINE_DISAGREEMENT: { recommendation: "Use the task's stored due date as the source of truth and confirm it with the team.", nextAction: "Confirm due date" },
  PRIORITY_DISAGREEMENT: { recommendation: "Confirm priority against the project's current task priorities.", nextAction: "Confirm priority" },
  REPEATED_DISAGREEMENT: { recommendation: "Hold a short decision-focused discussion and record the final decision.", nextAction: "Resolve open question" },
  ESCALATION_RISK: { recommendation: "Guide/Team Leader should review the issue because it is affecting project execution.", nextAction: "Guide/Leader review" },
};

function buildResolutionRecommendation(type) {
  return RECOMMENDATION_TEMPLATES[type] || { recommendation: "Review the situation with the team.", nextAction: "Review" };
}

/** Student-safe shaping — only fields explicitly listed in spec §22, and
 * only for a student who is actually involved (their own task/work). */
function shapeForStudent(conflict, userId) {
  const involved = (conflict.involvedUserIds || []).map(String).includes(String(userId));
  if (!involved) return null;
  return {
    conflictId: String(conflict._id || conflict.id),
    type: conflict.type,
    severity: conflict.severity,
    relatedTaskId: conflict.relatedTaskId ? String(conflict.relatedTaskId) : null,
    title: conflict.title,
    summary: conflict.summary,
    nextAction: conflict.nextAction,
  };
}

/* ============================================================
 * LAYER 2D — lifecycle transition rules (pure; spec §12)
 * ============================================================ */

const LIFECYCLE_RULES = {
  acknowledge: { from: ["OPEN"], to: "ACKNOWLEDGED" },
  resolve: { from: ["OPEN", "ACKNOWLEDGED"], to: "RESOLVED" },
  dismiss: { from: ["OPEN", "ACKNOWLEDGED"], to: "DISMISSED" },
};

/** Never mutates the input, never touches `evidence` — resolving/dismissing
 * only ever changes status/resolvedAt/resolvedBy/resolutionNote; the
 * evidence/sourceMessageIds trail is preserved forever (spec §12). */
function applyLifecycleTransition(currentStatus, action) {
  const rule = LIFECYCLE_RULES[action];
  if (!rule || !rule.from.includes(currentStatus)) {
    return { ok: false, reason: `Cannot ${action} a conflict with status ${currentStatus}` };
  }
  return { ok: true, status: rule.to };
}

/** Only ever stores what the user actually typed — never fabricated
 * (spec §24). Trims and caps length; nothing else is added or inferred. */
function sanitizeResolutionNote(note) {
  if (typeof note !== "string") return "";
  return note.trim().slice(0, 1000);
}

/* ============================================================
 * LAYER 1 — evidence gathering (DB access, group-scoped only)
 * ============================================================ */

async function gatherGroupConflictEvidence(groupId, { limit = RECENT_MESSAGE_LIMIT } = {}) {
  // Group isolation key is ALWAYS groupId (an ObjectId), never group name
  // (spec §2/§41) — and this query only ever matches documents that have
  // `group` set, which private/direct messages never do (see Message.js).
  const rawMessages = await Message.find({ group: groupId, deleted: false })
    .sort("-createdAt")
    .limit(limit)
    .lean();
  const messages = rawMessages.map(normalizeMessage).filter((m) => isGroupMessage(m) && belongsToGroup(m, groupId));

  const tasks = await Task.find({ group: groupId }).lean();
  const plainTasks = tasks.map((t) => ({
    id: String(t._id),
    title: t.title,
    status: t.status,
    priority: t.priority,
    due: t.due || null,
    assignee: t.assignee || null,
  }));

  return { messages: messages.reverse(), tasks: plainTasks }; // chronological order
}

/* ============================================================
 * LAYER 3 — orchestration + persistence
 * ============================================================ */

function runDetectors(messages, tasks, now = new Date()) {
  const structural = [
    ...detectTaskOwnershipConflict(messages, { tasks }),
    ...detectConflictingInstructions(messages),
    ...detectResponsibilityAmbiguity(messages),
    ...detectDuplicateWork(tasks),
    ...detectUnresolvedBlocker(messages, { tasks }),
    ...detectDeadlineDisagreement(messages, { tasks }),
    ...detectPriorityDisagreement(messages, { tasks }),
    ...detectRepeatedDisagreement(messages),
  ];
  const escalation = detectEscalationRisk(structural, { tasks, now });
  return [...structural, ...escalation];
}

/** Fire-and-forget entry point, called (never awaited) from
 * chatController.sendGroupMessage alongside the existing
 * processGroupMessageForTasks call. Never throws — every failure is caught
 * by the caller, same pattern as chatTaskService.js, so a bug here can
 * never break message sending. */
async function analyzeGroupMessageForConflicts({ group }) {
  const groupId = group._id || group.id;
  const { messages, tasks } = await gatherGroupConflictEvidence(groupId);
  if (messages.length < 2) return []; // not enough evidence to detect anything meaningful

  const candidates = runDetectors(messages, tasks);
  const deduped = deduplicateConflicts(candidates, groupId);

  const results = [];
  for (const c of deduped) {
    const task = c.relatedTaskId ? tasks.find((t) => String(t.id) === String(c.relatedTaskId)) : null;
    const severity = classifySeverity(c, { task });
    const { recommendation, nextAction } = buildResolutionRecommendation(c.type);

    // eslint-disable-next-line no-await-in-loop -- small, bounded list (one group's worth of candidates)
    const existing = await ConflictSnapshot.findOne({ group: groupId, fingerprint: c.fingerprint });
    if (existing) {
      if (existing.status === "RESOLVED" || existing.status === "DISMISSED") {
        results.push(existing); // do not reopen a resolved/dismissed conflict just because old evidence matched again
        continue;
      }
      existing.sourceMessageIds = [...new Set([...(existing.sourceMessageIds || []).map(String), ...c.sourceMessageIds])];
      existing.evidence = [...new Set([...(existing.evidence || []), ...(c.evidence || [])])];
      existing.evidenceCount = (existing.evidenceCount || 1) + 1;
      existing.lastEvidenceAt = new Date();
      existing.severity = severity;
      // eslint-disable-next-line no-await-in-loop
      await existing.save();
      results.push(existing);
      continue;
    }

    // eslint-disable-next-line no-await-in-loop
    const created = await ConflictSnapshot.create({
      group: groupId,
      type: c.type,
      severity,
      status: "OPEN",
      involvedUserIds: c.involvedUserIds,
      relatedTaskId: c.relatedTaskId,
      sourceMessageIds: c.sourceMessageIds,
      title: c.title,
      summary: c.summary,
      evidence: c.evidence,
      recommendation,
      nextAction,
      fingerprint: c.fingerprint,
    });
    results.push(created);

    // Notification rules per spec §17: LOW = none, MEDIUM/HIGH/CRITICAL =
    // Guide/Team Leader only. Never all students, never per-message spam
    // (this only fires once per NEW conflict record, not per message).
    if (severity !== "LOW") {
      const recipients = [group.guide, group.leader].filter(Boolean).map(String);
      if (recipients.length) {
        // eslint-disable-next-line no-await-in-loop
        await notifyUsers(
          [...new Set(recipients)],
          {
            type: "risk",
            title: "AI detected a possible collaboration issue",
            body: created.title,
            group: groupId,
          }
        ).catch(() => {}); // notification failure must never break chat (spec §17/§39)
      }
    }
  }

  return results;
}

module.exports = {
  // constants
  RECENT_MESSAGE_LIMIT,
  // pure functions
  normalizeMessage,
  isGroupMessage,
  belongsToGroup,
  // STEP 27 (Project Knowledge & Decision Memory) reuses these text-overlap
  // helpers unchanged for its own supersession/conflict token comparisons,
  // instead of re-implementing subject/token matching a second time — see
  // projectKnowledgeService.js. No detection logic here is modified.
  normalizeSubject,
  subjectTokens,
  tokenOverlap,
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
  runDetectors,
  // orchestration
  gatherGroupConflictEvidence,
  analyzeGroupMessageForConflicts,
};
