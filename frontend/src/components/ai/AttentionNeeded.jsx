import { Zap } from "lucide-react";
import { classNames } from "../../utils/helperFunctions";

/**
 * STEP 16 — Student "⚡ AI Attention Needed" section.
 * Only ever fed the caller's OWN early-warning tasks and OWN collaboration
 * status — teamRiskController.js#shapeForStudent already strips everything
 * about other students/guide-only info/plagiarism sources before this data
 * ever reaches the client, so there is nothing further to filter here.
 */
const AttentionNeeded = ({ earlyWarnings = [], collaboration = null }) => {
  const hasWarnings = earlyWarnings.length > 0;
  const hasCollabFlag = collaboration && collaboration.riskLevel !== "LOW";

  if (!hasWarnings && !hasCollabFlag) return null;

  return (
    <div className="bg-amber-soft border border-amber/20 rounded-xl2 p-5">
      <p className="flex items-center gap-2 text-sm font-semibold text-slate-ink mb-2">
        <Zap className="w-4 h-4 text-amber" /> ⚡ AI Attention Needed
      </p>

      {hasWarnings && (
        <div className="space-y-2 mb-2">
          {earlyWarnings.map((w) => (
            <div key={w.taskId} className="text-sm text-slate-ink">
              <span className="font-medium">{w.title}</span> — {w.reason}
              <span
                className={classNames(
                  "ml-2 text-[11px] font-semibold px-2 py-0.5 rounded-full",
                  w.level === "AT_RISK" ? "bg-coral-soft text-coral" : "bg-amber-soft text-amber"
                )}
              >
                {w.level.replace("_", " ")}
              </span>
              <p className="text-xs text-slate-muted mt-0.5">{w.recommendedAction}</p>
            </div>
          ))}
        </div>
      )}

      {hasCollabFlag && (
        <p className="text-xs text-slate-muted">{collaboration.recommendation}</p>
      )}
    </div>
  );
};

export default AttentionNeeded;
