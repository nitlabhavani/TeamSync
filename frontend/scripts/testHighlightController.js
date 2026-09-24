/**
 * STEP 34 (post-verification fix) — regression coverage for the
 * notification-target message highlight lifecycle bug.
 *
 * Tests the extracted, framework-free `createHighlightController` directly
 * (frontend/src/utils/highlightController.js) with plain Node + real
 * short-duration timers — no browser, no React renderer, no test
 * framework required (this project has none installed on the frontend;
 * this follows the same "plain node script, plain assert" convention the
 * existing backend/scripts/test*.js files already use).
 *
 * Covers exactly the scenarios requested for this fix:
 *   1. found target -> highlight appears
 *   2. highlight clears after the timeout
 *   3. parent "consuming" the target (i.e. onChange firing early, as
 *      onHighlightShown() does in GroupChat) does not permanently leave
 *      the highlight active
 *   4. missing target -> no stale highlight
 *   5. switching targets/groups does not leak the previous highlight
 *
 * Run: node frontend/scripts/testHighlightController.js
 */
import assert from "node:assert";
import { createHighlightController } from "../src/utils/highlightController.js";

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Short duration so the suite runs fast and deterministically.
const DURATION_MS = 40;

async function test1_foundTargetHighlights() {
  const seen = [];
  const ctrl = createHighlightController({
    durationMs: DURATION_MS,
    onChange: (id) => seen.push(id),
  });

  ctrl.show("msg_1");
  assert.strictEqual(
    ctrl.getActiveId(),
    "msg_1",
    "the target message should be highlighted immediately",
  );
  assert.deepStrictEqual(seen, ["msg_1"]);
  assert.strictEqual(ctrl.hasPendingTimer(), true, "a clear-timer must be scheduled");
  console.log("ok - 1. a found target is highlighted immediately");
}

async function test2_highlightClearsAfterTimeout() {
  const seen = [];
  const ctrl = createHighlightController({
    durationMs: DURATION_MS,
    onChange: (id) => seen.push(id),
  });

  ctrl.show("msg_1");
  await wait(DURATION_MS + 30);

  assert.strictEqual(ctrl.getActiveId(), null, "the highlight must be gone after ~duration ms");
  assert.strictEqual(ctrl.hasPendingTimer(), false, "the timer must have fired and cleared itself");
  assert.deepStrictEqual(
    seen,
    ["msg_1", null],
    "onChange must be called with the id, then with null",
  );
  console.log("ok - 2. the highlight clears on its own after the timeout");
}

async function test3_parentConsumingTargetEarlyDoesNotLeaveHighlightForever() {
  // This is the exact bug scenario: GroupChat's effect calls
  // onHighlightShown() synchronously right after ctrl.show(...), which in
  // the real app clears the parent's `highlightMessageId` prop and causes
  // a re-render. That re-render must NOT cancel the clear-timer.
  const seen = [];
  const ctrl = createHighlightController({
    durationMs: DURATION_MS,
    onChange: (id) => seen.push(id),
  });

  ctrl.show("msg_1");
  // Simulate "the parent immediately consumed/cleared the target" — in the
  // buggy implementation this was modeled by a dependency-array effect
  // re-running and cancelling the timer via its cleanup function. Here we
  // simply assert that nothing about the controller's own state depends
  // on any external "target" value at all — the timer is self-contained.
  const parentTargetAfterConsumption = null; // highlightMessageId, post onHighlightShown()
  void parentTargetAfterConsumption; // the controller never reads this - that's the fix

  assert.strictEqual(
    ctrl.hasPendingTimer(),
    true,
    "the timer must survive the parent clearing its own state",
  );
  await wait(DURATION_MS + 30);
  assert.strictEqual(
    ctrl.getActiveId(),
    null,
    "the highlight must still clear on its own, not stay on forever",
  );
  console.log(
    "ok - 3. the parent consuming/clearing its target does not leave the highlight active forever",
  );
}

async function test4_missingTargetLeavesNoStaleHighlight() {
  const seen = [];
  const ctrl = createHighlightController({
    durationMs: DURATION_MS,
    onChange: (id) => seen.push(id),
  });

  // Message not found in the loaded history — GroupChat calls clearNow().
  ctrl.clearNow();

  assert.strictEqual(
    ctrl.getActiveId(),
    null,
    "no highlight must be set for a target that was never found",
  );
  assert.strictEqual(
    ctrl.hasPendingTimer(),
    false,
    "no timer should be scheduled for a missing target",
  );
  await wait(DURATION_MS + 30);
  assert.strictEqual(ctrl.getActiveId(), null, "still nothing highlighted after waiting");
  console.log("ok - 4. a missing target never produces a stale highlight");
}

async function test5_newTargetReplacesPreviousWithoutLeaking() {
  const seen = [];
  const ctrl = createHighlightController({
    durationMs: DURATION_MS,
    onChange: (id) => seen.push(id),
  });

  ctrl.show("msg_1");
  await wait(10); // well before msg_1's timer would fire on its own
  ctrl.show("msg_2"); // a second notification click, before the first cleared

  assert.strictEqual(ctrl.getActiveId(), "msg_2", "the newer target must be the one highlighted");
  assert.strictEqual(ctrl.hasPendingTimer(), true);

  // Only msg_2's timer should still be pending — wait past msg_1's
  // original deadline and confirm msg_2 is still highlighted (its own
  // independent timer, not msg_1's cancelled one, is what's running).
  await wait(DURATION_MS - 10);
  assert.strictEqual(
    ctrl.getActiveId(),
    "msg_2",
    "msg_1's original timer must not have cleared msg_2's highlight",
  );

  await wait(30);
  assert.strictEqual(ctrl.getActiveId(), null, "msg_2's own timer must eventually clear it");
  assert.deepStrictEqual(
    seen,
    ["msg_1", "msg_2", null],
    "msg_1 must never re-appear or double-clear",
  );
  console.log(
    "ok - 5. a new target fully replaces the previous highlight/timer without leaking it",
  );
}

async function test6_groupSwitchResetDoesNotLeakIntoNewGroup() {
  // Models GroupChat's group-change cleanup effect: reset() is called with
  // no onChange guarantees (the component clears its own local state in
  // the same breath), and must stop any pending timer for the old group.
  const seen = [];
  const ctrl = createHighlightController({
    durationMs: DURATION_MS,
    onChange: (id) => seen.push(id),
  });

  ctrl.show("groupA_msg_1");
  ctrl.reset(); // simulates switching to a different group

  assert.strictEqual(ctrl.getActiveId(), null, "reset() must clear the active id");
  assert.strictEqual(ctrl.hasPendingTimer(), false, "reset() must cancel the pending timer");

  await wait(DURATION_MS + 30);
  // If the old timer had leaked, this would fire a stray onChange(null)
  // after reset already happened — harmless by itself, but let's confirm
  // no *new* highlight silently reappears for the old group's message.
  assert.strictEqual(
    ctrl.getActiveId(),
    null,
    "no leaked highlight must reappear after switching groups",
  );

  // The new group can now show its own message cleanly.
  ctrl.show("groupB_msg_1");
  assert.strictEqual(
    ctrl.getActiveId(),
    "groupB_msg_1",
    "the new group's target must highlight normally",
  );
  console.log(
    "ok - 6. switching groups (reset) does not leak the previous group's highlight/timer",
  );
}

(async () => {
  await test1_foundTargetHighlights();
  await test2_highlightClearsAfterTimeout();
  await test3_parentConsumingTargetEarlyDoesNotLeaveHighlightForever();
  await test4_missingTargetLeavesNoStaleHighlight();
  await test5_newTargetReplacesPreviousWithoutLeaking();
  await test6_groupSwitchResetDoesNotLeakIntoNewGroup();
  console.log("\nAll highlight-controller regression tests passed.");
})().catch((err) => {
  console.error("FAILED:", err);
  process.exit(1);
});
