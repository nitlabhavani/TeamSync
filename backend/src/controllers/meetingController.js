const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/apiError");
const Meeting = require("../models/Meeting");
const Task = require("../models/Task");
const User = require("../models/User");
const { summarizeMeetingNotes, extractMeetingActionItems } = require("../services/aiService");
const { notifyUsers } = require("../services/notificationService");
const { validateMeetingLink } = require("../utils/urlValidator");

exports.list = asyncHandler(async (req, res) => {
  const filter = { group: req.group._id };
  if (req.query.status) filter.status = req.query.status;
  const meetings = await Meeting.find(filter)
    .populate("attendees", "name color avatar")
    .sort({ when: -1 });
  const data = meetings.map((m) => {
    const obj = m.toObject();
    obj.meetingLink = obj.meetingLink || obj.link || null;
    return obj;
  });
  res.json({ success: true, data });
});

exports.getOne = asyncHandler(async (req, res) => {
  const meeting = await Meeting.findOne({ _id: req.params.meetingId, group: req.group._id })
    .populate("attendees", "name color avatar");
  if (!meeting) throw ApiError.notFound("Meeting not found");
  const obj = meeting.toObject();
  obj.meetingLink = obj.meetingLink || obj.link || null;
  res.json({ success: true, data: obj });
});

exports.create = asyncHandler(async (req, res) => {
  const payload = { ...req.body };
  const hasLinkField = payload.meetingLink !== undefined || payload.link !== undefined;

  if (hasLinkField) {
    const rawLink = payload.meetingLink !== undefined ? payload.meetingLink : payload.link;
    if (rawLink && String(rawLink).trim()) {
      const canManageLink = Boolean(req.isGuide || req.isLeader);
      if (!canManageLink) {
        throw ApiError.forbidden("Only the guide or team leader can set or update the meeting link");
      }
      try {
        const validated = validateMeetingLink(rawLink);
        payload.meetingLink = validated;
        payload.link = validated || "";
      } catch (err) {
        throw ApiError.badRequest(err.message || "Invalid meeting link");
      }
    } else {
      payload.meetingLink = null;
      payload.link = "";
    }
  }

  const meeting = await Meeting.create({
    ...payload,
    group: req.group._id,
    createdBy: req.user._id,
    attendees: payload.attendees?.length ? payload.attendees : req.group.members,
  });
  await notifyUsers(meeting.attendees, {
    title: "Meeting scheduled",
    body: `${meeting.title} — ${new Date(meeting.when).toLocaleString()}`,
    type: "meeting",
    group: req.group._id,
  }, { exclude: req.user._id });

  const obj = meeting.toObject();
  obj.meetingLink = obj.meetingLink || obj.link || null;
  res.status(201).json({ success: true, data: obj });
});

exports.update = asyncHandler(async (req, res) => {
  const payload = { ...req.body };
  const hasLinkField = payload.meetingLink !== undefined || payload.link !== undefined;

  if (hasLinkField) {
    const canManageLink = Boolean(req.isGuide || req.isLeader);
    if (!canManageLink) {
      throw ApiError.forbidden("Only the guide or team leader can set or update the meeting link");
    }
    const rawLink = payload.meetingLink !== undefined ? payload.meetingLink : payload.link;
    if (rawLink && String(rawLink).trim()) {
      try {
        const validated = validateMeetingLink(rawLink);
        payload.meetingLink = validated;
        payload.link = validated || "";
      } catch (err) {
        throw ApiError.badRequest(err.message || "Invalid meeting link");
      }
    } else {
      payload.meetingLink = null;
      payload.link = "";
    }
  }

  const meeting = await Meeting.findOneAndUpdate(
    { _id: req.params.meetingId, group: req.group._id },
    payload,
    { new: true, runValidators: true }
  );
  if (!meeting) throw ApiError.notFound("Meeting not found");
  const obj = meeting.toObject();
  obj.meetingLink = obj.meetingLink || obj.link || null;
  res.json({ success: true, data: obj });
});

exports.remove = asyncHandler(async (req, res) => {
  await Meeting.findOneAndDelete({ _id: req.params.meetingId, group: req.group._id });
  res.json({ success: true, message: "Meeting deleted" });
});

/** AI smart notes: turn raw notes into decisions / action items / risks. */
exports.generateSummary = asyncHandler(async (req, res) => {
  const meeting = await Meeting.findOne({ _id: req.params.meetingId, group: req.group._id });
  if (!meeting) throw ApiError.notFound("Meeting not found");

  const notes = req.body.notes ?? meeting.notes;
  if (!notes || notes.trim().length < 20)
    throw ApiError.badRequest("Add some meeting notes before generating a summary");

  const attendees = await User.find({ _id: { $in: meeting.attendees } }).select("name").lean();
  meeting.notes = notes;
  meeting.summary = summarizeMeetingNotes(notes, { attendees });
  meeting.status = "completed";
  await meeting.save();

  res.json({ success: true, data: meeting });
});

/**
 * STEP 16 — Feature 1: POST /groups/:groupId/meeting-action-items
 *
 * Ad-hoc extraction: does not require (or create) a saved Meeting — for
 * quickly analyzing raw meeting notes/chat text pasted by a guide/student.
 * Additive alongside the existing per-meeting generateSummary/
 * convertActionItems flow above, which is untouched.
 *
 * Reuses the existing group-access mechanism (requireGroupAccess in
 * routes/index.js already put req.group/req.isGuide on the request before
 * this runs) so a caller can never extract/view items for a group they are
 * not part of. Owner names are matched only against this group's own real
 * member list (req.group members resolved from the DB) — never trusted from
 * the request body — and the input text is only ever pattern-matched, never
 * executed as code.
 */
exports.extractActionItems = asyncHandler(async (req, res) => {
  const text = String(req.body.notes ?? req.body.text ?? "");
  if (!text || text.trim().length < 10) {
    throw ApiError.badRequest("Provide some meeting notes or transcript text to analyze");
  }
  if (text.length > 20000) {
    throw ApiError.badRequest("Meeting notes are too long (20,000 character limit)");
  }

  const members = await User.find({ _id: { $in: req.group.members } }).select("name").lean();
  const result = extractMeetingActionItems(text, { members });

  res.json({ success: true, data: result });
});

/** Convert AI action items into real tasks on the board. */
exports.convertActionItems = asyncHandler(async (req, res) => {
  const meeting = await Meeting.findOne({ _id: req.params.meetingId, group: req.group._id });
  if (!meeting) throw ApiError.notFound("Meeting not found");
  const items = meeting.summary?.actionItems || [];
  if (!items.length) throw ApiError.badRequest("No action items to convert");

  const members = await User.find({ _id: { $in: meeting.attendees } }).select("name").lean();
  const created = await Task.insertMany(
    items.map((item, i) => {
      const owner = members.find((m) => m.name === item.ownerHint);
      return {
        group: req.group._id,
        title: item.text.slice(0, 140),
        description: `From meeting: ${meeting.title}`,
        assignee: owner?._id,
        status: "todo",
        priority: "medium",
        estimate: 2,
        order: i,
        createdBy: req.user._id,
        tags: ["from-meeting"],
      };
    })
  );

  res.status(201).json({ success: true, data: created });
});
