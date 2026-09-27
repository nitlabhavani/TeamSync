/**
 * Task submissions and the AI review workflow.
 *
 *   pending -> submitted -> ai_review -> guide_review -> completed | rejected
 *
 * Students upload PDF / DOCX / PPT / ZIP / images / source code. Every upload
 * is analysed automatically by the AI file analyser.
 */
const fs = require("fs");
const path = require("path");
const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/apiError");
const Task = require("../models/Task");
const FileAsset = require("../models/FileAsset");
const { verifyZipFile } = require("../utils/mediaMagicBytes");
const { analyseSubmissionFile } = require("../services/fileAnalysisService");
const {
  analyzeZipSubmission,
  isZipFile,
  computeImprovementSummary,
  computeCodeQualityComparison,
} = require("../services/taskSubmissionAnalysisService");
const { notifyUsers } = require("../services/notificationService");
const { logActivity } = require("../services/activityService");
const { emitToGroup } = require("../services/socketService");
const { recalcGroupProgress } = require("./groupController");
const {
  verifyTaskRequirements,
  findNextTaskForStudent,
  executeCompletionAndNextTask,
} = require("../services/taskCompletionVerificationService");
// STEP 33 — task reassignment + submission ownership isolation.
const { shapeTaskForViewer, studentOwnSubmissions, isPrivilegedViewer } = require("../utils/taskSubmissionScope");

const kindOf = (name = "") => {
  const e = path.extname(name).toLowerCase();
  if (e === ".zip" || e === ".rar" || e === ".7z") return "zip";
  if (e === ".pdf") return "pdf";
  if ([".doc", ".docx", ".odt"].includes(e)) return "doc";
  if ([".ppt", ".pptx"].includes(e)) return "ppt";
  if ([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"].includes(e)) return "image";
  if ([".js", ".jsx", ".ts", ".tsx", ".py", ".java", ".c", ".cpp", ".cs", ".go", ".php", ".rb"].includes(e))
    return "code";
  return "file";
};

const publicUrl = (req, file) =>
  `/uploads/${req.params.groupId || "shared"}/${path.basename(file.path)}`;

const loadTask = async (req) => {
  const task = await Task.findOne({ _id: req.params.taskId, group: req.group._id })
    .populate("assignee", "name email")
    .populate("group", "name guide leader project description")
    // Step 12 — submission history needs "Reviewed by <name>" for every
    // past version, not just the one this request is acting on.
    .populate("submissions.reviewedBy", "name email avatar")
    .populate("submissions.student", "name email avatar");
  if (!task) throw ApiError.notFound("Task not found");
  return task;
};

/**
 * POST /api/groups/:groupId/tasks/:taskId/submit  (multipart, field: files)
 */
exports.submit = asyncHandler(async (req, res) => {
  const task = await loadTask(req);
  const isAssignee = String(task.assignee?._id || task.assignee) === String(req.user._id);
  if (!isAssignee && !req.isGuide) throw ApiError.forbidden("Only the assigned student can submit this task");
  if (task.status === "completed" || task.status === "done")
    throw ApiError.badRequest("This task is already completed and cannot be resubmitted");

  const uploaded = Array.isArray(req.files) ? req.files : [];
  const note = String(req.body?.note ?? req.body?.notes ?? "").trim();
  if (!uploaded.length && !note) throw ApiError.badRequest("Attach at least one file or add a note");

  // Validate ZIP archives with magic-byte verification and clean up on failure
  for (const f of uploaded) {
    const isZip = isZipFile(f.originalname || f.name) || kindOf(f.originalname || f.name) === "zip";
    if (isZip) {
      const verified = verifyZipFile(f.path);
      if (!verified.valid) {
        for (const up of uploaded) {
          try {
            fs.unlinkSync(up.path);
          } catch {
            /* ignore cleanup error */
          }
        }
        throw ApiError.badRequest(`Invalid or corrupted ZIP archive: ${verified.reason}`);
      }
    }
  }

  const isUploadOnly = req.body?.action === "upload_only" || req.query?.action === "upload_only";
  const action = isUploadOnly ? "upload_only" : "submit_for_review";

  const files = uploaded.map((f) => ({
    name: path.basename(f.path || f.filename || ""),
    originalName: f.originalname || f.originalName || path.basename(f.path || f.filename || ""),
    url: publicUrl(req, f),
    size: Number(f.size || 0),
    mimeType: f.mimetype || "application/octet-stream",
    type: kindOf(f.originalname || f.originalName || ""),
  }));

  const version = (task.submissions?.length || 0) + 1;
  const submissionDoc = {
    student: req.user._id,
    note,
    files,
    version,
  };
  task.submissions.push(submissionDoc);
  task.markModified("submissions");

  const previousProgress = Number(task.progress || 0);

  if (action === "upload_only") {
    // Evidence upload only: task stays in progress (10%), NOT in_review (90%)
    if (task.status === "todo" || task.status === "pending" || task.status === "backlog") {
      task.status = "in_progress";
      task.progress = 10;
    }
  } else {
    // Explicit submit for review: task transitions to in_review (progress verified by AI below)
    task.status = "in_review";
  }
  await task.save();

  // Mirror submissions into the shared file library (with version history).
  const updatedAssets = [];
  for (const f of files) {
    // eslint-disable-next-line no-await-in-loop
    const existing = await FileAsset.findOne({ group: req.group._id, originalName: f.originalName });
    if (existing) {
      existing.versions.push({
        version: existing.version,
        name: existing.name,
        url: existing.url,
        size: existing.size,
        mimeType: existing.mimeType,
        uploadedBy: existing.uploadedBy,
        uploadedAt: existing.updatedAt,
      });
      Object.assign(existing, { ...f, version: existing.version + 1, uploadedBy: req.user._id });
      // eslint-disable-next-line no-await-in-loop
      await existing.save();
      updatedAssets.push(existing);
    } else {
      // eslint-disable-next-line no-await-in-loop
      const created = await FileAsset.create({ group: req.group._id, uploadedBy: req.user._id, ...f });
      updatedAssets.push(created);
    }
  }

  if (updatedAssets.length) {
    emitToGroup(req.group._id, "group:file:uploaded", {
      groupId: String(req.group._id),
      files: updatedAssets.map((asset) => ({
        ...asset.toObject(),
        uploadedBy: asset.uploadedBy,
        id: String(asset._id),
      })),
    });
  }

  // Run the AI analysis on the primary artefact.
  const submission = task.submissions[task.submissions.length - 1];
  let submissionPlagiarism = null;
  // STEP 17 — Feature 3
  let submissionCodeReview = null;
  let submissionCodeQualityComparison = null;
  let submissionRelevance = null;
  if (uploaded.length) {
    const primary = uploaded.find((f) => kindOf(f.originalname) === "zip") || uploaded[0];

    if (isZipFile(primary.originalname)) {
      // Step 9 — full project/task-relatedness ZIP analysis pipeline.
      // Step 14 — now also runs duplicate/plagiarism detection alongside it.
      const { result, relevance, plagiarism, plagiarismFingerprint, codeReview, taskStatus } = await analyzeZipSubmission({
        zipFilePath: primary.path,
        originalName: primary.originalname,
        task: {
          _id: task._id,
          title: task.title,
          description: task.description,
          module: task.module,
          projectTitle: task.group?.project || req.group?.project || "",
          projectDescription: task.group?.description || req.group?.description || "",
        },
      });
      // Step 13 §6/§7 — compare against the previous version (if any) BEFORE
      // overwriting anything, since the previous submission's aiAnalysis is
      // the only source of truth for what changed.
      const previousSubmission = task.submissions.length > 1 ? task.submissions[task.submissions.length - 2] : null;
      const improvementSummary = computeImprovementSummary(previousSubmission?.aiAnalysis, result);
      // STEP 17 — Feature 3: same "compare against the previous version"
      // pattern, scoped to the code-quality score only.
      const codeQualityComparison = computeCodeQualityComparison(
        previousSubmission?.aiAnalysis?.codeReview,
        codeReview.score
      );
      submissionRelevance = relevance || result.relevance;
      if (submissionRelevance?.isIrrelevant) {
        submission.irrelevantNotified = true;
      }
      submission.aiAnalysis = {
        // Keep the generic fields populated too so any code (or the
        // existing frontend card) reading the old shape keeps working.
        score: result.progress,
        summary: result.summary,
        issues: result.missingParts,
        recommendations: result.suggestions,
        checks: {},
        analyzedAt: result.analyzedAt,
        engine: result.engine,
        projectRelated: result.projectRelated,
        projectConfidence: result.projectConfidence,
        taskRelated: result.taskRelated,
        implementationStatus: result.implementationStatus,
        progress: result.progress,
        completedParts: result.completedParts,
        missingParts: result.missingParts,
        // Step 13 — additive fields only.
        taskConfidence: result.taskConfidence,
        progressLabel: result.progressLabel,
        criticalIssues: result.criticalIssues,
        positiveFindings: result.positiveFindings,
        improvementSummary,
        // Step 14 — additive, and deliberately kept separate from the
        // project/task correctness judgement above (a correct submission
        // can still carry a plagiarism warning, and vice versa).
        plagiarism,
        // STEP 17 — Feature 3 — additive, also deliberately kept separate
        // from the project/task correctness judgement above.
        codeReview: { ...codeReview, comparison: codeQualityComparison },
        // Safe ZIP Content Relevance Check
        relevance: submissionRelevance,
      };
      submissionPlagiarism = plagiarism;
      submissionCodeReview = codeReview;
      submissionCodeQualityComparison = codeQualityComparison;
      // Internal-only — never sent to the frontend (select: false on the
      // schema path). Used only to compare *future* submissions against
      // this one.
      submission._plagiarismFingerprint = plagiarismFingerprint;
      submission.markModified("_plagiarismFingerprint");
    } else {
      const analysis = await analyseSubmissionFile({
        filePath: primary.path,
        originalName: primary.originalname,
        taskTitle: task.title,
        groupName: task.group?.name,
      });
      submission.aiAnalysis = analysis;
    }

    // Grounded verification of task requirements
    const verification = await verifyTaskRequirements({
      task,
      submission,
      group: req.group,
    });
    submission.verification = verification;

    if (action === "upload_only") {
      // Upload evidence only: keep in_progress (10%), do not auto-complete or set in_review
      if (task.status === "todo" || task.status === "pending" || task.status === "backlog") {
        task.status = "in_progress";
        task.progress = 10;
      }
    } else {
      // Explicit review submission:
      // AI evaluates and assigns task to guide_review for Guide's final approval
      if (verification.status === "FAIL") {
        task.status = "changes_requested";
        task.progress = previousProgress;
        task.completionStatus = verification.completionStatus || "INCOMPLETE";
        task.evidenceQuality = verification.evidenceQuality || "INVALID_EVIDENCE";
        task.missingRequirements = verification.missingItems || [];
        task.completionReason = verification.feedback || "Submission verification failed: requirements not satisfied.";
      } else {
        task.status = "guide_review";
        task.progress = Math.max(previousProgress, verification.progressPercent || 90);
        task.verifiedBy = "AI";
        task.completionStatus = verification.completionStatus || (verification.status === "PASS" ? "COMPLETE" : "PARTIALLY_COMPLETE");
        task.evidenceQuality = verification.evidenceQuality || (verification.status === "PASS" ? "VALID_EVIDENCE" : "PARTIAL_EVIDENCE");
        task.missingRequirements = verification.missingItems || [];
        task.completionReason = verification.feedback || "AI analyzed task submission. Awaiting guide final review and approval.";
      }
    }
    await task.save();
  }

  await notifyUsers([task.group?.guide], {
    title: action === "upload_only" ? "Task evidence uploaded" : "Task submitted for review",
    body: `${req.user.name} ${action === "upload_only" ? "uploaded evidence for" : "submitted"} "${task.title}".`,
    type: "task",
    link: `/guide/groups`,
    group: req.group._id,
    task: task._id,
  });
  await logActivity({
    req,
    group: req.group._id,
    action: "task.submitted",
    summary: `${req.user.name} submitted "${task.title}" (v${version})`,
    meta: { taskId: String(task._id), files: files.map((f) => f.originalName) },
  });

  // Step 14, Feature 11 — plagiarism visibility is primarily for the guide,
  // via the existing notification system only (no new infrastructure), and
  // only for the severities actually worth an interrupt (HIGH/DUPLICATE).
  // Students never get a plagiarism-specific notification — they see the
  // originality result on their own submission feedback panel only.
  if (submissionPlagiarism && (submissionPlagiarism.severity === "HIGH" || submissionPlagiarism.severity === "DUPLICATE")) {
    await notifyUsers([task.group?.guide], {
      title: "Similarity warning on a submission",
      body: `"${task.title}" submitted by ${req.user.name} shows ${submissionPlagiarism.severity === "DUPLICATE" ? "a likely duplicate" : "high similarity"} to another submission (${submissionPlagiarism.similarityScore}%).`,
      type: "task",
      link: `/guide/groups`,
      group: req.group._id,
      task: task._id,
    });
  }

  // STEP 17 — Feature 3 §"NOTIFICATIONS": deliberately narrow — only a
  // newly-detected CRITICAL/HIGH code-quality issue, or a significant
  // score drop between versions, is worth an interrupt. Every LOW/INFO
  // issue is still visible on the submission feedback panel; it just
  // never generates a notification (spec: "Do NOT notify for every
  // low-severity code issue").
  if (submissionCodeReview) {
    const severeIssues = (submissionCodeReview.issues || []).filter((i) => i.severity === "CRITICAL" || i.severity === "HIGH");
    const scoreDropped = submissionCodeQualityComparison?.changeNote === "decreased" && submissionCodeQualityComparison.delta <= -15;
    if (severeIssues.length > 0 || scoreDropped) {
      const reason = severeIssues.length > 0
        ? `${severeIssues.length} ${severeIssues.length === 1 ? "issue" : "issues"} need${severeIssues.length === 1 ? "s" : ""} attention (${severeIssues.map((i) => i.severity).join(", ")})`
        : `code quality dropped ${Math.abs(submissionCodeQualityComparison.delta)} points vs. the previous version`;
      await notifyUsers([task.group?.guide], {
        title: "AI code review flagged an issue",
        body: `"${task.title}" submitted by ${req.user.name}: ${reason}.`,
        type: "task",
        link: `/guide/groups`,
        group: req.group._id,
        task: task._id,
      });
    }
  }

  // Safe ZIP Content Relevance Check — guide and team leader notification on irrelevant submissions.
  // Students see the non-accusatory warning banner on their task panel.
  if (submissionRelevance && submissionRelevance.isIrrelevant) {
    const leaderId = task.group?.leader?._id || task.group?.leader || req.group?.leader?._id || req.group?.leader;
    const guideId = task.group?.guide?._id || task.group?.guide || req.group?.guide?._id || req.group?.guide;
    const recipients = [guideId, leaderId].filter(Boolean);
    await notifyUsers(
      recipients,
      {
        title: "Possible Irrelevant Submission",
        body: `"${task.title}" submitted by ${req.user.name} may not match the assigned task: ${submissionRelevance.reason || "irrelevant archive contents detected."}`,
        type: "review",
        link: `/guide/groups`,
        group: req.group._id,
        task: task._id,
      },
      { exclude: req.user._id }
    );
  }

  // SMART TASK COMPLETION → NEXT TASK FLOW
  // On verified PASS: auto-complete task, advance to next task in group, notify student & guide.
  // On FAIL: retain status with clear missing items feedback.
  if (task.status === "completed") {
    await executeCompletionAndNextTask({
      task,
      submission,
      group: req.group,
      user: req.user,
      isAuto: true,
    });
  } else if (submission.verification?.status === "FAIL") {
    await notifyUsers([task.assignee?._id], {
      title: "Task Requirements Not Met",
      body: `"${task.title}" requires revisions before completion. Missing: ${(submission.verification.missingItems || []).slice(0, 2).join("; ") || "Incomplete requirements"}`,
      type: "task",
      link: "/app/tasks",
      group: req.group._id,
      task: task._id,
    });
  }

  res.status(201).json({ success: true, data: shapeTaskForViewer(task.toJSON(), req) });
});

/** GET /api/groups/:groupId/tasks/:taskId/submissions */
exports.list = asyncHandler(async (req, res) => {
  const task = await Task.findOne({ _id: req.params.taskId, group: req.group._id })
    .populate("submissions.student", "name email avatar")
    .populate("submissions.reviewedBy", "name email avatar")
    .lean();
  if (!task) throw ApiError.notFound("Task not found");
  // STEP 33 — a student must only ever see THEIR OWN submissions for this
  // task (never a previous assignee's, or anyone else's). Guides/team
  // leaders keep seeing the complete history for review + audit purposes.
  const submissions = isPrivilegedViewer(req)
    ? task.submissions || []
    : studentOwnSubmissions(task.submissions, req.user._id);
  res.json({ success: true, data: submissions });
});

/** POST /api/groups/:groupId/tasks/:taskId/submissions/:submissionId/analyze */
exports.reanalyze = asyncHandler(async (req, res) => {
  const task = await loadTask(req);
  // STEP 33 — this endpoint had no authorization check at all: any group
  // member could trigger a re-analysis of ANY submission on ANY task,
  // including one no longer (or never) assigned to them. Restrict it to
  // the same actors who may act on a task's submissions elsewhere in this
  // controller: the task's current assignee, or the guide/team leader.
  const isAssignee = String(task.assignee?._id || task.assignee) === String(req.user._id);
  if (!isAssignee && !req.isGuide && String(req.group.leader) !== String(req.user._id))
    throw ApiError.forbidden("Only the assigned student, guide, or team leader can trigger a re-analysis");
  const submission = task.submissions.id(req.params.submissionId);
  if (!submission) throw ApiError.notFound("Submission not found");
  const first = submission.files?.[0];
  if (!first) throw ApiError.badRequest("This submission has no files to analyse");

  const uploadRoot = path.join(__dirname, "..", "..", process.env.UPLOAD_DIR || "uploads");
  const filePath = path.join(uploadRoot, String(req.group._id), first.name);

  if (isZipFile(first.originalName)) {
    const { result, plagiarism, plagiarismFingerprint, codeReview, taskStatus } = await analyzeZipSubmission({
      zipFilePath: filePath,
      originalName: first.originalName,
      task: { _id: task._id, title: task.title, description: task.description, module: task.module },
    });
    // Step 13 — re-analysis of a given version can also carry an
    // improvement comparison against whatever version precedes it.
    const submissionIndex = task.submissions.findIndex((s) => String(s._id) === String(submission._id));
    const previousSubmission = submissionIndex > 0 ? task.submissions[submissionIndex - 1] : null;
    const improvementSummary = computeImprovementSummary(previousSubmission?.aiAnalysis, result);
    const codeQualityComparison = computeCodeQualityComparison(
      previousSubmission?.aiAnalysis?.codeReview,
      codeReview.score
    );
    submission.aiAnalysis = {
      score: result.progress,
      summary: result.summary,
      issues: result.missingParts,
      recommendations: result.suggestions,
      checks: {},
      analyzedAt: result.analyzedAt,
      engine: result.engine,
      projectRelated: result.projectRelated,
      projectConfidence: result.projectConfidence,
      taskRelated: result.taskRelated,
      implementationStatus: result.implementationStatus,
      progress: result.progress,
      completedParts: result.completedParts,
      missingParts: result.missingParts,
      taskConfidence: result.taskConfidence,
      progressLabel: result.progressLabel,
      criticalIssues: result.criticalIssues,
      positiveFindings: result.positiveFindings,
      improvementSummary,
      // Step 14 — additive.
      plagiarism,
      // STEP 17 — Feature 3 — additive.
      codeReview: { ...codeReview, comparison: codeQualityComparison },
    };
    submission._plagiarismFingerprint = plagiarismFingerprint;
    submission.markModified("_plagiarismFingerprint");
    task.status = taskStatus;
  } else {
    submission.aiAnalysis = await analyseSubmissionFile({
      filePath,
      originalName: first.originalName,
      taskTitle: task.title,
      groupName: task.group?.name,
    });
    task.status = "guide_review";
  }

  const verification = await verifyTaskRequirements({
    task,
    submission,
    group: req.group,
  });
  submission.verification = verification;

  if (verification.status === "FAIL") {
    task.status = "changes_requested";
  } else {
    task.status = "guide_review";
  }
  task.verifiedBy = "AI";
  await task.save();

  res.json({ success: true, data: submission });
});

/** Verdict -> resulting Task.status. Keeps the single source of truth for
 * the three guide decisions (Step 11 §4). */
const STATUS_FOR_VERDICT = {
  approved: "completed",
  changes_requested: "changes_requested",
  rejected: "rejected",
};

/** Verdict -> the exact student-facing notification copy (Step 11 §7). */
const NOTIFICATION_FOR_VERDICT = (taskTitle, feedback) => ({
  approved: {
    title: "Task approved",
    body: `🎉 Your task '${taskTitle}' has been approved and completed by the guide.`,
  },
  changes_requested: {
    title: "Changes requested",
    body: `🔄 Changes requested for '${taskTitle}'. Check your task page for guide feedback.`,
  },
  rejected: {
    title: "Submission rejected",
    body: `❌ Your submission for '${taskTitle}' was rejected. Check the task page for details.`,
  },
});

/**
 * POST /api/groups/:groupId/tasks/:taskId/review
 * Body: { verdict: "approved" | "changes_requested" | "rejected", feedback }
 * Guide (or team leader) decision that closes out — or sends back — the
 * current submission. This is the single endpoint behind all three Step 11
 * guide actions: "✅ Approve & Complete", "🔄 Request Changes", "❌ Reject Submission".
 */
exports.review = asyncHandler(async (req, res) => {
  const task = await loadTask(req);
  // Authorization: only the group's guide (or its team leader) may review —
  // never trust anything from the client beyond req.group, which
  // requireGroupAccess already resolved server-side from the authenticated
  // user + the :groupId in the URL, so this can never be tricked into
  // reviewing a submission that belongs to a different group.
  if (!req.isGuide && String(req.group.leader) !== String(req.user._id))
    throw ApiError.forbidden("Only the guide or team leader can review submissions");

  const verdict = req.body.verdict;
  if (!STATUS_FOR_VERDICT[verdict])
    throw ApiError.badRequest("verdict must be one of: approved, changes_requested, rejected");

  const submission = task.submissions[task.submissions.length - 1];
  if (!submission) throw ApiError.badRequest("Nothing has been submitted yet");

  const feedback = String(req.body.feedback || "").trim();
  // "Request Changes" and "Reject" both require the guide to explain why —
  // an approval needs no comment.
  if (verdict !== "approved" && !feedback)
    throw ApiError.badRequest(
      verdict === "rejected"
        ? "A reason is required to reject a submission"
        : "Feedback is required when requesting changes"
    );

  submission.verdict = verdict;
  submission.guideFeedback = feedback;
  submission.reviewedBy = req.user._id;
  submission.reviewedAt = new Date();
  task.status = STATUS_FOR_VERDICT[verdict];
  task.markModified("submissions");

  if (verdict === "approved") {
    task.status = "completed";
    task.progress = 100;
    task.completionStatus = "COMPLETE";
    task.verifiedBy = req.isGuide ? "GUIDE" : "LEADER";
    task.completedAt = new Date();
    task.completionReason = feedback || `Manually approved and completed by ${req.user?.name || "Guide"}.`;

    // Grounded verification on guide approval
    const existingVerif = submission.verification?.status
      ? submission.verification
      : {
          status: "PASS",
          score: 100,
          confidence: 100,
          requirementsChecked: ["Guide Human Review & Verification"],
          requirementsPassed: ["Approved by Guide"],
          requirementsFailed: [],
          missingItems: [],
          feedback: feedback || "Submission reviewed and approved by guide.",
          autoCompleteEligible: true,
        };
    submission.verification = {
      ...existingVerif,
      status: "PASS",
      completionStatus: "COMPLETE",
      progressPercent: 100,
      handledAt: new Date(),
    };
    task.markModified("submissions");

    await executeCompletionAndNextTask({
      task,
      submission,
      group: req.group,
      user: req.user,
      isAuto: false,
    });
    await task.save();
    await recalcGroupProgress(req.group._id);
  } else if (verdict === "changes_requested") {
    task.status = "changes_requested";
    task.completionStatus = "INCOMPLETE";
    task.completionReason = feedback || "Changes requested by guide.";
    task.markModified("submissions");
    await task.save();
    const notification = NOTIFICATION_FOR_VERDICT(task.title, feedback)[verdict];
    await notifyUsers([task.assignee?._id || task.assignee], {
      title: notification.title,
      body: notification.body,
      type: "task",
      link: "/app/tasks",
      group: req.group._id,
      task: task._id,
    });
    await logActivity({
      req,
      group: req.group._id,
      action: `task.${verdict}`,
      summary: `${task.title} changes requested by ${req.user.name}`,
      audit: true,
    });
    await recalcGroupProgress(req.group._id);
  } else if (verdict === "rejected") {
    task.status = "rejected";
    task.completionStatus = "INCOMPLETE";
    task.completionReason = feedback || "Submission rejected by guide.";
    task.markModified("submissions");
    await task.save();
    const notification = NOTIFICATION_FOR_VERDICT(task.title, feedback)[verdict];
    await notifyUsers([task.assignee?._id || task.assignee], {
      title: notification.title,
      body: notification.body,
      type: "task",
      link: "/app/tasks",
      group: req.group._id,
      task: task._id,
    });
    await logActivity({
      req,
      group: req.group._id,
      action: `task.${verdict}`,
      summary: `${task.title} rejected by ${req.user.name}`,
      audit: true,
    });
    await recalcGroupProgress(req.group._id);
  }

  await task.populate("submissions.reviewedBy", "name email avatar");
  res.json({ success: true, data: shapeTaskForViewer(task.toJSON(), req) });
});

/**
 * POST /api/groups/:groupId/tasks/:taskId/submissions/:submissionId/verify
 * Explicit grounded verification endpoint for a submission.
 */
exports.verifySubmission = asyncHandler(async (req, res) => {
  const task = await loadTask(req);
  const isAssignee = String(task.assignee?._id || task.assignee) === String(req.user._id);
  if (!isAssignee && !req.isGuide && String(req.group.leader) !== String(req.user._id)) {
    throw ApiError.forbidden("Only the assignee, guide, or group leader can verify submissions");
  }

  const submission = task.submissions.id(req.params.submissionId);
  if (!submission) throw ApiError.notFound("Submission not found");

  const verification = await verifyTaskRequirements({
    task,
    submission,
    group: req.group,
  });
  submission.verification = verification;

  const autoRun = req.body?.autoRun !== false;
  let nextTaskResult = null;
  if (autoRun && verification.status === "PASS" && verification.autoCompleteEligible) {
    const outcome = await executeCompletionAndNextTask({
      task,
      submission,
      group: req.group,
      user: req.user,
      isAuto: true,
    });
    nextTaskResult = outcome.nextResult;
  } else {
    if (verification.status === "FAIL") {
      task.status = "changes_requested";
    }
    await task.save();
  }

  res.json({
    success: true,
    data: {
      verification,
      task: shapeTaskForViewer(task.toJSON(), req),
      nextTask: nextTaskResult?.task || task.nextTask || null,
    },
  });
});

/**
 * GET /api/groups/:groupId/tasks/:taskId/next-task
 * Returns next recommended or dependency-ready task for the current student.
 */
exports.getNextTask = asyncHandler(async (req, res) => {
  const task = await loadTask(req);
  const studentId = req.query.studentId || task.assignee?._id || task.assignee || req.user._id;

  const result = await findNextTaskForStudent({
    group: req.group,
    studentId,
    completedTaskId: task._id,
  });

  res.json({
    success: true,
    data: result,
  });
});

