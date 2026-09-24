const ProjectProgress = ({ label = "Project progress", progress = 0, meta }) => {
  return (
    <div className="bg-paper rounded-xl2 border border-slate-line p-5 shadow-panel">
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm font-medium text-slate-ink">{label}</p>
        <span className="font-mono text-sm font-semibold text-brand">{progress}%</span>
      </div>
      <div className="h-2.5 rounded-full bg-cloud overflow-hidden">
        <div
          className="h-full rounded-full bg-gradient-to-r from-brand to-mint transition-all duration-700"
          style={{ width: `${progress}%` }}
        />
      </div>
      {meta && <p className="text-xs text-slate-muted mt-2.5">{meta}</p>}
    </div>
  );
};

export default ProjectProgress;
