const ProjectProgress = ({ label = "Project progress", progress = 0, meta }) => {
  return (
    <div className="group relative overflow-hidden rounded-2xl border border-slate-line/80 dark:border-white/10 bg-paper/85 dark:bg-[#151926]/85 p-5 shadow-panel backdrop-blur-md transition-all duration-300 hover:-translate-y-0.5 hover:border-brand/40 hover:shadow-lg">
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm font-semibold text-slate-ink">{label}</p>
        <span className="font-mono text-sm font-bold text-brand px-2 py-0.5 rounded-md bg-brand/10">{progress}%</span>
      </div>
      <div className="h-2.5 rounded-full bg-cloud dark:bg-slate-800 overflow-hidden">
        <div
          className="h-full rounded-full bg-gradient-to-r from-brand via-purple-500 to-mint transition-all duration-700 ease-out shadow-xs"
          style={{ width: `${progress}%` }}
        />
      </div>
      {meta && <p className="text-xs text-slate-muted mt-2.5 flex items-center gap-1.5 font-medium">{meta}</p>}
    </div>
  );
};

export default ProjectProgress;
