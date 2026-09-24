const mongoose = require("mongoose");

/**
 * STEP 27 — AI Project Knowledge & Decision Memory.
 *
 * Persisted, group-scoped record of one piece of confirmed/candidate
 * project knowledge (a decision, requirement, technical choice, project
 * convention, resolved issue, meeting outcome, or other important
 * context). Mirrors ConflictSnapshot.js / MeetingIntelligenceSnapshot.js
 * conventions exactly:
 *
 *   - Stores only message/meeting *references* (sourceMessageIds,
 *     sourceMeetingId), never a copy of message text — this can never
 *     become a second copy of chat history.
 *   - Isolation key is ALWAYS `group` (an ObjectId), never the group's
 *     `name` — two same-name groups can never see each other's knowledge
 *     (spec Phase 2/29).
 *   - One document per deduplicated fact (see
 *     projectKnowledgeService.buildKnowledgeFingerprint) — reprocessing the
 *     same group chat/meeting never creates unlimited duplicates; a repeat
 *     mention updates evidence on the existing record instead (spec
 *     Phase 12).
 *   - Historical knowledge is never deleted — a superseded decision moves
 *     to status SUPERSEDED and keeps `supersedesKnowledgeId`/its own
 *     evidence trail forever (spec Phase 13/18).
 *
 * Every message referenced anywhere in this document was already confirmed
 * (via conflictDetectionService.isGroupMessage/belongsToGroup, reused
 * unchanged — see projectKnowledgeService.gatherKnowledgeEvidence) to be a
 * real GROUP chat message for THIS group — never a private/direct message,
 * never a message from another group (spec Phase 5/28).
 */

const KNOWLEDGE_TYPES = [
  "DECISION",
  "REQUIREMENT",
  "TECHNICAL_CHOICE",
  "PROJECT_CONVENTION",
  "RESOLVED_ISSUE",
  "MEETING_OUTCOME",
  "IMPORTANT_CONTEXT",
];

const KNOWLEDGE_STATUSES = ["CANDIDATE", "ACTIVE", "SUPERSEDED", "ARCHIVED"];

const KNOWLEDGE_CONFIDENCE = ["HIGH", "MEDIUM", "LOW"];

const SOURCE_TYPES = ["MESSAGE", "MEETING_INTELLIGENCE", "MANUAL"];

const sourceMessageRef = { type: mongoose.Schema.Types.ObjectId, ref: "Message" };

const projectKnowledgeSchema = new mongoose.Schema(
  {
    group: { type: mongoose.Schema.Types.ObjectId, ref: "Group", required: true, index: true },

    type: { type: String, enum: KNOWLEDGE_TYPES, required: true },
    title: { type: String, required: true, trim: true, maxlength: 300 },
    content: { type: String, required: true, trim: true, maxlength: 2000 },

    status: { type: String, enum: KNOWLEDGE_STATUSES, required: true, default: "CANDIDATE", index: true },
    confidence: { type: String, enum: KNOWLEDGE_CONFIDENCE, default: "MEDIUM" },

    // Evidence — never fabricated (spec Phase 30). Populated only from
    // messages already confirmed to be real GROUP messages of this group.
    sourceMessageIds: [sourceMessageRef],
    sourceMeetingId: { type: mongoose.Schema.Types.ObjectId, ref: "Meeting", default: null },
    // Present only when this candidate came from a saved Step 26 analysis run.
    sourceMeetingIntelligenceId: { type: mongoose.Schema.Types.ObjectId, ref: "MeetingIntelligenceSnapshot", default: null },
    sourceType: { type: String, enum: SOURCE_TYPES, required: true },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    confirmedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    confirmedAt: { type: Date, default: null },

    // Deterministic identity used for deduplication (spec Phase 12) — see
    // projectKnowledgeService.buildKnowledgeFingerprint. Unique per group
    // so a repeated mention updates the existing record's evidence instead
    // of creating a duplicate.
    fingerprint: { type: String, required: true, index: true },

    // Historical chain — never a delete (spec Phase 13/18).
    supersedesKnowledgeId: { type: mongoose.Schema.Types.ObjectId, ref: "ProjectKnowledge", default: null },
    supersededByKnowledgeId: { type: mongoose.Schema.Types.ObjectId, ref: "ProjectKnowledge", default: null },

    // Set when a new candidate's content structurally conflicts with an
    // existing ACTIVE decision (spec Phase 14) — surfaced for guide/leader
    // review, never auto-resolved. This module never creates a second
    // ConflictSnapshot; it only references one if Step 24 already flagged
    // the same underlying situation.
    potentialConflict: {
      flagged: { type: Boolean, default: false },
      withKnowledgeId: { type: mongoose.Schema.Types.ObjectId, ref: "ProjectKnowledge", default: null },
      existingConflictId: { type: mongoose.Schema.Types.ObjectId, ref: "ConflictSnapshot", default: null },
      note: { type: String, default: "" },
    },

    tags: [{ type: String, trim: true, lowercase: true }],

    archivedAt: { type: Date, default: null },
    archivedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },

    lastEvidenceAt: { type: Date, default: Date.now },
    evidenceCount: { type: Number, default: 1 },
  },
  { timestamps: true }
);

projectKnowledgeSchema.index({ group: 1, fingerprint: 1 }, { unique: true });
projectKnowledgeSchema.index({ group: 1, type: 1 });
projectKnowledgeSchema.index({ group: 1, status: 1 });
// Text index for search (Phase 15) — uses the project's existing MongoDB
// setup, no external search database introduced (spec Phase 3).
projectKnowledgeSchema.index({ title: "text", content: "text" });

projectKnowledgeSchema.statics.KNOWLEDGE_TYPES = KNOWLEDGE_TYPES;
projectKnowledgeSchema.statics.KNOWLEDGE_STATUSES = KNOWLEDGE_STATUSES;
projectKnowledgeSchema.statics.KNOWLEDGE_CONFIDENCE = KNOWLEDGE_CONFIDENCE;
projectKnowledgeSchema.statics.SOURCE_TYPES = SOURCE_TYPES;

module.exports = mongoose.model("ProjectKnowledge", projectKnowledgeSchema);
module.exports.KNOWLEDGE_TYPES = KNOWLEDGE_TYPES;
module.exports.KNOWLEDGE_STATUSES = KNOWLEDGE_STATUSES;
module.exports.KNOWLEDGE_CONFIDENCE = KNOWLEDGE_CONFIDENCE;
module.exports.SOURCE_TYPES = SOURCE_TYPES;
