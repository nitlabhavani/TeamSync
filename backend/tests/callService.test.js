jest.mock("../src/models/User", () => ({
  findById: jest.fn(),
}));

const User = require("../src/models/User");
const { CallSessionManager, STATES, validateCallTarget } = require("../src/services/callService");

const selectableUser = (doc) => ({ select: jest.fn().mockResolvedValue(doc) });

describe("validateCallTarget — private call authorization (spec section A)", () => {
  beforeEach(() => jest.clearAllMocks());

  test("1. authenticated user can initiate call to a valid, active peer", async () => {
    User.findById.mockReturnValue(selectableUser({ _id: "b", isActive: true }));
    await expect(validateCallTarget("a", "b")).resolves.toMatchObject({ isActive: true });
  });

  test("3. caller cannot call self", async () => {
    await expect(validateCallTarget("a", "a")).rejects.toMatchObject({ statusCode: 400 });
  });

  test("target user must exist", async () => {
    User.findById.mockReturnValue(selectableUser(null));
    await expect(validateCallTarget("a", "ghost")).rejects.toMatchObject({ statusCode: 404 });
  });

  test("deactivated target user is rejected", async () => {
    User.findById.mockReturnValue(selectableUser({ _id: "b", isActive: false }));
    await expect(validateCallTarget("a", "b")).rejects.toMatchObject({ statusCode: 404 });
  });

  test("missing ids are rejected", async () => {
    await expect(validateCallTarget("a", undefined)).rejects.toMatchObject({ statusCode: 400 });
    await expect(validateCallTarget(undefined, "b")).rejects.toMatchObject({ statusCode: 400 });
  });

  test("7. a groupId can never stand in for calleeId — validateCallTarget only ever accepts bare user ids and looks them up in the User collection, never Group", async () => {
    // There is no branch in validateCallTarget that queries the Group model
    // at all, so passing a real groupId simply fails the same way any
    // unknown/nonexistent user id would.
    User.findById.mockReturnValue(selectableUser(null));
    await expect(validateCallTarget("a", "some-group-id")).rejects.toMatchObject({ statusCode: 404 });
    expect(User.findById).toHaveBeenCalledWith("some-group-id");
  });
});

describe("CallSessionManager — lifecycle (spec section B) and race conditions (spec section 16)", () => {
  let manager;
  beforeEach(() => {
    manager = new CallSessionManager();
  });

  test("8/9. create() starts a RINGING session visible to both participants", () => {
    const session = manager.create({ callerId: "a", calleeId: "b", type: "voice" });
    expect(session.state).toBe(STATES.RINGING);
    expect(manager.getActiveCallIdForUser("a")).toBe(session.callId);
    expect(manager.getActiveCallIdForUser("b")).toBe(session.callId);
  });

  test("10. accept() transitions RINGING -> ACCEPTED and is reflected for both users", () => {
    const session = manager.create({ callerId: "a", calleeId: "b", type: "video" });
    const updated = manager.transition(session.callId, "b", STATES.ACCEPTED, [STATES.RINGING]);
    expect(updated.state).toBe(STATES.ACCEPTED);
  });

  test("11. reject() transitions RINGING -> REJECTED and releases both users", () => {
    const session = manager.create({ callerId: "a", calleeId: "b", type: "voice" });
    manager.transition(session.callId, "b", STATES.REJECTED, [STATES.RINGING]);
    expect(manager.isUserBusy("a")).toBe(false);
    expect(manager.isUserBusy("b")).toBe(false);
  });

  test("12. cancel() by the caller before answer releases both users", () => {
    const session = manager.create({ callerId: "a", calleeId: "b", type: "voice" });
    manager.transition(session.callId, "a", STATES.CANCELLED, [STATES.RINGING]);
    expect(manager.isUserBusy("a")).toBe(false);
    expect(manager.isUserBusy("b")).toBe(false);
  });

  test("13. end() from CONNECTED releases both users", () => {
    const session = manager.create({ callerId: "a", calleeId: "b", type: "voice" });
    manager.transition(session.callId, "b", STATES.ACCEPTED, [STATES.RINGING]);
    manager.transition(session.callId, "a", STATES.CONNECTED, [STATES.ACCEPTED]);
    manager.transition(session.callId, "a", STATES.ENDED, [STATES.ACCEPTED, STATES.CONNECTED]);
    expect(manager.isUserBusy("a")).toBe(false);
    expect(manager.isUserBusy("b")).toBe(false);
  });

  test("16. cleanup — releasing a call frees the slot for a brand new call attempt", () => {
    const first = manager.create({ callerId: "a", calleeId: "b", type: "voice" });
    manager.transition(first.callId, "a", STATES.CANCELLED, [STATES.RINGING]);
    expect(() => manager.create({ callerId: "a", calleeId: "b", type: "voice" })).not.toThrow();
  });

  test("only one active private call session per user — duplicate call attempt while busy is rejected", () => {
    manager.create({ callerId: "a", calleeId: "b", type: "voice" });
    expect(() => manager.create({ callerId: "a", calleeId: "c", type: "voice" })).toThrow();
    expect(() => manager.create({ callerId: "c", calleeId: "b", type: "voice" })).toThrow();
  });

  test("race: receiver accepts after caller already cancelled — no-ops instead of corrupting state", () => {
    const session = manager.create({ callerId: "a", calleeId: "b", type: "voice" });
    manager.transition(session.callId, "a", STATES.CANCELLED, [STATES.RINGING]);
    const result = manager.transition(session.callId, "b", STATES.ACCEPTED, [STATES.RINGING]);
    expect(result.state).toBe(STATES.CANCELLED); // accept after cancel is ignored, not applied
  });

  test("race: duplicate reject events are idempotent (second one no-ops)", () => {
    const session = manager.create({ callerId: "a", calleeId: "b", type: "voice" });
    manager.transition(session.callId, "b", STATES.REJECTED, [STATES.RINGING]);
    expect(() => manager.transition(session.callId, "b", STATES.REJECTED, [STATES.RINGING])).not.toThrow();
  });

  test("stale/unknown callId on transition throws instead of silently succeeding", () => {
    expect(() => manager.transition("does-not-exist", "a", STATES.ACCEPTED, [STATES.RINGING])).toThrow();
  });

  test("5. an unrelated user cannot act on someone else's call", () => {
    const session = manager.create({ callerId: "a", calleeId: "b", type: "voice" });
    expect(() => manager.transition(session.callId, "mallory", STATES.ACCEPTED, [STATES.RINGING])).toThrow();
  });

  test("15. ring timeout marks the call MISSED and releases both users", (done) => {
    const manager2 = new CallSessionManager();
    const realSetTimeout = global.setTimeout;
    // Exercise the same code path with a near-zero timeout instead of
    // waiting the real 45s in a unit test.
    jest.spyOn(global, "setTimeout").mockImplementation((fn, _ms) => realSetTimeout(fn, 10));
    const session = manager2.create({
      callerId: "a",
      calleeId: "b",
      type: "voice",
      onRingTimeout: (s) => {
        expect(s.state).toBe(STATES.MISSED);
        expect(manager2.isUserBusy("a")).toBe(false);
        expect(manager2.isUserBusy("b")).toBe(false);
        global.setTimeout.mockRestore();
        done();
      },
    });
    expect(session.state).toBe(STATES.RINGING);
  });

  test("peer disconnect (browser refresh/navigation) force-ends an active call", () => {
    const session = manager.create({ callerId: "a", calleeId: "b", type: "voice" });
    manager.transition(session.callId, "b", STATES.ACCEPTED, [STATES.RINGING]);
    const result = manager.endAllForUser("a");
    expect(result.state).toBe(STATES.ENDED);
    expect(manager.isUserBusy("a")).toBe(false);
    expect(manager.isUserBusy("b")).toBe(false);
  });

  test("peer disconnect while still RINGING is reported as MISSED, not ENDED", () => {
    const session = manager.create({ callerId: "a", calleeId: "b", type: "voice" });
    const result = manager.endAllForUser("b");
    expect(result.state).toBe(STATES.MISSED);
    expect(session.callId).toBe(result.callId);
  });
});
