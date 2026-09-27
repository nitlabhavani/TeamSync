import {
  ComposedChart,
  Line,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
} from "recharts";

/**
 * Monthly performance graph with gradient area fills and glassmorphism.
 */
const MonthlyPerformanceChart = ({ data = [], loading = false }) => (
  <div className="chart-panel relative overflow-hidden rounded-2xl border border-slate-line/80 dark:border-white/10 bg-paper/85 dark:bg-[#151926]/85 p-5 shadow-panel backdrop-blur-md transition-all hover:border-brand/40 duration-300">
    <div className="flex items-center justify-between mb-4">
      <div>
        <p className="text-sm font-semibold text-slate-ink">Monthly Performance</p>
        <p className="text-[11px] text-slate-muted">Cumulative productivity trend</p>
      </div>
      <span className="text-[11px] font-medium bg-brand/10 text-brand px-2.5 py-0.5 rounded-full">
        6 weekly buckets
      </span>
    </div>
    {loading ? (
      <div className="h-[240px] flex items-center justify-center text-sm text-slate-muted animate-pulse">
        Loading analytics…
      </div>
    ) : data.length === 0 ? (
      <div className="h-[240px] flex items-center justify-center text-sm text-slate-muted">
        No activity recorded this month.
      </div>
    ) : (
      <ResponsiveContainer width="100%" height={240}>
        <ComposedChart data={data} margin={{ left: -20, right: 10 }}>
          <defs>
            <linearGradient id="monthlyFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#6366F1" stopOpacity={0.35} />
              <stop offset="100%" stopColor="#6366F1" stopOpacity={0} />
            </linearGradient>
          </defs>
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
          <Area
            type="monotone"
            dataKey="messages"
            name="Messages"
            stroke="#6366F1"
            strokeWidth={2.5}
            fill="url(#monthlyFill)"
          />
          <Line
            type="monotone"
            dataKey="tasksCompleted"
            name="Tasks done"
            stroke="#10B981"
            strokeWidth={2.5}
            dot={{ r: 3.5, fill: "#10B981" }}
          />
          <Line
            type="monotone"
            dataKey="filesShared"
            name="Files"
            stroke="#F59E0B"
            strokeWidth={2}
            dot={{ r: 3, fill: "#F59E0B" }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    )}
  </div>
);

export default MonthlyPerformanceChart;
