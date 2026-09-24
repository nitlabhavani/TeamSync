const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/apiError");
const { searchLearning } = require("../services/learningSearchService");

/**
 * Handles learning search queries (Ask & Learn / Educational Search).
 * Accessible to both authenticated students and guides.
 *
 * Supported methods:
 * POST /api/search/learning (body: { query })
 * GET  /api/search/learning?q=query
 */
exports.search = asyncHandler(async (req, res) => {
  const query = req.body?.query || req.query?.q;
  const userId = req.user?._id;

  const result = await searchLearning({ query, userId });

  if (!result.success) {
    if (result.statusCode === 429) {
      throw ApiError.tooManyRequests(result.message);
    }
    throw ApiError.badRequest(result.message);
  }

  res.json({
    success: true,
    data: result.data,
  });
});
