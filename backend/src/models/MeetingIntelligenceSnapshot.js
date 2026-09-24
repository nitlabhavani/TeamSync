const mongoose = require("mongoose");

/**
 * STEP 26 — AI Meeting Intelligence.
 *
 * Persisted, group-scoped record of one meeting-intelligence analysis run.
 * Mirrors ConflictSnapshot.js's conventions (Step 24): stores only
 * *references* to source messages (sourceMessageIds), never a copy of
 * message text — this can never become a second copy of chat history.
 *
 * Every message referenced anywhere in this document was already confirmed
 * (in meetingIntelligenceService.gatherMeetingEvidence, reusing
 * conflictDetectionService.isGroupMessage/belongsToGroup) to be a real GROUP
 * chat message for THIS group — never a private/direct message, never a
 * message from another group.
 *
 * One document per analyze() call — unlike ConflictSnapshot there is no
 * dedup/fingerprint requirement here, since each analysis is itself a
 * point-in-time report over a specific meeting/window, not a fact that
 * should be merged with prior evidence.
 */

const OUTCOME_VALUES = ["PRODUCTIVE", "PARTIALLY_RESOLVED", "UNRESOLVED", "BLOCKED", "INSUFFICIENT_DATA"];
const ASSIGNEE_STATUS_VALUES = ["RESOLVED", "UNRESOLVED"];
const DEADLINE_STATUS_VALUES = ["RESOLVED", "UNRESOLVED"];
const BLOCKER_STATUS_VALUES = ["OPEN", "RESOLVED"];
// Deliberately mirrors the existing Task.priority enum (Task.js) — Meeting
// Intelligence never invents its own priority scale (spec Phase 11).
const { TASK_PRIORITIES } = require("./Task");

const sourceRef = { type: mongoose.Schema.Types.ObjectId, ref: "Message" };

const meetingIntelligenceSnapshotSchema = new mongoose.Schema(
  {
    group: { type: mongoose.Schema.Types.ObjectId, ref: "Group", required: true, index: true },
    // Present only when the analysis was anchored to a saved Meeting
    // (Step 16's Meeting model) — never a fabricated identifier.
    meeting: { type: mongoose.Schema.Types.ObjectId, ref: "Meeting", default: null, index: true },

    scope: {
      startTime: { type: Date, required: true },
      endTime: { type: Date, required: true },
    },
    sourceMessageIds: [sourceRef],
    generatedAt: { type: Date, default: Date.now },
    generatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },

    summary: {
      headline: { type: String, default: "" },
      topics: [{ type: String }],
      summary: { type: String, default: "" },
    },

    decisions: [
      {
        _id: false,
        decision: String,
        classification: { type: String, enum: ["DECISION", "SUGGESTION", "UNCLEAR"] },
        sourceMessageIds: [sourceRef],
        confidence: Number,
      },
    ],

    actionItems: [
      {
        _id: false,
        title: String,
        description: String,
        assignee: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
        assigneeName: { type: String, default: null },
        assigneeStatus: { type: String, enum: ASSIGNEE_STATUS_VALUES },
        deadline: { type: String, default: null },
        deadlineStatus: { type: String, enum: DEADLINE_STATUS_VALUES },
        priority: { type: String, enum: TASK_PRIORITIES },
        relatedTaskId: { type: mongoose.Schema.Types.ObjectId, ref: "Task", default: null },
        sourceMessageId: sourceRef,
        confidence: Number,
      },
    ],

    blockers: [
      {
        _id: false,
        text: String,
        relatedTaskId: { type: mongoose.Schema.Types.ObjectId, ref: "Task", default: null },
        sourceMessageIds: [sourceRef],
        status: { type: String, enum: BLOCKER_STATUS_VALUES },
      },
    ],

    unresolvedItems: [
      {
        _id: false,
        type: String, // OPEN_QUESTION | <ConflictSnapshot type, reused read-only>
        text: String,
        sourceMessageIds: [sourceRef],
        existingConflictId: { type: mongoose.Schema.Types.ObjectId, ref: "ConflictSnapshot", default: null },
        existingConflictStatus: { type: String, default: null },
      },
    ],

    followUps: [
      { _id: false, text: String, sourceMessageIds: [sourceRef] },
    ],

    priorityChanges: [
      { _id: false, text: String, sourceMessageIds: [sourceRef] },
    ],

    responsibilityChanges: [
      { _id: false, text: String, sourceMessageIds: [sourceRef] },
    ],

    risks: [
      { _id: false, text: String, sourceMessageIds: [sourceRef] },
    ],

    // Conflicting decisions + other structural conflicts, SURFACED from the
    // existing Step 24 conflictDetectionService detectors — never a second
    // scoring formula, never auto-created as new ConflictSnapshot records
    // (spec Phase 14).
    conflicts: [
      {
        _id: false,
        type: String,
        title: String,
        summary: String,
        sourceMessageIds: [sourceRef],
        relatedTaskId: { type: mongoose.Schema.Types.ObjectId, ref: "Task", default: null },
        existingConflictId: { type: mongoose.Schema.Types.ObjectId, ref: "ConflictSnapshot", default: null },
        existingConflictStatus: { type: String, default: null },
      },
    ],

    outcome: { type: String, enum: OUTCOME_VALUES, required: true },

    healthSignals: {
      decisionsCount: Number,
      actionItemCount: Number,
      unresolvedItemCount: Number,
      blockerCount: Number,
      openBlockerCount: Number,
      assignedActionItemCount: Number,
      deadlineDefinedActionItemCount: Number,
      followUpCount: Number,
      ownershipClarity: mongoose.Schema.Types.Mixed, // number 0-1, or "INSUFFICIENT_DATA"
    },

    // Object of 0-1 dimension scores + overall (0-100), or the literal
    // string "INSUFFICIENT_DATA" — see meetingIntelligenceService docs.
    effectiveness: mongoose.Schema.Types.Mixed,
  },
  { timestamps: true }
);

meetingIntelligenceSnapshotSchema.index({ group: 1, createdAt: -1 });

meetingIntelligenceSnapshotSchema.statics.OUTCOME_VALUES = OUTCOME_VALUES;

module.exports = mongoose.model("MeetingIntelligenceSnapshot", meetingIntelligenceSnapshotSchema);
