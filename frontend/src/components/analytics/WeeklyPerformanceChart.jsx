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
 * Weekly performance graph — last 7 days of messages, completed tasks and
 * shared files for the signed-in student.
 */
const WeeklyPerformanceChart = ({ data = [], loading = false }) => (
  <div className="chart-panel bg-paper rounded-xl2 border border-slate-line p-5 shadow-panel">
    <div className="flex items-center justify-between mb-4">
      <p className="text-sm font-semibold text-slate-ink">Weekly performance</p>
      <span className="text-xs text-slate-muted">Last 7 days</span>
    </div>
    {loading ? (
      <p className="text-sm text-slate-muted py-12 text-center">Loading…</p>
    ) : data.length === 0 ? (
      <p className="text-sm text-slate-muted py-12 text-center">No activity in the last 7 days.</p>
    ) : (
      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={data} margin={{ left: -20, right: 10 }} barGap={2}>
          <CartesianGrid vertical={false} stroke="#E6E8F0" />
          <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={11} />
          <YAxis tickLine={false} axisLine={false} width={30} fontSize={11} allowDecimals={false} />
          <Tooltip
            contentStyle={{ borderRadius: 12, border: "1px solid #E6E8F0", fontSize: 12 }}
            labelStyle={{ fontWeight: 600 }}
          />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Bar dataKey="messages" name="Messages" fill="#5B5FEF" radius={[4, 4, 0, 0]} />
          <Bar dataKey="tasksCompleted" name="Tasks done" fill="#22C29B" radius={[4, 4, 0, 0]} />
          <Bar dataKey="filesShared" name="Files" fill="#F5A524" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    )}
  </div>
);

export default WeeklyPerformanceChart;
