import { classNames } from "../../utils/helperFunctions";

const toneMap = {
  brand: { bg: "bg-brand-soft", text: "text-brand-deep", icon: "text-brand" },
  mint: { bg: "bg-mint-soft", text: "text-mint", icon: "text-mint" },
  amber: { bg: "bg-amber-soft", text: "text-amber", icon: "text-amber" },
  coral: { bg: "bg-coral-soft", text: "text-coral", icon: "text-coral" },
};

const StatsCard = ({ label, value, delta, icon: Icon, tone = "brand" }) => {
  const t = toneMap[tone] || toneMap.brand;
  return (
    <div className="stat-card bg-paper rounded-xl2 border border-slate-line p-5 shadow-panel">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium text-slate-muted mb-2">{label}</p>
          <p className="font-display text-2xl font-semibold text-slate-ink">{value}</p>
        </div>
        {Icon && (
          <span className={classNames("w-10 h-10 rounded-xl flex items-center justify-center", t.bg)}>
            <Icon className={classNames("w-5 h-5", t.icon)} />
          </span>
        )}
      </div>
      {delta && (
        <p className={classNames("text-xs font-medium mt-3", t.text)}>{delta}</p>
      )}
    </div>
  );
};

export default StatsCard;
