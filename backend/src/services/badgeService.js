const Badge = require("../models/Badge");
const Task = require("../models/Task");
const PeerReview = require("../models/PeerReview");
const Message = require("../models/Message");

const BADGE_CATALOG = [
  { key: "reliable", label: "Reliable", icon: "shield-check", description: "Consistently high reliability scores from peers" },
  { key: "unblocker", label: "Unblocker", icon: "key", description: "Helps teammates get past blockers" },
  { key: "communicator", label: "Communicator", icon: "message-circle", description: "Keeps the team informed" },
  { key: "finisher", label: "Finisher", icon: "check-circle", description: "Ships tasks on time" },
  { key: "mentor", label: "Mentor", icon: "graduation-cap", description: "Top helpfulness rating in the group" },
];

/** Recomputes and awards badges for every member of a group. */
async function recomputeBadges(group) {
  const memberIds = group.members.map(String);
  const [tasks, reviews, messages] = await Promise.all([
    Task.find({ group: group._id }).lean(),
    PeerReview.find({ group: group._id }).lean(),
    Message.find({ group: group._id }).select("sender").lean(),
  ]);

  const awarded = [];

  for (const memberId of memberIds) {
    const myReviews = reviews.filter((r) => String(r.reviewee) === memberId);
    const avg = (field) =>
      myReviews.length
        ? myReviews.reduce((s, r) => s + r.scores[field], 0) / myReviews.length
        : 0;

    const myTasks = tasks.filter((t) => String(t.assignee) === memberId);
    const doneOnTime = myTasks.filter(
      (t) => t.status === "done" && (!t.due || (t.completedAt && t.completedAt <= t.due))
    ).length;
    const msgCount = messages.filter((m) => String(m.sender) === memberId).length;

    const earned = [];
    if (avg("reliability") >= 4.2) earned.push("reliable");
    if (avg("helpfulness") >= 4.3) earned.push("unblocker");
    if (avg("communication") >= 4.2 || msgCount >= 20) earned.push("communicator");
    if (doneOnTime >= 3) earned.push("finisher");
    if (avg("helpfulness") >= 4.6 && myReviews.length >= 2) earned.push("mentor");

    for (const key of earned) {
      const meta = BADGE_CATALOG.find((b) => b.key === key);
      const badge = await Badge.findOneAndUpdate(
        { user: memberId, group: group._id, key },
        { $setOnInsert: { ...meta, user: memberId, group: group._id, awardedAt: new Date() } },
        { upsert: true, new: true }
      );
      awarded.push(badge);
    }
  }

  return awarded;
}

/** Recognition leaderboard for a group. */
async function buildLeaderboard(group) {
  const reviews = await PeerReview.find({ group: group._id })
    .populate("reviewee", "name color avatar")
    .lean();
  const tasks = await Task.find({ group: group._id }).lean();
  const badges = await Badge.find({ group: group._id }).lean();

  const map = new Map();
  reviews.forEach((r) => {
    const id = String(r.reviewee._id);
    const entry = map.get(id) || { user: r.reviewee, total: 0, count: 0 };
    const s = r.scores;
    entry.total += (s.contribution + s.communication + s.reliability + s.helpfulness) / 4;
    entry.count += 1;
    map.set(id, entry);
  });

  return [...map.values()]
    .map((e) => {
      const id = String(e.user._id);
      const done = tasks.filter((t) => String(t.assignee) === id && t.status === "done").length;
      const avgScore = e.count ? e.total / e.count : 0;
      return {
        user: e.user,
        avgScore: Number(avgScore.toFixed(2)),
        reviewCount: e.count,
        tasksCompleted: done,
        badges: badges.filter((b) => String(b.user) === id).map((b) => ({ key: b.key, label: b.label, icon: b.icon })),
        recognitionPoints: Math.round(avgScore * 20 + done * 5),
      };
    })
    .sort((a, b) => b.recognitionPoints - a.recognitionPoints);
}

module.exports = { BADGE_CATALOG, recomputeBadges, buildLeaderboard };
