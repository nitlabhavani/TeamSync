import { Sparkles, AlertTriangle, Gauge, MessageSquareText, Loader2 } from "lucide-react";

const LEVEL_STYLES = {
  high: "bg-coral-soft text-coral",
  medium: "bg-amber-soft text-amber",
  low: "bg-brand-soft text-brand",
};

/**
 * Group-chat AI panel: what the model read (group chat only), the alerts it
 * raised and the collaboration score it generated from conversation behaviour.
 */
const AIInsights = ({ data, loading }) => {
  if (loading) {
    return (
      <div className="bg-paper border border-slate-line rounded-xl2 p-6 flex items-center gap-2 text-sm text-slate-muted">
        <Loader2 className="w-4 h-4 animate-spin" /> Analyzing group chat…
      </div>
    );
  }
  if (!data) return null;

  const { summary = {}, alerts = [], collaboration = {}, analyzedMessages = 0 } = data;

  return (
    <div className="space-y-4">
      <div className="bg-paper border border-slate-line rounded-xl2 p-5">
        <p className="flex items-center gap-2 text-sm font-semibold text-slate-ink">
          <Sparkles className="w-4 h-4 text-brand" /> Chat analysis
        </p>
        <p className="text-xs text-slate-muted mt-1">
          Source: group chat only · {analyzedMessages} messages analyzed · sentiment{" "}
          <span className="font-semibold text-slate-ink">{summary.sentiment || "neutral"}</span>
        </p>
        {(summary.topics || []).length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-3">
            {summary.topics.map((t) => (
              <span
                key={t.word}
                className="text-xs bg-cloud text-slate-ink rounded-full px-2.5 py-1"
              >
                {t.word} · {t.count}
              </span>
            ))}
          </div>
        )}
        {(summary.openQuestions || []).length > 0 && (
          <div className="mt-4">
            <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-muted mb-1.5">
              <MessageSquareText className="w-3.5 h-3.5" /> Open questions
            </p>
            <ul className="space-y-1">
              {summary.openQuestions.map((q, i) => (
                <li key={i} className="text-sm text-slate-ink">
                  · {q}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="bg-paper border border-slate-line rounded-xl2 p-5">
        <p className="flex items-center gap-2 text-sm font-semibold text-slate-ink mb-3">
          <Gauge className="w-4 h-4 text-brand" /> Collaboration score
          <span className="ml-auto text-2xl font-semibold text-slate-ink leading-none">
            {collaboration.score ?? 0}
          </span>
        </p>
        <div className="h-2 rounded-full bg-cloud overflow-hidden">
          <div
            className="h-full bg-brand rounded-full transition-all"
            style={{ width: `${collaboration.score ?? 0}%` }}
          />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3">
          {Object.entries(collaboration.breakdown || {}).map(([k, v]) => (
            <div key={k} className="bg-cloud rounded-lg px-3 py-2">
              <p className="text-xs text-slate-muted capitalize">{k}</p>
              <p className="text-sm font-semibold text-slate-ink">{v}</p>
            </div>
          ))}
        </div>
        {(collaboration.participants || []).length > 0 && (
          <div className="mt-3 space-y-1.5">
            {collaboration.participants.map((p) => (
              <div key={p.name} className="flex items-center gap-2 text-xs">
                <span className="w-28 truncate text-slate-ink">{p.name}</span>
                <span className="flex-1 h-1.5 bg-cloud rounded-full overflow-hidden">
                  <span
                    className="block h-full bg-brand-deep rounded-full"
                    style={{ width: `${p.share}%` }}
                  />
                </span>
                <span className="text-slate-muted w-10 text-right">{p.share}%</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="bg-paper border border-slate-line rounded-xl2 p-5">
        <p className="flex items-center gap-2 text-sm font-semibold text-slate-ink mb-3">
          <AlertTriangle className="w-4 h-4 text-amber" /> AI alerts ({alerts.length})
        </p>
        {alerts.length === 0 ? (
          <p className="text-xs text-slate-muted">No alerts — the conversation looks healthy.</p>
        ) : (
          <ul className="space-y-2">
            {alerts.map((a) => (
              <li key={a.id} className="flex gap-3 items-start">
                <span
                  className={`text-[10px] font-semibold uppercase tracking-wide rounded-full px-2 py-0.5 shrink-0 ${
                    LEVEL_STYLES[a.level] || LEVEL_STYLES.low
                  }`}
                >
                  {a.level}
                </span>
                <span className="min-w-0">
                  <p className="text-sm font-medium text-slate-ink">{a.title}</p>
                  <p className="text-xs text-slate-muted">{a.detail}</p>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};

export default AIInsights;
