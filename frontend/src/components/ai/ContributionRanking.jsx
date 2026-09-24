import { Trophy } from "lucide-react";

const rankColors = ["text-amber", "text-slate-muted", "text-coral"];

const ContributionRanking = ({ data = [] }) => {
  const sorted = [...data].sort((a, b) => b.value - a.value);
  return (
    <div className="bg-paper rounded-xl2 border border-slate-line p-5 shadow-panel">
      <p className="text-sm font-medium text-slate-ink mb-4">Contribution ranking</p>
      <ul className="space-y-3">
        {sorted.map((row, idx) => (
          <li key={row.member} className="flex items-center gap-3">
            <span className={`w-6 text-sm font-semibold ${rankColors[idx] || "text-slate-muted"}`}>
              {idx < 3 ? <Trophy className="w-4 h-4" /> : idx + 1}
            </span>
            <span className="text-sm text-slate-ink flex-1">{row.member}</span>
            <div className="w-24 h-1.5 rounded-full bg-cloud overflow-hidden">
              <div className="h-full bg-brand" style={{ width: `${row.value}%` }} />
            </div>
            <span className="font-mono text-xs text-slate-muted w-8 text-right">{row.value}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
};

export default ContributionRanking;
