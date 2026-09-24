import { useState } from "react";
import { ListChecks, Loader2, Sparkles } from "lucide-react";
import { classNames } from "../../utils/helperFunctions";
import * as meetingService from "../../services/meetingService";

/**
 * STEP 16 — Feature 1 UI: paste raw meeting notes/transcript text and get
 * back structured action items (action / owner / deadline / priority /
 * confidence). Calls the ad-hoc POST /groups/:groupId/meeting-action-items
 * endpoint — no saved Meeting required. Additive: does not touch the
 * existing per-Meeting "Generate AI summary" flow elsewhere in the app.
 */
const priorityStyle = (p) =>
  classNames(
    "text-[11px] font-semibold px-2 py-0.5 rounded-full shrink-0",
    p === "HIGH" ? "bg-coral-soft text-coral" : p === "LOW" ? "bg-cloud text-slate-muted" : "bg-amber-soft text-amber"
  );

const MeetingActionItems = ({ groupId }) => {
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleExtract = async () => {
    setError("");
    setLoading(true);
    try {
      const data = await meetingService.extractActionItems(groupId, notes);
      setItems(data.actionItems || []);
    } catch (err) {
      setError(err?.message || "Couldn't extract action items — try again.");
      setItems(null);
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="bg-paper border border-slate-line rounded-xl2 p-5 shadow-panel">
      <p className="flex items-center gap-2 text-sm font-semibold text-slate-ink mb-3">
        <ListChecks className="w-4 h-4 text-brand" /> Meeting Action Items
      </p>
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder='Paste meeting notes, e.g. "Rohan will finish the login API by Friday. Bhavani needs to update the dashboard."'
        rows={4}
        className="w-full text-sm border border-slate-line rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand/30"
      />
      <div className="flex items-center justify-between mt-2">
        <p className="text-[11px] text-slate-muted">Extracted items are clearly separated from normal chat below.</p>
        <button
          type="button"
          onClick={handleExtract}
          disabled={loading || notes.trim().length < 10}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-white bg-brand rounded-lg px-3 py-1.5 disabled:opacity-50"
        >
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
          Extract action items
        </button>
      </div>

      {error && <p className="text-xs text-coral mt-2">{error}</p>}

      {items && (
        <div className="mt-4 space-y-2">
          {items.length === 0 ? (
            <p className="text-sm text-slate-muted">No clear action items found in that text.</p>
          ) : (
            items.map((item, i) => (
              <div key={i} className="border border-dashed border-brand/30 bg-brand/5 rounded-lg px-3 py-2">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm text-slate-ink font-medium">{item.action}</p>
                  <span className={priorityStyle(item.priority)}>{item.priority}</span>
                </div>
                <p className="text-[11px] text-slate-muted mt-1">
                  Owner: {item.owner || "Unassigned"}
                  {item.deadline ? ` · Deadline: ${item.deadline}` : ""} · Confidence:{" "}
                  {Math.round(item.confidence * 100)}%
                </p>
              </div>
            ))
          )}
        </div>
      )}
    </section>
  );
};

export default MeetingActionItems;
