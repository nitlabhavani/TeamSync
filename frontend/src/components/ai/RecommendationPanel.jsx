import { Lightbulb } from "lucide-react";

const RecommendationPanel = ({ recommendations = [] }) => (
  <div className="bg-paper rounded-xl2 border border-slate-line p-5 shadow-panel">
    <div className="flex items-center gap-2 mb-4">
      <Lightbulb className="w-4 h-4 text-amber" />
      <p className="text-sm font-medium text-slate-ink">AI recommendations</p>
    </div>
    <ul className="space-y-3">
      {recommendations.map((rec, idx) => (
        <li key={idx} className="flex items-start gap-2.5">
          <span className="w-5 h-5 rounded-full bg-amber-soft text-amber text-[11px] font-semibold flex items-center justify-center shrink-0 mt-0.5">
            {idx + 1}
          </span>
          <p className="text-sm text-slate-ink leading-relaxed">{rec}</p>
        </li>
      ))}
    </ul>
  </div>
);

export default RecommendationPanel;
