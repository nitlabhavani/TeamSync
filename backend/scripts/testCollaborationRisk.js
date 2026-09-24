/**
 * STEP 16 — Feature 3 tests: chat sentiment / disengagement flag.
 * No DB / server needed — exercises the pure scoreStudentCollaboration()
 * function directly with hand-built stats objects.
 *
 * Run: node backend/scripts/testCollaborationRisk.js
 */
const assert = require("assert");
const { scoreStudentCollaboration } = require("../src/services/collaborationRiskService");

let passed = 0;
const check = (label, fn) => {
  fn();
  passed += 1;
  console.log(`ok - ${label}`);
};

function baseStats(overrides = {}) {
  return {
    messagesThisWeek: 20,
    messagesLastWeek: 20,
    activeDaysThisWeek: 5,
    daysSinceLastMessage: 0,
    problemKeywordHits: 0,
    totalRecentMessages: 20,
    ...overrides,
  };
}

check("1. normal activity -> LOW, no flags", () => {
  const result = scoreStudentCollaboration(baseStats());
  assert.strictEqual(result.riskLevel, "LOW");
  assert.strictEqual(result.flags.length, 0);
});

check("2. message drop -> COLLABORATION_DROP flag", () => {
  const result = scoreStudentCollaboration(baseStats({ messagesThisWeek: 5, messagesLastWeek: 20 }));
  assert.ok(result.flags.some((f) => f.type === "COLLABORATION_DROP"));
  assert.ok(result.riskScore > 0);
});

check("3. long inactivity -> DISENGAGEMENT_RISK, HIGH severity", () => {
  const result = scoreStudentCollaboration(baseStats({ daysSinceLastMessage: 10, messagesThisWeek: 0 }));
  const flag = result.flags.find((f) => f.type === "DISENGAGEMENT_RISK");
  assert.ok(flag);
  assert.strictEqual(flag.severity, "HIGH");
});

check("4. low active chat days -> COLLABORATION_DROP flag", () => {
  const result = scoreStudentCollaboration(baseStats({ activeDaysThisWeek: 1, messagesThisWeek: 3 }));
  assert.ok(result.flags.some((f) => f.type === "COLLABORATION_DROP"));
});

check("5. repeated blocking keywords -> COMMUNICATION_RISK", () => {
  const result = scoreStudentCollaboration(
    baseStats({ problemKeywordHits: 9, totalRecentMessages: 20 })
  );
  assert.ok(result.flags.some((f) => f.type === "COMMUNICATION_RISK"));
});

check("6. communication risk recommendation is supportive and task-focused", () => {
  const result = scoreStudentCollaboration(baseStats({ problemKeywordHits: 9, totalRecentMessages: 20 }));
  assert.ok(result.recommendation.toLowerCase().includes("help"));
  // Never a clinical/emotional label anywhere in the output.
  const asString = JSON.stringify(result).toLowerCase();
  ["depress", "anxi", "burnout", "mental illness"].forEach((bad) => assert.ok(!asString.includes(bad)));
});

check("7. combined risk (drop + inactivity + keywords) -> HIGH/CRITICAL", () => {
  const result = scoreStudentCollaboration(
    baseStats({
      messagesThisWeek: 2,
      messagesLastWeek: 20,
      activeDaysThisWeek: 1,
      daysSinceLastMessage: 8,
      problemKeywordHits: 5,
      totalRecentMessages: 5,
    })
  );
  assert.ok(["HIGH", "CRITICAL"].includes(result.riskLevel));
  assert.ok(result.flags.length >= 2);
});

check("8. no false positive from ordinary conversation", () => {
  const result = scoreStudentCollaboration(
    baseStats({ messagesThisWeek: 18, messagesLastWeek: 20, problemKeywordHits: 0 })
  );
  assert.strictEqual(result.riskLevel, "LOW");
});

check("9. never labels a mental/emotional state (student privacy/safety)", () => {
  const result = scoreStudentCollaboration(baseStats({ daysSinceLastMessage: 15, problemKeywordHits: 10, totalRecentMessages: 12 }));
  const asString = JSON.stringify(result).toLowerCase();
  ["depress", "anxi", "burnout", "suicid", "mental health"].forEach((bad) => assert.ok(!asString.includes(bad)));
});

check("10. uses the same 0-100 / LOW-MODERATE-HIGH-CRITICAL scale as Team Risk", () => {
  const result = scoreStudentCollaboration(baseStats({ daysSinceLastMessage: 8 }));
  assert.ok(result.riskScore >= 0 && result.riskScore <= 100);
  assert.ok(["LOW", "MODERATE", "HIGH", "CRITICAL"].includes(result.riskLevel));
});

console.log(`\n${passed} passed`);
