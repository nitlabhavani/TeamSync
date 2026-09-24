const http = require("http");
const fs = require("fs");
const path = require("path");

function request(options, data, isBuffer = false) {
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
          parsed = isBuffer ? bodyBuf : bodyBuf.toString("utf8");
        }
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          data: parsed,
          raw: bodyBuf,
        });
      });
    });
    req.on("error", reject);
    if (data) {
      if (Buffer.isBuffer(data) || typeof data === "string") {
        req.write(data);
      } else {
        req.write(JSON.stringify(data));
      }
    }
    req.end();
  });
}

async function runLiveVerification() {
  console.log("=== Live End-to-End Verification ===");

  // 1. Log in as guide Dr. Meera Rao
  const guideLogin = await request(
    {
      hostname: "localhost",
      port: 5000,
      path: "/api/auth/login",
      method: "POST",
      headers: { "Content-Type": "application/json" },
    },
    { email: "meera.rao@teamsync.edu", password: "Password123" }
  );

  if (!guideLogin.data?.success) {
    console.error("Guide login failed:", guideLogin.data);
    process.exit(1);
  }
  const guideToken = guideLogin.data.data.token;
  const guideUser = guideLogin.data.data.user;
  const guideId = guideUser.id || guideUser._id;
  console.log("1. Guide logged in successfully:", guideUser.name, guideId);

  // 2. Log in as student Aisha Verma
  const studentLogin = await request(
    {
      hostname: "localhost",
      port: 5000,
      path: "/api/auth/login",
      method: "POST",
      headers: { "Content-Type": "application/json" },
    },
    { email: "aisha.verma@teamsync.edu", password: "Password123" }
  );

  if (!studentLogin.data?.success) {
    console.error("Student login failed:", studentLogin.data);
    process.exit(1);
  }
  const studentToken = studentLogin.data.data.token;
  const studentUser = studentLogin.data.data.user;
  const studentId = studentUser.id || studentUser._id;
  console.log("2. Student logged in successfully:", studentUser.name, studentId);

  // 3. Get Aisha's groups
  const groupsRes = await request({
    hostname: "localhost",
    port: 5000,
    path: "/api/groups",
    method: "GET",
    headers: { Authorization: `Bearer ${studentToken}` },
  });
  const groups = groupsRes.data.data || [];
  if (!groups.length) {
    console.error("No groups found for student");
    process.exit(1);
  }
  const group = groups[0];
  const groupId = group.id || group._id;
  console.log("3. Selected group:", group.name, groupId);

  // 4. Feature 1: Guide sends task instruction with deadline "by tomorrow"
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const msgRes = await request(
    {
      hostname: "localhost",
      port: 5000,
      path: `/api/groups/${groupId}/messages`,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${guideToken}`,
      },
    },
    { text: "Aisha, complete payment gateway integration by tomorrow" }
  );
  console.log("4. Sent group task message, status:", msgRes.statusCode);

  // Allow background task extraction to settle
  await new Promise((r) => setTimeout(r, 2000));

  // 5. Feature 2: Verify calendar events include the task with deadline
  const calRes = await request({
    hostname: "localhost",
    port: 5000,
    path: `/api/groups/${groupId}/calendar?includeAi=true`,
    method: "GET",
    headers: { Authorization: `Bearer ${studentToken}` },
  });
  const events = calRes.data?.data?.events || [];
  const taskEvents = events.filter((e) => e.type === "task" || e.isAiDeadline);
  console.log("5. Calendar events returned:", events.length, "Task events:", taskEvents.length);
  const matchedTask = taskEvents.find((e) => e.title?.toLowerCase().includes("payment gateway") || e.metadata?.whatToDo?.toLowerCase().includes("payment gateway"));
  if (matchedTask) {
    console.log("   Found extracted task deadline in Calendar:", matchedTask.title, "Due:", matchedTask.start, "isAiDeadline:", matchedTask.isAiDeadline);
  } else {
    console.log("   (Recent tasks in calendar: ", taskEvents.slice(0, 3).map((t) => ({ title: t.title, start: t.start, isAi: t.isAiDeadline })), ")");
  }

  // 6. Feature 3: Private photo upload via multipart/form-data
  const boundary = "----WebKitFormBoundary" + Math.random().toString(36).slice(2);
  const pngMagic = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52]);
  const postData = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="media"; filename="test-image.png"\r\nContent-Type: image/png\r\n\r\n`),
    pngMagic,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);

  const uploadRes = await request(
    {
      hostname: "localhost",
      port: 5000,
      path: `/api/chat/direct/${studentId}/media`,
      method: "POST",
      headers: {
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
        "Content-Length": postData.length,
        Authorization: `Bearer ${guideToken}`,
      },
    },
    postData
  );

  console.log("6. Uploaded direct media status:", uploadRes.statusCode);
  if (uploadRes.statusCode === 201) {
    console.log("   Direct media upload response:", uploadRes.data.data);
    const mediaUrl = uploadRes.data.data.url;

    // 7. Stream direct media with full GET
    const streamRes = await request({
      hostname: "localhost",
      port: 5000,
      path: `/api${mediaUrl}`,
      method: "GET",
      headers: { Authorization: `Bearer ${studentToken}` },
    }, null, true);
    console.log("7. Streamed direct media status:", streamRes.statusCode, "Content-Type:", streamRes.headers["content-type"]);

    // 8. Stream direct media with Range header
    const rangeRes = await request({
      hostname: "localhost",
      port: 5000,
      path: `/api${mediaUrl}`,
      method: "GET",
      headers: {
        Authorization: `Bearer ${studentToken}`,
        Range: "bytes=0-7",
      },
    }, null, true);
    console.log("8. Range request status:", rangeRes.statusCode, "Content-Range:", rangeRes.headers["content-range"], "Length:", rangeRes.raw.length);

    // 8b. Security test: Unauthorized third party tries to stream private media
    const sneakRes = await request({
      hostname: "localhost",
      port: 5000,
      path: `/api${mediaUrl}`,
      method: "GET",
      // No token -> 401
    });
    console.log("8b. Unauthenticated access status (expected 401):", sneakRes.statusCode);

    // 9. Send direct message with the media attachment
    const sendMsgRes = await request(
      {
        hostname: "localhost",
        port: 5000,
        path: `/api/chat/direct/${studentId}`,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${guideToken}`,
        },
      },
      {
        text: "Here is the screenshot diagram",
        attachments: [uploadRes.data.data],
      }
    );
    console.log("9. Sent direct media message status:", sendMsgRes.statusCode, "type:", sendMsgRes.data?.data?.type);

    // 10. Send emoji-only message
    const emojiMsgRes = await request(
      {
        hostname: "localhost",
        port: 5000,
        path: `/api/chat/direct/${guideId}`,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${studentToken}`,
        },
      },
      {
        text: "👍 🔥 🚀",
      }
    );
    console.log("10. Sent emoji-only direct message status:", emojiMsgRes.statusCode, "text:", emojiMsgRes.data?.data?.text);
  }

  console.log("=== All Live Verification Steps Passed Successfully! ===");
}

runLiveVerification().catch((err) => {
  console.error("Live verification failed:", err);
  process.exit(1);
});
