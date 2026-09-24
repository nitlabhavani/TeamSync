const router = require("express").Router();
const { protect, requireRole, requireGroupAccess } = require("../middleware/auth");
const upload = require("../middleware/upload");
const directUpload = require("../middleware/directUpload");
const directVoiceUpload = require("../middleware/directVoiceUpload");
const directMediaUpload = require("../middleware/directMediaUpload");
const { statusMediaUpload } = require("../middleware/statusMediaUpload");
const profileUpload = require("../middleware/profileUpload");
const validateDirectPeer = require("../middleware/validateDirectPeer");

const auth = require("../controllers/authController");
const users = require("../controllers/userController");
const groups = require("../controllers/groupController");
const tasks = require("../controllers/taskController");
const meetings = require("../controllers/meetingController");
const calendar = require("../controllers/calendarController");
const meetingIntelligence = require("../controllers/meetingIntelligenceController");
const reviews = require("../controllers/reviewController");
const chat = require("../controllers/chatController");
const calls = require("../controllers/callController");
const files = require("../controllers/fileController");
const notifications = require("../controllers/notificationController");
const analytics = require("../controllers/analyticsController");
const search = require("../controllers/searchController");
const learningSearch = require("../controllers/learningSearchController");
const statusUpdates = require("../controllers/statusUpdateController");
const communities = require("../controllers/communityController");
const ai = require("../controllers/aiController");
const invitations = require("../controllers/invitationController");
const submissions = require("../controllers/submissionController");
const reports = require("../controllers/reportController");
const activity = require("../controllers/activityController");
const teamRisk = require("../controllers/teamRiskController");
const projectForecast = require("../controllers/projectForecastController");
const projectHealth = require("../controllers/projectHealthController");
const executionCopilot = require("../controllers/projectExecutionCopilotController");
const teamPerformance = require("../controllers/teamPerformanceController");
const sprintPlanner = require("../controllers/sprintPlannerController");
const conflicts = require("../controllers/conflictController");
const whatIf = require("../controllers/projectWhatIfController");
const projectKnowledge = require("../controllers/projectKnowledgeController");
const projectMemoryAssistant = require("../controllers/projectMemoryAssistantController");
const actionableInsights = require("../controllers/actionableInsightsController");
const { optionalAuth } = require("../middleware/auth");

/* ---------------- Auth ---------------- */
router.post("/auth/signup", auth.signup);                 // step 1 — emails a 6-digit OTP
router.post("/auth/verify-otp", auth.verifyOtp);          // step 2 — creates the account
router.post("/auth/resend-otp", auth.resendOtp);
router.post("/auth/cancel-signup", auth.cancelSignup);
router.post("/auth/login", auth.login);
router.post("/auth/forgot-password", auth.forgotPassword);
router.post("/auth/reset-password", auth.resetPassword);
router.post("/auth/refresh", auth.refresh);
router.get("/auth/me", protect, auth.me);
router.post("/auth/logout", protect, auth.logout);

/* -------- Invitation / Join flow -------- */
router.get("/invitations/:token", optionalAuth, invitations.getByToken);
router.post("/invitations/:token/accept", protect, invitations.accept);
router.post("/invitations/:token/reject", optionalAuth, invitations.reject);
router.post("/invitations/:token/verify-otp", optionalAuth, invitations.verify);
router.post("/invitations/:token/resend-otp", invitations.resend);

/* ---------------- Users ---------------- */
router.get("/users", protect, users.list);
router.get("/users/me/profile", protect, users.myProfile);
router.patch("/users/me", protect, users.updateMe);
router.post("/users/me/avatar", protect, profileUpload.avatar.single("file"), users.uploadAvatar);
router.post("/users/me/resume", protect, profileUpload.resume.single("file"), users.uploadResume);
router.delete("/users/me/resume", protect, users.deleteResume);
router.post("/users/me/certificates", protect, profileUpload.certificate.single("file"), users.uploadCertificate);
router.delete("/users/me/certificates/:certId", protect, users.deleteCertificate);
router.patch("/users/me/settings", protect, users.updateSettings);
router.post("/users/me/password", protect, users.changePassword);
router.get("/users/:id", protect, users.getOne);
router.get("/users/:id/performance", protect, users.performance);
router.get("/users/:id/performance/trend", protect, users.performanceTrend);
router.delete("/users/:id", protect, requireRole("admin", "guide"), users.deactivate);

/* ---------------- Groups ---------------- */
router.get("/groups", protect, groups.list);
router.post("/groups", protect, requireRole("guide", "admin"), groups.create); // guide-only
router.post("/groups/join", protect, groups.join);
router.get("/groups/:groupId", protect, requireGroupAccess, groups.getOne);
router.patch("/groups/:groupId", protect, requireGroupAccess, groups.update);
router.delete("/groups/:groupId", protect, requireGroupAccess, groups.remove);
router.post("/groups/:groupId/members", protect, requireGroupAccess, groups.addMember);
router.post("/groups/:groupId/invitations", protect, requireGroupAccess, groups.inviteMembers);
router.get("/groups/:groupId/invitations", protect, requireGroupAccess, groups.listInvitations);
router.post("/groups/:groupId/invitations/:invitationId/resend", protect, requireGroupAccess, groups.resendInvitation);
router.delete("/groups/:groupId/invitations/:invitationId", protect, requireGroupAccess, groups.cancelInvitation);
router.delete("/groups/:groupId/members/:userId", protect, requireGroupAccess, groups.removeMember);
router.post("/groups/:groupId/leader", protect, requireGroupAccess, groups.setLeader);
router.post("/groups/:groupId/recalc-progress", protect, requireGroupAccess, groups.recalcProgress);
router.post("/groups/:groupId/ai/auto-plan-tasks", protect, requireGroupAccess, groups.autoPlanTasks);

/* --------------- Milestones --------------- */
router.get("/groups/:groupId/milestones", protect, requireGroupAccess, groups.listMilestones);
router.post("/groups/:groupId/milestones", protect, requireGroupAccess, groups.createMilestone);
router.patch("/groups/:groupId/milestones/:milestoneId", protect, requireGroupAccess, groups.updateMilestone);
router.delete("/groups/:groupId/milestones/:milestoneId", protect, requireGroupAccess, groups.deleteMilestone);

/* ---------------- Tasks (Kanban) ---------------- */
router.get("/groups/:groupId/tasks", protect, requireGroupAccess, tasks.list);
router.get("/groups/:groupId/tasks/board", protect, requireGroupAccess, tasks.board);
router.get("/groups/:groupId/tasks/stats", protect, requireGroupAccess, tasks.stats);
router.get("/groups/:groupId/tasks/workload", protect, requireGroupAccess, tasks.workload);
router.get("/groups/:groupId/tasks/:taskId/ai-assignment", protect, requireGroupAccess, tasks.recommendAssignment);
router.post("/groups/:groupId/tasks/ai-assignment", protect, requireGroupAccess, tasks.recommendAssignmentDraft);
router.post("/groups/:groupId/tasks/ai-expand", protect, requireGroupAccess, tasks.expandTask);
// STEP 18 — AI Task Intelligence / Smart Planning.
router.post("/groups/:groupId/tasks/ai-plan", protect, requireGroupAccess, tasks.generateTaskPlan);
router.get("/groups/:groupId/tasks/:taskId/ai-plan", protect, requireGroupAccess, tasks.generateTaskPlanForTask);
router.post("/groups/:groupId/tasks/:taskId/ai-plan/apply", protect, requireGroupAccess, tasks.applyTaskPlan);
router.post("/groups/:groupId/tasks/ai-preview", protect, requireGroupAccess, tasks.previewTask);
router.post("/groups/:groupId/tasks", protect, requireGroupAccess, tasks.create);
router.patch("/groups/:groupId/tasks/:taskId", protect, requireGroupAccess, tasks.update);
router.patch("/groups/:groupId/tasks/:taskId/move", protect, requireGroupAccess, tasks.move);
router.delete("/groups/:groupId/tasks/:taskId", protect, requireGroupAccess, tasks.remove);

/* --------- Task submissions & AI review workflow --------- */
router.get("/groups/:groupId/tasks/:taskId/submissions", protect, requireGroupAccess, submissions.list);
router.post("/groups/:groupId/tasks/:taskId/submit", protect, requireGroupAccess, upload.array("files", 10), submissions.submit);
router.post("/groups/:groupId/tasks/:taskId/submissions/:submissionId/analyze", protect, requireGroupAccess, submissions.reanalyze);
router.post("/groups/:groupId/tasks/:taskId/submissions/:submissionId/verify", protect, requireGroupAccess, submissions.verifySubmission);
router.post("/groups/:groupId/tasks/:taskId/review", protect, requireGroupAccess, submissions.review);
router.get("/groups/:groupId/tasks/:taskId/next-task", protect, requireGroupAccess, submissions.getNextTask);

/* ---------------- Meetings & smart notes ---------------- */
router.get("/groups/:groupId/meetings", protect, requireGroupAccess, meetings.list);
router.post("/groups/:groupId/meetings", protect, requireGroupAccess, meetings.create);
router.get("/groups/:groupId/meetings/:meetingId", protect, requireGroupAccess, meetings.getOne);
router.patch("/groups/:groupId/meetings/:meetingId", protect, requireGroupAccess, meetings.update);
router.delete("/groups/:groupId/meetings/:meetingId", protect, requireGroupAccess, meetings.remove);
router.post("/groups/:groupId/meetings/:meetingId/summary", protect, requireGroupAccess, meetings.generateSummary);
router.post("/groups/:groupId/meetings/:meetingId/convert-actions", protect, requireGroupAccess, meetings.convertActionItems);
// STEP 16 — Feature 1: ad-hoc meeting-notes action-item extraction (no saved Meeting required).
router.post("/groups/:groupId/meeting-action-items", protect, requireGroupAccess, meetings.extractActionItems);

// CALENDAR — additive, read-only aggregation of existing Task/Meeting/
// SprintPlan/Milestone/project-deadline data for this group. See
// calendarController.js for the full authorization/privacy rationale.
router.get("/groups/:groupId/calendar", protect, requireGroupAccess, calendar.getEvents);

// STEP 26 — AI Meeting Intelligence. Extends Step 16's meeting/chat action-item
// extraction into full structured intelligence (summary, decisions, blockers,
// unresolved items, outcome). Read-only over Message/Task/Meeting/ConflictSnapshot
// plus its own MeetingIntelligenceSnapshot persistence — see
// services/meetingIntelligenceService.js and controllers/meetingIntelligenceController.js.
router.post(
  "/groups/:groupId/meeting-intelligence/analyze",
  protect,
  requireGroupAccess,
  meetingIntelligence.analyze
);
router.get("/groups/:groupId/meeting-intelligence", protect, requireGroupAccess, meetingIntelligence.list);
router.get("/groups/:groupId/meeting-intelligence/:id", protect, requireGroupAccess, meetingIntelligence.getOne);

/* ---------------- Peer review & badges ---------------- */
router.get("/groups/:groupId/review-rounds", protect, requireGroupAccess, reviews.listRounds);
router.post("/groups/:groupId/review-rounds", protect, requireGroupAccess, reviews.createRound);
router.post("/groups/:groupId/review-rounds/:roundId/close", protect, requireGroupAccess, reviews.closeRound);
router.post("/groups/:groupId/review-rounds/:roundId/reviews", protect, requireGroupAccess, reviews.submit);
router.get("/groups/:groupId/review-rounds/:roundId/mine", protect, requireGroupAccess, reviews.myReviews);
router.get("/groups/:groupId/reviews/received/:userId", protect, requireGroupAccess, reviews.received);
router.get("/groups/:groupId/leaderboard", protect, requireGroupAccess, reviews.leaderboard);
router.get("/groups/:groupId/badges", protect, requireGroupAccess, reviews.badges);

/* ---------------- Chat ---------------- */
router.get("/groups/:groupId/messages", protect, requireGroupAccess, chat.groupMessages);
router.post("/groups/:groupId/messages", protect, requireGroupAccess, chat.sendGroupMessage);
router.get("/groups/:groupId/messages/summary", protect, requireGroupAccess, chat.summarize);
router.post("/groups/:groupId/messages/read", protect, requireGroupAccess, chat.markGroupRead);
router.get("/chat/conversations", protect, chat.conversations);
router.get("/chat/direct/:userId", protect, validateDirectPeer, chat.directMessages);
router.post("/chat/direct/:userId", protect, validateDirectPeer, chat.sendDirectMessage);
router.post("/chat/direct/:userId/read", protect, validateDirectPeer, chat.markDirectRead);
router.delete("/chat/messages/:messageId", protect, chat.remove);

/* -------- Private chat file sharing --------
 * Protected with validateDirectPeer and conversationKey isolation. */
router.post("/chat/direct/:userId/files", protect, validateDirectPeer, directUpload.any(), chat.uploadDirectFile);
router.get("/chat/direct/:userId/files/:filename/download", protect, validateDirectPeer, chat.downloadDirectFile);

/* -------- Private chat media sharing (Photos & Videos) --------
 * Protected with validateDirectPeer on upload, and protect on streaming. */
router.post("/chat/direct/:userId/media", protect, validateDirectPeer, directMediaUpload.single("media"), chat.uploadDirectMedia);
router.get("/chat/direct/:userId/media/:filename", protect, chat.streamDirectMedia);

/* -------- Private chat voice messages (PRIVATE CHAT ONLY) --------
 * Deliberately no group-scoped equivalent exists anywhere in this router —
 * that absence is itself the enforcement: there is no
 * "/groups/:groupId/voice" route for a malicious client to call, so group
 * voice recording/messages are impossible at the API layer, not just
 * hidden in the UI. Explicitly protected with validateDirectPeer. */
router.post("/chat/direct/:userId/voice", protect, validateDirectPeer, directVoiceUpload.single("audio"), chat.uploadDirectVoice);
router.get("/chat/direct/:userId/voice/:filename", protect, chat.streamDirectVoice);

/* -------- Private voice/video calling --------
 * Metadata-only call history for a private conversation. Actual call
 * signaling happens over the existing authenticated socket connection (see
 * sockets/callSignaling.js) — there is no REST endpoint to place or answer
 * a call, and deliberately no group-call equivalent anywhere in this file.
 */
router.get("/calls/history", protect, calls.myCallHistory);
router.get("/calls/history/:userId", protect, validateDirectPeer, calls.privateCallHistory);

/* ---------------- Files ---------------- */
router.get("/groups/:groupId/files", protect, requireGroupAccess, files.list);
router.post("/groups/:groupId/files", protect, requireGroupAccess, upload.any(), files.upload);
router.get("/groups/:groupId/files/:fileId/download", protect, requireGroupAccess, files.download);
router.delete("/groups/:groupId/files/:fileId", protect, requireGroupAccess, files.remove);

/* ---------------- Notifications ---------------- */
router.get("/notifications", protect, notifications.list);
router.post("/notifications/read-all", protect, notifications.markAllRead);
router.post("/notifications/:id/read", protect, notifications.markRead);
router.delete("/notifications/:id", protect, notifications.remove);

/* ---------------- Search (groups / members / files / messages) ---------------- */
router.get("/search", protect, search.search);

/* ---------------- Learning Search Engine (Ask & Learn / Educational Search) ----------------
 * Authenticated proxy for technical & learning queries. Never stores query in group analytics
 * or leaks private chat / files / project data. */
router.post("/search/learning", protect, learningSearch.search);
router.get("/search/learning", protect, learningSearch.search);

/* ---------------- Status Updates (WhatsApp Updates / Stories) ---------------- */
router.get("/updates", protect, statusUpdates.list);
router.post("/updates", protect, statusMediaUpload.single("media"), statusUpdates.create);
router.post("/updates/:id/view", protect, statusUpdates.recordView);
router.get("/updates/:id/viewers", protect, statusUpdates.getViewers);
router.get("/updates/media/:filename", protect, statusUpdates.streamMedia);
router.delete("/updates/:id", protect, statusUpdates.remove);

/* ---------------- Communities (WhatsApp Communities) ---------------- */
router.get("/communities", protect, communities.list);
router.post("/communities", protect, communities.create);
router.get("/communities/:id", protect, communities.getOne);
router.post("/communities/:id/groups", protect, communities.addGroup);
router.delete("/communities/:id/groups/:groupId", protect, communities.removeGroup);
router.post("/communities/:id/announcements", protect, communities.postAnnouncement);
router.delete("/communities/:id/announcements/:announcementId", protect, communities.deleteAnnouncement);

/* ---------------- AI analytics & risk radar ---------------- */
router.get("/groups/:groupId/ai/insights", protect, requireGroupAccess, ai.groupInsights);
router.get("/ai/risk-radar", protect, analytics.radar);
router.get("/ai/timeline", protect, analytics.timeline);
router.get("/ai/guide-overview", protect, requireRole("guide", "admin"), analytics.guideOverview);
router.get("/groups/:groupId/risk", protect, requireGroupAccess, analytics.groupRisk);
router.get("/groups/:groupId/risk/history", protect, requireGroupAccess, analytics.riskHistory);
router.get("/groups/:groupId/analytics", protect, requireGroupAccess, analytics.groupAnalytics);

/* ------------- Step 15 — AI Team Risk & Early Warning System -------------
 * Additive: separate from the existing /groups/:groupId/risk (old radar)
 * routes above, which are untouched. */
router.get("/groups/:groupId/ai-risk", protect, requireGroupAccess, teamRisk.teamRisk);
router.get("/groups/:groupId/ai-risk/history", protect, requireGroupAccess, teamRisk.teamRiskHistory);

// STEP 19 — AI Project Progress Forecast & Early Intervention System.
// requireGroupAccess already restricts these to members/guide/admin of
// req.group; guide-vs-student shaping happens inside the controller.
router.get("/groups/:groupId/project-forecast", protect, requireGroupAccess, projectForecast.getForecast);
router.get(
  "/groups/:groupId/intervention-recommendations",
  protect,
  requireGroupAccess,
  projectForecast.getRecommendations
);
router.get(
  "/groups/:groupId/project-forecast/history",
  protect,
  requireGroupAccess,
  projectForecast.getForecastHistory
);

// STEP 20 — AI Project Health Command Center (aggregation/orchestration
// layer only — see services/projectHealthService.js). Guide/leader-only;
// students continue to use the existing /project-forecast `myProgress`
// shape (Feature 7/10 — no duplicate student endpoint).
router.get("/groups/:groupId/project-health", protect, requireGroupAccess, projectHealth.getHealth);
router.get(
  "/groups/:groupId/project-health/history",
  protect,
  requireGroupAccess,
  projectHealth.getHealthHistory
);

// STEP 21 — AI Project Execution Copilot (aggregation/orchestration layer
// only — see services/projectExecutionCopilotService.js). Guide/leader-only;
// requireGroupAccess restricts to members/guide/admin of req.group, and the
// controller itself forbids normal students (Feature 12 — Privacy).
router.get("/groups/:groupId/execution-copilot", protect, requireGroupAccess, executionCopilot.getCopilot);
router.get(
  "/groups/:groupId/execution-copilot/history",
  protect,
  requireGroupAccess,
  executionCopilot.getCopilotHistory
);

// STEP 22 — AI Team Performance Insights (aggregation layer only — see
// services/teamPerformanceService.js). requireGroupAccess restricts to
// members/guide/admin of req.group; the controller shapes the response
// per-role (full for guide/leader, own-data-only for a normal student —
// Feature 10 — Privacy), mirroring teamRiskController.js.
router.get("/groups/:groupId/team-performance", protect, requireGroupAccess, teamPerformance.getTeamPerformance);
router.get(
  "/groups/:groupId/team-performance/history",
  protect,
  requireGroupAccess,
  teamPerformance.getTeamPerformanceHistory
);

// STEP 23 — AI Sprint Planner. Reuses existing evidence (team risk, project
// health/forecast, execution copilot) instead of duplicating any scoring —
// see services/sprintPlannerService.js. Preview NEVER mutates a task; only
// the explicit apply route does, and only after re-validating the plan
// isn't stale. Same guide/team-leader authorization as AI task plans
// (services/smartTaskAssignmentService.canRequestRecommendation).
router.post("/groups/:groupId/sprint-planner/preview", protect, requireGroupAccess, sprintPlanner.preview);
router.get("/groups/:groupId/sprint-planner/history", protect, requireGroupAccess, sprintPlanner.history);
router.get("/groups/:groupId/sprint-planner/current", protect, requireGroupAccess, sprintPlanner.current);
router.get("/groups/:groupId/sprint-planner/:planId", protect, requireGroupAccess, sprintPlanner.getOne);
router.post("/groups/:groupId/sprint-planner/:planId/apply", protect, requireGroupAccess, sprintPlanner.apply);
router.post("/groups/:groupId/sprint-planner/:planId/cancel", protect, requireGroupAccess, sprintPlanner.cancel);

// STEP 24 — AI Conflict Detection & Resolution. Analysis itself is
// triggered fire-and-forget from chatController.sendGroupMessage (see
// conflictDetectionService.analyzeGroupMessageForConflicts) — these routes
// only ever read/transition already-persisted ConflictSnapshot records.
// Same guide/team-leader authorization as Sprint Planner; students get a
// student-safe, involvement-only view (see conflictController.js).
router.get("/groups/:groupId/conflicts", protect, requireGroupAccess, conflicts.list);
router.get("/groups/:groupId/conflicts/:conflictId", protect, requireGroupAccess, conflicts.getOne);
router.post("/groups/:groupId/conflicts/:conflictId/acknowledge", protect, requireGroupAccess, conflicts.acknowledge);
router.post("/groups/:groupId/conflicts/:conflictId/resolve", protect, requireGroupAccess, conflicts.resolve);
router.post("/groups/:groupId/conflicts/:conflictId/dismiss", protect, requireGroupAccess, conflicts.dismiss);

/* -------- AI Project Knowledge & Decision Memory (Step 27) --------
 * requireGroupAccess restricts to members/guide/admin of req.group; the
 * controller further restricts extraction/confirm/archive/supersede to
 * guide/team-leader (see projectKnowledgeController.js), and shapes list/
 * detail reads for a plain student (spec Phase 27/31). */
router.get("/groups/:groupId/knowledge", protect, requireGroupAccess, projectKnowledge.list);
router.post("/groups/:groupId/knowledge", protect, requireGroupAccess, projectKnowledge.createManual);
router.get("/groups/:groupId/knowledge/:knowledgeId", protect, requireGroupAccess, projectKnowledge.getOne);
router.post("/groups/:groupId/knowledge/extract", protect, requireGroupAccess, projectKnowledge.extractFromMessages);
router.post(
  "/groups/:groupId/knowledge/from-meeting-intelligence/:snapshotId",
  protect,
  requireGroupAccess,
  projectKnowledge.extractFromMeetingIntelligence
);
router.post("/groups/:groupId/knowledge/:knowledgeId/confirm", protect, requireGroupAccess, projectKnowledge.confirm);
router.post("/groups/:groupId/knowledge/:knowledgeId/archive", protect, requireGroupAccess, projectKnowledge.archive);
router.post(
  "/groups/:groupId/knowledge/:knowledgeId/mark-superseded",
  protect,
  requireGroupAccess,
  projectKnowledge.markSuperseded
);

/* -------- AI Project Memory Assistant / Contextual Project Q&A (Step 28) --------
 * requireGroupAccess restricts to members/guide/admin of req.group.
 * projectMemoryAssistantController further shapes the answer for a plain
 * student (no guide-only data, no private chat — see
 * projectMemoryAssistantService.js). Ephemeral: nothing about the question
 * is persisted. */
router.post(
  "/groups/:groupId/ai/project-memory/ask",
  protect,
  requireGroupAccess,
  projectMemoryAssistant.ask
);

/* -------- AI Actionable Project Insights & Recommendation Engine (Step 29) --------
 * requireGroupAccess restricts to members/guide/admin of req.group; the
 * controller further shapes the recommendation set for a plain student
 * (own overdue/blocked tasks + involved conflicts only — no guide-only
 * risk/health/forecast/execution/sprint/meeting/knowledge data — see
 * actionableInsightsController.js / actionableInsightsService.js).
 * Read-only: never persists a new snapshot, never mutates a task,
 * conflict, knowledge, meeting, or sprint record. */
router.post(
  "/groups/:groupId/ai/actionable-insights",
  protect,
  requireGroupAccess,
  actionableInsights.getActionableInsights
);

// STEP 25 — AI Project What-If Simulator. Read-only orchestration over the
// EXISTING Team Risk / Forecast / Health / Sprint / Conflict formulas — see
// services/projectWhatIfSimulatorService.js. Never mutates a task/group;
// only the guide or team leader can use it (same canRequestRecommendation
// helper as Sprint Planner/Conflicts — see controllers/projectWhatIfController.js).
router.get("/groups/:groupId/what-if/capabilities", protect, requireGroupAccess, whatIf.capabilities);
router.post("/groups/:groupId/what-if/simulate", protect, requireGroupAccess, whatIf.simulate);
router.post("/groups/:groupId/what-if/compare", protect, requireGroupAccess, whatIf.compare);

/* ------------- AI reports, performance & recommendations ------------- */
router.get("/guide/dashboard", protect, requireRole("guide", "admin"), reports.guideDashboard);
router.get("/ai/guide-report", protect, requireRole("guide", "admin"), reports.guideReport);
router.get("/ai/engine-status", protect, reports.engineStatus);
router.get("/groups/:groupId/ai-summary", protect, requireGroupAccess, reports.groupAiSummary);
router.get("/groups/:groupId/ai/report", protect, requireGroupAccess, reports.groupReport);
router.get("/groups/:groupId/ai/report/history", protect, requireGroupAccess, reports.reportHistory);
router.get("/groups/:groupId/ai/report/export", protect, requireGroupAccess, reports.exportReport);
router.get("/groups/:groupId/ai/report/:period", protect, requireGroupAccess, reports.periodReport);
router.get("/groups/:groupId/ai/performance", protect, requireGroupAccess, reports.performance);
router.get("/groups/:groupId/ai/recommendations", protect, requireGroupAccess, reports.recommendations);
router.get("/groups/:groupId/ai/prediction", protect, requireGroupAccess, reports.prediction);
// STEP 3 — student work analysis, AI score, performance/completion prediction,
// group-chat analysis, file evidence, warnings and recommendations.
router.get("/groups/:groupId/ai/project-performance", protect, requireGroupAccess, reports.projectPerformance);
// STEP 1 of project-planning AI — read-only, does not create Task documents (see reportController.projectPlan).
router.post("/groups/:groupId/ai/project-plan", protect, requireGroupAccess, reports.projectPlan);
// STEP 2 — guide-reviewed plan -> real Task documents (see reportController.createProjectPlanTasks).
router.post(
  "/groups/:groupId/ai/project-plan/create-tasks",
  protect,
  requireGroupAccess,
  reports.createProjectPlanTasks
);

/* ---------------- Activity & audit log ---------------- */
router.get("/groups/:groupId/activity", protect, requireGroupAccess, activity.groupActivity);
router.get("/activity/audit", protect, requireRole("guide", "admin"), activity.auditTrail);

module.exports = router;
