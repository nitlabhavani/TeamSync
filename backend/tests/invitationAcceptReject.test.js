// Tests for Student Invitation Accept & Reject Workflow
process.env.NODE_ENV = "test";

const http = require("http");
const mongoose = require("mongoose");

// Mocks
jest.mock("../src/models/User");
jest.mock("../src/models/Group");
jest.mock("../src/models/Invitation");
jest.mock("../src/models/Notification");
jest.mock("../src/services/activityService", () => ({
  logActivity: jest.fn().mockResolvedValue({}),
}));
jest.mock("../src/services/socketService", () => ({
  emitToUser: jest.fn(),
  emitToGroup: jest.fn(),
}));

const User = require("../src/models/User");
const Group = require("../src/models/Group");
const Invitation = require("../src/models/Invitation");
const Notification = require("../src/models/Notification");
const { signAccessToken } = require("../src/utils/token");

const GUIDE_ID = "64f000000000000000000001";
const STUDENT_ID = "64f000000000000000000002";
const OTHER_STUDENT_ID = "64f000000000000000000003";
const GROUP_ID = "64f000000000000000000004";
const TOKEN_VALID = "test-token-valid-123456";

let studentToken;
let otherToken;
let server;
let baseUrl;

beforeAll((done) => {
  const app = require("../src/app");
  studentToken = signAccessToken({ _id: STUDENT_ID, role: "student", email: "student@test.edu" });
  otherToken = signAccessToken({ _id: OTHER_STUDENT_ID, role: "student", email: "other@test.edu" });
  server = http.createServer(app);
  server.listen(0, () => {
    baseUrl = `http://127.0.0.1:${server.address().port}`;
    done();
  });
});

afterAll((done) => {
  server.close(done);
});

beforeEach(() => {
  jest.clearAllMocks();

  User.findById = jest.fn().mockImplementation((id) => {
    if (String(id) === STUDENT_ID) {
      return {
        select: jest.fn().mockResolvedValue({
          _id: new mongoose.Types.ObjectId(STUDENT_ID),
          name: "Test Student",
          email: "student@test.edu",
          role: "student",
          isActive: true,
        }),
      };
    }
    if (String(id) === OTHER_STUDENT_ID) {
      return {
        select: jest.fn().mockResolvedValue({
          _id: new mongoose.Types.ObjectId(OTHER_STUDENT_ID),
          name: "Other Student",
          email: "other@test.edu",
          role: "student",
          isActive: true,
        }),
      };
    }
    return { select: jest.fn().mockResolvedValue(null) };
  });

  Notification.insertMany = jest.fn().mockResolvedValue([]);
});

function request(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${baseUrl}${path}`);
    const req = http.request(
      url,
      {
        method,
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      },
      (res) => {
        let raw = "";
        res.on("data", (c) => (raw += c));
        res.on("end", () => {
          let parsed;
          try {
            parsed = JSON.parse(raw);
          } catch {
            parsed = raw;
          }
          resolve({ status: res.statusCode, body: parsed });
        });
      }
    );
    req.on("error", reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

describe("Invitation Accept & Reject Endpoints", () => {
  const mockGroup = {
    _id: new mongoose.Types.ObjectId(GROUP_ID),
    name: "AI Innovators",
    project: "Autonomous Agent System",
    description: "Building smart agents",
    category: "Machine Learning",
    expectedCompletion: new Date(),
    guide: new mongoose.Types.ObjectId(GUIDE_ID),
    leader: null,
    leaderEmail: "student@test.edu",
    members: [],
    maxMembers: 5,
    save: jest.fn().mockResolvedValue(true),
  };

  const mockGuide = {
    _id: new mongoose.Types.ObjectId(GUIDE_ID),
    name: "Dr. Professor",
    email: "prof@test.edu",
  };

  const createMockInvitation = (overrides = {}) => ({
    _id: new mongoose.Types.ObjectId(),
    group: mockGroup,
    invitedBy: mockGuide,
    email: "student@test.edu",
    role: "leader",
    status: "pending",
    token: TOKEN_VALID,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    otpHash: "mockedHash",
    otpExpiresAt: new Date(Date.now() + 10 * 60 * 1000),
    otpAttempts: 0,
    otpResends: 0,
    acceptedAt: null,
    rejectedAt: null,
    user: null,
    save: jest.fn().mockResolvedValue(true),
    ...overrides,
  });

  describe("GET /api/invitations/:token", () => {
    it("returns public invitation details for valid token", async () => {
      const inv = createMockInvitation();
      Invitation.findOne = jest.fn().mockReturnValue({
        populate: jest.fn().mockReturnValue({
          populate: jest.fn().mockResolvedValue(inv),
        }),
      });

      const res = await request("GET", `/api/invitations/${TOKEN_VALID}`);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.email).toBe("student@test.edu");
      expect(res.body.data.group.name).toBe("AI Innovators");
      expect(res.body.data.guideName).toBe("Dr. Professor");
      expect(res.body.data.role).toBe("leader");
      expect(res.body.data.status).toBe("pending");
    });

    it("returns 404 for nonexistent token", async () => {
      Invitation.findOne = jest.fn().mockReturnValue({
        populate: jest.fn().mockReturnValue({
          populate: jest.fn().mockResolvedValue(null),
        }),
      });

      const res = await request("GET", "/api/invitations/invalid-token");
      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });

    it("identifies expired invitations", async () => {
      const expiredInv = createMockInvitation({
        expiresAt: new Date(Date.now() - 1000),
      });
      Invitation.findOne = jest.fn().mockReturnValue({
        populate: jest.fn().mockReturnValue({
          populate: jest.fn().mockResolvedValue(expiredInv),
        }),
      });

      const res = await request("GET", `/api/invitations/${TOKEN_VALID}`);
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe("expired");
    });
  });

  describe("POST /api/invitations/:token/accept", () => {
    it("rejects unauthenticated requests with 401", async () => {
      const res = await request("POST", `/api/invitations/${TOKEN_VALID}/accept`, {});
      expect(res.status).toBe(401);
    });

    it("rejects requests if authenticated email does not match invitation email (403)", async () => {
      const inv = createMockInvitation();
      Invitation.findOne = jest.fn().mockReturnValue({
        populate: jest.fn().mockReturnValue({
          populate: jest.fn().mockResolvedValue(inv),
        }),
      });

      const res = await request("POST", `/api/invitations/${TOKEN_VALID}/accept`, {}, otherToken);
      expect(res.status).toBe(403);
      expect(res.body.message).toContain("sent to student@test.edu");
    });

    it("successfully accepts invitation when email matches", async () => {
      const inv = createMockInvitation();
      Invitation.findOne = jest.fn().mockReturnValue({
        populate: jest.fn().mockReturnValue({
          populate: jest.fn().mockResolvedValue(inv),
        }),
      });
      Group.findById = jest.fn().mockResolvedValue(mockGroup);

      const res = await request("POST", `/api/invitations/${TOKEN_VALID}/accept`, {}, studentToken);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.joined).toBe(true);
      expect(res.body.data.groupName).toBe("AI Innovators");
      expect(inv.status).toBe("accepted");
      expect(inv.acceptedAt).toBeInstanceOf(Date);
      expect(mockGroup.save).toHaveBeenCalled();
      expect(inv.save).toHaveBeenCalled();
      expect(Notification.insertMany).toHaveBeenCalled();
    });

    it("promotes student to leader if specified in role or leaderEmail", async () => {
      const inv = createMockInvitation({ role: "leader" });
      const groupWithoutLeader = {
        ...mockGroup,
        leader: null,
        members: [],
        save: jest.fn().mockResolvedValue(true),
      };
      Invitation.findOne = jest.fn().mockReturnValue({
        populate: jest.fn().mockReturnValue({
          populate: jest.fn().mockResolvedValue(inv),
        }),
      });
      Group.findById = jest.fn().mockResolvedValue(groupWithoutLeader);

      const res = await request("POST", `/api/invitations/${TOKEN_VALID}/accept`, {}, studentToken);
      expect(res.status).toBe(200);
      expect(res.body.data.isLeader).toBe(true);
      expect(String(groupWithoutLeader.leader)).toBe(STUDENT_ID);
    });

    it("prevents duplicate acceptance if invitation is already accepted (400)", async () => {
      const inv = createMockInvitation({ status: "accepted" });
      Invitation.findOne = jest.fn().mockReturnValue({
        populate: jest.fn().mockReturnValue({
          populate: jest.fn().mockResolvedValue(inv),
        }),
      });

      const res = await request("POST", `/api/invitations/${TOKEN_VALID}/accept`, {}, studentToken);
      expect(res.status).toBe(400);
      expect(res.body.message).toContain("already been accepted");
    });

    it("prevents acceptance if invitation is expired (400)", async () => {
      const inv = createMockInvitation({
        expiresAt: new Date(Date.now() - 5000),
      });
      Invitation.findOne = jest.fn().mockReturnValue({
        populate: jest.fn().mockReturnValue({
          populate: jest.fn().mockResolvedValue(inv),
        }),
      });

      const res = await request("POST", `/api/invitations/${TOKEN_VALID}/accept`, {}, studentToken);
      expect(res.status).toBe(400);
      expect(res.body.message).toContain("expired");
    });

    it("prevents acceptance if invitation was rejected (403)", async () => {
      const inv = createMockInvitation({ status: "rejected" });
      Invitation.findOne = jest.fn().mockReturnValue({
        populate: jest.fn().mockReturnValue({
          populate: jest.fn().mockResolvedValue(inv),
        }),
      });

      const res = await request("POST", `/api/invitations/${TOKEN_VALID}/accept`, {}, studentToken);
      expect(res.status).toBe(403);
      expect(res.body.message).toContain("rejected");
    });
  });

  describe("POST /api/invitations/:token/reject", () => {
    it("successfully marks invitation as rejected", async () => {
      const inv = createMockInvitation();
      Invitation.findOne = jest.fn().mockReturnValue({
        populate: jest.fn().mockReturnValue({
          populate: jest.fn().mockResolvedValue(inv),
        }),
      });

      const res = await request("POST", `/api/invitations/${TOKEN_VALID}/reject`, {}, studentToken);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(inv.status).toBe("rejected");
      expect(inv.rejectedAt).toBeInstanceOf(Date);
      expect(inv.save).toHaveBeenCalled();
      expect(Notification.insertMany).toHaveBeenCalled();
    });

    it("rejects attempt by mismatched authenticated user (403)", async () => {
      const inv = createMockInvitation();
      Invitation.findOne = jest.fn().mockReturnValue({
        populate: jest.fn().mockReturnValue({
          populate: jest.fn().mockResolvedValue(inv),
        }),
      });

      const res = await request("POST", `/api/invitations/${TOKEN_VALID}/reject`, {}, otherToken);
      expect(res.status).toBe(403);
    });

    it("prevents rejection if already accepted (400)", async () => {
      const inv = createMockInvitation({ status: "accepted" });
      Invitation.findOne = jest.fn().mockReturnValue({
        populate: jest.fn().mockReturnValue({
          populate: jest.fn().mockResolvedValue(inv),
        }),
      });

      const res = await request("POST", `/api/invitations/${TOKEN_VALID}/reject`, {}, studentToken);
      expect(res.status).toBe(400);
    });
  });
});
