const TeamStatsCard = ({ totalGroups, avgScore, avgProgress }) => (
  <div className="bg-ink rounded-xl2 p-5 text-white grid grid-cols-3 gap-4">
    <div>
      <p className="text-2xl font-display font-semibold">{totalGroups}</p>
      <p className="text-xs text-white/50 mt-1">Active groups</p>
    </div>
    <div>
      <p className="text-2xl font-display font-semibold">{avgScore}</p>
      <p className="text-xs text-white/50 mt-1">Avg. collaboration</p>
    </div>
    <div>
      <p className="text-2xl font-display font-semibold">{avgProgress}%</p>
      <p className="text-xs text-white/50 mt-1">Avg. progress</p>
    </div>
  </div>
);

export default TeamStatsCard;
