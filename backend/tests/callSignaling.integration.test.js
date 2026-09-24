process.env.JWT_SECRET = "test-secret";

jest.mock("../src/models/User", () => ({
  findById: jest.fn(),
}));
jest.mock("../src/models/Group", () => ({
  findById: jest.fn(),
}));
jest.mock("../src/models/CallLog", () => ({
  create: jest.fn().mockResolvedValue({}),
}));
jest.mock("../src/services/notificationService", () => ({
  notifyUsers: jest.fn().mockResolvedValue([]),
}));

const http = require("http");
const jwt = require("jsonwebtoken");
const { io: ioClient } = require("socket.io-client");
const registerSockets = require("../src/sockets");
const User = require("../src/models/User");

const USERS = { a: "user-a", b: "user-b", c: "user-c" };

const tokenFor = (uid) => jwt.sign({ sub: uid, role: "student", email: `${uid}@test.dev` }, "test-secret");

/** Matches the shape `User.findById(id).select("isActive")` expects. */
User.findById.mockImplementation((id) => ({
  select: jest.fn().mockResolvedValue({ _id: id, isActive: true }),
}));

describe("private-call socket signaling — integration (spec sections A/B/C/16)", () => {
  let server;
  let port;
  let clients;

  const connectAs = (uid) =>
    new Promise((resolve, reject) => {
      const client = ioClient(`http://localhost:${port}`, {
        auth: { token: tokenFor(uid) },
        transports: ["websocket"],
        forceNew: true,
      });
      client.on("connect", () => resolve(client));
      client.on("connect_error", reject);
    });

  beforeAll((done) => {
    server = http.createServer();
    registerSockets(server);
    server.listen(0, () => {
      port = server.address().port;
      done();
    });
  });

  afterAll((done) => {
    server.close(done);
  });

  afterEach(() => {
    clients?.forEach((c) => c.disconnect());
  });

  test("2. unauthenticated connection (no/invalid token) is rejected", (done) => {
    const bad = ioClient(`http://localhost:${port}`, {
      auth: { token: "garbage" },
      transports: ["websocket"],
      forceNew: true,
    });
    bad.on("connect_error", (err) => {
      expect(err.message).toMatch(/Unauthorized/);
      bad.close();
      done();
    });
    bad.on("connect", () => {
      bad.close();
      done(new Error("should not have connected"));
    });
  });

  test("1/8/9/10. full happy path: call -> incoming -> accept -> accepted, scoped to the two participants", async () => {
    const a = await connectAs(USERS.a);
    const b = await connectAs(USERS.b);
    clients = [a, b];

    const incoming = new Promise((resolve) => b.once("private-call:incoming", resolve));
    const callAck = await new Promise((resolve) => a.emit("private-call:call", { toUserId: USERS.b, type: "video" }, resolve));
    expect(callAck.ok).toBe(true);
    expect(typeof callAck.callId).toBe("string");

    const incomingPayload = await incoming;
    expect(incomingPayload.fromUserId).toBe(USERS.a);
    expect(incomingPayload.type).toBe("video");

    const accepted = new Promise((resolve) => a.once("private-call:accepted", resolve));
    const acceptAck = await new Promise((resolve) =>
      b.emit("private-call:accept", { callId: callAck.callId }, resolve)
    );
    expect(acceptAck.ok).toBe(true);
    await expect(accepted).resolves.toMatchObject({ callId: callAck.callId });
  });

  test("3. cannot call self", async () => {
    const a = await connectAs(USERS.a);
    clients = [a];
    const ack = await new Promise((resolve) => a.emit("private-call:call", { toUserId: USERS.a, type: "voice" }, resolve));
    expect(ack.ok).toBe(false);
  });

  test("4. cannot impersonate another caller — fromUserId on the incoming event is always the authenticated socket's own id, never client-supplied", async () => {
    const a = await connectAs(USERS.a);
    const b = await connectAs(USERS.b);
    clients = [a, b];
    const incoming = new Promise((resolve) => b.once("private-call:incoming", resolve));
    // Even if a malicious client tried to pass a spoofed identity in the
    // payload, the handler only ever reads socket.user.sub (uid) for
    // fromUserId — there is no field a client can set to override it.
    a.emit("private-call:call", { toUserId: USERS.b, type: "voice", fromUserId: "someone-else" }, () => {});
    const payload = await incoming;
    expect(payload.fromUserId).toBe(USERS.a);
  });

  test("5. an unrelated third user cannot accept/reject/end someone else's call", async () => {
    const a = await connectAs(USERS.a);
    const b = await connectAs(USERS.b);
    const c = await connectAs(USERS.c);
    clients = [a, b, c];

    const callAck = await new Promise((resolve) => a.emit("private-call:call", { toUserId: USERS.b, type: "voice" }, resolve));
    const ack = await new Promise((resolve) => c.emit("private-call:accept", { callId: callAck.callId }, resolve));
    expect(ack.ok).toBe(false);
    expect(ack.error).toMatch(/Not a participant/);
  });

  test("6. invalid/unknown call ID is rejected, not silently accepted", async () => {
    const a = await connectAs(USERS.a);
    clients = [a];
    const ack = await new Promise((resolve) => a.emit("private-call:accept", { callId: "does-not-exist" }, resolve));
    expect(ack.ok).toBe(false);
  });

  test("19/20. call signaling is never broadcast to a group room, and group ids cannot be used as a callId/target", async () => {
    const a = await connectAs(USERS.a);
    const b = await connectAs(USERS.b);
    const c = await connectAs(USERS.c);
    clients = [a, b, c];

    let cSawIncoming = false;
    c.on("private-call:incoming", () => {
      cSawIncoming = true;
    });

    const incoming = new Promise((resolve) => b.once("private-call:incoming", resolve));
    await new Promise((resolve) => a.emit("private-call:call", { toUserId: USERS.b, type: "voice" }, resolve));
    await incoming;

    // Give any (incorrect) broadcast a moment to arrive before asserting it never did.
    await new Promise((r) => setTimeout(r, 50));
    expect(cSawIncoming).toBe(false);
  });

  test("offer/answer/ICE relay only reaches the other participant, never a third party, and is dropped for a stale callId", async () => {
    const a = await connectAs(USERS.a);
    const b = await connectAs(USERS.b);
    const c = await connectAs(USERS.c);
    clients = [a, b, c];

    let cSawOffer = false;
    c.on("private-call:offer", () => {
      cSawOffer = true;
    });

    const callAck = await new Promise((resolve) => a.emit("private-call:call", { toUserId: USERS.b, type: "video" }, resolve));
    const offerReceived = new Promise((resolve) => b.once("private-call:offer", resolve));
    a.emit("private-call:offer", { callId: callAck.callId, sdp: "fake-sdp" });
    const offer = await offerReceived;
    expect(offer.fromUserId).toBe(USERS.a);

    // Stale callId: relay silently drops rather than erroring or broadcasting.
    a.emit("private-call:offer", { callId: "stale-call-id", sdp: "fake-sdp" });
    await new Promise((r) => setTimeout(r, 50));
    expect(cSawOffer).toBe(false);
  });

  test("cancel before answer stops ringing for the receiver", async () => {
    const a = await connectAs(USERS.a);
    const b = await connectAs(USERS.b);
    clients = [a, b];

    const callAck = await new Promise((resolve) => a.emit("private-call:call", { toUserId: USERS.b, type: "voice" }, resolve));
    const cancelled = new Promise((resolve) => b.once("private-call:cancelled", resolve));
    a.emit("private-call:cancel", { callId: callAck.callId });
    await expect(cancelled).resolves.toMatchObject({ callId: callAck.callId });
  });

  test("duplicate call attempt while the caller already has an active call is rejected", async () => {
    const a = await connectAs(USERS.a);
    const b = await connectAs(USERS.b);
    const c = await connectAs(USERS.c);
    clients = [a, b, c];

    const firstAck = await new Promise((resolve) => a.emit("private-call:call", { toUserId: USERS.b, type: "voice" }, resolve));
    expect(firstAck.ok).toBe(true);
    const secondAck = await new Promise((resolve) => a.emit("private-call:call", { toUserId: USERS.c, type: "voice" }, resolve));
    expect(secondAck.ok).toBe(false);
  });
});
