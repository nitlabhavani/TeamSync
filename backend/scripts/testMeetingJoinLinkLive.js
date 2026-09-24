require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });
const http = require("http");
const mongoose = require("mongoose");

function request(options, data) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const bodyBuf = Buffer.concat(chunks);
        let parsed = null;
        try {
          parsed = JSON.parse(bodyBuf.toString("utf8"));
        } catch {
          parsed = bodyBuf.toString("utf8");
        }
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          data: parsed,
        });
      });
    });
    req.on("error", reject);
    if (data) {
      req.write(typeof data === "string" ? data : JSON.stringify(data));
    }
    req.end();
  });
}

async function runLiveTest() {
  console.log("=== Live End-to-End Meeting Join Link Tests ===");

  // Connect to DB directly to find active users
  await mongoose.connect("mongodb://localhost:27017/teamsync_ai");
  const User = mongoose.model("User", new mongoose.Schema({ email: String, role: String }));
  const Group = mongoose.model("Group", new mongoose.Schema({ name: String, guide: mongoose.Schema.Types.ObjectId, leader: mongoose.Schema.Types.ObjectId, members: [mongoose.Schema.Types.ObjectId] }));

  // Find a group
  const group = await Group.findOne({}).lean();
  if (!group) {
    console.error("No groups found in MongoDB.");
    process.exit(1);
  }

  const guideUser = await User.findById(group.guide).lean();
  // Find a member student who is NOT the guide
  const studentUser = await User.findOne({ _id: { $in: group.members } }).lean();

  console.log("Using Group:", group.name, "(id:", String(group._id), ")");
  console.log("Guide User:", guideUser?.email);
  console.log("Student User:", studentUser?.email);

  const { signAccessToken } = require("../src/utils/token");
  const guideToken = signAccessToken(guideUser);
  const studentToken = signAccessToken(studentUser);

  const groupId = String(group._id);

  // 1. Guide creates meeting with valid HTTPS link
  console.log("\n1. Testing Guide creating meeting with HTTPS meetingLink...");
  const createRes = await request(
    {
      hostname: "localhost",
      port: 5000,
      path: `/api/groups/${groupId}/meetings`,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${guideToken}`,
      },
    },
    {
      title: "Live E2E Verification Sync",
      when: new Date(Date.now() + 86400000).toISOString(),
      durationMins: 30,
      meetingLink: "https://meet.google.com/live-test-abc",
    }
  );

  if (createRes.statusCode !== 201 || !createRes.data?.data?.meetingLink) {
    console.error("Failed to create meeting with link:", createRes.statusCode, createRes.data);
    process.exit(1);
  }
  const createdMeeting = createRes.data.data;
  console.log("✓ Created meeting successfully with meetingLink:", createdMeeting.meetingLink);

  const meetingId = String(createdMeeting._id || createdMeeting.id);

  // 2. Student views the meeting via getOne
  console.log("\n2. Testing Student reading meeting join link...");
  const readRes = await request({
    hostname: "localhost",
    port: 5000,
    path: `/api/groups/${groupId}/meetings/${meetingId}`,
    method: "GET",
    headers: {
      Authorization: `Bearer ${studentToken}`,
    },
  });

  if (readRes.statusCode !== 200 || readRes.data?.data?.meetingLink !== "https://meet.google.com/live-test-abc") {
    console.error("Student failed to read meetingLink:", readRes.statusCode, readRes.data);
    process.exit(1);
  }
  console.log("✓ Student received valid meetingLink:", readRes.data.data.meetingLink);

  // 3. Student tries to modify meeting link (Should be 403 Forbidden)
  console.log("\n3. Testing Student unauthorized link modification (403 expected)...");
  const studentUpdateRes = await request(
    {
      hostname: "localhost",
      port: 5000,
      path: `/api/groups/${groupId}/meetings/${meetingId}`,
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${studentToken}`,
      },
    },
    {
      meetingLink: "https://meet.google.com/hacked-link",
    }
  );

  if (studentUpdateRes.statusCode !== 403) {
    console.error("Expected 403 but got:", studentUpdateRes.statusCode, studentUpdateRes.data);
    process.exit(1);
  }
  console.log("✓ Student modification blocked with 403 Forbidden:", studentUpdateRes.data?.message);

  // 4. Guide updates meeting link to Zoom
  console.log("\n4. Testing Guide updating meetingLink to Zoom URL...");
  const guideUpdateRes = await request(
    {
      hostname: "localhost",
      port: 5000,
      path: `/api/groups/${groupId}/meetings/${meetingId}`,
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${guideToken}`,
      },
    },
    {
      meetingLink: "https://us04web.zoom.us/j/9876543210",
    }
  );

  if (guideUpdateRes.statusCode !== 200 || guideUpdateRes.data?.data?.meetingLink !== "https://us04web.zoom.us/j/9876543210") {
    console.error("Guide failed to update meetingLink:", guideUpdateRes.statusCode, guideUpdateRes.data);
    process.exit(1);
  }
  console.log("✓ Guide updated meetingLink to:", guideUpdateRes.data.data.meetingLink);

  // 5. Calendar events include meetingLink in metadata
  console.log("\n5. Testing Calendar API returns metadata.meetingLink...");
  const calRes = await request({
    hostname: "localhost",
    port: 5000,
    path: `/api/groups/${groupId}/calendar`,
    method: "GET",
    headers: {
      Authorization: `Bearer ${studentToken}`,
    },
  });

  if (calRes.statusCode !== 200 || !Array.isArray(calRes.data?.data?.events)) {
    console.error("Calendar API failed:", calRes.statusCode, calRes.data);
    process.exit(1);
  }
  const meetingEvent = calRes.data.data.events.find((e) => e.sourceId === meetingId || e.id === `meeting-${meetingId}`);
  if (!meetingEvent || meetingEvent.metadata?.meetingLink !== "https://us04web.zoom.us/j/9876543210") {
    console.error("Meeting event in calendar missing meetingLink:", meetingEvent);
    process.exit(1);
  }
  console.log("✓ Calendar event metadata contains meetingLink:", meetingEvent.metadata.meetingLink);

  // 6. Test invalid scheme rejection (400 Bad Request)
  console.log("\n6. Testing unsafe URL rejection on update (400 expected)...");
  const badUrlRes = await request(
    {
      hostname: "localhost",
      port: 5000,
      path: `/api/groups/${groupId}/meetings/${meetingId}`,
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${guideToken}`,
      },
    },
    {
      meetingLink: "javascript:alert(1)",
    }
  );

  if (badUrlRes.statusCode !== 400) {
    console.error("Expected 400 for unsafe URL but got:", badUrlRes.statusCode, badUrlRes.data);
    process.exit(1);
  }
  console.log("✓ Unsafe URL rejected with 400 Bad Request:", badUrlRes.data?.message);

  // 7. Cleanup test meeting
  console.log("\n7. Cleaning up test meeting...");
  await request({
    hostname: "localhost",
    port: 5000,
    path: `/api/groups/${groupId}/meetings/${meetingId}`,
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${guideToken}`,
    },
  });
  console.log("✓ Cleaned up test meeting.");

  await mongoose.disconnect();
  console.log("\n========================================================");
  console.log("ALL LIVE END-TO-END VERIFICATION CHECKS PASSED!");
  console.log("========================================================\n");
}

runLiveTest().catch((err) => {
  console.error("Live test failed:", err);
  process.exit(1);
});
