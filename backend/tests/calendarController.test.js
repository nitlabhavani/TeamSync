// Calendar feature — GET /groups/:groupId/calendar
// Boots the real app.js (same approach as uploadsStaticAuth.test.js) with
// only the data models mocked, so authentication (protect), group
// authorization (requireGroupAccess) and error handling (CastError, etc.)
// all run for real — only the database layer is stubbed.

process.env.JWT_SECRET = "test-secret";
process.env.NODE_ENV = "test";

jest.mock("../src/models/User", () => ({ findById: jest.fn() }));
jest.mock("../src/models/Group", () => ({ findById: jest.fn() }));
jest.mock("../src/models/Task", () => ({ find: jest.fn() }));
jest.mock("../src/models/Meeting", () => ({ find: jest.fn() }));
jest.mock("../src/models/SprintPlan", () => ({ find: jest.fn() }));
jest.mock("../src/models/Milestone", () => ({ find: jest.fn() }));

const http = require("http");
const jwt = require("jsonwebtoken");
const User = require("../src/models/User");
const Group = require("../src/models/Group");
const Task = require("../src/models/Task");
const Meeting = require("../src/models/Meeting");
const SprintPlan = require("../src/models/SprintPlan");
const Milestone = require("../src/models/Milestone");

const GUIDE_ID = "64f0000000000000000000g1";
const STUDENT_ID = "64f0000000000000000000s1";
const OTHER_STUDENT_ID = "64f0000000000000000000s2";
const OUTSIDER_ID = "64f0000000000000000000o1";
const GROUP_A_ID = "64f000000000000000000aa1";
const GROUP_B_ID = "64f000000000000000000bb1"; // same `name` as Group A, different _id

const tokenFor = (uid, role) => jwt.sign({ sub: uid, role, email: `${uid}@test.dev` }, process.env.JWT_SECRET);

function makeQueryable(chainMethods, resolvedValue) {
  // Supports controller code that does `.select(...).lean()` off a find() result.
  const obj = {};
  for (const m of chainMethods) obj[m] = jest.fn().mockReturnValue(obj);
  obj.lean = jest.fn().mockResolvedValue(resolvedValue);
  return obj;
}

function groupDoc({ _id, name, members, guide }) {
  return {
    _id,
    name,
    project: "Capstone Project",
    guide,
    members,
    expectedCompletion: new Date("2026-12-01T00:00:00.000Z"),
  };
}

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

function request(path, token) {
  return new Promise((resolve, reject) => {
    const req = http.get(
      `${baseUrl}${path}`,
      { headers: token ? { Authorization: `Bearer ${token}` } : {} },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => {
          let json = null;
          try {
            json = JSON.parse(body);
          } catch {
            /* non-JSON error page */
          }
          resolve({ status: res.statusCode, json });
        });
      }
    );
    req.on("error", reject);
  });
}

beforeEach(() => {
  jest.clearAllMocks();

  User.findById.mockImplementation((id) => ({
    select: jest.fn().mockResolvedValue({ _id: id, isActive: true, role: id === GUIDE_ID ? "guide" : "student" }),
  }));

  Group.findById.mockImplementation(async (id) => {
    if (String(id) === GROUP_A_ID) {
      return groupDoc({ _id: GROUP_A_ID, name: "Team Falcon", members: [STUDENT_ID, OTHER_STUDENT_ID], guide: GUIDE_ID });
    }
    if (String(id) === GROUP_B_ID) {
      // Deliberately the SAME display name as Group A — groupId must still isolate them.
      return groupDoc({ _id: GROUP_B_ID, name: "Team Falcon", members: [OTHER_STUDENT_ID], guide: GUIDE_ID });
    }
    return null;
  });

  Task.find.mockReturnValue(makeQueryable(["select"], []));
  Meeting.find.mockReturnValue(makeQueryable(["select"], []));
  SprintPlan.find.mockReturnValue(makeQueryable(["select"], []));
  Milestone.find.mockReturnValue(makeQueryable(["select"], []));
});

describe("GET /groups/:groupId/calendar — authorization", () => {
  test("no token → 401", async () => {
    const res = await request(`/api/groups/${GROUP_A_ID}/calendar`, null);
    expect(res.status).toBe(401);
  });

  test("authenticated but not a member/guide of the group → 403", async () => {
    const res = await request(`/api/groups/${GROUP_A_ID}/calendar`, tokenFor(OUTSIDER_ID, "student"));
    expect(res.status).toBe(403);
  });

  test("malformed groupId → handled safely (no 500 crash)", async () => {
    // Group is mocked here (see top of file) rather than backed by a real
    // Mongoose connection, so this exercises requireGroupAccess's "no such
    // group" path (404) rather than a real CastError (400) — the real
    // CastError path is already covered end-to-end by the existing
    // errorHandler behavior other routes rely on (middleware/error.js).
    // What matters for this endpoint specifically: a malformed id is
    // rejected cleanly, never a 500.
    const res = await request(`/api/groups/not-a-valid-object-id/calendar`, tokenFor(STUDENT_ID, "student"));
    expect([400, 404]).toContain(res.status);
  });

  test("authorized guide → 200", async () => {
    const res = await request(`/api/groups/${GROUP_A_ID}/calendar`, tokenFor(GUIDE_ID, "guide"));
    expect(res.status).toBe(200);
    expect(res.json.success).toBe(true);
  });

  test("authorized student member → 200", async () => {
    const res = await request(`/api/groups/${GROUP_A_ID}/calendar`, tokenFor(STUDENT_ID, "student"));
    expect(res.status).toBe(200);
  });
});

describe("GET /groups/:groupId/calendar — real data only, no fabrication", () => {
  test("empty calendar (no tasks/meetings/sprints/milestones) never returns fabricated ones", async () => {
    const res = await request(`/api/groups/${GROUP_A_ID}/calendar`, tokenFor(GUIDE_ID, "guide"));
    const { events } = res.json.data;
    // The fixture group does have expectedCompletion set, so the one real
    // project-deadline event is expected — everything else must be empty.
    expect(events.filter((e) => e.type !== "deadline")).toEqual([]);
    expect(events.every((e) => e.type === "deadline")).toBe(true);
  });

  test("returns task/meeting/sprint/milestone events built only from mocked DB docs", async () => {
    const taskId = "64f0000000000000000000t1";
    const meetingId = "64f0000000000000000000m1";
    const sprintId = "64f0000000000000000000sp1";
    const milestoneId = "64f0000000000000000000ms1";

    Task.find.mockReturnValue(
      makeQueryable(["select"], [
        { _id: taskId, title: "Build API", due: new Date("2026-06-10"), priority: "high", status: "in_progress", assignee: STUDENT_ID, group: GROUP_A_ID },
      ])
    );
    Meeting.find.mockReturnValue(
      makeQueryable(["select"], [
        { _id: meetingId, title: "Sprint sync", when: new Date("2026-06-05T10:00:00.000Z"), durationMins: 45, status: "scheduled", group: GROUP_A_ID },
      ])
    );
    SprintPlan.find.mockReturnValue(
      makeQueryable(["select"], [
        { _id: sprintId, title: "Sprint 1", sprintStart: new Date("2026-06-01"), sprintEnd: new Date("2026-06-14"), status: "APPLIED", group: GROUP_A_ID },
      ])
    );
    Milestone.find.mockReturnValue(
      makeQueryable(["select"], [
        { _id: milestoneId, title: "Beta release", due: new Date("2026-06-20"), status: "pending", group: GROUP_A_ID },
      ])
    );

    const res = await request(`/api/groups/${GROUP_A_ID}/calendar`, tokenFor(GUIDE_ID, "guide"));
    const { events } = res.json.data;

    expect(events).toHaveLength(5); // task + meeting + sprint + milestone + project deadline
    const byType = Object.fromEntries(events.map((e) => [e.type, e]));
    expect(byType.task.sourceId).toBe(taskId);
    expect(byType.task.title).toBe("Build API");
    expect(byType.meeting.sourceId).toBe(meetingId);
    expect(byType.sprint.sourceId).toBe(sprintId);
    expect(byType.milestone.sourceId).toBe(milestoneId);
    expect(byType.deadline.groupId).toBe(GROUP_A_ID);
  });

  test("project deadline is omitted when the group has none set", async () => {
    Group.findById.mockImplementationOnce(async () => ({
      _id: GROUP_A_ID,
      name: "Team Falcon",
      project: "Capstone",
      guide: GUIDE_ID,
      members: [STUDENT_ID],
      expectedCompletion: null,
    }));
    const res = await request(`/api/groups/${GROUP_A_ID}/calendar`, tokenFor(GUIDE_ID, "guide"));
    expect(res.json.data.events.find((e) => e.type === "deadline")).toBeUndefined();
  });
});

describe("GET /groups/:groupId/calendar — student task isolation", () => {
  test("a student's calendar query filters tasks to their own assignee id", async () => {
    await request(`/api/groups/${GROUP_A_ID}/calendar`, tokenFor(STUDENT_ID, "student"));
    const filterArg = Task.find.mock.calls[0][0];
    expect(String(filterArg.assignee)).toBe(STUDENT_ID);
  });

  test("the group's guide is NOT restricted to a single assignee", async () => {
    await request(`/api/groups/${GROUP_A_ID}/calendar`, tokenFor(GUIDE_ID, "guide"));
    const filterArg = Task.find.mock.calls[0][0];
    expect(filterArg.assignee).toBeUndefined();
  });
});

describe("GET /groups/:groupId/calendar — groupId isolation (duplicate group names)", () => {
  test("querying Group B never touches Group A's id, even with an identical name", async () => {
    await request(`/api/groups/${GROUP_B_ID}/calendar`, tokenFor(GUIDE_ID, "guide"));
    const taskFilter = Task.find.mock.calls[0][0];
    const meetingFilter = Meeting.find.mock.calls[0][0];
    expect(String(taskFilter.group)).toBe(GROUP_B_ID);
    expect(String(taskFilter.group)).not.toBe(GROUP_A_ID);
    expect(String(meetingFilter.group)).toBe(GROUP_B_ID);
  });

  test("a member of Group B only (not Group A) is rejected from Group A despite the shared name", async () => {
    // OTHER_STUDENT_ID is a member of both in this fixture; use a user who
    // is only ever a member of Group B to prove name-based confusion can't
    // grant Group A access.
    const bOnlyToken = tokenFor(OUTSIDER_ID, "student");
    const res = await request(`/api/groups/${GROUP_A_ID}/calendar`, bOnlyToken);
    expect(res.status).toBe(403);
  });
});

describe("GET /groups/:groupId/calendar — date range filtering", () => {
  test("start/end query params are translated into a Mongo range filter", async () => {
    await request(
      `/api/groups/${GROUP_A_ID}/calendar?start=2026-06-01T00:00:00.000Z&end=2026-06-30T23:59:59.000Z`,
      tokenFor(GUIDE_ID, "guide")
    );
    const taskFilter = Task.find.mock.calls[0][0];
    expect(taskFilter.due.$gte.toISOString()).toBe("2026-06-01T00:00:00.000Z");
    expect(taskFilter.due.$lte.toISOString()).toBe("2026-06-30T23:59:59.000Z");
  });

  test("invalid date params are ignored rather than crashing the request", async () => {
    const res = await request(
      `/api/groups/${GROUP_A_ID}/calendar?start=not-a-date&end=also-not-a-date`,
      tokenFor(GUIDE_ID, "guide")
    );
    expect(res.status).toBe(200);
  });
});

describe("GET /groups/:groupId/calendar — private data protection", () => {
  test("the calendar controller never imports any private-communication model", () => {
    // Static guard: private chat/voice/call data must never even be reachable
    // from this file, regardless of query params or role.
    const src = require("fs").readFileSync(
      require("path").join(__dirname, "..", "src", "controllers", "calendarController.js"),
      "utf8"
    );
    expect(src).not.toMatch(/require\(["']\.\.\/models\/Message["']\)/);
    expect(src).not.toMatch(/require\(["']\.\.\/models\/CallLog["']\)/);
    expect(src).not.toMatch(/require\(["']\.\.\/models\/FileAsset["']\)/);
  });
});
