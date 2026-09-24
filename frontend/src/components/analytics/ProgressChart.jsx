import { RadialBarChart, RadialBar, ResponsiveContainer, PolarAngleAxis } from "recharts";

const ProgressChart = ({ progress = 0, label = "Overall progress" }) => (
  <div className="chart-panel bg-paper rounded-xl2 border border-slate-line p-5 shadow-panel flex flex-col items-center">
    <p className="text-sm font-medium text-slate-ink self-start mb-2">{label}</p>
    <ResponsiveContainer width="100%" height={180}>
      <RadialBarChart
        innerRadius="70%"
        outerRadius="100%"
        data={[{ value: progress, fill: "#5B5FEF" }]}
        startAngle={90}
        endAngle={-270}
      >
        <PolarAngleAxis type="number" domain={[0, 100]} angleAxisId={0} tick={false} />
        <RadialBar background={{ fill: "#F5F6FA" }} dataKey="value" cornerRadius={12} />
      </RadialBarChart>
    </ResponsiveContainer>
    <p className="font-display text-2xl font-semibold text-slate-ink -mt-16">{progress}%</p>
  </div>
);

export default ProgressChart;
