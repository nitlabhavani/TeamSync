import { useMemo, useState } from "react";
import { statusStyle, statusLabel } from "../../utils/aiStatus";

const FILTERS = [
  { key: "all", label: "All" },
  { key: "ON_TRACK", label: "On track" },
  { key: "AT_RISK", label: "At risk" },
  { key: "BEHIND", label: "Behind" },
  { key: "INSUFFICIENT_DATA", label: "Insufficient data" },
];

/**
 * STEP 4D/4E — guide-facing team performance table, built directly from
 * Step 3's `studentAnalysis` + `performancePrediction`. The backend/AI
 * engine remains the source of truth: no score or status is recalculated
 * here, only matched by studentId and rendered.
 */
const TeamPerformanceTable = ({ studentAnalysis = [], performancePrediction = [], loading, error }) => {
  const [filter, setFilter] = useState("all");

  const rows = useMemo(() => {
    const predictionById = new Map(performancePrediction.map((p) => [p.studentId, p]));
    return studentAnalysis.map((work) => {
      const prediction = predictionById.get(work.studentId) || {};
      const score = work.aiScore || {};
      return {
        studentId: work.studentId,
        name: work.name || work.studentId,
        score: score.score,
        confidence: score.confidence,
        status: prediction.status || (work.status === "insufficient_data" ? "INSUFFICIENT_DATA" : undefined),
        completed: (work.completedWork || []).length,
        overdue: (work.overdueWork || []).length,
        inProgress: (work.inProgressWork || []).length,
        remaining: (work.remainingWork || []).length,
      };
    });
  }, [studentAnalysis, performancePrediction]);

  const filtered = filter === "all" ? rows : rows.filter((r) => r.status === filter);

  if (loading) {
    return (
      <div className="bg-paper rounded-xl2 border border-slate-line p-5 shadow-panel">
        <p className="text-sm text-slate-muted">Analyzing team performance…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-paper rounded-xl2 border border-slate-line p-5 shadow-panel">
        <p className="text-sm text-coral">AI analysis is temporarily unavailable.</p>
      </div>
    );
  }

  return (
    <div className="bg-paper rounded-xl2 border border-slate-line p-5 shadow-panel">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
        <p className="text-sm font-semibold text-slate-ink">Team performance</p>
        <div className="flex gap-1 bg-cloud rounded-full p-1 flex-wrap">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              aria-pressed={filter === f.key}
              className={`text-xs font-medium px-3 py-1.5 rounded-full transition-colors ${
                filter === f.key ? "bg-paper text-brand shadow-sm" : "text-slate-muted"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-slate-muted">Insufficient data to calculate team performance.</p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-slate-muted">No students match this filter.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs font-semibold text-slate-muted uppercase tracking-wide border-b border-slate-line">
                <th className="py-3 pr-3">Student</th>
                <th className="py-3 pr-3">Score</th>
                <th className="py-3 pr-3">Status</th>
                <th className="py-3 pr-3">Progress</th>
                <th className="py-3 pr-3">Risk</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.studentId} className="border-b border-slate-line last:border-0 hover:bg-cloud/50 transition-colors">
                  <td className="py-3 pr-3 text-slate-ink font-medium">{r.name}</td>
                  <td className="py-3 pr-3 text-slate-ink">
                    {r.score === null || r.score === undefined ? (
                      <span className="text-slate-muted">Insufficient data</span>
                    ) : (
                      `${r.score} / 100`
                    )}
                  </td>
                  <td className="py-3 pr-3">
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${statusStyle(r.status)}`}>
                      {statusLabel(r.status)}
                    </span>
                  </td>
                  <td className="py-3 pr-3 text-slate-muted">
                    {r.completed} done · {r.inProgress} in progress · {r.remaining} remaining
                  </td>
                  <td className="py-3 pr-3">
                    {r.overdue > 0 ? (
                      <span className="text-coral font-medium">{r.overdue} overdue</span>
                    ) : (
                      <span className="text-slate-muted">None</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default TeamPerformanceTable;
