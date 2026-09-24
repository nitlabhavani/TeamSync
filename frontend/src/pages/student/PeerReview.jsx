import { useEffect, useMemo, useState, useCallback } from "react";
import {
  Star,
  Send,
  Award,
  Trophy,
  MessageSquareQuote,
  Users,
  CheckCircle2,
  Clock,
  AlertTriangle,
  RefreshCw,
  ClipboardCheck,
} from "lucide-react";
import Navbar from "../../components/navbar/Navbar";
import { useAuth } from "../../hooks/useAuth";
import { useGroups } from "../../hooks/useGroups";
import { useNavigate } from "@/lib/router-compat";
import { nameOf as dirName, colorOf as dirColor } from "../../services/userDirectory";
import { BADGE_CATALOG } from "../../services/workspaceData";
import { ROUTES } from "../../utils/constants";
import * as reviewService from "../../services/reviewService";

const nameOf = (id) => dirName(id, id);
const colorOf = (id) => dirColor(id);
const initials = (id) =>
  nameOf(id)
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("");

const CRITERIA = [
  { key: "reliability", label: "Reliability" },
  { key: "communication", label: "Communication" },
  { key: "quality", label: "Work quality" },
];

const Stars = ({ value, onChange, readOnly = false, size = "w-4 h-4" }) => (
  <div className="flex gap-0.5">
    {[1, 2, 3, 4, 5].map((n) => (
      <button
        key={n}
        type="button"
        disabled={readOnly}
        onClick={() => onChange?.(n)}
        className={readOnly ? "cursor-default" : "cursor-pointer"}
      >
        <Star className={`${size} ${n <= Math.round(value) ? "fill-amber text-amber" : "text-slate-line"}`} />
      </button>
    ))}
  </div>
);

const CardSkeleton = () => (
  <div className="rounded-xl2 border border-slate-line bg-paper p-5 shadow-panel space-y-4 animate-pulse">
    <div className="h-4 w-40 rounded bg-cloud" />
    <div className="flex gap-2">
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-8 w-20 rounded-full bg-cloud" />
      ))}
    </div>
    {[0, 1, 2].map((i) => (
      <div key={i} className="h-5 w-full rounded bg-cloud" />
    ))}
    <div className="h-20 w-full rounded-lg bg-cloud" />
    <div className="h-9 w-full rounded-lg bg-cloud" />
  </div>
);

const PeerReview = () => {
  const { user } = useAuth();
  const { groups } = useGroups();
  const navigate = useNavigate();
  const [groupId, setGroupId] = useState(null);

  const [rounds, setRounds] = useState([]);
  const [roundId, setRoundId] = useState(null);
  const [roundsLoading, setRoundsLoading] = useState(true);
  const [roundsError, setRoundsError] = useState("");

  const [reviews, setReviews] = useState([]);
  const [reviewsLoading, setReviewsLoading] = useState(false);

  const [target, setTarget] = useState(null);
  const [scores, setScores] = useState({ reliability: 4, communication: 4, quality: 4 });
  const [comment, setComment] = useState("");
  const [sent, setSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");

  const [leaderboard, setLeaderboard] = useState([]);
  const [leaderboardLoading, setLeaderboardLoading] = useState(false);
  const [leaderboardError, setLeaderboardError] = useState("");

  useEffect(() => {
    if (!groupId && groups.length) setGroupId(groups[0].id);
  }, [groups, groupId]);

  const loadRounds = useCallback(() => {
    if (!groupId) return;
    setRoundsLoading(true);
    setRoundsError("");
    reviewService
      .getRounds(groupId)
      .then((r) => {
        setRounds(r);
        setRoundId(r[0]?.id || null);
        setRoundsLoading(false);
      })
      .catch((err) => {
        setRoundsError(err.message || "Review rounds could not be loaded.");
        setRoundsLoading(false);
      });
  }, [groupId]);

  useEffect(() => {
    loadRounds();
  }, [loadRounds]);

  const loadReviews = useCallback(() => {
    if (!groupId || !roundId) return;
    setReviewsLoading(true);
    reviewService
      .getReviews(groupId, roundId)
      .then((r) => setReviews(r))
      .catch(() => setReviews([]))
      .finally(() => setReviewsLoading(false));
  }, [groupId, roundId]);

  useEffect(() => {
    loadReviews();
  }, [loadReviews]);

  const loadLeaderboard = useCallback(() => {
    if (!groupId) return;
    setLeaderboardLoading(true);
    setLeaderboardError("");
    reviewService
      .getLeaderboard(groupId)
      .then((rows) => setLeaderboard(rows))
      .catch((err) => {
        setLeaderboard([]);
        setLeaderboardError(err.message || "Recognition board could not be loaded.");
      })
      .finally(() => setLeaderboardLoading(false));
  }, [groupId]);

  useEffect(() => {
    loadLeaderboard();
    // reviews is intentionally a dependency, same as before: the board is
    // refreshed after a review is submitted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId, reviews]);

  const group = groups.find((g) => g.id === groupId);
  const memberIds = group?.memberIds || [];
  const meId = user?.id || memberIds[0];
  const peers = memberIds.filter((id) => id !== meId);
  const round = rounds.find((r) => r.id === roundId);

  useEffect(() => {
    setTarget((t) => (peers.includes(t) ? t : peers[0] || null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId, peers.join(",")]);

  const reviewedIds = useMemo(() => new Set(reviews.filter((r) => r.fromId === meId).map((r) => r.toId)), [reviews, meId]);
  const alreadyReviewed = target ? reviewedIds.has(target) : false;
  const reviewedCount = reviewedIds.size;
  const pendingCount = Math.max(peers.length - reviewedCount, 0);
  const roundProgress = peers.length ? Math.round((reviewedCount / peers.length) * 100) : 0;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!target || alreadyReviewed || submitting) return;
    setSubmitting(true);
    setSubmitError("");
    try {
      const entry = await reviewService.submitReview(groupId, roundId, { toId: target, scores, comment: comment.trim() });
      setReviews((prev) => [entry, ...prev]);
      setComment("");
      setSent(true);
      setTimeout(() => setSent(false), 2500);
    } catch (err) {
      setSubmitError(err.message || "Couldn't submit this review. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const noGroups = groups.length === 0;

  return (
    <>
      <Navbar title="Peer Review" subtitle="Give teammates structured feedback and build a track record of contribution." />
      <main className="flex-1 px-5 md:px-8 py-6 space-y-6">
        {noGroups ? (
          <div className="flex flex-col items-center text-center gap-3 border border-dashed border-slate-line rounded-xl2 py-16 px-6">
            <span className="w-12 h-12 rounded-full bg-cloud flex items-center justify-center">
              <Users className="w-5 h-5 text-slate-muted" />
            </span>
            <div>
              <p className="text-sm font-medium text-slate-ink">No project groups yet</p>
              <p className="text-xs text-slate-muted mt-1 max-w-sm">
                Peer reviews happen inside project groups. Join or get added to a group to review teammates here.
              </p>
            </div>
            <button
              onClick={() => navigate(ROUTES.STUDENT_GROUPS)}
              className="inline-flex items-center gap-1.5 rounded-full bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-deep transition-colors"
            >
              Go to groups
            </button>
          </div>
        ) : (
          <>
            {/* Group + round switcher */}
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex gap-1.5 rounded-full bg-cloud p-1 overflow-x-auto">
                {groups.map((g) => (
                  <button
                    key={g.id}
                    onClick={() => setGroupId(g.id)}
                    className={`shrink-0 rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${
                      g.id === groupId ? "bg-paper text-slate-ink shadow-sm" : "text-slate-muted hover:text-slate-ink"
                    }`}
                  >
                    {g.name}
                  </button>
                ))}
              </div>

              {!roundsLoading && rounds.length > 0 && (
                <select
                  value={roundId || ""}
                  onChange={(e) => setRoundId(e.target.value)}
                  className="rounded-full border border-slate-line bg-paper px-3.5 py-1.5 text-sm outline-none focus:border-brand"
                >
                  {rounds.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.label} {r.open ? "(open)" : "(closed)"}
                    </option>
                  ))}
                </select>
              )}

              {round && (
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium ${
                    round.open ? "bg-mint-soft text-mint" : "bg-cloud text-slate-muted"
                  }`}
                >
                  <Clock className="w-3.5 h-3.5" />
                  {round.open
                    ? round.closesAt
                      ? `Closes ${new Date(round.closesAt).toLocaleDateString()}`
                      : "Open"
                    : "Round closed"}
                </span>
              )}
            </div>

            {/* Round progress */}
            {round && peers.length > 0 && (
              <div className="rounded-xl2 border border-slate-line bg-paper p-4 shadow-panel">
                <div className="flex items-center justify-between mb-2.5">
                  <div className="flex items-center gap-2">
                    <ClipboardCheck className="w-4 h-4 text-brand" />
                    <p className="text-sm font-medium text-slate-ink">Your reviews this round</p>
                  </div>
                  <span className="font-mono text-sm font-semibold text-brand">
                    {reviewedCount}/{peers.length}
                  </span>
                </div>
                <div className="h-2 rounded-full bg-cloud overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-brand to-mint transition-all duration-700"
                    style={{ width: `${roundProgress}%` }}
                  />
                </div>
                <p className="mt-2 text-xs text-slate-muted">
                  {pendingCount === 0 ? "All teammates reviewed — nice work." : `${pendingCount} teammate${pendingCount === 1 ? "" : "s"} still to review.`}
                </p>
              </div>
            )}

            {/* Rounds load error */}
            {roundsError && (
              <div className="flex items-center justify-between gap-3 rounded-xl2 border border-coral/30 bg-coral-soft px-4 py-3.5">
                <div className="flex items-center gap-2.5 min-w-0">
                  <AlertTriangle className="w-4 h-4 text-coral shrink-0" />
                  <p className="text-sm text-coral truncate">Review rounds could not be loaded — {roundsError}</p>
                </div>
                <button
                  onClick={loadRounds}
                  className="inline-flex items-center gap-1.5 shrink-0 rounded-full bg-paper border border-coral/30 px-3 py-1.5 text-xs font-medium text-coral hover:bg-coral hover:text-white transition-colors"
                >
                  <RefreshCw className="w-3.5 h-3.5" /> Retry
                </button>
              </div>
            )}

            {roundsLoading && !roundsError && (
              <div className="grid gap-5 lg:grid-cols-[360px_1fr]">
                <CardSkeleton />
                <CardSkeleton />
              </div>
            )}

            {!roundsLoading && !roundsError && rounds.length === 0 && (
              <div className="flex flex-col items-center text-center gap-3 border border-dashed border-slate-line rounded-xl2 py-16 px-6">
                <span className="w-12 h-12 rounded-full bg-cloud flex items-center justify-center">
                  <ClipboardCheck className="w-5 h-5 text-slate-muted" />
                </span>
                <div>
                  <p className="text-sm font-medium text-slate-ink">No peer review rounds yet</p>
                  <p className="text-xs text-slate-muted mt-1 max-w-sm">
                    Your guide hasn't opened a review round for this group yet. Check back once one starts.
                  </p>
                </div>
              </div>
            )}

            {!roundsLoading && !roundsError && rounds.length > 0 && (
              <div className="grid gap-5 lg:grid-cols-[360px_1fr]">
                {/* Review form */}
                <form onSubmit={handleSubmit} className="rounded-xl2 border border-slate-line bg-paper p-5 shadow-panel space-y-4 h-fit">
                  <h2 className="font-display text-sm font-semibold text-slate-ink">Review a teammate</h2>

                  {peers.length === 0 ? (
                    <div className="flex flex-col items-center text-center gap-2 py-6">
                      <Users className="w-5 h-5 text-slate-muted" />
                      <p className="text-xs text-slate-muted">No teammates to review yet.</p>
                    </div>
                  ) : (
                    <>
                      <div>
                        <p className="text-xs font-medium text-slate-muted mb-2">Teammate</p>
                        <div className="space-y-1.5">
                          {peers.map((id) => {
                            const done = reviewedIds.has(id);
                            const active = id === target;
                            return (
                              <button
                                key={id}
                                type="button"
                                onClick={() => setTarget(id)}
                                className={`w-full flex items-center gap-2.5 rounded-xl border px-3 py-2 text-left transition-colors ${
                                  active ? "border-brand bg-brand-soft" : "border-slate-line hover:bg-cloud"
                                }`}
                              >
                                <span
                                  className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-[10px] font-semibold text-white"
                                  style={{ backgroundColor: colorOf(id) }}
                                >
                                  {initials(id)}
                                </span>
                                <span className="min-w-0 flex-1 text-sm font-medium text-slate-ink truncate">{nameOf(id)}</span>
                                {done ? (
                                  <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-mint-soft px-2 py-0.5 text-[10px] font-medium text-mint">
                                    <CheckCircle2 className="w-3 h-3" /> Reviewed
                                  </span>
                                ) : (
                                  <span className="shrink-0 rounded-full bg-cloud px-2 py-0.5 text-[10px] font-medium text-slate-muted">Pending</span>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      <div className="space-y-3 rounded-xl bg-cloud/60 p-3.5">
                        {CRITERIA.map((c) => (
                          <div key={c.key} className="flex items-center justify-between">
                            <span className="text-sm text-slate-ink">{c.label}</span>
                            <Stars value={scores[c.key]} onChange={(n) => setScores({ ...scores, [c.key]: n })} />
                          </div>
                        ))}
                      </div>

                      <div>
                        <p className="text-xs font-medium text-slate-muted mb-1.5">Comments (optional)</p>
                        <textarea
                          value={comment}
                          onChange={(e) => setComment(e.target.value)}
                          rows={3}
                          placeholder="What went well? What could be better?"
                          className="w-full rounded-lg border border-slate-line bg-cloud px-3 py-2 text-sm outline-none focus:border-brand"
                        />
                      </div>

                      <button
                        disabled={!target || !round?.open || alreadyReviewed || submitting}
                        className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-brand py-2.5 text-sm font-medium text-white disabled:opacity-40 hover:bg-brand-deep transition-colors"
                      >
                        <Send className="w-4 h-4" />
                        {!round?.open ? "Round closed" : alreadyReviewed ? "Already reviewed" : submitting ? "Submitting…" : "Submit review"}
                      </button>

                      {alreadyReviewed && !sent && (
                        <p className="text-[11px] text-amber">You already reviewed {nameOf(target)} this round.</p>
                      )}
                      {submitError && <p className="text-[11px] text-coral">{submitError}</p>}
                      {sent && (
                        <p className="flex items-center gap-1 text-[11px] font-medium text-mint">
                          <CheckCircle2 className="w-3.5 h-3.5" /> Feedback submitted — thanks!
                        </p>
                      )}
                    </>
                  )}
                </form>

                <div className="space-y-5">
                  <section className="rounded-xl2 border border-slate-line bg-paper p-5 shadow-panel">
                    <div className="flex items-center gap-2">
                      <Trophy className="w-4 h-4 text-amber" />
                      <h2 className="font-display text-sm font-semibold text-slate-ink">Team recognition board</h2>
                    </div>

                    {leaderboardError && (
                      <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-coral/30 bg-coral-soft px-3 py-2.5">
                        <p className="text-xs text-coral">{leaderboardError}</p>
                        <button
                          onClick={loadLeaderboard}
                          className="inline-flex shrink-0 items-center gap-1 rounded-full bg-paper border border-coral/30 px-2.5 py-1 text-[11px] font-medium text-coral hover:bg-coral hover:text-white transition-colors"
                        >
                          <RefreshCw className="w-3 h-3" /> Retry
                        </button>
                      </div>
                    )}

                    {leaderboardLoading && (
                      <div className="mt-4 space-y-3">
                        {[0, 1, 2].map((i) => (
                          <div key={i} className="h-16 rounded-xl border border-slate-line bg-cloud/60 animate-pulse" />
                        ))}
                      </div>
                    )}

                    {!leaderboardLoading && !leaderboardError && leaderboard.length === 0 && (
                      <p className="mt-4 text-xs text-slate-muted">No reviews recorded yet — the board will fill in as teammates review each other.</p>
                    )}

                    {!leaderboardLoading && leaderboard.length > 0 && (
                      <div className="mt-4 space-y-3">
                        {leaderboard.map((row, i) => (
                          <article key={row.id} className="rounded-xl border border-slate-line p-3.5">
                            <div className="flex flex-wrap items-center gap-3">
                              <span className="w-5 text-sm font-semibold text-slate-muted">#{i + 1}</span>
                              <span
                                className="grid h-8 w-8 place-items-center rounded-full text-xs font-semibold text-white"
                                style={{ backgroundColor: row.color }}
                              >
                                {(row.name || "?").split(" ").map((p) => p[0]).slice(0, 2).join("")}
                              </span>
                              <div className="min-w-0 flex-1">
                                <p className="text-sm font-medium text-slate-ink">{row.name}</p>
                                <p className="text-[11px] text-slate-muted">
                                  {row.reviewCount ?? 0} review{row.reviewCount === 1 ? "" : "s"} · {row.doneCount ?? 0}/{row.taskCount ?? 0} tasks done
                                </p>
                              </div>
                              <div className="flex items-center gap-1.5">
                                <Stars value={row.overall} readOnly />
                                <span className="text-xs font-semibold text-slate-ink">{row.overall ? row.overall.toFixed(1) : "—"}</span>
                              </div>
                            </div>

                            {!!row.badges?.length && (
                              <div className="mt-2.5 flex flex-wrap gap-1.5">
                                {row.badges.map((b) => {
                                  const badge = reviewService.badgeById(b);
                                  return (
                                    <span
                                      key={b}
                                      title={badge?.hint}
                                      className="inline-flex items-center gap-1 rounded-full bg-mint-soft px-2.5 py-1 text-[11px] font-medium text-mint"
                                    >
                                      <span>{badge?.emoji}</span> {badge?.label}
                                    </span>
                                  );
                                })}
                              </div>
                            )}

                            {!!row.comments?.length && (
                              <p className="mt-2.5 flex gap-1.5 text-[11px] italic text-slate-muted">
                                <MessageSquareQuote className="w-3.5 h-3.5 shrink-0" /> "{row.comments[0]}"
                              </p>
                            )}
                          </article>
                        ))}
                      </div>
                    )}
                  </section>

                  <section className="rounded-xl2 border border-slate-line bg-paper p-5 shadow-panel">
                    <div className="flex items-center gap-2">
                      <Award className="w-4 h-4 text-brand" />
                      <h2 className="font-display text-sm font-semibold text-slate-ink">Badge catalog</h2>
                    </div>
                    <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
                      {BADGE_CATALOG.map((b) => (
                        <div key={b.id} className="rounded-lg bg-cloud px-3 py-2.5">
                          <p className="text-xs font-medium text-slate-ink">
                            {b.emoji} {b.label}
                          </p>
                          <p className="mt-0.5 text-[11px] text-slate-muted">{b.hint}</p>
                        </div>
                      ))}
                    </div>
                  </section>
                </div>
              </div>
            )}
          </>
        )}
      </main>
    </>
  );
};

export default PeerReview;
