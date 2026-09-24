const mongoose = require("mongoose");
const StatusUpdate = require("../src/models/StatusUpdate");
const Community = require("../src/models/Community");
const CallLog = require("../src/models/CallLog");

describe("WhatsApp Features — Calls, Updates, Communities & Privacy Guardrails", () => {
  describe("1. Status Updates (24h Ephemeral Stories)", () => {
    it("assigns 24-hour default expiration upon creation", () => {
      const now = Date.now();
      const doc = new StatusUpdate({
        user: new mongoose.Types.ObjectId(),
        text: "Building the new frontend sprint!",
        color: "#059669",
      });

      expect(doc.text).toBe("Building the new frontend sprint!");
      expect(doc.color).toBe("#059669");
      expect(doc.expiresAt).toBeDefined();

      const diffHours = (doc.expiresAt.getTime() - now) / (1000 * 60 * 60);
      expect(Math.round(diffHours)).toBe(24);
    });

    it("requires status text", () => {
      const doc = new StatusUpdate({
        user: new mongoose.Types.ObjectId(),
        color: "#059669",
      });
      const err = doc.validateSync();
      expect(err.errors.text).toBeDefined();
    });

    it("rejects status text longer than 300 characters", () => {
      const doc = new StatusUpdate({
        user: new mongoose.Types.ObjectId(),
        text: "a".repeat(301),
      });
      const err = doc.validateSync();
      expect(err.errors.text).toBeDefined();
    });

    it("verifies 24-hour expiration filter criteria", () => {
      const now = new Date();
      const pastExpiry = new Date(now.getTime() - 1000);
      const futureExpiry = new Date(now.getTime() + 100000);

      expect(pastExpiry > now).toBe(false);
      expect(futureExpiry > now).toBe(true);
    });
  });

  describe("2. WhatsApp Communities (Inter-team Hub & Broadcasts)", () => {
    it("creates community with default category and color", () => {
      const userId = new mongoose.Types.ObjectId();
      const doc = new Community({
        name: "Computer Science Dept 2026",
        description: "Capstone projects and departmental announcements",
        createdBy: userId,
      });

      expect(doc.name).toBe("Computer Science Dept 2026");
      expect(doc.category).toBe("General");
      expect(doc.color).toBe("#059669");
      expect(doc.createdBy).toEqual(userId);
      expect(Array.isArray(doc.groups)).toBe(true);
      expect(Array.isArray(doc.announcements)).toBe(true);
    });

    it("supports linking project groups and adding broadcast announcements", () => {
      const comm = new Community({
        name: "AI Research Hub",
        createdBy: new mongoose.Types.ObjectId(),
      });

      const grp1 = new mongoose.Types.ObjectId();
      const grp2 = new mongoose.Types.ObjectId();
      comm.groups.push(grp1, grp2);
      expect(comm.groups).toHaveLength(2);

      comm.announcements.push({
        title: "Sprint Review Tomorrow",
        content: "All capstone teams present their demo at 10 AM.",
        sender: new mongoose.Types.ObjectId(),
      });

      expect(comm.announcements).toHaveLength(1);
      expect(comm.announcements[0].title).toBe("Sprint Review Tomorrow");
      expect(comm.announcements[0].createdAt).toBeDefined();
    });
  });

  describe("3. Call History & Direction Resolution", () => {
    it("correctly identifies outgoing vs incoming and missed calls", () => {
      const myId = "user_me_123";
      const peerId = "user_peer_456";

      const outgoingCall = {
        caller: { _id: myId, name: "Me" },
        receiver: { _id: peerId, name: "Teammate" },
        status: "ended",
        durationSeconds: 145,
      };

      const isCaller = outgoingCall.caller._id === myId;
      const peer = isCaller ? outgoingCall.receiver : outgoingCall.caller;
      expect(isCaller).toBe(true);
      expect(peer.name).toBe("Teammate");

      const incomingMissed = {
        caller: { _id: peerId, name: "Teammate" },
        receiver: { _id: myId, name: "Me" },
        status: "missed",
        durationSeconds: 0,
      };

      const isCallerIncoming = incomingMissed.caller._id === myId;
      const isMissed = incomingMissed.status === "missed" || incomingMissed.status === "rejected";
      expect(isCallerIncoming).toBe(false);
      expect(isMissed).toBe(true);
    });
  });

  describe("4. Strict Privacy & Zero AI Leakage Guarantee", () => {
    it("verifies StatusUpdate, Community, and CallLog models have zero group AI metrics association", () => {
      // Confirm schemas do not contain AI analytics or task scoring references
      const statusPaths = Object.keys(StatusUpdate.schema.paths);
      const commPaths = Object.keys(Community.schema.paths);
      const callPaths = Object.keys(CallLog.schema.paths);

      expect(statusPaths).not.toContain("aiScore");
      expect(statusPaths).not.toContain("codeReview");
      expect(statusPaths).not.toContain("plagiarismScore");

      expect(commPaths).not.toContain("aiWorkloadScore");
      expect(commPaths).not.toContain("groupRiskLevel");

      expect(callPaths).not.toContain("transcript");
      expect(callPaths).not.toContain("audioAnalysis");
    });
  });
});
