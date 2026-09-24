import { useEffect, useState } from "react";
import {
  ShieldAlert, Users, ClipboardList, ChevronDown, ChevronUp,
  CheckCircle2, XCircle, Loader2, Info,
} from "lucide-react";
import { classNames } from "../../utils/helperFunctions";
import * as conflictService from "../../services/conflictService";

/**
 * STEP 24 — AI Conflict Detection & Resolution.
 *
 * Guide/team-leader only (backend-enforced — see conflictController.js).
 * This is a review/decision UI: nothing here mutates a task, reassigns
 * anyone, or disciplines anyone. The only actions available are
 * Acknowledge / Resolve / Dismiss, which change the ConflictSnapshot's own
 * status — never the underlying chat, task, or user records.
 *
 * Purely additive alongside TeamPerformanceInsights / SprintPlannerPanel /
 * TeamRisk cards.
 */

const SEVERITY_STYLES = {
  LOW: { text: "text-slate-muted", bg: "bg-cloud", label: "LOW" },
  MEDIUM: { text: "text-amber", bg: "bg-amber-soft", label: "MEDIUM" },
  HIGH: { text: "text-coral", bg: "bg-coral-soft", label: "HIGH" },
  CRITICAL: { text: "text-coral", bg: "bg-coral-soft", label: "CRITICAL" },
};

const STATUS_STYLES = {
  OPEN: { text: "text-amber", bg: "bg-amber-soft", label: "Open" },
  ACKNOWLEDGED: { text: "text-brand", bg: "bg-brand-soft", label: "Acknowledged" },
  RESOLVED: { text: "text-mint", bg: "bg-mint-soft", label: "Resolved" },
  DISMISSED: { text: "text-slate-muted", bg: "bg-cloud", label: "Dismissed" },
};

const fmtDate = (d) => (d ? new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "—");

function ConflictRow({ conflict, onAction, busyId }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [showNoteFor, setShowNoteFor] = useState(null); // "resolve" | "dismiss" | null
  const severityStyle = SEVERITY_STYLES[conflict.severity] || SEVERITY_STYLES.LOW;
  const statusStyle = STATUS_STYLES[conflict.status] || STATUS_STYLES.OPEN;
  const busy = busyId === conflict.id;

  const submitNote = (action) => {
    onAction(conflict.id, action, note);
    setShowNoteFor(null);
    setNote("");
  };

  return (
    <div className="rounded-lg border border-slate-line/70 p-4">
      <button onClick={() => setOpen((v) => !v)} className="w-full flex items-start justify-between gap-3 text-left">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={classNames("text-[10px] font-semibold px-2 py-0.5 rounded-full", severityStyle.bg, severityStyle.text)}>
              {severityStyle.label}
            </span>
            <span className={classNames("text-[10px] font-semibold px-2 py-0.5 rounded-full", statusStyle.bg, statusStyle.text)}>
              {statusStyle.label}
            </span>
          </div>
          <p className="text-sm font-semibold text-slate-ink mt-1.5">{conflict.title}</p>
          <p className="text-xs text-slate-muted mt-0.5">{conflict.summary}</p>
        </div>
        {open ? <ChevronUp className="w-4 h-4 text-slate-muted shrink-0 mt-1" /> : <ChevronDown className="w-4 h-4 text-slate-muted shrink-0 mt-1" />}
      </button>

      {open && (
        <div className="mt-3 space-y-3 border-t border-slate-line/60 pt-3">
          <div className="flex flex-wrap gap-4 text-xs text-slate-muted">
            <span className="flex items-center gap-1"><Users className="w-3.5 h-3.5" /> {conflict.involvedUserIds?.length || 0} member(s)</span>
            {conflict.relatedTaskId && <span className="flex items-center gap-1"><ClipboardList className="w-3.5 h-3.5" /> Related task linked</span>}
            <span>Detected {fmtDate(conflict.detectedAt || conflict.createdAt)}</span>
          </div>

          {conflict.evidence?.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-slate-muted mb-1">Evidence</p>
              <ul className="space-y-0.5">
                {conflict.evidence.map((e, i) => (
                  <li key={i} className="text-sm text-slate-ink">• {e}</li>
                ))}
              </ul>
            </div>
          )}

          {conflict.recommendation && (
            <p className="text-sm text-slate-ink bg-brand-soft rounded-lg px-3 py-2">
              💡 <strong>Recommended:</strong> {conflict.recommendation}
            </p>
          )}

          {conflict.status === "RESOLVED" || conflict.status === "DISMISSED" ? (
            conflict.resolutionNote && (
              <p className="text-xs text-slate-muted italic">"{conflict.resolutionNote}"</p>
            )
          ) : (
            <div className="space-y-2">
              {showNoteFor && (
                <div className="space-y-1.5">
                  <textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Resolution note (optional)…"
                    rows={2}
                    className="w-full bg-cloud border border-slate-line rounded-lg px-3 py-2 text-sm outline-none focus:border-brand resize-none"
                  />
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                {conflict.status === "OPEN" && (
                  <button
                    onClick={() => onAction(conflict.id, "acknowledge")}
                    disabled={busy}
                    className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-ink bg-cloud rounded-lg px-3 py-1.5 hover:bg-slate-line/60 transition-colors disabled:opacity-60"
                  >
                    {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Info className="w-3.5 h-3.5" />} Acknowledge
                  </button>
                )}
                {showNoteFor === "resolve" ? (
                  <button onClick={() => submitNote("resolve")} disabled={busy} className="inline-flex items-center gap-1.5 text-sm font-semibold text-white bg-brand rounded-lg px-3 py-1.5 hover:bg-brand-deep transition-colors disabled:opacity-60">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Confirm Resolve
                  </button>
                ) : (
                  <button onClick={() => setShowNoteFor("resolve")} disabled={busy} className="inline-flex items-center gap-1.5 text-sm font-semibold text-white bg-brand rounded-lg px-3 py-1.5 hover:bg-brand-deep transition-colors disabled:opacity-60">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Resolve
                  </button>
                )}
                {showNoteFor === "dismiss" ? (
                  <button onClick={() => submitNote("dismiss")} disabled={busy} className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-muted hover:text-slate-ink transition-colors px-3 py-1.5">
                    <XCircle className="w-3.5 h-3.5" /> Confirm Dismiss
                  </button>
                ) : (
                  <button onClick={() => setShowNoteFor("dismiss")} disabled={busy} className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-muted hover:text-slate-ink transition-colors px-3 py-1.5">
                    <XCircle className="w-3.5 h-3.5" /> Dismiss
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const ConflictResolutionPanel = ({ groupId }) => {
  const [conflicts, setConflicts] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const load = () => {
    setLoading(true);
    setError(null);
    conflictService
      .getConflicts(groupId)
      .then(setConflicts)
      .catch(() => setError("Couldn't load conflict data."))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (groupId) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId]);

  const handleAction = async (conflictId, action, note) => {
    setBusyId(conflictId);
    try {
      const fn = { acknowledge: conflictService.acknowledgeConflict, resolve: conflictService.resolveConflict, dismiss: conflictService.dismissConflict }[action];
      const updated = await fn(groupId, conflictId, note);
      setConflicts((prev) => (prev || []).map((c) => (c.id === conflictId ? updated : c)));
    } catch {
      /* leave the list as-is; the row itself still shows current state */
    } finally {
      setBusyId(null);
    }
  };

  const openCount = (conflicts || []).filter((c) => c.status === "OPEN" || c.status === "ACKNOWLEDGED").length;

  return (
    <div className="bg-paper border border-slate-line rounded-xl2 p-5 shadow-panel space-y-4">
      <div className="flex items-center justify-between">
        <p className="flex items-center gap-2 text-sm font-semibold text-slate-ink">
          <ShieldAlert className="w-4 h-4 text-brand" /> AI Conflict Resolution
        </p>
        {conflicts && <span className="text-xs font-semibold text-slate-muted">Open: {openCount}</span>}
      </div>

      {loading && <p className="text-sm text-slate-muted">Checking recent group chat for collaboration issues…</p>}
      {error && <p className="text-sm text-coral bg-coral-soft rounded-lg px-4 py-3">{error}</p>}

      {!loading && !error && conflicts && conflicts.length === 0 && (
        <p className="text-sm text-slate-muted">No collaboration conflicts detected in this group's recent chat.</p>
      )}

      {!loading && !error && conflicts && conflicts.length > 0 && (
        <div className="space-y-2">
          {conflicts.map((c) => (
            <ConflictRow key={c.id} conflict={c} onAction={handleAction} busyId={busyId} />
          ))}
        </div>
      )}
    </div>
  );
};

export default ConflictResolutionPanel;
