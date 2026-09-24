import { Sparkles, CheckCircle2, Clock, ListTodo, AlertTriangle } from "lucide-react";
import { statusStyle, statusLabel, confidenceLabel } from "../../utils/aiStatus";

const SectionList = ({ title, icon: Icon, items, render, empty }) => (
  <div>
    <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-muted uppercase tracking-wide mb-2">
      <Icon className="w-3.5 h-3.5" /> {title} ({items.length})
    </p>
    {items.length === 0 ? (
      <p className="text-xs text-slate-muted">{empty}</p>
    ) : (
      <ul className="space-y-1.5">{items.map(render)}</ul>
    )}
  </div>
);

/**
 * STEP 4A — student's own Step 3 AI performance card.
 *
 * `work` is one entry from the engine's `studentAnalysis` (already includes
 * `aiScore` merged in by the engine). `prediction` is the matching entry
 * from `performancePrediction`, matched by studentId. Every value shown
 * comes directly from those two objects — nothing is computed here.
 */
const StudentAIPerformance = ({ work, prediction, loading, error }) => {
  if (loading) {
    return (
      <div className="bg-paper rounded-xl2 border border-slate-line p-5 shadow-panel">
        <p className="text-sm text-slate-muted">Analyzing project performance…</p>
        <div className="mt-3 space-y-2">
          <div className="h-3 bg-cloud rounded animate-pulse w-full" />
          <div className="h-3 bg-cloud rounded animate-pulse w-5/6" />
          <div className="h-3 bg-cloud rounded animate-pulse w-2/3" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-paper rounded-xl2 border border-slate-line p-5 shadow-panel">
        <p className="text-sm text-coral">AI analysis is temporarily unavailable.</p>
        <p className="text-xs text-slate-muted mt-1">{error}</p>
      </div>
    );
  }

  if (!work) {
    return (
      <div className="bg-paper rounded-xl2 border border-slate-line p-5 shadow-panel">
        <p className="text-sm text-slate-muted">Insufficient data to calculate performance.</p>
      </div>
    );
  }

  const score = work.aiScore || {};
  const positiveEvidence = (work.evidence || []).filter((e) => e.impact === "positive");
  const negativeEvidence = (work.evidence || []).filter((e) => e.impact === "negative");

  return (
    <div className="bg-paper rounded-xl2 border border-slate-line p-5 shadow-panel space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-brand" />
          <p className="text-sm font-medium text-slate-ink">AI performance analysis</p>
        </div>
        {prediction?.status && (
          <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${statusStyle(prediction.status)}`}>
            {statusLabel(prediction.status)}
          </span>
        )}
      </div>

      <div className="flex items-end gap-6 flex-wrap">
        <div>
          <p className="text-xs text-slate-muted mb-1">Performance score</p>
          {score.score === null || score.score === undefined ? (
            <p className="text-lg font-semibold text-slate-muted">Insufficient data</p>
          ) : (
            <p className="text-3xl font-semibold text-slate-ink leading-none">
              {score.score}
              <span className="text-sm text-slate-muted font-normal"> / 100</span>
            </p>
          )}
        </div>
        {score.confidence && (
          <div>
            <p className="text-xs text-slate-muted mb-1">Confidence</p>
            <p className="text-sm font-medium text-slate-ink">{confidenceLabel(score.confidence)}</p>
          </div>
        )}
      </div>

      {(score.reasons || []).length > 0 && (
        <div>
          <p className="text-xs font-semibold text-slate-muted uppercase tracking-wide mb-2">Evidence</p>
          <ul className="space-y-1">
            {score.reasons.map((r, i) => (
              <li key={i} className="text-sm text-slate-ink">
                {r}
              </li>
            ))}
          </ul>
        </div>
      )}

      {prediction?.reasons?.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-slate-muted uppercase tracking-wide mb-2">Why this status</p>
          <ul className="space-y-1">
            {prediction.reasons.map((r, i) => (
              <li key={i} className="text-sm text-slate-ink">
                {r}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid sm:grid-cols-2 gap-4">
        <SectionList
          title="Completed"
          icon={CheckCircle2}
          items={work.completedWork || []}
          empty="No completed tasks yet."
          render={(t) => (
            <li key={t.id} className="text-sm text-slate-ink bg-mint-soft/50 rounded-lg px-3 py-2">
              {t.title}
            </li>
          )}
        />
        <SectionList
          title="In progress"
          icon={Clock}
          items={work.inProgressWork || []}
          empty="No tasks in progress."
          render={(t) => (
            <li key={t.id} className="text-sm text-slate-ink bg-cloud rounded-lg px-3 py-2">
              {t.title}
              {t.progress != null && <span className="text-slate-muted"> · {t.progress}%</span>}
            </li>
          )}
        />
        <SectionList
          title="Remaining"
          icon={ListTodo}
          items={work.remainingWork || []}
          empty="Nothing remaining."
          render={(t) => (
            <li key={t.id} className="text-sm text-slate-ink bg-cloud rounded-lg px-3 py-2">
              {t.title}
            </li>
          )}
        />
        <SectionList
          title="Overdue"
          icon={AlertTriangle}
          items={work.overdueWork || []}
          empty="Nothing overdue."
          render={(t) => (
            <li key={t.id} className="text-sm text-coral bg-coral-soft/50 rounded-lg px-3 py-2">
              {t.title} · {t.daysLate} day{t.daysLate === 1 ? "" : "s"} late
            </li>
          )}
        />
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <div>
          <p className="text-xs font-semibold text-mint uppercase tracking-wide mb-2">Positive factors</p>
          {positiveEvidence.length === 0 ? (
            <p className="text-xs text-slate-muted">None recorded yet.</p>
          ) : (
            <ul className="space-y-1">
              {positiveEvidence.map((e, i) => (
                <li key={i} className="text-sm text-slate-ink">
                  {e.observation}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <p className="text-xs font-semibold text-coral uppercase tracking-wide mb-2">Negative factors</p>
          {negativeEvidence.length === 0 ? (
            <p className="text-xs text-slate-muted">None recorded.</p>
          ) : (
            <ul className="space-y-1">
              {negativeEvidence.map((e, i) => (
                <li key={i} className="text-sm text-slate-ink">
                  {e.observation}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {(work.suggestions || []).length > 0 && (
        <div>
          <p className="text-xs font-semibold text-slate-muted uppercase tracking-wide mb-2">AI recommendations</p>
          <ul className="space-y-1.5">
            {work.suggestions.map((s, i) => (
              <li key={i} className="text-sm text-slate-ink flex items-start gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-brand mt-1.5 shrink-0" />
                {s}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

export default StudentAIPerformance;
