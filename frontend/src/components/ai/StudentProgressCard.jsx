import { ShieldCheck, AlertTriangle } from "lucide-react";

/**
 * STEP 19, Feature 8 — small "Your Progress" card for the Student
 * Dashboard. Consumes ONLY the student-safe `{ myProgress }` shape
 * returned by GET /groups/:groupId/project-forecast for a non-guide/
 * non-leader caller (see projectForecastController.js#buildStudentProgress)
 * — never the team forecast, other students, team risk, workload ranking,
 * or guide-only intervention recommendations (Feature 4/17 — Privacy).
 */
const StudentProgressCard = ({ myProgress, loading, error }) => {
  if (loading) {
    return <div className="h-[140px] rounded-xl2 border border-slate-line bg-cloud/60 animate-pulse" />;
  }

  if (error || !myProgress) {
    return null;
  }

  const onTrack = myProgress.status === "ON_TRACK";

  return (
    <div className={onTrack ? "bg-mint-soft border border-mint/20 rounded-xl2 p-5" : "bg-amber-soft border border-amber/20 rounded-xl2 p-5"}>
      <p className="flex items-center gap-2 text-sm font-semibold text-slate-ink mb-2">
        {onTrack ? (
          <>
            <ShieldCheck className="w-4 h-4 text-mint" /> Your Progress
          </>
        ) : (
          <>
            <AlertTriangle className="w-4 h-4 text-amber" /> Your Progress
          </>
        )}
      </p>
      <div className={onTrack ? "inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full bg-mint/15 text-mint mb-2" : "inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full bg-amber/15 text-amber mb-2"}>
        {onTrack ? "🟢 ON TRACK" : "🟡 NEEDS ATTENTION"}
      </div>
      <p className="text-sm text-slate-ink">{myProgress.message}</p>
      <p className="text-sm text-slate-ink mt-2">
        Completed: <span className="font-semibold">{myProgress.completed} / {myProgress.total}</span> tasks
      </p>
      {myProgress.nextPriority && (
        <p className="text-xs text-slate-muted mt-1.5">
          Next priority: <span className="font-medium text-slate-ink">{myProgress.nextPriority.title}</span>
        </p>
      )}
    </div>
  );
};

export default StudentProgressCard;
