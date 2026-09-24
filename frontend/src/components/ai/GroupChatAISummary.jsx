import { MessagesSquare } from "lucide-react";

/**
 * STEP 4G — Step 3 `chatAnalysis`. GROUP CHAT ONLY: the backend
 * (reportController.projectPerformance) only ever sends group messages to
 * the AI engine — private/direct messages use a different model field and
 * are never included — and the engine itself sets `privateChatAnalysed:
 * false` on this object. This component only renders that group-scoped
 * object; it never requests or displays private chat data.
 */
const GroupChatAISummary = ({ data, loading, error }) => {
  if (loading) {
    return (
      <div className="bg-paper rounded-xl2 border border-slate-line p-5 shadow-panel">
        <p className="text-sm text-slate-muted">Analyzing group chat…</p>
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

  const insufficient = data.status === "insufficient_data";

  return (
    <div className="bg-paper rounded-xl2 border border-slate-line p-5 shadow-panel">
      <div className="flex items-center gap-2 mb-3">
        <MessagesSquare className="w-4 h-4 text-brand" />
        <p className="text-sm font-medium text-slate-ink">Group chat AI summary</p>
      </div>

      {insufficient ? (
        <p className="text-sm text-slate-muted">No sufficient project-chat evidence available.</p>
      ) : (
        <>
          <p className="text-sm text-slate-ink mb-4">{data.summary}</p>

          <div className="grid sm:grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-xs font-semibold text-slate-muted uppercase tracking-wide mb-1.5">
                Progress updates ({(data.progressUpdates || []).length})
              </p>
              {(data.progressUpdates || []).length === 0 ? (
                <p className="text-xs text-slate-muted">None found.</p>
              ) : (
                <ul className="space-y-1">
                  {data.progressUpdates.slice(0, 5).map((p, i) => (
                    <li key={i} className="text-slate-ink">
                      "{p.text}"
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <p className="text-xs font-semibold text-coral uppercase tracking-wide mb-1.5">
                Blockers ({(data.blockers || []).length})
              </p>
              {(data.blockers || []).length === 0 ? (
                <p className="text-xs text-slate-muted">None found.</p>
              ) : (
                <ul className="space-y-1">
                  {data.blockers.slice(0, 5).map((b, i) => (
                    <li key={i} className="text-slate-ink">
                      "{b.text}"
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-muted uppercase tracking-wide mb-1.5">
                Unanswered questions ({(data.unansweredQuestions || []).length})
              </p>
              {(data.unansweredQuestions || []).length === 0 ? (
                <p className="text-xs text-slate-muted">None found.</p>
              ) : (
                <ul className="space-y-1">
                  {data.unansweredQuestions.slice(0, 5).map((q, i) => (
                    <li key={i} className="text-slate-ink">
                      "{q.text}"
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <p className="text-xs font-semibold text-amber uppercase tracking-wide mb-1.5">Risk signals</p>
              {(data.riskSignals || []).length === 0 ? (
                <p className="text-xs text-slate-muted">None found.</p>
              ) : (
                <ul className="space-y-1">
                  {data.riskSignals.map((s, i) => (
                    <li key={i} className="text-slate-ink">
                      {s}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {(data.collaborationObservations || []).length > 0 && (
            <div className="mt-4 pt-4 border-t border-slate-line">
              <p className="text-xs font-semibold text-slate-muted uppercase tracking-wide mb-1.5">
                Collaboration observations
              </p>
              <ul className="space-y-1">
                {data.collaborationObservations.map((o, i) => (
                  <li key={i} className="text-sm text-slate-ink">
                    {o}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default GroupChatAISummary;
