import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";

const ActivityChart = ({ data = [] }) => (
  <div className="chart-panel relative overflow-hidden rounded-2xl border border-slate-line/80 dark:border-white/10 bg-paper/85 dark:bg-[#151926]/85 p-5 shadow-panel backdrop-blur-md transition-all hover:border-brand/40 duration-300">
    <div className="flex items-center justify-between mb-4">
      <div>
        <p className="text-sm font-semibold text-slate-ink">Weekly Message Activity</p>
        <p className="text-[11px] text-slate-muted">Collaboration traffic density</p>
      </div>
      <span className="text-[11px] font-medium bg-brand/10 text-brand px-2.5 py-0.5 rounded-full">
        Real-time
      </span>
    </div>
    <ResponsiveContainer width="100%" height={220}>
      <AreaChart data={data} margin={{ left: -20, right: 10 }}>
        <defs>
          <linearGradient id="activityFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#6366F1" stopOpacity={0.4} />
            <stop offset="100%" stopColor="#6366F1" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke="rgba(148, 163, 184, 0.15)" />
        <XAxis dataKey="day" tickLine={false} axisLine={false} stroke="#94a3b8" fontSize={11} />
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
        <Area type="monotone" dataKey="messages" stroke="#6366F1" strokeWidth={2.5} fill="url(#activityFill)" />
      </AreaChart>
    </ResponsiveContainer>
  </div>
);

export default ActivityChart;
