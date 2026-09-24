const fs = require("fs");
const path = require("path");
const { detectMessageTasks } = require("../src/services/aiService");
const { verifyMediaBuffer, verifyMediaFile } = require("../src/utils/mediaMagicBytes");

describe("Feature 1: AI Chat Task Deadline Extraction", () => {
  const members = [
    { _id: "user-1", id: "user-1", name: "Bhavani" },
    { _id: "user-2", id: "user-2", name: "Chinna" },
  ];

  // Fixed reference date: Wednesday, September 10, 2026 at 12:00:00 UTC
  const fixedNow = new Date("2026-09-10T12:00:00.000Z");

  test("extracts deadline for 'by tomorrow'", () => {
    const text = "Bhavani, complete login page by tomorrow";
    const res = detectMessageTasks(text, members, fixedNow);
    expect(res.isTask).toBe(true);
    expect(res.tasks.length).toBe(1);
    expect(res.tasks[0].assigneeName).toBe("Bhavani");
    expect(res.tasks[0].dueDate).toBe("2026-09-11");
  });

  test("extracts deadline for 'in 3 days'", () => {
    const text = "Bhavani, implement auth module in 3 days";
    const res = detectMessageTasks(text, members, fixedNow);
    expect(res.isTask).toBe(true);
    expect(res.tasks.length).toBe(1);
    expect(res.tasks[0].dueDate).toBe("2026-09-13");
  });

  test("extracts deadline for month date 'on September 20'", () => {
    const text = "Bhavani, prepare the architecture report on September 20";
    const res = detectMessageTasks(text, members, fixedNow);
    expect(res.isTask).toBe(true);
    expect(res.tasks.length).toBe(1);
    expect(res.tasks[0].dueDate).toBe("2026-09-20");
  });

  test("extracts deadline for 'before Friday'", () => {
    // Sept 10 is Thursday -> Friday is Sept 11
    const text = "Bhavani, finish user dashboard before Friday";
    const res = detectMessageTasks(text, members, fixedNow);
    expect(res.isTask).toBe(true);
    expect(res.tasks.length).toBe(1);
    expect(res.tasks[0].dueDate).toBe("2026-09-11");
  });

  test("extracts deadline with time 'on Monday at 5 PM'", () => {
    // Sept 10 is Thursday -> upcoming Monday is Sept 14 at 17:00
    const text = "Bhavani, review pull requests on Monday at 5 PM";
    const res = detectMessageTasks(text, members, fixedNow);
    expect(res.isTask).toBe(true);
    expect(res.tasks.length).toBe(1);
    expect(res.tasks[0].dueDate).toBeDefined();
    expect(res.tasks[0].dueDate).toContain("2026-09-14T17:00:00");
  });

  test("extracts deadline with time 'next Monday at 5 PM'", () => {
    // Sept 10 is Thursday -> next week's Monday is Sept 21 at 17:00
    const text = "Bhavani, deploy to production next Monday at 5 PM";
    const res = detectMessageTasks(text, members, fixedNow);
    expect(res.isTask).toBe(true);
    expect(res.tasks.length).toBe(1);
    expect(res.tasks[0].dueDate).toBeDefined();
    expect(res.tasks[0].dueDate).toContain("2026-09-21T17:00:00");
  });

  test("does NOT invent or fake a deadline when none is mentioned (dueDate: null)", () => {
    const text = "Bhavani, please debug the database connection issue";
    const res = detectMessageTasks(text, members, fixedNow);
    expect(res.isTask).toBe(true);
    expect(res.tasks.length).toBe(1);
    expect(res.tasks[0].dueDate).toBeNull();
  });

  test("ignores non-directive / conversational messages (isTask: false)", () => {
    const text = "Hey team, how is the project going today?";
    const res = detectMessageTasks(text, members, fixedNow);
    expect(res.isTask).toBe(false);
    expect(res.tasks.length).toBe(0);
  });
});

describe("Feature 2: Shared Deadline Countdown Logic", () => {
  function computeCountdown(dueDate, referenceDate) {
    if (!dueDate) return { status: "none", label: "" };
    const d = new Date(dueDate);
    if (Number.isNaN(d.getTime())) return { status: "none", label: "" };

    const ref = new Date(referenceDate);
    const dueMidnight = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const refMidnight = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate()).getTime();
    const diffDays = Math.round((dueMidnight - refMidnight) / 86400000);

    if (diffDays < 0) {
      const overdueDays = Math.abs(diffDays);
      return {
        status: "overdue",
        label: overdueDays === 1 ? "Overdue by 1 day" : `Overdue by ${overdueDays} days`,
      };
    }
    if (diffDays === 0) {
      return { status: "today", label: "Due today" };
    }
    return {
      status: "upcoming",
      label: diffDays === 1 ? "1 day left" : `${diffDays} days left`,
    };
  }

  const now = new Date("2026-09-12T10:00:00.000Z");

  test("calculates '3 days left'", () => {
    const due = new Date("2026-09-15T10:00:00.000Z");
    expect(computeCountdown(due, now).label).toBe("3 days left");
  });

  test("calculates '2 days left'", () => {
    const due = new Date("2026-09-14T10:00:00.000Z");
    expect(computeCountdown(due, now).label).toBe("2 days left");
  });

  test("calculates '1 day left'", () => {
    const due = new Date("2026-09-13T10:00:00.000Z");
    expect(computeCountdown(due, now).label).toBe("1 day left");
  });

  test("calculates 'Due today'", () => {
    const due = new Date("2026-09-12T18:00:00.000Z");
    expect(computeCountdown(due, now).label).toBe("Due today");
  });

  test("calculates 'Overdue by 1 day'", () => {
    const due = new Date("2026-09-11T10:00:00.000Z");
    expect(computeCountdown(due, now).label).toBe("Overdue by 1 day");
  });

  test("calculates 'Overdue by 3 days'", () => {
    const due = new Date("2026-09-09T10:00:00.000Z");
    expect(computeCountdown(due, now).label).toBe("Overdue by 3 days");
  });

  test("handles null or missing dueDate safely", () => {
    expect(computeCountdown(null, now).label).toBe("");
    expect(computeCountdown(undefined, now).label).toBe("");
  });
});

describe("Feature 3: Media Magic Bytes & Security Verification", () => {
  test("validates PNG file signature", () => {
    // 89 50 4E 47 0D 0A 1A 0A
    const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
    const res = verifyMediaBuffer(pngHeader);
    expect(res.valid).toBe(true);
    expect(res.type).toBe("image");
    expect(res.format).toBe("png");
  });

  test("validates JPEG file signature", () => {
    // FF D8 FF
    const jpegHeader = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
    const res = verifyMediaBuffer(jpegHeader);
    expect(res.valid).toBe(true);
    expect(res.type).toBe("image");
    expect(res.format).toBe("jpeg");
  });

  test("validates GIF file signature", () => {
    // GIF89a
    const gifHeader = Buffer.from("GIF89a\x01\x00\x01\x00\x80\x00", "binary");
    const res = verifyMediaBuffer(gifHeader);
    expect(res.valid).toBe(true);
    expect(res.type).toBe("image");
    expect(res.format).toBe("gif");
  });

  test("validates WebP file signature", () => {
    // RIFF .... WEBP
    const webpHeader = Buffer.from([
      0x52, 0x49, 0x46, 0x46,
      0x20, 0x00, 0x00, 0x00,
      0x57, 0x45, 0x42, 0x50,
    ]);
    const res = verifyMediaBuffer(webpHeader);
    expect(res.valid).toBe(true);
    expect(res.type).toBe("image");
    expect(res.format).toBe("webp");
  });

  test("validates MP4 file signature ('ftyp' at offset 4)", () => {
    const mp4Header = Buffer.from([
      0x00, 0x00, 0x00, 0x18,
      0x66, 0x74, 0x79, 0x70, // 'ftyp'
      0x69, 0x73, 0x6f, 0x6d,
    ]);
    const res = verifyMediaBuffer(mp4Header);
    expect(res.valid).toBe(true);
    expect(res.type).toBe("video");
    expect(res.format).toBe("mp4");
  });

  test("validates WebM video signature (EBML)", () => {
    const webmHeader = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01, 0x42, 0xf7, 0x81]);
    const res = verifyMediaBuffer(webmHeader);
    expect(res.valid).toBe(true);
    expect(res.type).toBe("video");
    expect(res.format).toBe("webm");
  });

  test("rejects spoofed file with fake MIME (e.g. text/html pretending to be image)", () => {
    const fakeHtml = Buffer.from("<html><script>alert(1)</script></html>", "utf8");
    const res = verifyMediaBuffer(fakeHtml);
    expect(res.valid).toBe(false);
  });

  test("rejects executable or corrupt binary", () => {
    // MZ DOS executable header
    const exeHeader = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00, 0x04, 0x00, 0x00, 0x00]);
    const res = verifyMediaBuffer(exeHeader);
    expect(res.valid).toBe(false);
  });

  test("verifies valid and invalid files on disk using verifyMediaFile", () => {
    const tmpDir = path.join(__dirname, "tmp_test_media");
    fs.mkdirSync(tmpDir, { recursive: true });

    const pngFile = path.join(tmpDir, "test.png");
    const badFile = path.join(tmpDir, "bad.png");

    const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52]);
    fs.writeFileSync(pngFile, pngHeader);
    fs.writeFileSync(badFile, Buffer.from("plain text not an image", "utf8"));

    try {
      const pngRes = verifyMediaFile(pngFile);
      expect(pngRes.valid).toBe(true);
      expect(pngRes.type).toBe("image");
      expect(pngRes.format).toBe("png");

      const badRes = verifyMediaFile(badFile);
      expect(badRes.valid).toBe(false);
    } finally {
      try {
        fs.unlinkSync(pngFile);
        fs.unlinkSync(badFile);
        fs.rmdirSync(tmpDir);
      } catch {
        /* ignore */
      }
    }
  });

  test("Message model schema permits 'image' and 'video' types with attachments", () => {
    const Message = require("../src/models/Message");
    const mongoose = require("mongoose");

    const u1 = new mongoose.Types.ObjectId();
    const u2 = new mongoose.Types.ObjectId();

    const imageMsg = new Message({
      conversation: Message.conversationKey(u1, u2),
      sender: u1,
      recipient: u2,
      type: "image",
      attachments: [
        {
          name: "screenshot.png",
          url: `/chat/direct/${u2}/media/media-1234.png`,
          size: 1024,
          type: "image",
          mimeType: "image/png",
        },
      ],
    });
    const errImage = imageMsg.validateSync();
    expect(errImage).toBeUndefined();

    const videoMsg = new Message({
      conversation: Message.conversationKey(u1, u2),
      sender: u1,
      recipient: u2,
      type: "video",
      attachments: [
        {
          name: "demo.mp4",
          url: `/chat/direct/${u2}/media/media-5678.mp4`,
          size: 10240,
          type: "video",
          mimeType: "video/mp4",
        },
      ],
    });
    const errVideo = videoMsg.validateSync();
    expect(errVideo).toBeUndefined();
  });

  test("Emoji-only message is accepted without attachments and has no group field (100% group AI excluded)", () => {
    const Message = require("../src/models/Message");
    const mongoose = require("mongoose");

    const u1 = new mongoose.Types.ObjectId();
    const u2 = new mongoose.Types.ObjectId();

    const emojiMsg = new Message({
      conversation: Message.conversationKey(u1, u2),
      sender: u1,
      recipient: u2,
      text: "🎉 🔥 🚀",
      type: "text",
    });
    const err = emojiMsg.validateSync();
    expect(err).toBeUndefined();
    expect(emojiMsg.group).toBeUndefined();
    expect(emojiMsg.text).toBe("🎉 🔥 🚀");
  });
});
