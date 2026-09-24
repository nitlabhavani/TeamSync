const Notification = require("../models/Notification");
const { emitToUser } = require("./socketService");

/**
 * Fan-out a notification to a list of users (skipping the actor), persisting
 * to MongoDB and pushing each one live over the user's existing socket room.
 *
 * `payload` is whatever the Notification schema accepts — `title`, `body`,
 * `type`, `link`, and (optionally) `group` / `task` ObjectIds so a
 * notification can be traced back to exactly the group/task it's about.
 * Callers should always pass the real Group/Task `_id`, never a name —
 * two groups can share a name, and only the id is unambiguous.
 */
async function notifyUsers(userIds, payload, { exclude } = {}) {
  const targets = [...new Set(userIds.map(String))].filter(
    (id) => !exclude || id !== String(exclude)
  );
  if (!targets.length) return [];
  const created = await Notification.insertMany(targets.map((user) => ({ user, ...payload })));
  created.forEach((doc) => emitToUser(doc.user, "notification:new", doc.toObject ? doc.toObject() : doc));
  return created;
}

module.exports = { notifyUsers };
