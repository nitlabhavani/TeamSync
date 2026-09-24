/**
 * Step 15 — AI Team Risk & Early Warning System endpoints.
 *
 * Additive: does not touch analyticsController.js or the existing
 * /groups/:groupId/risk (old risk radar) routes. requireGroupAccess has
 * already verified the caller is a member/guide/admin of req.group before
 * any of these run (see routes/index.js + middleware/auth.js), so
 * cross-group access is impossible here.
 */
const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/apiError");
const TeamRiskSnapshot = require("../models/TeamRiskSnapshot");
const { analyzeGroupRisk } = require("../services/teamRiskAnalyzer");

/** Strips anything about OTHER students before a student sees the response
 * (Feature 13/17 — a student may only see their own actionable status). */
function shapeForStudent(result, userId) {
  const mine = (result.studentRisks || []).find((s) => String(s.studentId) === String(userId)) || {
    studentId: String(userId),
    riskScore: 0,
    riskLevel: "ON_TRACK",
    reasons: ["No tasks are currently assigned."],
    overdueTasks: 0,
    pendingSubmissions: 0,
    changesRequested: 0,
    recommendations: [],
  };
  // STEP 16 — same "own data only" rule applied to the new proactive
  // evidence: a student never sees another student's deadline/collaboration
  // signals, only their own assigned tasks' early warnings and their own
  // collaboration status.
  const myEarlyWarnings = (result.earlyWarnings || []).filter(
    (w) => w.assignee && String(w.assignee.id) === String(userId)
  );
  const myCollaboration =
    (result.collaborationRisks || []).find((c) => String(c.studentId) === String(userId)) || null;

  return {
    myRisk: mine,
    myEarlyWarnings,
    myCollaboration,
    team: {
      riskLevel: result.riskLevel,
      riskTrend: result.riskTrend,
      trendMessage: result.trendMessage,
    },
  };
}

/** GET /groups/:groupId/ai-risk */
exports.teamRisk = asyncHandler(async (req, res) => {
  const result = await analyzeGroupRisk(req.group, { persist: true });

  if (!req.isGuide) {
    return res.json({ success: true, data: shapeForStudent(result, req.user._id) });
  }

  // Guide/admin — full picture, but riskyTasks/warnings never include raw
  // submission file contents or plagiarism source material (Feature 17).
  res.json({ success: true, data: result });
});

/** GET /groups/:groupId/ai-risk/history — guide/admin only. */
exports.teamRiskHistory = asyncHandler(async (req, res) => {
  if (!req.isGuide) throw ApiError.forbidden("Only the guide can view team risk history");
  const items = await TeamRiskSnapshot.find({ group: req.group._id }).sort("-createdAt").limit(30);
  res.json({ success: true, data: items });
});
