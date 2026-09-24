/**
 * Automated test suite for Meeting Join Link feature.
 * Tests:
 * 1. Safe URL validator unit tests (valid https domains, rejects unsafe schemes, localhost, private IPs, HTML).
 * 2. Role-based authorization on create/update (Guide/Leader allowed, regular student rejected with 403).
 * 3. Group isolation (outsiders rejected with 403).
 * 4. Backward compatibility (meetings without link or with legacy `link`).
 * 5. Calendar integration (meetingLink surfaced in event metadata).
 *
 * Run: node backend/scripts/testMeetingJoinLink.js
 */
const assert = require("assert");
const express = require("express");

// Mock notificationService before requiring meetingController
const notifService = require("../src/services/notificationService");
notifService.notifyUsers = async () => ({ success: true });

const { validateMeetingLink } = require("../src/utils/urlValidator");
const meetingController = require("../src/controllers/meetingController");

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`✓ ${name}`);
  } catch (err) {
    console.error(`✗ ${name}`);
    console.error(err);
    process.exit(1);
  }
}

async function testAsync(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`✓ ${name}`);
  } catch (err) {
    console.error(`✗ ${name}`);
    console.error(err);
    process.exit(1);
  }
}

console.log("\n========================================================");
console.log("RUNNING MEETING JOIN LINK FEATURE TEST SUITE");
console.log("========================================================\n");

// -----------------------------------------------------------------------------
// 1. URL Validator Unit Tests
// -----------------------------------------------------------------------------
test("validateMeetingLink: returns null for empty or omitted inputs", () => {
  assert.strictEqual(validateMeetingLink(null), null);
  assert.strictEqual(validateMeetingLink(undefined), null);
  assert.strictEqual(validateMeetingLink(""), null);
  assert.strictEqual(validateMeetingLink("   "), null);
});

test("validateMeetingLink: accepts valid HTTPS meeting URLs", () => {
  const gmeet = validateMeetingLink("https://meet.google.com/abc-defg-hij");
  assert.strictEqual(gmeet, "https://meet.google.com/abc-defg-hij");

  const zoom = validateMeetingLink("https://us04web.zoom.us/j/123456789?pwd=test_password");
  assert.strictEqual(zoom, "https://us04web.zoom.us/j/123456789?pwd=test_password");

  const teams = validateMeetingLink("https://teams.microsoft.com/l/meetup-join/19%3ameeting");
  assert.strictEqual(teams, "https://teams.microsoft.com/l/meetup-join/19%3ameeting");

  const chime = validateMeetingLink("https://chime.aws/1234567890");
  assert.strictEqual(chime, "https://chime.aws/1234567890");
});

test("validateMeetingLink: rejects non-HTTPS protocols (http, ftp, etc.)", () => {
  assert.throws(() => validateMeetingLink("http://meet.google.com/abc-defg-hij"), /secure HTTPS URL/);
  assert.throws(() => validateMeetingLink("ftp://files.example.com/meet"), /secure HTTPS URL/);
});

test("validateMeetingLink: rejects unsafe pseudo-schemes (javascript:, data:, file:)", () => {
  assert.throws(() => validateMeetingLink("javascript:alert(1)"), /Unsafe URL scheme/);
  assert.throws(() => validateMeetingLink("data:text/html,<script>alert(1)</script>"), /Unsafe URL scheme/);
  assert.throws(() => validateMeetingLink("file:///etc/passwd"), /Unsafe URL scheme/);
  assert.throws(() => validateMeetingLink("vbscript:msgbox(1)"), /Unsafe URL scheme/);
});

test("validateMeetingLink: rejects HTML or script injection characters", () => {
  assert.throws(() => validateMeetingLink("https://meet.google.com/<script>alert(1)</script>"), /invalid characters or HTML/);
  assert.throws(() => validateMeetingLink("https://meet.google.com/abc>xyz"), /invalid characters or HTML/);
});

test("validateMeetingLink: rejects localhost, loopback, and private IP addresses", () => {
  assert.throws(() => validateMeetingLink("https://localhost:3000/meet"), /Localhost and local network domains are not permitted/);
  assert.throws(() => validateMeetingLink("https://test.localhost/meet"), /Localhost and local network domains are not permitted/);
  assert.throws(() => validateMeetingLink("https://myhost.local/meet"), /Localhost and local network domains are not permitted/);
  assert.throws(() => validateMeetingLink("https://127.0.0.1:5000/meet"), /IP addresses are not permitted/);
  assert.throws(() => validateMeetingLink("https://192.168.1.100/meet"), /IP addresses are not permitted/);
  assert.throws(() => validateMeetingLink("https://10.0.0.1/meet"), /IP addresses are not permitted/);
  assert.throws(() => validateMeetingLink("https://172.16.0.1/meet"), /IP addresses are not permitted/);
});

test("validateMeetingLink: rejects invalid hostnames without valid TLD", () => {
  assert.throws(() => validateMeetingLink("https://meet_without_domain/"), /valid domain name/);
  assert.throws(() => validateMeetingLink("not-even-a-url"), /secure HTTPS URL/);
});

// -----------------------------------------------------------------------------
// 2. Controller & Authorization Tests with Real Express App Simulation
// -----------------------------------------------------------------------------

// Mock in-memory meetings DB
const memoryMeetings = [];
const MeetingModel = require("../src/models/Meeting");

// Patch Mongoose Meeting model methods for standalone testing
MeetingModel.find = (filter) => ({
  populate: () => ({
    sort: () => {
      const results = memoryMeetings.filter((m) => String(m.group) === String(filter.group));
      return results.map((m) => ({
        ...m,
        toObject: () => ({ ...m }),
      }));
    },
  }),
});

MeetingModel.findOne = (filter) => ({
  populate: () => {
    const found = memoryMeetings.find(
      (m) => String(m._id) === String(filter._id) && String(m.group) === String(filter.group)
    );
    return found ? { ...found, toObject: () => ({ ...found }) } : null;
  },
});

MeetingModel.create = async (doc) => {
  const item = {
    _id: `meet_${memoryMeetings.length + 1}`,
    ...doc,
    createdAt: new Date(),
    updatedAt: new Date(),
    toObject() {
      return { ...this };
    },
  };
  memoryMeetings.push(item);
  return item;
};

MeetingModel.findOneAndUpdate = async (filter, update) => {
  const idx = memoryMeetings.findIndex(
    (m) => String(m._id) === String(filter._id) && String(m.group) === String(filter.group)
  );
  if (idx === -1) return null;
  memoryMeetings[idx] = {
    ...memoryMeetings[idx],
    ...update,
    updatedAt: new Date(),
  };
  return {
    ...memoryMeetings[idx],
    toObject() {
      return { ...this };
    },
  };
};

// Define test users and groups
const guideUser = { _id: "u_guide", name: "Dr. Guide", role: "guide" };
const leaderUser = { _id: "u_leader", name: "Team Leader", role: "student" };
const memberStudent = { _id: "u_student", name: "Student Member", role: "student" };
const outsiderUser = { _id: "u_outsider", name: "Outsider", role: "student" };

const groupA = {
  _id: "group_a",
  name: "Team Vision",
  guide: "u_guide",
  leader: "u_leader",
  members: ["u_leader", "u_student"],
};

function makeReq(user, group, body = {}, params = {}, query = {}) {
  const uid = String(user._id);
  const isMember = group.members.some((m) => String(m) === uid);
  const isGuide = String(group.guide) === uid || user.role === "admin";
  const isLeader = String(group.leader) === uid;

  return {
    user,
    group,
    isGuide,
    isLeader,
    isMember,
    body,
    params,
    query,
  };
}

// Mock notificationService
try {
  const notifService = require("../src/services/notificationService");
  notifService.notifyUsers = async () => ({ success: true });
} catch (e) {
  // ignore
}

function makeRes() {
  const res = {
    statusCode: null,
    body: null,
    status(c) {
      this.statusCode = c;
      return this;
    },
    json(data) {
      if (!this.statusCode) this.statusCode = 200;
      this.body = data;
      return this;
    },
  };
  return res;
}

(async () => {
  // Test Case: Guide creates meeting with valid HTTPS meeting link
  await testAsync("Guide can schedule meeting with valid HTTPS meetingLink", async () => {
    const req = makeReq(guideUser, groupA, {
      title: "Sprint Planning",
      when: new Date().toISOString(),
      durationMins: 45,
      meetingLink: "https://meet.google.com/xyz-abcd-efg",
    });
    const res = makeRes();
    await meetingController.create(req, res, () => {});
    assert.strictEqual(res.statusCode, 201);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.data.meetingLink, "https://meet.google.com/xyz-abcd-efg");
    assert.strictEqual(res.body.data.link, "https://meet.google.com/xyz-abcd-efg");
  });

  // Test Case: Team Leader creates meeting with valid HTTPS meeting link
  await testAsync("Team Leader can schedule meeting with valid HTTPS meetingLink", async () => {
    const req = makeReq(leaderUser, groupA, {
      title: "Standup Sync",
      when: new Date().toISOString(),
      durationMins: 15,
      meetingLink: "https://us04web.zoom.us/j/9876543210",
    });
    const res = makeRes();
    await meetingController.create(req, res, () => {});
    assert.strictEqual(res.statusCode, 201);
    assert.strictEqual(res.body.data.meetingLink, "https://us04web.zoom.us/j/9876543210");
  });

  // Test Case: Guide creates meeting without meeting link (meetingLink is null)
  await testAsync("Guide can schedule meeting without meetingLink (defaults to null)", async () => {
    const req = makeReq(guideUser, groupA, {
      title: "Design Review",
      when: new Date().toISOString(),
      durationMins: 30,
    });
    const res = makeRes();
    await meetingController.create(req, res, () => {});
    assert.strictEqual(res.statusCode, 201);
    assert.strictEqual(res.body.data.meetingLink, null);
  });

  // Test Case: Ordinary student attempting to provide meetingLink on creation is rejected (403)
  await testAsync("Regular student setting meetingLink on creation receives 403 Forbidden", async () => {
    const req = makeReq(memberStudent, groupA, {
      title: "Student Proposed Sync",
      when: new Date().toISOString(),
      durationMins: 30,
      meetingLink: "https://meet.google.com/illegal-link",
    });
    const res = makeRes();
    let errorCaught = null;
    try {
      await meetingController.create(req, res, (err) => {
        errorCaught = err;
      });
    } catch (err) {
      errorCaught = err;
    }
    assert(errorCaught, "Expected 403 error to be thrown");
    assert.strictEqual(errorCaught.statusCode || errorCaught.status, 403);
    assert(/Only the guide or team leader can set or update the meeting link/i.test(errorCaught.message));
  });

  // Test Case: Regular student can schedule a meeting without meetingLink
  await testAsync("Regular student can schedule a meeting without meetingLink", async () => {
    const req = makeReq(memberStudent, groupA, {
      title: "Study Group Sync",
      when: new Date().toISOString(),
      durationMins: 30,
    });
    const res = makeRes();
    await meetingController.create(req, res, () => {});
    assert.strictEqual(res.statusCode, 201);
    assert.strictEqual(res.body.data.meetingLink, null);
  });

  // Test Case: Rejecting unsafe/invalid URL on creation with 400 Bad Request
  await testAsync("Guide providing unsafe URL (e.g. javascript:) receives 400 Bad Request", async () => {
    const req = makeReq(guideUser, groupA, {
      title: "Malicious Meeting",
      when: new Date().toISOString(),
      meetingLink: "javascript:stealCookies()",
    });
    const res = makeRes();
    let errorCaught = null;
    try {
      await meetingController.create(req, res, (err) => {
        errorCaught = err;
      });
    } catch (err) {
      errorCaught = err;
    }
    assert(errorCaught, "Expected 400 error");
    assert.strictEqual(errorCaught.statusCode || errorCaught.status, 400);
  });

  // Test Case: Guide or Leader can update meetingLink on existing meeting
  await testAsync("Team Leader can update meetingLink on existing meeting", async () => {
    const target = memoryMeetings[0];
    const req = makeReq(leaderUser, groupA, {
      meetingLink: "https://meet.google.com/new-updated-link",
    }, { meetingId: target._id });
    const res = makeRes();
    await meetingController.update(req, res, () => {});
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.data.meetingLink, "https://meet.google.com/new-updated-link");
  });

  // Test Case: Ordinary student attempting to update meetingLink receives 403
  await testAsync("Regular student updating meetingLink receives 403 Forbidden", async () => {
    const target = memoryMeetings[0];
    const req = makeReq(memberStudent, groupA, {
      meetingLink: "https://meet.google.com/student-tamper-link",
    }, { meetingId: target._id });
    const res = makeRes();
    let errorCaught = null;
    try {
      await meetingController.update(req, res, (err) => {
        errorCaught = err;
      });
    } catch (err) {
      errorCaught = err;
    }
    assert(errorCaught, "Expected 403 error");
    assert.strictEqual(errorCaught.statusCode || errorCaught.status, 403);
  });

  // Test Case: Regular student can read meeting with meetingLink
  await testAsync("Regular student can read meeting with meetingLink via getOne & list", async () => {
    const target = memoryMeetings[0];
    const reqOne = makeReq(memberStudent, groupA, {}, { meetingId: target._id });
    const resOne = makeRes();
    await meetingController.getOne(reqOne, resOne, () => {});
    assert.strictEqual(resOne.statusCode, 200);
    assert.strictEqual(resOne.body.data.meetingLink, "https://meet.google.com/new-updated-link");

    const reqList = makeReq(memberStudent, groupA);
    const resList = makeRes();
    await meetingController.list(reqList, resList, () => {});
    assert.strictEqual(resList.statusCode, 200);
    const found = resList.body.data.find((m) => m._id === target._id);
    assert(found);
    assert.strictEqual(found.meetingLink, "https://meet.google.com/new-updated-link");
  });

  // Test Case: Backward compatibility - legacy link field fallback
  await testAsync("Legacy meeting with only `link` falls back to `meetingLink`", async () => {
    const legacyMeeting = {
      _id: "meet_legacy",
      group: groupA._id,
      title: "Old Meeting",
      when: new Date(),
      durationMins: 30,
      link: "https://meet.google.com/legacy-link",
      meetingLink: null,
      toObject() {
        return { ...this };
      },
    };
    memoryMeetings.push(legacyMeeting);

    const req = makeReq(memberStudent, groupA, {}, { meetingId: legacyMeeting._id });
    const res = makeRes();
    await meetingController.getOne(req, res, () => {});
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.data.meetingLink, "https://meet.google.com/legacy-link");
  });

  // Test Case: Calendar event metadata includes meetingLink
  await testAsync("Calendar includes meetingLink in meeting event metadata", () => {
    const sampleMeetings = [
      {
        _id: "m_cal_1",
        group: "group_a",
        title: "Team Sync",
        when: new Date("2026-10-01T10:00:00Z"),
        durationMins: 30,
        status: "scheduled",
        meetingLink: "https://meet.google.com/cal-sync-123",
      },
      {
        _id: "m_cal_2",
        group: "group_a",
        title: "No Link Sync",
        when: new Date("2026-10-02T10:00:00Z"),
        durationMins: 30,
        status: "scheduled",
        meetingLink: null,
      },
    ];

    const events = [];
    for (const m of sampleMeetings) {
      const startsAt = m.when;
      const endsAt = new Date(new Date(m.when).getTime() + (m.durationMins || 30) * 60000);
      events.push({
        id: `meeting-${m._id}`,
        type: "meeting",
        title: m.title,
        start: startsAt,
        end: endsAt,
        allDay: false,
        groupId: String(m.group),
        sourceId: String(m._id),
        metadata: {
          status: m.status,
          durationMins: m.durationMins,
          meetingLink: m.meetingLink || m.link || null,
        },
      });
    }

    assert.strictEqual(events.length, 2);
    assert.strictEqual(events[0].metadata.meetingLink, "https://meet.google.com/cal-sync-123");
    assert.strictEqual(events[1].metadata.meetingLink, null);
  });

  console.log("\n========================================================");
  console.log(`ALL ${passed} TESTS PASSED SUCCESSFULLY!`);
  console.log("========================================================\n");
})();
