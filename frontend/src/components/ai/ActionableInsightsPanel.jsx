import { useEffect, useState } from "react";
import { Sparkles, ListChecks, Loader2, ShieldAlert, Info, ChevronDown, ChevronUp } from "lucide-react";
import { classNames } from "../../utils/helperFunctions";
import { getActionableInsights } from "../../services/actionableInsightsService";

/**
 * STEP 29 — AI Actionable Project Insights & Recommendation Engine panel.
 *
 * An orchestration layer over already-computed project intelligence (Team
 * Risk, Project Forecast, Project Health, Execution Copilot, Sprint
 * Planner, Conflict Detection, Meeting Intelligence, Project Knowledge,
 * and real Task data) — this panel never scores anything itself. Every
 * card shown here is read-only: it can only be reviewed, never applied
 * automatically (no button here mutates a task, conflict, deadline, or
 * priority).
 *
 * Mirrors ProjectMemoryAssistant.jsx's loading/error/empty conventions.
 */

const PRIORITY_STYLES = {
  CRITICAL: { bg: "bg-red-50", text: "text-red-700", ring: "ring-red-200" },
  HIGH: { bg: "bg-orange-50", text: "text-orange-700", ring: "ring-orange-200" },
  MEDIUM: { bg: "bg-amber-50", text: "text-amber-700", ring: "ring-amber-200" },
  LOW: { bg: "bg-slate-100", text: "text-slate-600", ring: "ring-slate-200" },
};

const CONFIDENCE_STYLES = {
  HIGH: "text-emerald-700 bg-emerald-50",
  MEDIUM: "text-amber-700 bg-amber-50",
  LOW: "text-slate-600 bg-slate-100",
};

const FILTERS = ["ALL", "CRITICAL", "HIGH", "MEDIUM", "LOW"];

function friendlyError(e) {
  const msg = e?.message || "";
  if (/403|not part of this group|not authorized/i.test(msg)) return "You don't have access to actionable insights for this group.";
  if (/Could not reach/i.test(msg)) return msg;
  return "Couldn't load actionable insights right now. Please try again.";
}

function categoryLabel(category) {
  return category
    .split("_")
    .map((w) => w[0] + w.slice(1).toLowerCase())
    .join(" ");
}

function RecommendationCard({ item }) {
  const [expanded, setExpanded] = useState(false);
  const style = PRIORITY_STYLES[item.priority] || PRIORITY_STYLES.LOW;

  return (
    <div className={classNames("rounded-lg border border-slate-line/70 p-4 space-y-2.5 ring-1", style.ring)}>
      <div className="flex items-center gap-2 flex-wrap">
        <span className={classNames("text-[10px] font-semibold px-2 py-0.5 rounded-full", style.bg, style.text)}>
          {item.priority}
        </span>
        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-brand-soft text-brand">
          {categoryLabel(item.category)}
        </span>
        <span
          className={classNames(
            "text-[10px] font-semibold px-2 py-0.5 rounded-full",
            CONFIDENCE_STYLES[item.confidence] || CONFIDENCE_STYLES.LOW
          )}
        >
          {item.confidence} confidence
        </span>
      </div>

      <p className="text-sm font-semibold text-slate-ink">{item.title}</p>
      <p className="text-xs text-slate-muted">{item.reason}</p>
      <p className="text-sm text-slate-ink leading-relaxed">{item.recommendation}</p>
      {item.consequenceIfIgnored && (
        <p className="text-xs text-slate-muted flex items-start gap-1.5">
          <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" /> {item.consequenceIfIgnored}
        </p>
      )}

      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="text-xs font-semibold text-brand flex items-center gap-1"
      >
        {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        {expanded ? "Hide evidence" : `View evidence (${item.evidence.length})`}
      </button>

      {expanded && (
        <ul className="space-y-1.5 pt-1">
          {item.evidence.map((ev, i) => (
            <li key={`${ev.sourceType}-${ev.sourceId}-${i}`} className="text-xs text-slate-muted bg-cloud rounded-lg px-3 py-2">
              <span className="font-semibold text-slate-ink">{ev.label}</span>
              {ev.snippet ? ` — ${ev.snippet}` : ""}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function ActionableInsightsPanel({ groupId }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [filter, setFilter] = useState("ALL");

  useEffect(() => {
    if (!groupId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    getActionableInsights(groupId, { limit: 20 })
      .then((data) => {
        if (!cancelled) setResult(data);
      })
      .catch((e) => {
        if (!cancelled) {
          setError(friendlyError(e));
          setResult(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [groupId]);

  const recommendations = result?.recommendations || [];
  const summary = result?.summary;
  const filtered = filter === "ALL" ? recommendations : recommendations.filter((r) => r.priority === filter);

  return (
    <div className="bg-paper border border-slate-line rounded-xl2 p-5 shadow-panel space-y-4">
      <div>
        <p className="flex items-center gap-2 text-sm font-semibold text-slate-ink">
          <Sparkles className="w-4 h-4 text-brand" /> AI Actionable Insights
        </p>
        <p className="text-xs text-slate-muted mt-1">
          Prioritized recommendations based on current project evidence.
        </p>
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-sm text-slate-muted py-6 justify-center">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading insights…
        </div>
      )}

      {!loading && error && (
        <div className="flex items-start gap-2 text-sm text-slate-muted bg-cloud rounded-lg px-3 py-3">
          <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {!loading && !error && result && (
        <>
          <div className="flex items-center gap-2 flex-wrap">
            {["critical", "high", "medium", "low"].map((k) => (
              <span
                key={k}
                className={classNames(
                  "text-[10px] font-semibold px-2 py-0.5 rounded-full",
                  PRIORITY_STYLES[k.toUpperCase()].bg,
                  PRIORITY_STYLES[k.toUpperCase()].text
                )}
              >
                {k[0].toUpperCase() + k.slice(1)}: {summary?.[k] ?? 0}
              </span>
            ))}
          </div>

          <div className="flex items-center gap-1.5 flex-wrap">
            {FILTERS.map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                className={classNames(
                  "text-[11px] font-semibold px-2.5 py-1 rounded-full border",
                  filter === f
                    ? "bg-brand text-white border-brand"
                    : "bg-paper text-slate-muted border-slate-line hover:text-slate-ink"
                )}
              >
                {f[0] + f.slice(1).toLowerCase()}
              </button>
            ))}
          </div>

          {filtered.length === 0 ? (
            <div className="flex items-center gap-2 text-sm text-slate-muted py-6 justify-center">
              <ListChecks className="w-4 h-4" />
              {recommendations.length === 0
                ? "No actionable issues detected from current project evidence."
                : "No recommendations match this filter."}
            </div>
          ) : (
            <div className="space-y-3">
              {filtered.map((item) => (
                <RecommendationCard key={item.id} item={item} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
