import { ShieldCheck, AlertTriangle, Sparkles, CheckCircle2 } from "lucide-react";

/**
 * STEP 19, Feature 8 — "Your Progress" card for Student Dashboard.
 * Glassmorphic, modern Uiverse pill badge and glowing status border.
 */
const StudentProgressCard = ({ myProgress, loading, error }) => {
  if (loading) {
    return <div className="h-[140px] rounded-2xl border border-slate-line/80 bg-cloud/60 animate-pulse" />;
  }

  if (error || !myProgress) {
    return null;
  }

  const onTrack = myProgress.status === "ON_TRACK";

  return (
    <div
      className={`relative overflow-hidden rounded-2xl border p-5 shadow-md backdrop-blur-md transition-all duration-300 hover:shadow-lg ${
        onTrack
          ? "border-mint/30 bg-mint-soft/60 dark:bg-mint-soft/10 text-slate-ink"
          : "border-amber/30 bg-amber-soft/60 dark:bg-amber-soft/10 text-slate-ink"
      }`}
    >
      <div
        className={`absolute top-0 left-0 right-0 h-1 ${
          onTrack ? "bg-gradient-to-r from-mint to-teal-400" : "bg-gradient-to-r from-amber to-yellow-400"
        }`}
      />

      <div className="flex items-center justify-between mb-3">
        <p className="flex items-center gap-2 text-sm font-bold text-slate-ink">
          {onTrack ? (
            <>
              <ShieldCheck className="w-4.5 h-4.5 text-mint" /> Your Progress
            </>
          ) : (
            <>
              <AlertTriangle className="w-4.5 h-4.5 text-amber" /> Action Recommended
            </>
          )}
        </p>
        <span
          className={`inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full ${
            onTrack ? "bg-mint/20 text-mint" : "bg-amber/20 text-amber"
          }`}
        >
          {onTrack ? "🟢 ON TRACK" : "🟡 ATTENTION"}
        </span>
      </div>

      <p className="text-sm font-medium leading-relaxed text-slate-ink mb-3">{myProgress.message}</p>

      <div className="flex items-center justify-between pt-2.5 border-t border-slate-line/60 dark:border-white/10 text-xs font-semibold">
        <span className="text-slate-muted flex items-center gap-1.5">
          <CheckCircle2 className="w-3.5 h-3.5 text-mint" /> Tasks Completed:
        </span>
        <span className="font-mono text-slate-ink bg-white/60 dark:bg-slate-800/60 px-2 py-0.5 rounded-md">
          {myProgress.completed} / {myProgress.total}
        </span>
      </div>

      {myProgress.nextPriority && (
        <p className="text-[11px] text-slate-muted mt-2">
          🎯 Next priority: <span className="font-semibold text-brand">{myProgress.nextPriority.title}</span>
        </p>
      )}
    </div>
  );
};

export default StudentProgressCard;
