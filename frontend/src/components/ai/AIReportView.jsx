import TeamPerformanceTable from "./TeamPerformanceTable";
import ProjectCompletionPrediction from "./ProjectCompletionPrediction";
import GroupChatAISummary from "./GroupChatAISummary";
import AIWarningsList from "./AIWarningsList";
import RecommendationPanel from "./RecommendationPanel";

const SectionHeading = ({ eyebrow, title }) => (
  <div className="mb-3">
    <p className="text-[11px] font-semibold uppercase tracking-wider text-brand">{eyebrow}</p>
    <p className="text-sm font-semibold text-slate-ink">{title}</p>
  </div>
);

/**
 * STEP 4K — Guide AI report/summary. Reuses the existing Step 3
 * project-performance response and existing Step 4 components; keeps
 * OBSERVED (what happened), PREDICTED (what the AI estimates) and
 * RECOMMENDED (what to do) strictly separate, per the Step 4K spec.
 */
const AIReportView = ({ groupName, data, loading, error }) => {
  if (loading) {
    return (
      <div className="bg-paper rounded-xl2 border border-slate-line p-5 shadow-panel">
        <p className="text-sm text-slate-muted">Compiling AI report…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-paper rounded-xl2 border border-slate-line p-5 shadow-panel">
        <p className="text-sm text-coral">AI analysis is temporarily unavailable.</p>
      </div>
    );
  }

  if (!data) return null;

  const sufficiency = data.dataSufficiency || {};

  return (
    <div className="space-y-6">
      <div className="bg-paper rounded-xl2 border border-slate-line p-5 shadow-panel">
        <p className="text-sm font-semibold text-slate-ink mb-1">
          {groupName ? `AI report — ${groupName}` : "AI report"}
        </p>
        <p className="text-xs text-slate-muted">
          {sufficiency.studentsAnalyzed ?? 0} student(s) analyzed
          {sufficiency.studentsWithInsufficientData
            ? `, ${sufficiency.studentsWithInsufficientData} with insufficient data`
            : ""}
          . Generated {data.generatedAt ? new Date(data.generatedAt).toLocaleString() : "just now"}.
        </p>
      </div>

      <section>
        <SectionHeading eyebrow="Observed" title="Team performance" />
        <TeamPerformanceTable
          studentAnalysis={data.studentAnalysis || []}
          performancePrediction={data.performancePrediction || []}
        />
      </section>

      <section>
        <SectionHeading eyebrow="Observed" title="Group chat analysis" />
        <GroupChatAISummary data={data.chatAnalysis} />
      </section>

      <section>
        <SectionHeading eyebrow="Predicted" title="Project completion prediction" />
        <ProjectCompletionPrediction data={data.projectCompletionPrediction} />
      </section>

      <section>
        <SectionHeading eyebrow="Observed" title="AI warnings" />
        <AIWarningsList warnings={data.warnings || []} />
      </section>

      {(data.recommendations || []).length > 0 && (
        <section>
          <SectionHeading eyebrow="Recommended" title="Next steps" />
          <RecommendationPanel recommendations={data.recommendations} />
        </section>
      )}
    </div>
  );
};

export default AIReportView;
