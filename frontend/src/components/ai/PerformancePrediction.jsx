import { TrendingUp, TrendingDown, CalendarClock } from "lucide-react";

const PerformancePrediction = ({ data }) => {
  if (!data) return null;
  const { weeksRemaining, onTrack, predictedCompletion, confidence } = data;

  return (
    <div className="bg-paper rounded-xl2 border border-slate-line p-5 shadow-panel">
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm font-medium text-slate-ink">Completion prediction</p>
        <span
          className={`flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full ${
            onTrack ? "bg-mint-soft text-mint" : "bg-coral-soft text-coral"
          }`}
        >
          {onTrack ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
          {onTrack ? "On track" : "At risk"}
        </span>
      </div>

      <div className="flex items-center gap-2 text-slate-ink mb-1">
        <CalendarClock className="w-4 h-4 text-slate-muted" />
        <p className="text-sm">
          Predicted completion: <span className="font-semibold">{predictedCompletion}</span>
        </p>
      </div>
      <p className="text-xs text-slate-muted mb-4">{weeksRemaining} weeks remaining at current pace</p>

      <div className="flex items-center justify-between text-xs text-slate-muted mb-1.5">
        <span>Model confidence</span>
        <span className="font-mono font-semibold text-slate-ink">{confidence}%</span>
      </div>
      <div className="h-1.5 rounded-full bg-cloud overflow-hidden">
        <div className="h-full bg-brand" style={{ width: `${confidence}%` }} />
      </div>
    </div>
  );
};

export default PerformancePrediction;
