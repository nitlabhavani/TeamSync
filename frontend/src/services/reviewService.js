import { api, normalize, idOf } from "../lib/apiClient";
import { BADGE_CATALOG } from "./workspaceData";

const toReview = (r) => {
  const review = normalize(r);
  return {
    ...review,
    fromId: idOf(review.reviewer),
    toId: idOf(review.reviewee),
  };
};

export const getRounds = async (groupId) =>
  normalize(await api.get(`/groups/${groupId}/review-rounds`));

export const createRound = async (groupId, payload) =>
  normalize(await api.post(`/groups/${groupId}/review-rounds`, payload));

export const closeRound = async (groupId, roundId) =>
  normalize(await api.post(`/groups/${groupId}/review-rounds/${roundId}/close`, {}));

/** Reviews the signed-in user already submitted in this round. */
export const getReviews = async (groupId, roundId) =>
  (await api.get(`/groups/${groupId}/review-rounds/${roundId}/mine`)).map(toReview);

export const getReceivedReviews = async (groupId, userId) =>
  normalize(await api.get(`/groups/${groupId}/reviews/received/${userId}`));

/**
 * The UI collects reliability/communication/quality; the backend model stores
 * contribution/communication/reliability/helpfulness.
 */
const toApiScores = (s = {}) => ({
  reliability: s.reliability ?? 0,
  communication: s.communication ?? 0,
  contribution: s.quality ?? s.contribution ?? 0,
  helpfulness: s.helpfulness ?? s.quality ?? 0,
});

export const submitReview = async (groupId, roundId, review) => {
  const { toId, reviewee, scores, comment } = review;
  return toReview(
    await api.post(`/groups/${groupId}/review-rounds/${roundId}/reviews`, {
      reviewee: reviewee || toId,
      scores: toApiScores(scores),
      comment,
    }),
  );
};

/** Leaderboard + badges are computed on the backend. */
export const getLeaderboard = async (groupId) => {
  const rows = normalize(await api.get(`/groups/${groupId}/leaderboard`));
  return (Array.isArray(rows) ? rows : rows.rows || []).map((r) => ({
    ...r,
    id: idOf(r.user) || r.id,
    name: r.name || r.user?.name,
    color: r.color || r.user?.color || "#5B5FEF",
    badges: r.badges || [],
  }));
};

export const getBadges = async (groupId) => normalize(await api.get(`/groups/${groupId}/badges`));

export const badgeById = (id) => BADGE_CATALOG.find((b) => b.id === id);
