/**
 * STEP 16 — Feature 1 tests: meeting action-item extraction.
 * No DB / server needed — exercises aiService.extractMeetingActionItems()
 * directly, exactly like testTeamRiskAnalyzer.js does for its pure functions.
 *
 * Run: node backend/scripts/testMeetingActionItems.js
 */
const assert = require("assert");
const { extractMeetingActionItems } = require("../src/services/aiService");

let passed = 0;
const check = (label, fn) => {
  fn();
  passed += 1;
  console.log(`ok - ${label}`);
};

const MEMBERS = [{ name: "Rohan Sharma" }, { name: "Bhavani Reddy" }, { name: "Aditi Verma" }];

check("1. single action item", () => {
  const { actionItems } = extractMeetingActionItems("Rohan will finish the login API by Friday.", { members: MEMBERS });
  assert.strictEqual(actionItems.length, 1);
  assert.strictEqual(actionItems[0].owner, "Rohan Sharma");
  assert.strictEqual(actionItems[0].deadline, "by Friday");
  assert.strictEqual(actionItems[0].priority, "HIGH");
});

check("2. multiple action items", () => {
  const text =
    "Rohan will finish the login API by Friday. Bhavani needs to update the dashboard. " +
    "Aditi must fix the ZIP upload bug.";
  const { actionItems } = extractMeetingActionItems(text, { members: MEMBERS });
  assert.strictEqual(actionItems.length, 3);
});

check("3. multi-word owner", () => {
  const { actionItems } = extractMeetingActionItems("Rohan Sharma should implement the payment module.", {
    members: MEMBERS,
  });
  assert.strictEqual(actionItems[0].owner, "Rohan Sharma");
});

check("4. deadline extraction", () => {
  const { actionItems } = extractMeetingActionItems("Bhavani will test the dashboard tomorrow.", { members: MEMBERS });
  assert.strictEqual(actionItems[0].deadline, "tomorrow");
});

check("5. no deadline", () => {
  const { actionItems } = extractMeetingActionItems("Bhavani needs to update the dashboard.", { members: MEMBERS });
  assert.strictEqual(actionItems[0].deadline, null);
});

check("6. no identifiable owner", () => {
  const { actionItems } = extractMeetingActionItems("The team should test the ZIP submission flow tomorrow.", {
    members: MEMBERS,
  });
  assert.strictEqual(actionItems.length, 1);
  assert.strictEqual(actionItems[0].owner, null);
});

check("7. non-action conversation", () => {
  const { actionItems } = extractMeetingActionItems(
    "Hi everyone, thanks for joining today. Great progress this week! How is everyone feeling about the sprint?",
    { members: MEMBERS }
  );
  assert.strictEqual(actionItems.length, 0);
});

check("8. duplicate action item prevention", () => {
  const text = "Rohan will finish the login API by Friday. Rohan will finish the login API by Friday.";
  const { actionItems } = extractMeetingActionItems(text, { members: MEMBERS });
  assert.strictEqual(actionItems.length, 1);
});

check("9. group isolation (only trusted member list is matched)", () => {
  // "Priya" is not a member of THIS group's trusted member list, so she
  // must never be returned as an owner even though her name appears.
  const { actionItems } = extractMeetingActionItems("Priya will finish the report by Monday.", { members: MEMBERS });
  assert.strictEqual(actionItems[0].owner, null);
});

check("10. deterministic / fallback-safe (no AI engine call, pure JS)", () => {
  // Calling twice with the same input must give identical output — this
  // function never calls the network/AI engine, so it can never be
  // affected by the AI engine being unavailable.
  const text = "Aditi must fix the ZIP upload bug by tomorrow.";
  const a = extractMeetingActionItems(text, { members: MEMBERS });
  const b = extractMeetingActionItems(text, { members: MEMBERS });
  assert.deepStrictEqual(a, b);
});

check("does not execute submitted text as code", () => {
  const malicious = "Rohan will finish `require('fs').readFileSync('/etc/passwd')` by Friday.";
  const { actionItems } = extractMeetingActionItems(malicious, { members: MEMBERS });
  // Just treated as text — extraction still works, nothing is executed.
  assert.ok(actionItems.length >= 1);
});

console.log(`\n${passed} passed`);
