import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
} from "recharts";

/**
 * Weekly performance graph with glassmorphism container and modern accents.
 */
const WeeklyPerformanceChart = ({ data = [], loading = false }) => (
  <div className="chart-panel relative overflow-hidden rounded-2xl border border-slate-line/80 dark:border-white/10 bg-paper/85 dark:bg-[#151926]/85 p-5 shadow-panel backdrop-blur-md transition-all hover:border-brand/40 duration-300">
    <div className="flex items-center justify-between mb-4">
      <div>
        <p className="text-sm font-semibold text-slate-ink">Weekly Performance</p>
        <p className="text-[11px] text-slate-muted">Task velocity & engagement telemetry</p>
      </div>
      <span className="text-[11px] font-medium bg-brand/10 text-brand px-2.5 py-0.5 rounded-full">
        Last 7 days
      </span>
    </div>
    {loading ? (
      <div className="h-[240px] flex items-center justify-center text-sm text-slate-muted animate-pulse">
        Loading analytics…
      </div>
    ) : data.length === 0 ? (
      <div className="h-[240px] flex items-center justify-center text-sm text-slate-muted">
        No activity recorded in the last 7 days.
      </div>
    ) : (
      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={data} margin={{ left: -20, right: 10 }} barGap={3}>
          <CartesianGrid vertical={false} stroke="rgba(148, 163, 184, 0.15)" />
          <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={11} stroke="#94a3b8" />
          <YAxis tickLine={false} axisLine={false} width={30} fontSize={11} allowDecimals={false} stroke="#94a3b8" />
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
          <Legend wrapperStyle={{ fontSize: 11, paddingTop: 6 }} />
          <Bar dataKey="messages" name="Messages" fill="#6366F1" radius={[4, 4, 0, 0]} />
          <Bar dataKey="tasksCompleted" name="Tasks done" fill="#10B981" radius={[4, 4, 0, 0]} />
          <Bar dataKey="filesShared" name="Files" fill="#F59E0B" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    )}
  </div>
);

export default WeeklyPerformanceChart;
