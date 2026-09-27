const mongoose = require("mongoose");

/**
 * Kanban columns (board view) plus the submission workflow states required by
 * the TeamSync spec:
 *   pending -> submitted -> ai_review -> guide_review -> completed
 */
const TASK_STATUSES = [
  "backlog",
  "todo",
  "in_progress",
  "review",
  "in_review",
  "done",
  // submission workflow
  "pending",
  "submitted",
  "ai_review",
  "guide_review",
  "changes_requested",
  "overdue",
  "completed",
  "rejected",
];
const TASK_PRIORITIES = ["low", "medium", "high", "critical"];

const submissionFileSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    originalName: { type: String, required: true },
    url: { type: String, required: true },
    size: { type: Number, default: 0 },
    mimeType: { type: String, default: "application/octet-stream" },
    type: { type: String, default: "file" },
  },
  { _id: false }
);

const submissionSchema = new mongoose.Schema(
  {
    student: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    note: { type: String, default: "" },
    files: [submissionFileSchema],
    aiAnalysis: {
      score: { type: Number, default: null },
      summary: { type: String, default: "" },
      issues: [{ type: String }],
      recommendations: [{ type: String }],
      checks: { type: mongoose.Schema.Types.Mixed, default: {} },
      analyzedAt: { type: Date, default: null },
      engine: { type: String, default: "" },
      /**
       * Step 9 — ZIP project submission analysis (project identity + task
       * relevance + implementation classification). Left undefined/default
       * for non-ZIP submissions (docs/images/etc.), which keep using only
       * the generic fields above exactly as before.
       */
      projectRelated: { type: Boolean, default: null },
      projectConfidence: { type: Number, default: null },
      taskRelated: { type: Boolean, default: null },
      implementationStatus: {
        type: String,
        enum: [
          "",
          "WRONG_PROJECT",
          "PROJECT_RELATED_TASK_NOT_IMPLEMENTED",
          "PARTIAL_PROGRESS",
          "VALID_BUT_NEEDS_IMPROVEMENT",
          "VALID_SUBMISSION",
          "UNREADABLE_ZIP",
        ],
        default: "",
      },
      progress: { type: Number, default: null },
      completedParts: [{ type: String }],
      missingParts: [{ type: String }],
      /**
       * Step 13 — richer feedback categorization + progress labelling +
       * resubmission comparison. All additive: every Step 9-12 field above
       * is untouched, so any submission created before Step 13 simply has
       * these as their schema defaults (null/"").
       */
      taskConfidence: { type: Number, default: null },
      progressLabel: {
        type: String,
        enum: ["", "Not Started", "In Progress", "Nearly Complete", "Complete"],
        default: "",
      },
      criticalIssues: [{ type: String }],
      positiveFindings: [{ type: String }],
      improvementSummary: {
        type: new mongoose.Schema(
          {
            progressDelta: { type: Number, default: null },
            projectConfidenceDelta: { type: Number, default: null },
            taskConfidenceDelta: { type: Number, default: null },
            resolvedIssues: [{ type: String }],
            newIssues: [{ type: String }],
            changeNote: { type: String, enum: ["", "improved", "decreased", "no_change"], default: "" },
          },
          { _id: false }
        ),
        default: null,
      },
      /**
       * Step 14 — duplicate/plagiarism detection result (Feature 2).
       * Purely additive: submissions created before Step 14 simply have
       * this as schema defaults (detected: false, everything else
       * null/empty), so every place that already reads `aiAnalysis` keeps
       * working unchanged. Never contains raw source code — only scores,
       * a severity label, and references to the matched submission.
       */
      plagiarism: {
        type: new mongoose.Schema(
          {
            detected: { type: Boolean, default: false },
            similarityScore: { type: Number, default: 0 },
            severity: {
              type: String,
              enum: ["NONE", "POSSIBLE", "HIGH", "DUPLICATE"],
              default: "NONE",
            },
            matchedSubmissionId: { type: mongoose.Schema.Types.ObjectId, default: null },
            matchedStudentId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
            matchedGroupId: { type: mongoose.Schema.Types.ObjectId, ref: "Group", default: null },
            matchedFiles: [{ type: String }],
            reasons: [{ type: String }],
            recommendation: { type: String, default: "" },
            analyzedAt: { type: Date, default: null },
          },
          { _id: false }
        ),
        default: () => ({}),
      },
      /**
       * STEP 17 — Feature 3: Deep AI Code Review (static analysis only,
       * see services/codeReviewAnalyzer.js). Purely additive: submissions
       * created before Step 17 simply have this as schema defaults
       * (score: null, empty issues/positiveFindings), exactly like
       * `plagiarism` above. Deliberately kept separate from the project/
       * task correctness judgement above — a project-relevant, on-task
       * submission can still have code-quality issues, and vice versa.
       */
      codeReview: {
        type: new mongoose.Schema(
          {
            score: { type: Number, default: null },
            issues: [
              {
                severity: { type: String, enum: ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"] },
                category: { type: String, enum: ["ERROR_HANDLING", "CODE_QUALITY", "REACT", "BACKEND"] },
                file: { type: String, default: "" },
                line: { type: Number, default: null },
                message: { type: String, default: "" },
                suggestion: { type: String, default: "" },
              },
            ],
            positiveFindings: [{ type: String }],
            analyzedFileCount: { type: Number, default: 0 },
            analyzedAt: { type: Date, default: null },
            /** vs. the previous submission version's codeReview.score, if any (never fabricated — see computeCodeQualityComparison). */
            comparison: {
              type: new mongoose.Schema(
                {
                  previousScore: { type: Number, default: null },
                  currentScore: { type: Number, default: null },
                  delta: { type: Number, default: null },
                  changeNote: { type: String, enum: ["", "improved", "decreased", "no_change"], default: "" },
                },
                { _id: false }
              ),
              default: null,
            },
          },
          { _id: false }
        ),
        default: () => ({}),
      },
      /**
       * Safe ZIP Content Relevance Check.
       * RELEVANT | POSSIBLY_RELEVANT | IRRELEVANT
       */
      relevance: {
        type: new mongoose.Schema(
          {
            status: { type: String, enum: ["", "RELEVANT", "POSSIBLY_RELEVANT", "IRRELEVANT"], default: "" },
            isIrrelevant: { type: Boolean, default: false },
            score: { type: Number, default: 0 },
            reason: { type: String, default: "" },
            evidence: {
              type: new mongoose.Schema(
                {
                  zipName: { type: String, default: "" },
                  projectKeywords: [{ type: String }],
                  taskKeywords: [{ type: String }],
                  matchedFiles: [{ type: String }],
                  unmatchedReasons: [{ type: String }],
                },
                { _id: false }
              ),
              default: () => ({}),
            },
            evaluatedAt: { type: Date, default: null },
          },
          { _id: false }
        ),
        default: () => ({}),
      },
    },
    irrelevantNotified: { type: Boolean, default: false },
    /**
     * Step 14 — internal-only content fingerprint used to compare *future*
     * submissions against this one for duplicate/plagiarism detection (see
     * services/plagiarismAnalyzer.js). `select: false` means it is excluded
     * from every query by default (including submission history/review
     * endpoints) unless a service explicitly opts in with
     * `.select("+submissions._plagiarismFingerprint")` — this is what
     * guarantees it never reaches the frontend/student/guide, satisfying
     * "never expose another student's private submission files" (Feature 1
     * §8, Feature 12). Contains only hashes, never raw file content.
     */
    _plagiarismFingerprint: { type: mongoose.Schema.Types.Mixed, select: false, default: null },
    guideFeedback: { type: String, default: "" },
    verdict: { type: String, enum: ["", "approved", "rejected", "changes_requested"], default: "" },
    /**
     * Step 11 — who closed out this submission (guide or team leader) and
     * when. Additive fields only; `verdict`/`guideFeedback` already carried
     * the decision + comment since Step 10, so this just adds the missing
     * "who/when" audit trail without duplicating anything.
     */
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    reviewedAt: { type: Date, default: null },
    version: { type: Number, default: 1 },
    submittedAt: { type: Date, default: Date.now },
    /**
     * Smart Task Completion & Verification.
     * Grounded verification of submission requirements, completeness, and next task routing.
     */
    verification: {
      type: new mongoose.Schema(
        {
          status: { type: String, enum: ["", "PASS", "FAIL", "NEEDS_REVIEW"], default: "" },
          score: { type: Number, default: 0 },
          confidence: { type: Number, default: 0 },
          requirementsChecked: [{ type: String }],
          requirementsPassed: [{ type: String }],
          requirementsFailed: [{ type: String }],
          missingItems: [{ type: String }],
          feedback: { type: String, default: "" },
          autoCompleteEligible: { type: Boolean, default: false },
          completionHandled: { type: Boolean, default: false },
          completionStatus: {
            type: String,
            enum: ["", "COMPLETE", "PARTIALLY_COMPLETE", "INCOMPLETE", "INSUFFICIENT_EVIDENCE"],
            default: "",
          },
          evidenceQuality: {
            type: String,
            enum: ["", "VALID_EVIDENCE", "PARTIAL_EVIDENCE", "INVALID_EVIDENCE", "NO_EVIDENCE", "UNREADABLE_EVIDENCE"],
            default: "",
          },
          deliverableType: { type: String, default: "" },
          progressPercent: { type: Number, default: 0, min: 0, max: 100 },
          handledAt: { type: Date, default: null },
          evaluatedAt: { type: Date, default: null },
          nextTask: {
            id: { type: mongoose.Schema.Types.ObjectId, ref: "Task", default: null },
            title: { type: String, default: "" },
            priority: { type: String, default: "" },
            due: { type: Date, default: null },
            status: { type: String, default: "" },
            isAssigned: { type: Boolean, default: false },
            autoAssigned: { type: Boolean, default: false },
          },
        },
        { _id: false }
      ),
      default: () => ({}),
    },
  },
  { _id: true }
);

const taskSchema = new mongoose.Schema(
  {
    group: { type: mongoose.Schema.Types.ObjectId, ref: "Group", required: true, index: true },
    title: { type: String, required: true, trim: true },
    description: { type: String, default: "" },
    assignee: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    status: { type: String, enum: TASK_STATUSES, default: "todo" },
    priority: { type: String, enum: TASK_PRIORITIES, default: "medium" },
    due: { type: Date },
    estimate: { type: Number, default: 1, min: 0 }, // hours
    tags: [{ type: String }],
    order: { type: Number, default: 0 },
    completedAt: { type: Date },

    /**
     * Where this task came from. "ai" tasks were created via the AI project
     * plan (see reportController.createProjectPlanTasks); "ai_chat" tasks
     * were created automatically from a group chat message (see
     * chatTaskService.js). Everything else about them (assignment, status
     * workflow, submissions, notifications) is identical to a manually
     * created task — no separate task type/system.
     */
    source: { type: String, enum: ["manual", "ai", "ai_chat"], default: "manual", index: true },
    /** AI-plan module label (e.g. "Frontend / UI"), display-only. */
    module: { type: String, default: "" },
    /** Other Tasks in this group that must be done first (from the AI plan). */
    dependencies: [{ type: mongoose.Schema.Types.ObjectId, ref: "Task" }],

    /**
     * The group chat Message._id this task was auto-created from (source
     * "ai_chat" only). Used purely for duplicate protection — re-processing
     * the same message must never create a second task. Sparse: unrelated
     * ("manual"/"ai") tasks never set this.
     */
    sourceMessageId: { type: mongoose.Schema.Types.ObjectId, ref: "Message", default: null, index: true },

    /** Optional reference material attached by the guide / leader. */
    referenceFile: {
      name: String,
      url: String,
      size: Number,
      mimeType: String,
    },

    submissions: [submissionSchema],

    /** Which deadline reminders already went out (5 / 2 / 1 / 0 days, overdue). */
    remindersSent: [{ type: String }],
    overdueNotifiedAt: { type: Date, default: null },

    /**
     * STEP 16 — Feature 2: proactive deadline early warning. Purely additive
     * (defaults preserve every task created before Step 16). Separate from
     * the existing overdue/remindersSent fields above — this tracks a task
     * that is NOT yet overdue but is trending that way, so the existing
     * overdue logic in deadlineService.js is never touched or replaced.
     */
    earlyWarning: {
      level: {
        type: String,
        enum: ["ON_TRACK", "DEADLINE_APPROACHING", "AT_RISK"],
        default: "ON_TRACK",
      },
      reason: { type: String, default: "" },
      recommendedAction: { type: String, default: "" },
      updatedAt: { type: Date, default: null },
      /** Last level a notification was actually sent for, so re-scans don't
       * re-notify unless the level has genuinely worsened (dedup/throttle). */
      lastNotifiedLevel: { type: String, default: null },
      lastNotifiedAt: { type: Date, default: null },
    },
    /**
     * STEP 18 — AI Task Intelligence / Smart Planning. Purely additive
     * (defaults preserve every task created before Step 18). Only the
     * STUDENT-SAFE part of a generated plan is ever persisted here — the
     * guide-only reasoning (suggested priority + why, recommended
     * assignee + why, team-risk signals) is returned by the generate
     * endpoint but deliberately never written to this field, so it can
     * never leak to a student reading this task (see
     * services/taskPlanService.js and the Step 18 report's Security
     * section for why).
     */
    aiPlan: {
      type: new mongoose.Schema(
        {
          subtasks: [
            {
              title: { type: String, default: "" },
              difficulty: { type: String, enum: ["LOW", "MEDIUM", "HIGH"], default: "MEDIUM" },
              estimatedHours: { type: Number, default: null },
              _id: false,
            },
          ],
          acceptanceCriteria: [{ type: String }],
          testingChecklist: [{ type: String }],
          estimatedTotalEffort: { type: String, default: "" },
          generatedAt: { type: Date, default: null },
          appliedAt: { type: Date, default: null },
          appliedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
        },
        { _id: false }
      ),
      default: () => ({}),
    },
    /**
     * Smart Next Task reference upon completion.
     */
    nextTask: {
      id: { type: mongoose.Schema.Types.ObjectId, ref: "Task", default: null },
      title: { type: String, default: "" },
      priority: { type: String, default: "" },
      due: { type: Date, default: null },
      status: { type: String, default: "" },
      isAssigned: { type: Boolean, default: false },
      autoAssigned: { type: Boolean, default: false },
    },

    /**
     * AI Task Clarity and Deliverable Criteria
     */
    whatToDo: { type: String, default: "" },
    expectedOutput: { type: String, default: "" },
    deliverableType: { type: String, default: "" },
    completionCriteria: [{ type: String }],
    progress: { type: Number, default: 0, min: 0, max: 100 },
    completionStatus: {
      type: String,
      enum: ["", "COMPLETE", "PARTIALLY_COMPLETE", "INCOMPLETE", "INSUFFICIENT_EVIDENCE"],
      default: "",
    },
    evidenceQuality: {
      type: String,
      enum: ["", "VALID_EVIDENCE", "PARTIAL_EVIDENCE", "INVALID_EVIDENCE", "NO_EVIDENCE", "UNREADABLE_EVIDENCE"],
      default: "",
    },
    completionReason: { type: String, default: "" },
    missingRequirements: [{ type: String }],
    verifiedBy: { type: String, default: "" },

    /**
     * AI-Controlled Task Decomposition & Tracking
     */
    objective: { type: String, default: "" },
    problemStatement: { type: String, default: "" },
    implementationPlan: [
      {
        stepNumber: { type: Number },
        title: { type: String, default: "" },
        description: { type: String, default: "" },
        targetFiles: [{ type: String }],
      },
    ],
    expectedFiles: [{ type: String }],
    requiredSkills: [{ type: String }],
    aiAssignment: {
      type: new mongoose.Schema(
        {
          selectedStudentId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
          studentName: { type: String, default: "" },
          assignmentReason: { type: String, default: "" },
          evidenceUsed: [{ type: String }],
          confidence: { type: Number, default: 0 },
          eligibilityStatus: {
            type: String,
            enum: ["", "ASSIGNED", "NO_ELIGIBLE_ASSIGNEE", "REASSIGNED", "ACTIVE_ASSIGNED", "QUEUED_ASSIGNED"],
            default: "",
          },
          evaluatedMembersCount: { type: Number, default: 0 },
          activeTasksCount: { type: Number, default: 0 },
          assignedAt: { type: Date, default: null },
        },
        { _id: false }
      ),
      default: () => ({}),
    },
    isActiveTask: { type: Boolean, default: false },
    queueIndex: { type: Number, default: 0 },
    activatedAt: { type: Date, default: null },
    deadlineSource: { type: String, default: "" },
    priorityRationale: { type: String, default: "" },
    aiAnalysisVersion: { type: String, default: "1.0" },
  },
  { timestamps: true }
);

taskSchema.pre("save", function stampCompletion(next) {
  if (this.isModified("status")) {
    const finished = this.status === "done" || this.status === "completed";
    this.completedAt = finished ? new Date() : undefined;
  }
  next();
});

taskSchema.virtual("isOverdue").get(function isOverdue() {
  const finished = this.status === "done" || this.status === "completed";
  return Boolean(this.due && !finished && this.due < new Date());
});

taskSchema.virtual("latestSubmission").get(function latestSubmission() {
  if (!this.submissions?.length) return null;
  return this.submissions[this.submissions.length - 1];
});

taskSchema.set("toJSON", { virtuals: true });

const ACTIVE_TASK_STATUSES = [
  "todo",
  "in_progress",
  "review",
  "in_review",
  "submitted",
  "ai_review",
  "guide_review",
  "changes_requested",
];

module.exports = mongoose.model("Task", taskSchema);
module.exports.TASK_STATUSES = TASK_STATUSES;
module.exports.TASK_PRIORITIES = TASK_PRIORITIES;
module.exports.ACTIVE_TASK_STATUSES = ACTIVE_TASK_STATUSES;
