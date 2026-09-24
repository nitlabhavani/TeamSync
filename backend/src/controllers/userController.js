const fs = require("fs");
const path = require("path");
const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/apiError");
const User = require("../models/User");
const Group = require("../models/Group");
const Message = require("../models/Message");
const FileAsset = require("../models/FileAsset");
const Task = require("../models/Task");
const PeerReview = require("../models/PeerReview");
const Badge = require("../models/Badge");

const uploadsDir = path.join(__dirname, "..", "..", process.env.UPLOAD_DIR || "uploads");

/**
 * IDOR guard for cross-user endpoints (/users/:id, .../performance*).
 * A caller may view another user's profile/analytics only if they are:
 *   - the target themselves,
 *   - an admin,
 *   - a guide of a group the target belongs to, or
 *   - a member of a group the target also belongs to (teammate).
 */
const assertCanViewUser = async (req, targetId) => {
  if (String(req.user._id) === String(targetId)) return;
  if (req.user.role === "admin") return;
  const shared = await Group.exists({
    members: req.user._id,
    $or: [{ members: targetId }, { guide: targetId }],
  });
  const isGuideOfTarget = await Group.exists({ guide: req.user._id, members: targetId });
  if (!shared && !isGuideOfTarget) throw ApiError.forbidden("You are not authorized to view this user");
};

/** Strip an /uploads/... URL back to an absolute path we own, then delete it. */
const removeStoredFile = (url) => {
  if (!url || !url.startsWith("/uploads/")) return;
  const abs = path.join(uploadsDir, url.replace(/^\/uploads\//, ""));
  if (abs.startsWith(uploadsDir)) fs.promises.unlink(abs).catch(() => {});
};

const fileUrl = (req, filename) => `/uploads/profiles/${req.user._id}/${filename}`;

const asList = (value) => {
  if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean).slice(0, 60);
  if (typeof value === "string")
    return value.split(",").map((v) => v.trim()).filter(Boolean).slice(0, 60);
  return [];
};

const clampNumber = (value, min, max) => {
  if (value === "" || value === null || value === undefined) return undefined;
  const n = Number(value);
  if (Number.isNaN(n)) throw ApiError.badRequest("Expected a number");
  return Math.min(max, Math.max(min, n));
};

const isUrlOrEmpty = (v) => !v || /^https?:\/\/\S+$/i.test(String(v));

exports.list = asyncHandler(async (req, res) => {
  const { role, q, dept } = req.query;
  const filter = { isActive: true };
  if (role) filter.role = role;
  if (dept) filter.dept = dept;
  if (q) filter.$or = [{ name: new RegExp(q, "i") }, { email: new RegExp(q, "i") }];
  const users = await User.find(filter).select("name email role dept color avatar").sort("name").limit(200);
  res.json({ success: true, data: users });
});

exports.getOne = asyncHandler(async (req, res) => {
  const targetId = req.params.id === "me" ? req.user._id : req.params.id;
  await assertCanViewUser(req, targetId);
  const user = await User.findById(targetId);
  if (!user) throw ApiError.notFound("User not found");
  res.json({ success: true, data: user });
});

/** Full profile of the signed-in user (personal, academic, skills, docs, links). */
exports.myProfile = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id);
  res.json({ success: true, data: user });
});

/**
 * Update the signed-in user's profile. Accepts flat top-level fields plus the
 * nested `personal`, `academic` and `social` objects.
 */
exports.updateMe = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id);
  const body = req.body || {};

  ["name", "dept", "bio", "avatar", "color"].forEach((k) => {
    if (body[k] !== undefined) user[k] = String(body[k]).trim();
  });
  if (body.name !== undefined && user.name.length < 2)
    throw ApiError.badRequest("Name must be at least 2 characters");
  if (body.bio !== undefined && user.bio.length > 600)
    throw ApiError.badRequest("About must be 600 characters or fewer");

  if (body.personal) {
    const p = body.personal;
    if (p.phone !== undefined) {
      const phone = String(p.phone).trim();
      if (phone && !/^[+\d][\d\s\-()]{6,19}$/.test(phone))
        throw ApiError.badRequest("Enter a valid phone number");
      user.personal.phone = phone;
    }
    if (p.dateOfBirth !== undefined) user.personal.dateOfBirth = p.dateOfBirth || undefined;
    if (p.gender !== undefined) user.personal.gender = p.gender || "";
    ["address", "city", "state", "pincode"].forEach((k) => {
      if (p[k] !== undefined) user.personal[k] = String(p[k]).trim().slice(0, 200);
    });
  }

  if (body.academic) {
    const a = body.academic;
    [
        "college", "university", "degree", "branch", "year", "semester",
        "rollNumber", "registrationNumber", "enrollmentNumber", "graduationYear",
      ].forEach(
      (k) => {
        if (a[k] !== undefined) user.academic[k] = String(a[k]).trim().slice(0, 120);
      }
    );
    if (a.cgpa !== undefined) user.academic.cgpa = clampNumber(a.cgpa, 0, 10);
    if (a.tenthPercentage !== undefined) user.academic.tenthPercentage = clampNumber(a.tenthPercentage, 0, 100);
    if (a.interPercentage !== undefined) user.academic.interPercentage = clampNumber(a.interPercentage, 0, 100);
  }

  if (body.professional) {
    const pr = body.professional;
    ["designation", "employeeId", "college", "department", "qualification", "specialization", "officeRoom", "officeHours"].forEach(
      (k) => {
        if (pr[k] !== undefined) user.professional[k] = String(pr[k]).trim().slice(0, 160);
      }
    );
    if (pr.experienceYears !== undefined)
      user.professional.experienceYears = clampNumber(pr.experienceYears, 0, 60);
  }

  ["skills", "programmingLanguages", "frameworks", "tools", "researchInterests"].forEach((k) => {
    if (body[k] !== undefined) user[k] = asList(body[k]);
  });

  if (body.social) {
    ["github", "linkedin", "portfolio", "twitter"].forEach((k) => {
      if (body.social[k] === undefined) return;
      const value = String(body.social[k]).trim();
      if (!isUrlOrEmpty(value)) throw ApiError.badRequest(`${k} must be a full URL starting with https://`);
      user.social[k] = value;
    });
  }

  await user.save();
  res.json({ success: true, data: user });
});

/* ---------------- Avatar ---------------- */
exports.uploadAvatar = asyncHandler(async (req, res) => {
  if (!req.file) throw ApiError.badRequest("No image uploaded");
  const user = await User.findById(req.user._id);
  removeStoredFile(user.avatar);
  user.avatar = fileUrl(req, req.file.filename);
  await user.save();
  res.status(201).json({ success: true, data: { avatar: user.avatar } });
});

/* ---------------- Resume ---------------- */
exports.uploadResume = asyncHandler(async (req, res) => {
  if (!req.file) throw ApiError.badRequest("No resume uploaded");
  const user = await User.findById(req.user._id);
  removeStoredFile(user.resume?.url);
  user.resume = {
    name: req.file.originalname,
    url: fileUrl(req, req.file.filename),
    size: req.file.size,
    mimeType: req.file.mimetype,
    uploadedAt: new Date(),
  };
  await user.save();
  res.status(201).json({ success: true, data: user.resume });
});

exports.deleteResume = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id);
  if (!user.resume?.url) throw ApiError.notFound("No resume on file");
  removeStoredFile(user.resume.url);
  user.resume = undefined;
  await user.save();
  res.json({ success: true, message: "Resume removed" });
});

/* ---------------- Certifications ---------------- */
exports.uploadCertificate = asyncHandler(async (req, res) => {
  if (!req.file) throw ApiError.badRequest("No certificate uploaded");
  const user = await User.findById(req.user._id);
  if (user.certifications.length >= 25) throw ApiError.badRequest("Certificate limit reached (25)");

  user.certifications.push({
    name: String(req.body.name || req.file.originalname).slice(0, 140),
    url: fileUrl(req, req.file.filename),
    size: req.file.size,
    mimeType: req.file.mimetype,
    issuer: String(req.body.issuer || "").slice(0, 140),
    issuedOn: req.body.issuedOn || undefined,
    credentialUrl: isUrlOrEmpty(req.body.credentialUrl) ? req.body.credentialUrl || "" : "",
    uploadedAt: new Date(),
  });
  await user.save();
  res.status(201).json({ success: true, data: user.certifications[user.certifications.length - 1] });
});

exports.deleteCertificate = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id);
  const cert = user.certifications.id(req.params.certId);
  if (!cert) throw ApiError.notFound("Certificate not found");
  removeStoredFile(cert.url);
  cert.deleteOne();
  await user.save();
  res.json({ success: true, message: "Certificate removed" });
});

exports.updateSettings = asyncHandler(async (req, res) => {
  req.user.settings = { ...req.user.settings.toObject(), ...req.body };
  await req.user.save();
  res.json({ success: true, data: req.user.settings });
});

exports.changePassword = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id).select("+password");
  if (!(await user.comparePassword(req.body.currentPassword || "")))
    throw ApiError.badRequest("Current password is incorrect");
  if (!req.body.newPassword || String(req.body.newPassword).length < 8)
    throw ApiError.badRequest("New password must be at least 8 characters");
  user.password = req.body.newPassword;
  await user.save();
  res.json({ success: true, message: "Password changed" });
});

/** Aggregated performance profile for a member (used by student + guide views). */
exports.performance = asyncHandler(async (req, res) => {
  const userId = req.params.id === "me" ? req.user._id : req.params.id;
  await assertCanViewUser(req, userId);
  const [groups, tasks, reviews, badges, messageCount, files, weekly] = await Promise.all([
    Group.find({ members: userId }).select("name project progress"),
    Task.find({ assignee: userId }).lean(),
    PeerReview.find({ reviewee: userId }).lean(),
    Badge.find({ user: userId }).lean(),
    Message.countDocuments({ sender: userId, deleted: false }),
    FileAsset.find({ uploadedBy: userId }).select("size createdAt").lean(),
    Message.aggregate([
      { $match: { sender: new (require("mongoose").Types.ObjectId)(String(userId)), deleted: false } },
      { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } }, count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
      { $limit: 60 },
    ]),
  ]);

  const done = tasks.filter((t) => t.status === "done");
  const onTime = done.filter((t) => !t.due || (t.completedAt && t.completedAt <= t.due));
  const overdue = tasks.filter((t) => t.status !== "done" && t.due && new Date(t.due) < new Date());
  const avgScore = reviews.length
    ? reviews.reduce((s, r) => {
        const x = r.scores;
        return s + (x.contribution + x.communication + x.reliability + x.helpfulness) / 4;
      }, 0) / reviews.length
    : 0;

  res.json({
    success: true,
    data: {
      groups,
      totals: {
        tasks: tasks.length,
        completed: done.length,
        onTimeRate: done.length ? Math.round((onTime.length / done.length) * 100) : 0,
        overdue: overdue.length,
        openHours: tasks.filter((t) => t.status !== "done").reduce((s, t) => s + (t.estimate || 0), 0),
      },
      activity: {
        messages: messageCount,
        filesShared: files.length,
        bytesShared: files.reduce((sum, f) => sum + (f.size || 0), 0),
        daily: weekly.map((d) => ({ date: d._id, messages: d.count })),
      },
      collaborationScore: Math.min(
        100,
        Math.round(
          done.length * 6 + messageCount * 0.6 + files.length * 4 + Number(avgScore.toFixed(2)) * 5
        )
      ),
      peerScore: Number(avgScore.toFixed(2)),
      reviewCount: reviews.length,
      badges,
    },
  });
});

/**
 * GET /api/users/:id/performance/trend?range=weekly|monthly
 * Buckets messages, tasks completed and files shared into 7 daily points
 * (weekly) or 6 weekly points (monthly) for the performance graphs.
 */
exports.performanceTrend = asyncHandler(async (req, res) => {
  const userId = req.params.id === "me" ? req.user._id : req.params.id;
  await assertCanViewUser(req, userId);
  const range = req.query.range === "monthly" ? "monthly" : "weekly";
  const DAY = 86400000;
  const days = range === "monthly" ? 42 : 7;
  const since = new Date(Date.now() - (days - 1) * DAY);

  const [messages, tasks, files] = await Promise.all([
    Message.find({ sender: userId, deleted: false, createdAt: { $gte: since } })
      .select("createdAt")
      .lean(),
    Task.find({ assignee: userId, completedAt: { $gte: since } }).select("completedAt").lean(),
    FileAsset.find({ uploadedBy: userId, createdAt: { $gte: since } }).select("createdAt size").lean(),
  ]);

  const bucketCount = range === "monthly" ? 6 : 7;
  const bucketDays = range === "monthly" ? 7 : 1;

  const points = Array.from({ length: bucketCount }, (_, i) => {
    const end = new Date(Date.now() - (bucketCount - 1 - i) * bucketDays * DAY);
    const start = new Date(end.getTime() - (bucketDays - 1) * DAY);
    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);
    const inRange = (d) => d && new Date(d) >= start && new Date(d) <= end;
    return {
      key: start.toISOString().slice(0, 10),
      label:
        range === "monthly"
          ? `${start.toISOString().slice(5, 10)}`
          : start.toLocaleDateString("en-US", { weekday: "short" }),
      messages: messages.filter((m) => inRange(m.createdAt)).length,
      tasksCompleted: tasks.filter((t) => inRange(t.completedAt)).length,
      filesShared: files.filter((f) => inRange(f.createdAt)).length,
    };
  });

  const sum = (k) => points.reduce((a, p) => a + p[k], 0);
  res.json({
    success: true,
    data: {
      range,
      points,
      totals: {
        messages: sum("messages"),
        tasksCompleted: sum("tasksCompleted"),
        filesShared: sum("filesShared"),
      },
    },
  });
});

exports.deactivate = asyncHandler(async (req, res) => {
  const user = await User.findByIdAndUpdate(req.params.id, { isActive: false }, { new: true });
  if (!user) throw ApiError.notFound("User not found");
  res.json({ success: true, message: "User deactivated" });
});
