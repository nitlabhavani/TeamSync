const mongoose = require("mongoose");

/**
 * STEP 24 — AI Conflict Detection & Resolution.
 *
 * Persisted, group-scoped conflict record. One document per real,
 * deduplicated conflict (see conflictDetectionService.buildConflictFingerprint)
 * — reprocessing the same group chat never creates unlimited duplicates;
 * new evidence updates the existing OPEN/ACKNOWLEDGED record instead.
 *
 * Stores only message *references* (sourceMessageIds), never a copy of
 * message text, so this can never become a second copy of chat history and
 * always reflects the live Message documents (which still respect the
 * existing chat privacy model — this collection only ever stores IDs of
 * messages that were already confirmed to be GROUP messages, never
 * private/direct ones — see conflictDetectionService.isGroupMessage).
 */

const CONFLICT_TYPES = [
  "TASK_OWNERSHIP",
  "CONFLICTING_INSTRUCTIONS",
  "RESPONSIBILITY_AMBIGUITY",
  "DUPLICATE_WORK",
  "UNRESOLVED_BLOCKER",
  "DEADLINE_DISAGREEMENT",
  "PRIORITY_DISAGREEMENT",
  "REPEATED_DISAGREEMENT",
  "ESCALATION_RISK",
];

const CONFLICT_SEVERITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
const CONFLICT_STATUSES = ["OPEN", "ACKNOWLEDGED", "RESOLVED", "DISMISSED"];

const conflictSnapshotSchema = new mongoose.Schema(
  {
    group: { type: mongoose.Schema.Types.ObjectId, ref: "Group", required: true, index: true },

    type: { type: String, enum: CONFLICT_TYPES, required: true },
    severity: { type: String, enum: CONFLICT_SEVERITIES, required: true, default: "LOW" },
    status: { type: String, enum: CONFLICT_STATUSES, required: true, default: "OPEN", index: true },

    involvedUserIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    relatedTaskId: { type: mongoose.Schema.Types.ObjectId, ref: "Task", default: null },
    sourceMessageIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "Message" }],

    title: { type: String, required: true, trim: true },
    summary: { type: String, required: true, trim: true },
    // Short, neutral, non-diagnostic evidence lines (never raw message
    // text — see conflictDetectionService for the phrasing rules).
    evidence: [{ type: String }],
    recommendation: { type: String, default: "" },
    nextAction: { type: String, default: "" },

    // Deterministic identity used for deduplication — see
    // buildConflictFingerprint. Unique per group so re-analysis updates
    // the same record instead of creating a duplicate.
    fingerprint: { type: String, required: true, index: true },

    detectedAt: { type: Date, default: Date.now },
    lastEvidenceAt: { type: Date, default: Date.now },
    evidenceCount: { type: Number, default: 1 },

    resolvedAt: { type: Date, default: null },
    resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    resolutionNote: { type: String, default: "" },
    acknowledgedAt: { type: Date, default: null },
    acknowledgedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

conflictSnapshotSchema.index({ group: 1, fingerprint: 1 }, { unique: true });
conflictSnapshotSchema.index({ group: 1, status: 1, createdAt: -1 });

conflictSnapshotSchema.statics.CONFLICT_TYPES = CONFLICT_TYPES;
conflictSnapshotSchema.statics.CONFLICT_SEVERITIES = CONFLICT_SEVERITIES;
conflictSnapshotSchema.statics.CONFLICT_STATUSES = CONFLICT_STATUSES;

module.exports = mongoose.model("ConflictSnapshot", conflictSnapshotSchema);
