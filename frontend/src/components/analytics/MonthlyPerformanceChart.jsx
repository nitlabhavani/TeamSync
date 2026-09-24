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
 * Monthly performance graph — six weekly buckets covering the last ~6 weeks.
 */
const MonthlyPerformanceChart = ({ data = [], loading = false }) => (
  <div className="chart-panel bg-paper rounded-xl2 border border-slate-line p-5 shadow-panel">
    <div className="flex items-center justify-between mb-4">
      <p className="text-sm font-semibold text-slate-ink">Monthly performance</p>
      <span className="text-xs text-slate-muted">6 weekly buckets</span>
    </div>
    {loading ? (
      <p className="text-sm text-slate-muted py-12 text-center">Loading…</p>
    ) : data.length === 0 ? (
      <p className="text-sm text-slate-muted py-12 text-center">No activity this month.</p>
    ) : (
      <ResponsiveContainer width="100%" height={240}>
        <ComposedChart data={data} margin={{ left: -20, right: 10 }}>
          <defs>
            <linearGradient id="monthlyFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#5B5FEF" stopOpacity={0.32} />
              <stop offset="100%" stopColor="#5B5FEF" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="#E6E8F0" />
          <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={11} />
          <YAxis tickLine={false} axisLine={false} width={30} fontSize={11} allowDecimals={false} />
          <Tooltip
            contentStyle={{ borderRadius: 12, border: "1px solid #E6E8F0", fontSize: 12 }}
            labelStyle={{ fontWeight: 600 }}
          />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Area
            type="monotone"
            dataKey="messages"
            name="Messages"
            stroke="#5B5FEF"
            strokeWidth={2.5}
            fill="url(#monthlyFill)"
          />
          <Line
            type="monotone"
            dataKey="tasksCompleted"
            name="Tasks done"
            stroke="#22C29B"
            strokeWidth={2.5}
            dot={{ r: 3 }}
          />
          <Line
            type="monotone"
            dataKey="filesShared"
            name="Files"
            stroke="#F5A524"
            strokeWidth={2}
            dot={{ r: 3 }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    )}
  </div>
);

export default MonthlyPerformanceChart;
