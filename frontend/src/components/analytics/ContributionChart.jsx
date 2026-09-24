import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell } from "recharts";

const COLORS = ["#5B5FEF", "#23C486", "#F2A93B", "#EF5B5B", "#8B5CF6", "#0EA5E9"];

const ContributionChart = ({ data = [] }) => (
  <div className="chart-panel bg-paper rounded-xl2 border border-slate-line p-5 shadow-panel">
    <p className="text-sm font-medium text-slate-ink mb-4">Contribution by member</p>
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ left: -20, right: 10 }}>
        <CartesianGrid vertical={false} stroke="#E6E8F0" />
        <XAxis dataKey="member" tickLine={false} axisLine={false} />
        <YAxis tickLine={false} axisLine={false} width={30} />
        <Tooltip contentStyle={{ borderRadius: 12, border: "1px solid #E6E8F0", fontSize: 12 }} />
        <Bar dataKey="value" radius={[8, 8, 0, 0]}>
          {data.map((_, idx) => (
            <Cell key={idx} fill={COLORS[idx % COLORS.length]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  </div>
);

export default ContributionChart;
