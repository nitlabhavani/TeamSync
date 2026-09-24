import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";

const ActivityChart = ({ data = [] }) => (
  <div className="chart-panel bg-paper rounded-xl2 border border-slate-line p-5 shadow-panel">
    <p className="text-sm font-medium text-slate-ink mb-4">Weekly message activity</p>
    <ResponsiveContainer width="100%" height={220}>
      <AreaChart data={data} margin={{ left: -20, right: 10 }}>
        <defs>
          <linearGradient id="activityFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#5B5FEF" stopOpacity={0.35} />
            <stop offset="100%" stopColor="#5B5FEF" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke="#E6E8F0" />
        <XAxis dataKey="day" tickLine={false} axisLine={false} />
        <YAxis tickLine={false} axisLine={false} width={30} />
        <Tooltip
          contentStyle={{ borderRadius: 12, border: "1px solid #E6E8F0", fontSize: 12 }}
          labelStyle={{ fontWeight: 600 }}
        />
        <Area type="monotone" dataKey="messages" stroke="#5B5FEF" strokeWidth={2.5} fill="url(#activityFill)" />
      </AreaChart>
    </ResponsiveContainer>
  </div>
);

export default ActivityChart;
