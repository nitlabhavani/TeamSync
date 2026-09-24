const mongoose = require("mongoose");
const User = require("../models/User");
const ApiError = require("../utils/apiError");
const asyncHandler = require("../utils/asyncHandler");

/**
 * Validates that `req.params.userId` represents a valid, active peer user for
 * 1:1 direct conversations.
 *
 * Enforces:
 * 1. Valid MongoDB ObjectId format.
 * 2. Peer is not the authenticated user (cannot DM/call oneself).
 * 3. Peer exists in the database.
 * 4. Peer account is active (isActive === true).
 *
 * Attaches `req.peer` to the request for downstream controllers.
 * Crucially, placing this before Multer upload middleware prevents disk allocation
 * or folder creation if the peer is invalid, nonexistent, or inactive.
 */
const validateDirectPeer = asyncHandler(async (req, res, next) => {
  const { userId } = req.params;
  if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
    throw ApiError.badRequest("Invalid peer user ID");
  }

  if (String(req.user?._id) === String(userId)) {
    throw ApiError.badRequest("Cannot start a direct conversation with yourself");
  }

  const peer = await User.findById(userId).select("_id isActive name avatar color role dept");
  if (!peer) {
    throw ApiError.notFound("Peer user not found");
  }

  if (!peer.isActive) {
    throw ApiError.badRequest("Peer user account is inactive");
  }

  req.peer = peer;
  next();
});

module.exports = validateDirectPeer;
