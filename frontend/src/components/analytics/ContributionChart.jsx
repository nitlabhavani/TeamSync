import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell } from "recharts";

const COLORS = ["#6366F1", "#10B981", "#F59E0B", "#EF4444", "#8B5CF6", "#06B6D4"];

const ContributionChart = ({ data = [] }) => (
  <div className="chart-panel relative overflow-hidden rounded-2xl border border-slate-line/80 dark:border-white/10 bg-paper/85 dark:bg-[#151926]/85 p-5 shadow-panel backdrop-blur-md transition-all hover:border-brand/40 duration-300">
    <div className="flex items-center justify-between mb-4">
      <div>
        <p className="text-sm font-semibold text-slate-ink">Contribution by Member</p>
        <p className="text-[11px] text-slate-muted">Peer relative workload balance</p>
      </div>
      <span className="text-[11px] font-medium bg-mint/10 text-mint px-2.5 py-0.5 rounded-full">
        Balanced
      </span>
    </div>
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ left: -20, right: 10 }}>
        <CartesianGrid vertical={false} stroke="rgba(148, 163, 184, 0.15)" />
        <XAxis dataKey="member" tickLine={false} axisLine={false} stroke="#94a3b8" fontSize={11} />
        <YAxis tickLine={false} axisLine={false} width={30} stroke="#94a3b8" fontSize={11} />
        <Tooltip
          contentStyle={{
            borderRadius: 12,
            border: "1px solid rgba(255,255,255,0.15)",
            backgroundColor: "rgba(15, 23, 42, 0.9)",
            backdropFilter: "blur(12px)",
            color: "#fff",
            fontSize: 12,
            boxShadow: "0 10px 25px -5px rgba(0,0,0,0.3)",
          }}
          labelStyle={{ fontWeight: 600, color: "#fff" }}
        />
        <Bar dataKey="value" radius={[6, 6, 0, 0]}>
          {data.map((_, idx) => (
            <Cell key={idx} fill={COLORS[idx % COLORS.length]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  </div>
);

export default ContributionChart;
