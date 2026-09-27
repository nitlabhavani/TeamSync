import { Users, TrendingUp, Sparkles } from "lucide-react";

const TeamStatsCard = ({ totalGroups, avgScore, avgProgress }) => (
  <div className="relative overflow-hidden rounded-2xl border border-white/15 bg-gradient-to-br from-slate-900 via-[#131622] to-slate-950 p-6 text-white shadow-xl backdrop-blur-xl">
    <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-brand via-purple-500 to-mint" />
    <div className="grid grid-cols-3 gap-4 text-center sm:text-left">
      <div className="space-y-1">
        <div className="flex items-center justify-center sm:justify-start gap-1.5 text-xs text-white/60 font-medium">
          <Users className="w-3.5 h-3.5 text-brand" /> Active groups
        </div>
        <p className="text-2xl sm:text-3xl font-display font-bold text-white tracking-tight">{totalGroups}</p>
      </div>
      <div className="space-y-1 border-x border-white/10 px-3">
        <div className="flex items-center justify-center sm:justify-start gap-1.5 text-xs text-white/60 font-medium">
          <Sparkles className="w-3.5 h-3.5 text-amber" /> Avg. score
        </div>
        <p className="text-2xl sm:text-3xl font-display font-bold text-amber tracking-tight">{avgScore}</p>
      </div>
      <div className="space-y-1">
        <div className="flex items-center justify-center sm:justify-start gap-1.5 text-xs text-white/60 font-medium">
          <TrendingUp className="w-3.5 h-3.5 text-mint" /> Avg. progress
        </div>
        <p className="text-2xl sm:text-3xl font-display font-bold text-mint tracking-tight">{avgProgress}%</p>
      </div>
    </div>
  </div>
);

export default TeamStatsCard;
