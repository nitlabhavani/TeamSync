/**
 * Pure helpers for turning an AI-detected chat task candidate into a real
 * Task input — deliberately DB-free (no mongoose import), same philosophy
 * as projectPlanTaskService.js: this module never talks to Mongo and never
 * trusts an AI-supplied id blindly. chatTaskService.js is the one place
 * responsible for authorization, persistence and duplicate protection.
 */
const VALID_PRIORITIES = new Set(["low", "medium", "high", "critical"]);

/**
 * Re-validates one AI-suggested assignment against the group's real roster.
 * Matches by NAME (never trusts an AI-supplied id) against `members`, which
 * the caller must have populated straight from the DB — this is the same
 * "AI suggests by name, backend resolves against real users" principle
 * used by projectPlanTaskService.resolveAssignments for the existing AI
 * Project Plan flow.
 *
 * @param {{assigneeName?: string}} candidate one task candidate from the AI response
 * @param {Array<{_id: any, name: string}>} members the group's real, current members
 * @returns {{member: object|null, reason: string|null}}
 */
function nameTokens(s) {
  return String(s || "").trim().toLowerCase().split(/\s+/).filter(Boolean);
}

function resolveAssignee(candidate, members) {
  const name = String(candidate?.assigneeName || "").trim();
  if (!name) return { member: null, reason: "missing_assignee_name" };

  const low = name.toLowerCase();
  const exact = members.filter((m) => String(m.name || "").trim().toLowerCase() === low);

  let pool = exact;
  if (!pool.length) {
    // Same "any word order" / "first name only" fallback used by the AI
    // engine and its Node heuristic, kept here so a candidate re-validated
    // against the group's real roster is never rejected on a technicality
    // (e.g. a reversed full name) that the extractor itself already accepts.
    const mentionTokens = nameTokens(name);
    if (mentionTokens.length > 1) {
      const mentionSet = new Set(mentionTokens);
      pool = members.filter((m) => {
        const mTokens = nameTokens(m.name);
        return mTokens.length === mentionSet.size && mTokens.every((t) => mentionSet.has(t));
      });
    } else {
      pool = members.filter((m) => String(m.name || "").trim().split(" ")[0].toLowerCase() === low);
    }
  }

  if (!pool.length) return { member: null, reason: "not_a_member_of_this_group" };
  if (pool.length > 1) return { member: null, reason: "ambiguous_name_multiple_members_match" };
  return { member: pool[0], reason: null };
}

/**
 * Builds the plain object passed to Task.create for one resolved candidate.
 * Never invents a title/description beyond what the AI extracted; falls
 * back to safe defaults rather than throwing on a malformed candidate.
 *
 * @param {object} candidate the AI task candidate (title/description/priority/dueDate)
 * @param {{groupId: any, senderId: any, memberId: any, sourceMessageId: any}} ctx
 */
function buildTaskInput(candidate, { groupId, senderId, memberId, sourceMessageId }) {
  const title = String(candidate?.title || "").trim().slice(0, 200) || "Untitled task";
  const description = String(candidate?.description || "").trim().slice(0, 2000);
  const priority = VALID_PRIORITIES.has(candidate?.priority) ? candidate.priority : "medium";
  const due = candidate?.dueDate ? new Date(candidate.dueDate) : undefined;

  return {
    group: groupId,
    title,
    description,
    whatToDo: candidate?.whatToDo || description,
    expectedOutput: candidate?.expectedOutput || `Working deliverable for ${title}`,
    deliverableType: candidate?.deliverableType || "",
    completionCriteria: Array.isArray(candidate?.completionCriteria) ? candidate.completionCriteria : [],
    assignee: memberId,
    createdBy: senderId,
    status: "pending",
    progress: 0,
    priority,
    ...(due && !Number.isNaN(due.getTime()) ? { due } : {}),
    source: "ai_chat",
    sourceMessageId,
  };
}

module.exports = { resolveAssignee, buildTaskInput };
