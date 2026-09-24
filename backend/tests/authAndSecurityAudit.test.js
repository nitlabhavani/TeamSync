// LIVE READINESS: Complete Authentication & Authorization Audit Test Suite
process.env.NODE_ENV = "test";

jest.mock("../src/models/User", () => ({
  findOne: jest.fn(),
  findById: jest.fn(),
}));
jest.mock("../src/models/Group", () => ({
  findById: jest.fn(),
}));
jest.mock("../src/models/Notification", () => ({
  find: jest.fn(),
  countDocuments: jest.fn(),
}));
jest.mock("../src/models/Invitation", () => ({
  find: jest.fn().mockResolvedValue([]),
}));

const http = require("http");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const User = require("../src/models/User");
const Group = require("../src/models/Group");
const Notification = require("../src/models/Notification");

const GUIDE_ID = "64f0000000000000000000g1";
const STUDENT_ID = "64f0000000000000000000s1";
const OUTSIDER_ID = "64f0000000000000000000o1";
const GROUP_ID = "64f000000000000000000aa1";

const tokenFor = (uid, role) => jwt.sign({ sub: uid, role, email: `${uid}@test.dev` }, process.env.JWT_SECRET);

let server;
let baseUrl;

beforeAll((done) => {
  const app = require("../src/app");
  server = http.createServer(app);
  server.listen(0, () => {
    baseUrl = `http://127.0.0.1:${server.address().port}`;
    done();
  });
});

afterAll((done) => {
  server.close(done);
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
          let json = null;
          try {
            json = JSON.parse(raw);
          } catch {}
          resolve({ status: res.statusCode, json });
        });
      }
    );
    req.on("error", reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

describe("1. Authentication Live-Readiness — POST /api/auth/login", () => {
  const hashedPassword = bcrypt.hashSync("CorrectPassword123", 10);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("valid credentials of verified user → 200 and returns token + session", async () => {
    User.findOne.mockReturnValue({
      select: jest.fn().mockResolvedValue({
        _id: STUDENT_ID,
        name: "Test Student",
        email: "student@test.dev",
        role: "student",
        password: hashedPassword,
        isActive: true,
        isVerified: true,
        comparePassword: (p) => bcrypt.compare(p, hashedPassword),
        save: jest.fn().mockResolvedValue(true),
      }),
    });

    const res = await request("POST", "/api/auth/login", {
      email: "student@test.dev",
      password: "CorrectPassword123",
    });

    expect(res.status).toBe(200);
    expect(res.json.success).toBe(true);
    expect(res.json.data.token).toBeDefined();
    expect(res.json.data.user.email).toBe("student@test.dev");
  });

  test("wrong password → 401 Unauthorized", async () => {
    User.findOne.mockReturnValue({
      select: jest.fn().mockResolvedValue({
        _id: STUDENT_ID,
        email: "student@test.dev",
        password: hashedPassword,
        isActive: true,
        isVerified: true,
        comparePassword: (p) => bcrypt.compare(p, hashedPassword),
      }),
    });

    const res = await request("POST", "/api/auth/login", {
      email: "student@test.dev",
      password: "WrongPassword!",
    });

    expect(res.status).toBe(401);
    expect(res.json.success).toBe(false);
  });

  test("unregistered email → 401 Unauthorized", async () => {
    User.findOne.mockReturnValue({
      select: jest.fn().mockResolvedValue(null),
    });

    const res = await request("POST", "/api/auth/login", {
      email: "nonexistent@test.dev",
      password: "AnyPassword123",
    });

    expect(res.status).toBe(401);
    expect(res.json.success).toBe(false);
  });

  test("unverified user (isVerified=false) → 401 Unauthorized", async () => {
    User.findOne.mockReturnValue({
      select: jest.fn().mockResolvedValue({
        _id: STUDENT_ID,
        email: "unverified@test.dev",
        password: hashedPassword,
        isActive: true,
        isVerified: false,
        comparePassword: (p) => bcrypt.compare(p, hashedPassword),
      }),
    });

    const res = await request("POST", "/api/auth/login", {
      email: "unverified@test.dev",
      password: "CorrectPassword123",
    });

    expect(res.status).toBe(401);
    expect(res.json.message).toMatch(/not verified/i);
  });

  test("deactivated user (isActive=false) → 403 Forbidden", async () => {
    User.findOne.mockReturnValue({
      select: jest.fn().mockResolvedValue({
        _id: STUDENT_ID,
        email: "inactive@test.dev",
        password: hashedPassword,
        isActive: false,
        isVerified: true,
        comparePassword: (p) => bcrypt.compare(p, hashedPassword),
      }),
    });

    const res = await request("POST", "/api/auth/login", {
      email: "inactive@test.dev",
      password: "CorrectPassword123",
    });

    expect(res.status).toBe(403);
  });
});

describe("2. Notifications Authorization — GET /api/notifications", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("unauthenticated request → 401 Unauthorized (expected behavior)", async () => {
    const res = await request("GET", "/api/notifications", null, null);
    expect(res.status).toBe(401);
  });

  test("authenticated request with valid Bearer token → 200 OK with notifications", async () => {
    User.findById.mockImplementation((id) => ({
      select: jest.fn().mockResolvedValue({ _id: id, isActive: true, role: "student" }),
    }));
    Notification.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        limit: jest.fn().mockResolvedValue([]),
      }),
    });
    Notification.countDocuments.mockResolvedValue(0);

    const res = await request("GET", "/api/notifications", null, tokenFor(STUDENT_ID, "student"));
    expect(res.status).toBe(200);
    expect(res.json.success).toBe(true);
    expect(res.json.data.unread).toBe(0);
    expect(Array.isArray(res.json.data.items)).toBe(true);
  });
});

describe("3. Role Authorization & Group Isolation", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    User.findById.mockImplementation((id) => ({
      select: jest.fn().mockResolvedValue({
        _id: id,
        isActive: true,
        role: id === GUIDE_ID ? "guide" : "student",
      }),
    }));
    Group.findById.mockImplementation(async (id) => {
      if (String(id) === GROUP_ID) {
        return {
          _id: GROUP_ID,
          name: "Team Alpha",
          guide: GUIDE_ID,
          members: [STUDENT_ID],
          leader: STUDENT_ID,
        };
      }
      return null;
    });
  });

  test("student accessing guide-only route (/api/ai/guide-overview) → 403 Forbidden", async () => {
    const res = await request("GET", "/api/ai/guide-overview", null, tokenFor(STUDENT_ID, "student"));
    expect(res.status).toBe(403);
  });

  test("outsider accessing a group route (/api/groups/:groupId/calendar) → 403 Forbidden", async () => {
    const res = await request("GET", `/api/groups/${GROUP_ID}/calendar`, null, tokenFor(OUTSIDER_ID, "student"));
    expect(res.status).toBe(403);
  });
});
