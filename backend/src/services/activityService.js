const ActivityLog = require("../models/ActivityLog");

/**
 * Record an activity / audit entry. Never throws — logging must not break a
 * request.
 */
async function logActivity({ req, group, action, summary, meta = {}, audit = false }) {
  try {
    return await ActivityLog.create({
      group: group || null,
      actor: req?.user?._id || null,
      actorName: req?.user?.name || "",
      action,
      summary,
      meta,
      audit: audit || req?.user?.role === "guide",
      ip: req?.ip || "",
    });
  } catch (err) {
    console.warn(`[activity] failed to log ${action}: ${err.message}`);
    return null;
  }
}

module.exports = { logActivity };
