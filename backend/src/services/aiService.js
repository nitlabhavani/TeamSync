/**
 * Rule-based "AI" helpers. No external API needed — deterministic heuristics
 * over the project's own data. Swap internals for an LLM call later; the
 * exported signatures are designed to stay stable.
 */

const DECISION_HINTS = ["agreed", "decided", "we will", "confirmed", "final", "chose", "settled"];
const ACTION_HINTS = ["will ", "owns", "to do", "next step", "action", "share", "prepare", "send", "assign"];
const RISK_HINTS = ["blocked", "risk", "delay", "behind", "issue", "problem", "waiting", "may need", "concern"];

const splitSentences = (text = "") =>
  text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 12);

const matches = (sentence, hints) => {
  const low = sentence.toLowerCase();
  return hints.some((h) => low.includes(h));
};

/**
 * STEP 16 — Feature 1: Meeting Action-Item Extraction.
 *
 * Purely additive, standalone function — does NOT modify summarizeMeetingNotes
 * above (that stays exactly as-is so every existing meeting/summary flow is
 * untouched). Deterministic/rule-based, same family of heuristics already
 * used by summarizeMeetingNotes/ACTION_HINTS above, extended with:
 *   - multi-word owner matching against the group's real member list
 *     (never invents a name, and never trusts a name from client input —
 *     callers must pass the group's own member list)
 *   - deadline phrase extraction (or null when none is stated)
 *   - a simple, transparent HIGH/MEDIUM/LOW priority heuristic
 *   - a 0–1 confidence score reflecting how much was actually detected
 *
 * Never executes the input text — it is only ever scanned with string/regex
 * operations, never eval'd, required, or passed to a shell.
 */
const ACTION_ITEM_HINTS = [
  "will ",
  "needs to",
  "need to",
  "should ",
  "must ",
  "responsible for",
  "assigned to",
  "to complete",
  "to finish",
  "to implement",
  "to fix",
  "to update",
  "to test",
  "complete ",
  "finish ",
  "implement ",
  "fix ",
  "update ",
  "test ",
];
const STRONG_ACTION_VERBS = ["finish", "implement", "fix", "complete", "resolve", "deploy"];
const URGENCY_HINTS = ["urgent", "asap", "critical", "immediately", "must ", "important"];
const LOW_PRIORITY_HINTS = ["when possible", "eventually", "low priority", "nice to have", "no rush"];
const NEAR_DEADLINE_HINTS = ["today", "tomorrow", "tonight", "asap", "urgent"];
const DEADLINE_PATTERN =
  /\b(today|tomorrow|tonight|this week|next week|this weekend|end of (?:the )?(?:day|week)|monday|tuesday|wednesday|thursday|friday|saturday|sunday|by \w+(?: \w+)?)\b/i;

/** True when `sentence` looks like a plain conversational line, not a task. */
function isPlainConversation(sentence) {
  const low = sentence.toLowerCase().trim();
  if (!low) return true;
  if (/[?]$/.test(low)) return true; // questions are discussion, not commitments
  const greetingsOrFiller = ["hi ", "hello ", "hey ", "thanks", "thank you", "great job", "good morning", "sounds good"];
  return greetingsOrFiller.some((g) => low.startsWith(g) || low === g.trim());
}

/** Finds the best (longest, most specific) member-name match inside a sentence.
 * `members` must come from trusted server-side group data — never client input. */
function findOwner(sentence, members = []) {
  const low = sentence.toLowerCase();
  const candidates = (members || [])
    .filter((m) => m && m.name)
    .map((m) => m.name.trim())
    .filter(Boolean)
    // Prefer full multi-word names over a bare first name so "Rohan Sharma"
    // beats a coincidental "Rohan" substring elsewhere.
    .sort((a, b) => b.length - a.length);

  for (const name of candidates) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`\\b${escaped}\\b`, "i").test(sentence)) return name;
    // Also allow a match on just the first token of a multi-word name
    // (e.g. "Rohan will finish..." matching member "Rohan Sharma").
    const firstToken = name.split(" ")[0];
    if (firstToken.length > 2 && new RegExp(`\\b${firstToken}\\b`, "i").test(sentence)) return name;
  }
  void low;
  return null;
}

function extractDeadline(sentence) {
  const match = sentence.match(DEADLINE_PATTERN);
  return match ? match[0] : null;
}

function inferPriority(sentence, deadline) {
  const low = sentence.toLowerCase();
  if (LOW_PRIORITY_HINTS.some((h) => low.includes(h))) return "LOW";
  if (URGENCY_HINTS.some((h) => low.includes(h))) return "HIGH";
  if (deadline && NEAR_DEADLINE_HINTS.some((h) => deadline.toLowerCase().includes(h))) return "HIGH";
  if (deadline) return "HIGH";
  return "MEDIUM";
}

/**
 * @param {string} text raw meeting notes / transcript (never executed)
 * @param {{name: string}[]} members trusted group member list (server-resolved)
 * @returns {{actionItems: Array}}
 */
function extractMeetingActionItems(text = "", { members = [] } = {}) {
  const sentences = splitSentences(text);
  const seen = new Set();
  const actionItems = [];

  for (const sentence of sentences) {
    if (isPlainConversation(sentence)) continue;
    if (!matches(sentence, ACTION_ITEM_HINTS)) continue;

    const owner = findOwner(sentence, members);
    const deadline = extractDeadline(sentence);
    const priority = inferPriority(sentence, deadline);

    // Trim the sentence down to an "action" phrase: drop a leading
    // "<Name> will/needs to/should/must " if present, otherwise keep as-is.
    let action = sentence.replace(/[.!?]+$/, "");
    const leadMatch = action.match(/^(.*?)\b(will|needs to|need to|should|must|is responsible for|are responsible for)\b\s*/i);
    if (leadMatch && owner && leadMatch[1].toLowerCase().includes(owner.split(" ")[0].toLowerCase())) {
      action = action.slice(leadMatch[0].length);
    }
    action = action.charAt(0).toUpperCase() + action.slice(1);

    // Dedupe near-identical extractions from the same sentence text.
    const dedupeKey = sentence.toLowerCase();
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    let confidence = 0.55;
    if (owner) confidence += 0.15;
    if (deadline) confidence += 0.15;
    if (STRONG_ACTION_VERBS.some((v) => sentence.toLowerCase().includes(v))) confidence += 0.1;
    confidence = Math.min(0.97, Math.round(confidence * 100) / 100);

    actionItems.push({
      action,
      owner: owner || null,
      deadline: deadline || null,
      priority,
      source: sentence,
      confidence,
    });
  }

  return { actionItems };
}

/** Extract decisions / action items / risks from raw meeting notes. */
function summarizeMeetingNotes(notes = "", { attendees = [] } = {}) {
  const sentences = splitSentences(notes);
  const decisions = [];
  const actionItems = [];
  const risks = [];

  sentences.forEach((sentence) => {
    if (matches(sentence, RISK_HINTS)) {
      risks.push(sentence);
      return;
    }
    if (matches(sentence, DECISION_HINTS)) {
      decisions.push(sentence);
      return;
    }
    if (matches(sentence, ACTION_HINTS)) {
      const owner = attendees.find((a) =>
        sentence.toLowerCase().includes(String(a.name || "").split(" ")[0].toLowerCase())
      );
      const dueMatch = sentence.match(
        /\b(today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|next week|this week|by \w+)\b/i
      );
      actionItems.push({
        text: sentence,
        ownerHint: owner ? owner.name : "Unassigned",
        dueHint: dueMatch ? dueMatch[0] : "",
      });
    }
  });

  return {
    decisions: decisions.slice(0, 8),
    actionItems: actionItems.slice(0, 10),
    risks: risks.slice(0, 8),
    generatedAt: new Date(),
  };
}

/** Condense a chat window into themes + sentiment + suggested follow-ups. */
function summarizeConversation(messages = []) {
  const texts = messages.map((m) => m.text || "");
  const joined = texts.join(" ").toLowerCase();
  const words = joined.match(/[a-z]{4,}/g) || [];
  const stop = new Set([
    "this", "that", "with", "have", "will", "from", "they", "them", "your", "about",
    "just", "been", "then", "than", "when", "what", "some", "also", "into", "need",
    "there", "still", "cant", "dont", "were", "sure", "okay", "yeah", "thanks",
  ]);
  const freq = {};
  words.forEach((w) => {
    if (!stop.has(w)) freq[w] = (freq[w] || 0) + 1;
  });
  const topics = Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([word, count]) => ({ word, count }));

  const positive = (joined.match(/\b(great|nice|thanks|done|works|good|ready|👍|🎉)\b/g) || []).length;
  const negative = (joined.match(/\b(blocked|delay|issue|problem|late|stuck|waiting|third week)\b/g) || []).length;
  const sentiment = positive === negative ? "neutral" : positive > negative ? "positive" : "negative";

  const openQuestions = texts.filter((t) => t.trim().endsWith("?")).slice(0, 5);

  let summaryText = "";
  if (!messages.length) {
    summaryText = "No group conversation recorded yet.";
  } else {
    const topicList = topics.map((t) => t.word).join(", ");
    const sentimentPhrase =
      sentiment === "positive"
        ? "optimistic and constructive"
        : sentiment === "negative"
        ? "facing challenges or blocker discussions"
        : "steady and collaborative";
    const parts = [
      `The team has exchanged ${messages.length} message(s), with conversation focusing on ${topicList || "project tasks"}.`,
      `Communication tone is ${sentimentPhrase}.`,
    ];
    if (openQuestions.length > 0) {
      parts.push(`${openQuestions.length} question(s) were raised and may need guide or team attention.`);
    }
    summaryText = parts.join(" ");
  }

  return {
    summary: summaryText,
    text: summaryText,
    messageCount: messages.length,
    topics,
    sentiment,
    sentimentScore: Math.round(((positive - negative) / Math.max(1, positive + negative)) * 100),
    openQuestions,
    followUps: openQuestions.length
      ? ["Answer the open questions raised in chat", "Convert unanswered questions into tasks"]
      : ["No open questions — keep the cadence going"],
    generatedAt: new Date(),
  };
}

/** Balance workload across members using open estimate hours or open task counts. */
function suggestWorkloadRebalance(tasks = [], members = []) {
  const byMember = new Map(
    members.map((m) => [String(m._id || m.id), { user: m, openHours: 0, openTasks: 0, overdue: 0, done: 0 }])
  );

  tasks.forEach((t) => {
    const key = String(t.assignee?._id || t.assignee || "");
    const bucket = byMember.get(key);
    if (!bucket) return;
    if (t.status === "done" || t.status === "completed") {
      bucket.done += 1;
      return;
    }
    bucket.openTasks += 1;
    const est = Number(t.estimate);
    bucket.openHours += Number.isFinite(est) && est > 0 ? est : 0;
    if (t.due && new Date(t.due) < new Date()) bucket.overdue += 1;
  });

  const rows = [...byMember.values()];
  const totalHours = rows.reduce((sum, r) => sum + r.openHours, 0);
  const totalOpenTasks = rows.reduce((sum, r) => sum + r.openTasks, 0);
  const avg = rows.length ? totalHours / rows.length : 0;
  const avgTasks = rows.length ? totalOpenTasks / rows.length : 0;

  const suggestions = [];
  const overloaded = rows.filter((r) =>
    (totalHours > 0 && r.openHours > avg * 1.35 && r.openHours - avg >= 2) ||
    (totalHours === 0 && totalOpenTasks > 0 && r.openTasks > avgTasks * 1.35 && r.openTasks - avgTasks >= 2)
  );
  const idle = rows.filter((r) =>
    (totalHours > 0 && r.openHours < avg * 0.65) ||
    (totalHours === 0 && totalOpenTasks > 0 && r.openTasks < avgTasks * 0.65)
  );

  overloaded.forEach((over) => {
    const target = idle.sort((a, b) => (totalHours ? a.openHours - b.openHours : a.openTasks - b.openTasks))[0];
    if (!target) return;
    const candidate = tasks
      .filter((t) => String(t.assignee?._id || t.assignee) === String(over.user._id || over.user.id) && t.status !== "done" && t.status !== "completed")
      .sort((a, b) => (a.priority === "high" ? 1 : -1))[0];
    if (!candidate) return;
    const reason = totalHours > 0
      ? `${over.user.name} has ${over.openHours}h open vs a ${avg.toFixed(1)}h team average.`
      : `${over.user.name} has ${over.openTasks} open task(s) vs a ${avgTasks.toFixed(1)} task team average.`;
    suggestions.push({
      type: "reassign",
      taskId: String(candidate._id),
      taskTitle: candidate.title,
      from: over.user.name,
      to: target.user.name,
      reason,
    });
  });

  rows
    .filter((r) => r.overdue > 0)
    .forEach((r) =>
      suggestions.push({
        type: "unblock",
        from: r.user.name,
        reason: `${r.user.name} has ${r.overdue} overdue task(s) — check for blockers in the next stand-up.`,
      })
    );

  // Helper to calculate task progress based on 4-stage lifecycle
  const getTaskProgress = (t) => {
    if (typeof t.progress === "number" && t.progress >= 0 && t.progress <= 100) return t.progress;
    const s = String(t.status || "").toLowerCase().trim();
    if (s === "done" || s === "completed") {
      if (t.verification?.status === "FAIL" || t.verification?.completionStatus === "PARTIALLY_COMPLETE") return 90;
      return 100;
    }
    if (["in_review", "review", "submitted", "ai_review", "guide_review", "changes_requested"].includes(s)) {
      return 90; // In review when zip folder uploaded
    }
    if (s === "in_progress") {
      return 10; // In progress
    }
    return 0; // todo, backlog, pending
  };

  return {
    averageOpenHours: Number(avg.toFixed(1)),
    totalOpenHours: totalHours,
    totalOpenTasks,
    distribution: rows.map((r) => {
      const memberTasks = tasks.filter(
        (t) => String(t.assignee?._id || t.assignee || "") === String(r.user._id || r.user.id)
      );
      const progressPct = memberTasks.length > 0
        ? Math.round(memberTasks.reduce((sum, t) => sum + getTaskProgress(t), 0) / memberTasks.length)
        : 0;

      const openHoursPct = totalHours > 0
        ? Math.round((r.openHours / totalHours) * 100)
        : totalOpenTasks > 0
        ? Math.round((r.openTasks / totalOpenTasks) * 100)
        : 0;

      return {
        userId: String(r.user._id || r.user.id),
        name: r.user.name,
        openHours: r.openHours,
        openTasks: r.openTasks,
        totalTasks: memberTasks.length,
        overdue: r.overdue,
        done: r.done,
        progressPct,
        loadPct: progressPct, // 4-stage lifecycle progress: 0% todo, 10% in_progress, 90% in_review, 100% done
        openHoursPct,
      };
    }),
    suggestions,
  };
}


const RISK_WORDS = ["blocked", "stuck", "delay", "late", "issue", "problem", "waiting", "cannot", "can't", "confused", "no update"];

/**
 * Alerts derived *only* from the group conversation: silence, one-person
 * domination, unanswered questions and blocker chatter.
 */
function chatAlerts(messages = [], { memberCount = 0, tasks = [] } = {}) {
  const alerts = [];
  const now = Date.now();
  const DAY = 86400000;

  if (!messages.length) {
    return [
      {
        id: "no-chat",
        level: "high",
        title: "No group conversation yet",
        detail: "The team has not exchanged a single message. Kick off a stand-up thread.",
      },
    ];
  }

  const last = messages[messages.length - 1];
  const quietDays = Math.floor((now - new Date(last.createdAt).getTime()) / DAY);
  if (quietDays >= 3) {
    alerts.push({
      id: "silence",
      level: quietDays >= 7 ? "high" : "medium",
      title: `Chat quiet for ${quietDays} days`,
      detail: "Sustained silence usually precedes a missed milestone.",
    });
  }

  const perSender = {};
  messages.forEach((m) => {
    perSender[m.senderName || m.senderId] = (perSender[m.senderName || m.senderId] || 0) + 1;
  });
  const senders = Object.entries(perSender).sort((a, b) => b[1] - a[1]);
  const topShare = senders[0][1] / messages.length;
  if (senders.length > 1 && topShare > 0.6) {
    alerts.push({
      id: "domination",
      level: "medium",
      title: `${senders[0][0]} sends ${Math.round(topShare * 100)}% of messages`,
      detail: "Collaboration is lopsided — invite quieter members into the thread.",
    });
  }

  if (memberCount && senders.length < memberCount) {
    const silent = memberCount - senders.length;
    alerts.push({
      id: "silent-members",
      level: silent > 1 ? "high" : "medium",
      title: `${silent} member(s) never posted`,
      detail: "Members with zero chat activity are the strongest drop-off signal.",
    });
  }

  const blockers = messages.filter((m) =>
    RISK_WORDS.some((w) => String(m.text || "").toLowerCase().includes(w))
  );
  if (blockers.length) {
    alerts.push({
      id: "blockers",
      level: blockers.length > 3 ? "high" : "medium",
      title: `${blockers.length} blocker mention(s) in chat`,
      detail: blockers[blockers.length - 1].text.slice(0, 140),
    });
  }

  const questions = messages.filter((m) => String(m.text || "").trim().endsWith("?"));
  const unanswered = questions.filter((q) => {
    const idx = messages.indexOf(q);
    return !messages.slice(idx + 1).some((m) => m.senderId !== q.senderId);
  });
  if (unanswered.length) {
    alerts.push({
      id: "unanswered",
      level: "low",
      title: `${unanswered.length} unanswered question(s)`,
      detail: unanswered[unanswered.length - 1].text.slice(0, 140),
    });
  }

  const overdue = (tasks || []).filter((t) => t.status !== "done" && t.due && new Date(t.due) < new Date());
  if (overdue.length && !blockers.length) {
    alerts.push({
      id: "silent-overdue",
      level: "high",
      title: `${overdue.length} overdue task(s) never discussed`,
      detail: "Nobody raised these in chat — surface them in the next stand-up.",
    });
  }

  return alerts;
}

/**
 * Collaboration score (0-100) generated from chat behaviour: volume,
 * participation balance, responsiveness and recency.
 */
function collaborationFromChat(messages = [], { memberCount = 0 } = {}) {
  if (!messages.length) {
    return { score: 0, level: "low", breakdown: { volume: 0, balance: 0, responsiveness: 0, recency: 0 }, participants: [] };
  }

  const DAY = 86400000;
  const perSender = {};
  messages.forEach((m) => {
    const key = m.senderName || m.senderId;
    perSender[key] = (perSender[key] || 0) + 1;
  });
  const counts = Object.values(perSender);
  const speakers = counts.length;
  const total = messages.length;

  // Volume: 40 messages/week ~ full marks.
  const spanDays = Math.max(
    1,
    (new Date(messages[messages.length - 1].createdAt) - new Date(messages[0].createdAt)) / DAY
  );
  const perWeek = (total / spanDays) * 7;
  const volume = Math.min(30, Math.round((perWeek / 40) * 30));

  // Balance: how evenly members contribute.
  const expected = total / Math.max(1, memberCount || speakers);
  const deviation =
    counts.reduce((sum, c) => sum + Math.abs(c - expected), 0) / (2 * total || 1);
  const balance = Math.round((1 - Math.min(1, deviation)) * 30);

  // Responsiveness: share of consecutive messages from different people.
  let switches = 0;
  for (let i = 1; i < messages.length; i += 1) {
    if (messages[i].senderId !== messages[i - 1].senderId) switches += 1;
  }
  const responsiveness = Math.round((switches / Math.max(1, messages.length - 1)) * 25);

  // Recency: activity in the last 7 days.
  const recent = messages.filter((m) => Date.now() - new Date(m.createdAt).getTime() < 7 * DAY).length;
  const recency = Math.min(15, Math.round((recent / 15) * 15));

  const score = Math.max(0, Math.min(100, volume + balance + responsiveness + recency));
  return {
    score,
    level: score >= 70 ? "high" : score >= 40 ? "medium" : "low",
    breakdown: { volume, balance, responsiveness, recency },
    participants: Object.entries(perSender)
      .map(([name, count]) => ({ name, messages: count, share: Math.round((count / total) * 100) }))
      .sort((a, b) => b.messages - a.messages),
  };
}

/**
 * Node-side fallback for group-chat task detection, used only when the
 * Python AI engine (ai-engine/analyzers/messageTaskAnalyzer.py — the
 * primary implementation) is unreachable. Deliberately a smaller, simpler
 * rule set than the Python version, same graceful-degrade contract as
 * every aiEngineClient method: it never guesses an assignee outside the
 * `members` list supplied by the caller.
 */
const TASK_ACTION_VERBS = [
  "complete", "finish", "handle", "build", "implement", "add", "fix",
  "prepare", "submit", "create", "test", "deploy", "design", "review",
  "update", "write", "setup", "set up", "configure", "connect",
  "integrate", "upload", "merge", "push", "develop", "start", "make",
  "check", "research", "debug", "document", "deliver", "ship",
  "refactor", "analyze", "investigate", "own", "work on",
];
const VERB_ALT = TASK_ACTION_VERBS.slice()
  .sort((a, b) => b.length - a.length)
  .map((v) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
  .join("|");
const NAME_WORD = "[A-Z][a-zA-Z'-]{1,30}";
// A "name" can be one word ("Bhavani") or up to three capitalized words
// ("Bhavani Nitla", "Nitla Bhavani") so full names and reversed full names
// are captured whole instead of only the last word before the comma/verb.
const NAME_TOKEN = `${NAME_WORD}(?:\\s+${NAME_WORD}){0,2}`;
// IMPORTANT: no "i" flag is used on these — a case-insensitive flag would
// make [A-Z] match lowercase too, letting ordinary words like "and" become
// fake "names" (this bit Python's version first; fixed here by matching
// candidate name tokens WITHOUT case-insensitivity, then checking the verb
// that follows against a lower-cased window in plain JS below instead of
// embedding case-insensitivity into the same regex).
const CANDIDATE_NAME = new RegExp(NAME_TOKEN, "g");
const MODAL_PREFIX = /^(?:please\s+|kindly\s+|will\s+|should\s+|needs?\s+to\s+|has\s+to\s+|to\s+)*/i;
const VERB_START = new RegExp(`^(?:${VERB_ALT})\\b`, "i");
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

const MONTH_MAP = {
  january: 1, jan: 1,
  february: 2, feb: 2,
  march: 3, mar: 3,
  april: 4, apr: 4,
  may: 5,
  june: 6, jun: 6,
  july: 7, jul: 7,
  august: 8, aug: 8,
  september: 9, sep: 9, sept: 9,
  october: 10, oct: 10,
  november: 11, nov: 11,
  december: 12, dec: 12,
};

const MONTH_NAMES_PATTERN = Object.keys(MONTH_MAP).sort((a, b) => b.length - a.length).join("|");

const MONTH_DATE_PATTERN = `(?:(?:${MONTH_NAMES_PATTERN})\\s+\\d{1,2}(?:st|nd|rd|th)?(?:\\s*,?\\s*\\d{4})?|\\d{1,2}(?:st|nd|rd|th)?\\s+(?:of\\s+)?(?:${MONTH_NAMES_PATTERN})(?:\\s*,?\\s*\\d{4})?)`;

const TIME_SUFFIX_PATTERN = `(?:\\s+(?:at\\s+|by\\s+)?(\\d{1,2}(?::\\d{2})?\\s*(?:am|pm)))?`;

const DATE_PATTERN = new RegExp(
  `\\b(?:by\\s+|on\\s+|before\\s+|due\\s+)?(today|tomorrow|next\\s+(?:${WEEKDAYS.join("|")})|${WEEKDAYS.join("|")}|in\\s+\\d+\\s+days?|${MONTH_DATE_PATTERN})${TIME_SUFFIX_PATTERN}\\b`,
  "i"
);

function parseTimeStr(timeStr) {
  if (!timeStr) return null;
  const t = timeStr.trim().toLowerCase();
  const m = t.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/);
  if (!m) return null;
  let hour = parseInt(m[1], 10);
  const minute = m[2] ? parseInt(m[2], 10) : 0;
  const meridiem = m[3];
  if (hour === 12) {
    hour = meridiem === "am" ? 0 : 12;
  } else if (meridiem === "pm") {
    hour += 12;
  }
  if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
    return { hour, minute };
  }
  return null;
}

function resolveRelativeDate(phrase, timeStr, current) {
  if (!phrase) return null;
  const p = phrase.toLowerCase().trim();
  const base = new Date(current);
  let targetDt = null;
  const timeTuple = parseTimeStr(timeStr);

  if (p === "today") {
    targetDt = new Date(base);
  } else if (p === "tomorrow") {
    targetDt = new Date(base.getTime() + 86400000);
  } else {
    const inDays = p.match(/^in\s+(\d+)\s+days?$/);
    if (inDays) {
      targetDt = new Date(base.getTime() + Number(inDays[1]) * 86400000);
    } else if (p.startsWith("next ") || WEEKDAYS.includes(p)) {
      const isNext = p.startsWith("next ");
      const dayName = p.replace(/^next\s+/, "");
      const idx = WEEKDAYS.indexOf(dayName);
      if (idx !== -1) {
        const currentIdx = base.getDay();
        let delta = (idx - currentIdx + 7) % 7;
        if (delta === 0) delta = isNext ? 7 : 7;
        else if (isNext && delta < 7) delta += 7;
        targetDt = new Date(base.getTime() + delta * 86400000);
      }
    } else {
      let cleanP = p.replace(/(\d+)(?:st|nd|rd|th)\b/g, "$1").replace(/\bof\b/g, "").trim();
      let foundMonth = null;
      for (const [mName, mNum] of Object.entries(MONTH_MAP)) {
        if (new RegExp(`\\b${mName}\\b`, "i").test(cleanP)) {
          foundMonth = mNum;
          cleanP = cleanP.replace(new RegExp(`\\b${mName}\\b`, "i"), "").trim();
          break;
        }
      }
      if (foundMonth !== null) {
        const dayMatch = cleanP.match(/\b(\d{1,2})\b/);
        const yearMatch = cleanP.match(/\b(20\d{2})\b/);
        if (dayMatch) {
          const day = parseInt(dayMatch[1], 10);
          let year = yearMatch ? parseInt(yearMatch[1], 10) : base.getFullYear();
          if (!yearMatch && (foundMonth < (base.getMonth() + 1) || (foundMonth === (base.getMonth() + 1) && day < base.getDate() - 2))) {
            year += 1;
          }
          targetDt = new Date(Date.UTC(year, foundMonth - 1, day, 0, 0, 0));
        }
      }
    }
  }

  if (targetDt && !Number.isNaN(targetDt.getTime())) {
    if (timeTuple) {
      targetDt.setUTCHours(timeTuple.hour, timeTuple.minute, 0, 0);
    }
    return targetDt;
  }
  return null;
}

function parseAnyDate(phrase, current = new Date()) {
  if (!phrase) return null;
  const rel = resolveRelativeDate(phrase, null, current);
  if (rel && !Number.isNaN(rel.getTime())) return rel;
  const cleaned = phrase.replace(/^(?:by|on|before|due)\s+/i, "").trim();
  const direct = new Date(cleaned);
  if (!Number.isNaN(direct.getTime())) return direct;
  return null;
}

function nameTokens(s) {
  return String(s || "").trim().toLowerCase().split(/\s+/).filter(Boolean);
}

/**
 * Case-insensitive match against real group members only. Never matches
 * anything not present in `members`. Tries, in order:
 *   1. exact full-string match ("Bhavani Nitla" == "Bhavani Nitla")
 *   2. same set of words in any order, for multi-word mentions — covers a
 *      reversed full name ("Nitla Bhavani" -> "Bhavani Nitla")
 *   3. first-name match, for single-word mentions only ("Bhavani" -> first
 *      token of the member's name)
 */
function findMembersByName(name, members) {
  const low = name.trim().toLowerCase();
  const exact = members.filter((m) => String(m.name || "").trim().toLowerCase() === low);
  if (exact.length) return exact;

  const mentionTokens = nameTokens(name);
  if (mentionTokens.length > 1) {
    const mentionSet = new Set(mentionTokens);
    return members.filter((m) => {
      const mTokens = nameTokens(m.name);
      return mTokens.length === mentionSet.size && mTokens.every((t) => mentionSet.has(t));
    });
  }

  return members.filter((m) => String(m.name || "").trim().split(" ")[0].toLowerCase() === low);
}

function cleanTitle(text) {
  const stop = new Set(["the", "a", "an", "to", "on", "for", "our", "your", "my", "it", "with"]);
  let words = text.trim().replace(/[.,;:]+$/, "").split(/\s+/).filter(Boolean);
  while (words.length && stop.has(words[0].toLowerCase())) words = words.slice(1);
  words = words.slice(0, 8);
  const title = words.map((w) => (w === w.toLowerCase() ? w[0].toUpperCase() + w.slice(1) : w)).join(" ");
  return title || "Untitled task";
}

function priorityFor(text) {
  const low = text.toLowerCase();
  if (["urgent", "asap", "immediately", "critical", "high priority"].some((h) => low.includes(h))) return "high";
  if (["no rush", "low priority", "when free", "whenever you can", "no hurry"].some((h) => low.includes(h)))
    return "low";
  return "medium";
}

/**
 * @param {string} text chat message text
 * @param {Array<{id:string,name:string}>} members the group's REAL roster
 * @param {Date} [currentDate] for resolving relative dates in tests
 * @returns {{isTask:boolean, tasks:Array, unmatchedMentions:Array, reason:string|null}}
 */
function detectMessageTasks(text, members = [], currentDate = new Date()) {
  const raw = String(text || "").trim();
  if (!raw) return { isTask: false, tasks: [], unmatchedMentions: [], reason: "empty_message" };

  const memberList = Array.isArray(members)
    ? members
    : (Array.isArray(members?.members) ? members.members : []);
  members = memberList;

  // 0. Project Specification format: "Project Title: ... Description: ..." or "Title: ... Description: ..."
  const projTitleMatch = raw.match(/(?:^|\n)\s*(?:Project\s+Title|Project\s+Name|Project|Title)\s*:\s*([^\n]+)/i);
  const projDescMatch = raw.match(/(?:^|\n)\s*(?:Project\s+Description|Task\s+Description|Description)\s*:\s*([\s\S]+)/i);

  if (projTitleMatch && projDescMatch) {
    const projTitle = cleanTitle(projTitleMatch[1].trim());
    const projDesc = projDescMatch[1].trim();

    if (projTitle && projDesc) {
      let items = [];
      const listMatches = [...projDesc.matchAll(/(?:^|\n)\s*(?:\d+[\.\)]|\-|\*|•)\s*([^\n]+)/g)];
      if (listMatches.length > 0) {
        items = listMatches.map((m) => m[1].trim()).filter(Boolean);
      } else {
        const parts = projDesc.split(/[.\n;]+/).map((p) => p.trim()).filter((p) => p.length > 3);
        if (parts.length >= 2) {
          items = parts;
        } else {
          items = [
            `Core Architecture & Backend Setup for ${projTitle}`,
            `Database Modeling & API Integration for ${projTitle}`,
            `Frontend UI & Client Interaction for ${projTitle}`,
            `Quality Assurance, Testing & Deployment for ${projTitle}`,
          ];
        }
      }

      const tasks = items.map((rawItem, i) => {
        let itemTitle = cleanTitle(rawItem);
        let itemDesc = rawItem.trim();
        let assignedMember = null;

        const colonPrefix = rawItem.match(/^([A-Za-z\s]+)[:\-]\s*(.+)/);
        if (colonPrefix) {
          const candName = colonPrefix[1].trim();
          const candMatches = findMembersByName(candName, members);
          if (candMatches.length > 0) {
            assignedMember = candMatches[0];
            itemDesc = colonPrefix[2].trim();
            itemTitle = cleanTitle(itemDesc);
          }
        }

        if (!assignedMember && members.length > 0) {
          assignedMember = members[i % members.length];
        }

        return {
          assigneeName: assignedMember ? assignedMember.name : null,
          assigneeId: assignedMember ? (assignedMember._id || assignedMember.id) : null,
          title: itemTitle,
          description: /[.!?]$/.test(itemDesc) ? itemDesc : `${itemDesc}.`,
          priority: priorityFor(rawItem) || (i === 0 ? "high" : "medium"),
          dueDate: null,
        };
      });

      if (tasks.length > 0) {
        return {
          isTask: true,
          tasks,
          projectTitle: projTitle,
          projectDescription: projDesc,
          unmatchedMentions: [],
          reason: null,
        };
      }
    }
  }

  // 1. Structured task assignment format: "Task: ...", "Deadline: ...", "Assignee: ..."
  const structuredTaskMatch = raw.match(/(?:^|\n)\s*Task(?:\s+Title)?\s*:\s*([^\n]+)/i);
  if (structuredTaskMatch) {
    const taskTitle = cleanTitle(structuredTaskMatch[1].trim());
    const descMatch = raw.match(/(?:^|\n)\s*(?:Project\s+Description|Task\s+Description|Description)\s*:\s*([^\n]+)/i);
    const deadlineMatch = raw.match(/(?:^|\n)\s*(?:Deadline|Due(?:\s+Date)?)\s*:\s*([^\n]+)/i);
    const assigneeMatch = raw.match(/(?:^|\n)\s*(?:Assignee|Assigned\s+To)\s*:\s*([^\n]+)/i);

    let assignedMember = null;
    if (assigneeMatch) {
      const candidates = findMembersByName(assigneeMatch[1].trim(), members);
      if (candidates.length === 1) assignedMember = candidates[0];
    }
    if (!assignedMember) {
      // Check if any member is explicitly mentioned in the text
      for (const m of members) {
        if (new RegExp(`\\b${m.name}\\b`, "i").test(raw)) {
          assignedMember = m;
          break;
        }
      }
    }
    if (!assignedMember && members.length > 0) {
      assignedMember = members[0];
    }

    if (assignedMember) {
      let dueDate = null;
      if (deadlineMatch) {
        const rawDate = deadlineMatch[1].trim();
        const parsed = parseAnyDate(rawDate, currentDate);
        if (parsed) dueDate = parsed.toISOString().split("T")[0];
      }
      return {
        isTask: true,
        tasks: [
          {
            assigneeName: assignedMember.name,
            assigneeId: assignedMember._id || assignedMember.id,
            title: taskTitle,
            description: descMatch ? descMatch[1].trim() : "Task assigned via group chat",
            priority: priorityFor(raw),
            dueDate,
          },
        ],
        unmatchedMentions: [],
        reason: null,
      };
    }
  }

  // 2. Conversational directive scanning:
  // Scan every capitalized token as a candidate name, then check (in plain
  // JS, case-insensitively) whether it's immediately followed by a comma +
  // action verb ("Name, complete...") or directly by an action verb, with
  // an optional modal in between ("Name will complete...", "Name handle...").
  const spans = [];
  CANDIDATE_NAME.lastIndex = 0;
  let cm;
  while ((cm = CANDIDATE_NAME.exec(raw))) {
    const name = cm[0];
    const afterStart = cm.index + name.length;
    let rest = raw.slice(afterStart);

    const commaMatch = rest.match(/^\s*,\s*/);
    let directiveEnd = null;
    if (commaMatch) {
      const afterComma = rest.slice(commaMatch[0].length);
      const modalMatch = afterComma.match(MODAL_PREFIX) || [""];
      const afterModal = afterComma.slice(modalMatch[0].length);
      if (VERB_START.test(afterModal)) {
        directiveEnd = afterStart + commaMatch[0].length;
      }
    }
    if (directiveEnd === null) {
      const spaceMatch = rest.match(/^\s+/);
      if (spaceMatch) {
        const afterSpace = rest.slice(spaceMatch[0].length);
        const modalMatch = afterSpace.match(MODAL_PREFIX) || [""];
        const afterModal = afterSpace.slice(modalMatch[0].length);
        if (VERB_START.test(afterModal)) {
          directiveEnd = afterStart + spaceMatch[0].length;
        }
      }
    }
    if (directiveEnd !== null) {
      spans.push({ start: cm.index, end: directiveEnd, name });
    }
  }
  if (!spans.length) return { isTask: false, tasks: [], unmatchedMentions: [], reason: "no_actionable_assignment_found" };

  let globalDuePhrase = null;
  let globalTimeStr = null;
  let dm;
  const globalDateRe = new RegExp(DATE_PATTERN.source, "gi");
  while ((dm = globalDateRe.exec(raw))) {
    globalDuePhrase = dm[1];
    globalTimeStr = dm[2];
  }

  const tasks = [];
  const unmatched = [];
  const seen = new Set();

  spans.forEach((span, idx) => {
    const segmentEnd = idx + 1 < spans.length ? spans[idx + 1].start : raw.length;
    let segment = raw.slice(span.end, segmentEnd).trim();
    segment = segment.replace(/[\s,]*\b(?:and|then)\b[\s,]*$/i, "").trim();
    if (!segment) return;

    const matches = findMembersByName(span.name, members);
    if (!matches.length) {
      if (!seen.has(span.name.toLowerCase())) {
        unmatched.push({ name: span.name, reason: "not_a_member_of_this_group" });
        seen.add(span.name.toLowerCase());
      }
      return;
    }
    if (matches.length > 1) {
      unmatched.push({ name: span.name, reason: "ambiguous_name_multiple_members_match" });
      return;
    }
    const member = matches[0];

    const localMatch = segment.match(DATE_PATTERN);
    const duePhrase = localMatch ? localMatch[1] : globalDuePhrase;
    const dueTime = localMatch ? localMatch[2] : (localMatch ? null : globalTimeStr);
    const dueDate = duePhrase ? resolveRelativeDate(duePhrase, dueTime, currentDate) : null;

    let body = segment;
    if (localMatch) body = (segment.slice(0, localMatch.index) + segment.slice(localMatch.index + localMatch[0].length)).trim();
    body = body.replace(/\s{2,}/g, " ").replace(/\s+([.,!?])/g, "$1").replace(/^[\s.,]+|[\s.,]+$/g, "");

    const firstClause = body.split(/(?<=[.!?])\s+/)[0] || "";
    const title = cleanTitle(firstClause.replace(new RegExp(`^\\s*(?:please\\s+|kindly\\s+)?(?:${VERB_ALT})\\b`, "i"), "").trim());
    let description = body ? body[0].toUpperCase() + body.slice(1) : title;
    if (description && !/[.!?]$/.test(description)) description += ".";

    let dueStr = null;
    if (dueDate) {
      dueStr = dueTime ? dueDate.toISOString() : dueDate.toISOString().slice(0, 10);
    }

    tasks.push({
      assigneeName: member.name,
      assigneeId: member.id || member._id,
      title,
      description,
      dueDate: dueStr,
      priority: priorityFor(segment),
    });
  });

  return {
    isTask: tasks.length > 0,
    tasks,
    unmatchedMentions: unmatched,
    reason: tasks.length ? null : "no_recognized_group_member_in_any_assignment",
  };
}

module.exports = {
  summarizeMeetingNotes,
  extractMeetingActionItems,
  summarizeConversation,
  suggestWorkloadRebalance,
  chatAlerts,
  collaborationFromChat,
  detectMessageTasks,
};

