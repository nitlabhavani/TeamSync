const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/apiError");
const ReviewRound = require("../models/ReviewRound");
const PeerReview = require("../models/PeerReview");
const Badge = require("../models/Badge");
const { BADGE_CATALOG, recomputeBadges, buildLeaderboard } = require("../services/badgeService");

exports.listRounds = asyncHandler(async (req, res) => {
  const rounds = await ReviewRound.find({ group: req.group._id }).sort("-createdAt");
  res.json({ success: true, data: rounds });
});

exports.createRound = asyncHandler(async (req, res) => {
  const round = await ReviewRound.create({ ...req.body, group: req.group._id });
  res.status(201).json({ success: true, data: round });
});

exports.closeRound = asyncHandler(async (req, res) => {
  if (!req.isGuide) throw ApiError.forbidden("Only the guide can close a review round");
  const round = await ReviewRound.findOneAndUpdate(
    { _id: req.params.roundId, group: req.group._id },
    { status: "closed" },
    { new: true }
  );
  if (!round) throw ApiError.notFound("Round not found");
  await recomputeBadges(req.group);
  res.json({ success: true, data: round });
});

/** Submit (or update) a peer review for one teammate. */
exports.submit = asyncHandler(async (req, res) => {
  const round = await ReviewRound.findOne({ _id: req.params.roundId, group: req.group._id });
  if (!round) throw ApiError.notFound("Round not found");
  if (round.status === "closed") throw ApiError.badRequest("This review round is closed");

  const { reviewee, scores, comment = "" } = req.body;
  if (String(reviewee) === String(req.user._id))
    throw ApiError.badRequest("You cannot review yourself");
  if (!req.group.members.some((m) => String(m) === String(reviewee)))
    throw ApiError.badRequest("Reviewee is not in this group");

  const review = await PeerReview.findOneAndUpdate(
    { round: round._id, reviewer: req.user._id, reviewee },
    { round: round._id, group: req.group._id, reviewer: req.user._id, reviewee, scores, comment },
    { upsert: true, new: true, setDefaultsOnInsert: true, runValidators: true }
  );

  await recomputeBadges(req.group);
  res.status(201).json({ success: true, data: review });
});

/** Reviews the caller has already submitted for a round. */
exports.myReviews = asyncHandler(async (req, res) => {
  const reviews = await PeerReview.find({ round: req.params.roundId, reviewer: req.user._id })
    .populate("reviewee", "name color avatar");
  res.json({ success: true, data: reviews });
});

/** Anonymous aggregate of reviews received (guides see everything). */
exports.received = asyncHandler(async (req, res) => {
  const userId = req.params.userId === "me" ? req.user._id : req.params.userId;
  if (!req.isGuide && String(userId) !== String(req.user._id))
    throw ApiError.forbidden("You can only read your own feedback");

  const reviews = await PeerReview.find({ group: req.group._id, reviewee: userId }).lean();
  const fields = ["contribution", "communication", "reliability", "helpfulness"];
  const averages = fields.reduce((acc, f) => {
    acc[f] = reviews.length
      ? Number((reviews.reduce((s, r) => s + r.scores[f], 0) / reviews.length).toFixed(2))
      : 0;
    return acc;
  }, {});

  res.json({
    success: true,
    data: {
      count: reviews.length,
      averages,
      overall: Number(
        (fields.reduce((s, f) => s + averages[f], 0) / fields.length).toFixed(2)
      ),
      // Comments stay anonymous for students.
      comments: reviews
        .filter((r) => r.comment)
        .map((r) => (req.isGuide ? { comment: r.comment, reviewer: r.reviewer } : { comment: r.comment })),
    },
  });
});

exports.leaderboard = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await buildLeaderboard(req.group) });
});

exports.badges = asyncHandler(async (req, res) => {
  const badges = await Badge.find({ group: req.group._id }).populate("user", "name color avatar");
  res.json({ success: true, data: { catalog: BADGE_CATALOG, awarded: badges } });
});
