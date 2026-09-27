import { classNames } from "../../utils/helperFunctions";

const toneMap = {
  brand: {
    bg: "bg-brand/15 text-brand",
    glow: "from-brand/30 via-indigo-500/20 to-transparent",
    topBar: "bg-gradient-to-r from-brand to-purple-500",
    text: "text-brand",
    icon: "text-brand",
  },
  mint: {
    bg: "bg-mint/15 text-mint",
    glow: "from-mint/30 via-teal-500/20 to-transparent",
    topBar: "bg-gradient-to-r from-mint to-teal-400",
    text: "text-mint",
    icon: "text-mint",
  },
  amber: {
    bg: "bg-amber/15 text-amber",
    glow: "from-amber/30 via-yellow-500/20 to-transparent",
    topBar: "bg-gradient-to-r from-amber to-yellow-400",
    text: "text-amber",
    icon: "text-amber",
  },
  coral: {
    bg: "bg-coral/15 text-coral",
    glow: "from-coral/30 via-rose-500/20 to-transparent",
    topBar: "bg-gradient-to-r from-coral to-rose-400",
    text: "text-coral",
    icon: "text-coral",
  },
};

const StatsCard = ({ label, value, delta, icon: Icon, tone = "brand" }) => {
  const t = toneMap[tone] || toneMap.brand;
  return (
    <div className="group relative overflow-hidden rounded-2xl border border-slate-line/80 dark:border-white/10 bg-paper/85 dark:bg-[#151926]/85 p-5 shadow-panel backdrop-blur-md transition-all duration-300 hover:-translate-y-1 hover:border-brand/40 hover:shadow-xl">
      {/* Top ambient color bar (Uiverse inspired) */}
      <div className={classNames("absolute top-0 left-0 right-0 h-1 opacity-70 group-hover:opacity-100 transition-opacity", t.topBar)} />

      {/* Ambient background glow */}
      <div className={classNames("absolute -top-10 -right-10 w-28 h-28 rounded-full blur-2xl opacity-0 group-hover:opacity-25 transition-opacity pointer-events-none bg-gradient-to-br", t.glow)} />

      <div className="relative z-10 flex items-start justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-muted mb-2">{label}</p>
          <p className="font-display text-2xl sm:text-3xl font-bold text-slate-ink tracking-tight">{value}</p>
        </div>
        {Icon && (
          <span className={classNames("w-11 h-11 rounded-xl flex items-center justify-center shadow-xs transition-transform duration-300 group-hover:scale-110", t.bg)}>
            <Icon className={classNames("w-5 h-5", t.icon)} />
          </span>
        )}
      </div>
      {delta && (
        <p className={classNames("relative z-10 text-xs font-semibold mt-3 flex items-center gap-1", t.text)}>{delta}</p>
      )}
    </div>
  );
};

export default StatsCard;
