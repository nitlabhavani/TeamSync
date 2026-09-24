import { useEffect, useState } from "react";
import {
  Brain,
  Loader2,
  Sparkles,
  ChevronDown,
  ChevronUp,
  Users,
  CalendarClock,
  ListChecks,
  MessageSquareText,
  Flag,
  AlertOctagon,
  ShieldAlert,
  Link2,
  Info,
  History,
} from "lucide-react";
import { classNames } from "../../utils/helperFunctions";
import * as meetingIntelligenceService from "../../services/meetingIntelligenceService";
import * as meetingService from "../../services/meetingService";

/**
 * STEP 26 — AI Meeting Intelligence panel.
 *
 * Guide/team-leader only (backend-enforced — see
 * backend/src/controllers/meetingIntelligenceController.js). A normal
 * student gets a 403 from the analyze call, which this panel treats as
 * "show the student-safe notice", never the full analysis — same pattern
 * as ProjectWhatIfPanel.jsx / ConflictResolutionPanel.jsx.
 *
 * Reuses Step 16's meetingService.getMeetings for the meeting picker (no
 * duplicate meeting list is fetched/invented). Reuses the existing
 * collapsible-card visual language from SprintPlannerPanel / ConflictResolutionPanel.
 *
 * Analysis is entirely user-triggered — nothing here polls or
 * auto-analyzes on mount, and running an analysis never mutates a task,
 * message, or ConflictSnapshot (read-only on the backend — see Part 1
 * report). Task creation from an extracted action item is intentionally
 * NOT wired here: Part 1 does not expose a task-creation endpoint for
 * Meeting Intelligence's own extraction, so this panel only ever *shows*
 * extracted action items and points to the existing task workflow — see
 * ActionItemsSection below.
 */

const OUTCOME_STYLES = {
  PRODUCTIVE: { text: "text-mint", bg: "bg-mint-soft", label: "Productive" },
  PARTIALLY_RESOLVED: { text: "text-amber", bg: "bg-amber-soft", label: "Partially Resolved" },
  UNRESOLVED: { text: "text-amber", bg: "bg-amber-soft", label: "Unresolved" },
  BLOCKED: { text: "text-coral", bg: "bg-coral-soft", label: "Blocked" },
  INSUFFICIENT_DATA: { text: "text-slate-muted", bg: "bg-cloud", label: "Insufficient Data" },
};

const PRIORITY_STYLES = {
  critical: "text-coral",
  high: "text-amber",
  medium: "text-slate-ink",
  low: "text-slate-muted",
};

const DECISION_STYLES = {
  DECISION: { text: "text-mint", bg: "bg-mint-soft", label: "Decision" },
};

const fmtDate = (d) => (d ? new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "—");
const fmtDateTime = (d) =>
  d ? new Date(d).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";

/** Maps a thrown Error's message (from apiClient's `request()`) to a
 * friendly, non-technical string — never a raw stack trace. */
function friendlyError(e) {
  const msg = e?.message || "";
  if (/403|guide or team leader/i.test(msg)) return "FORBIDDEN";
  if (/404|not found/i.test(msg)) return "Meeting not found. It may have been deleted.";
  if (/startTime must be before endTime/i.test(msg)) return "The start time must be before the end time.";
  if (/30 day limit/i.test(msg)) return "That time window is too large — please choose a range under 30 days.";
  if (/startTime\/endTime|meetingId/i.test(msg)) return "Choose a meeting or a valid time range first.";
  if (/valid dates/i.test(msg)) return "Please enter a valid start and end time.";
  if (/Could not reach/i.test(msg)) return msg; // network diagnosis message is already user-safe
  return "Couldn't analyze this meeting right now. Please try again.";
}

function EvidenceNote({ ids }) {
  const n = ids?.length || 0;
  if (!n) return null;
  return <p className="text-[11px] text-slate-muted mt-1">Based on {n} group message{n === 1 ? "" : "s"}.</p>;
}

function SectionHeading({ icon: Icon, children, count }) {
  return (
    <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-muted uppercase tracking-wide mb-2">
      <Icon className="w-3.5 h-3.5" /> {children}
      {typeof count === "number" && <span className="text-slate-ink normal-case font-normal">({count})</span>}
    </p>
  );
}

/* ---------------------------------------------------------------------- */

function MeetingPicker({ groupId, meetings, meetingsLoading, selection, setSelection }) {
  const hasMeetings = meetings.length > 0;

  return (
    <div className="space-y-3">
      {meetingsLoading && (
        <p className="flex items-center gap-2 text-sm text-slate-muted">
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading this group's meetings…
        </p>
      )}

      {!meetingsLoading && hasMeetings && selection.mode === "meeting" && (
        <div>
          <label className="block text-xs font-semibold text-slate-muted mb-1.5">Meeting</label>
          <select
            value={selection.meetingId}
            onChange={(e) => setSelection((s) => ({ ...s, meetingId: e.target.value }))}
            className="w-full bg-cloud border border-slate-line rounded-lg px-3 py-2 text-sm outline-none focus:border-brand"
          >
            <option value="">Select a meeting…</option>
            {meetings.map((m) => (
              <option key={m.id} value={m.id}>
                {m.title} — {fmtDateTime(m.when)}
              </option>
            ))}
          </select>
        </div>
      )}

      {!meetingsLoading && !hasMeetings && selection.mode === "meeting" && (
        <p className="text-sm text-slate-muted">No meetings available for analysis.</p>
      )}

      {selection.mode === "window" && (
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-slate-muted mb-1.5">From</label>
            <input
              type="datetime-local"
              value={selection.startTime}
              onChange={(e) => setSelection((s) => ({ ...s, startTime: e.target.value }))}
              className="w-full bg-cloud border border-slate-line rounded-lg px-3 py-2 text-sm outline-none focus:border-brand"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-muted mb-1.5">To</label>
            <input
              type="datetime-local"
              value={selection.endTime}
              onChange={(e) => setSelection((s) => ({ ...s, endTime: e.target.value }))}
              className="w-full bg-cloud border border-slate-line rounded-lg px-3 py-2 text-sm outline-none focus:border-brand"
            />
          </div>
        </div>
      )}

      {!meetingsLoading && (
        <button
          type="button"
          onClick={() => setSelection((s) => ({ ...s, mode: s.mode === "meeting" ? "window" : "meeting" }))}
          className="text-xs font-semibold text-brand hover:text-brand-deep transition-colors"
        >
          {selection.mode === "meeting" ? "Use a custom time window instead" : "Choose an existing meeting instead"}
        </button>
      )}
      <p className="text-xs text-slate-muted" id={`mi-privacy-${groupId}`}>
        Analysis uses group meeting data only. Private conversations are never analyzed.
      </p>
    </div>
  );
}

function DecisionsSection({ decisions = [] }) {
  return (
    <div>
      <SectionHeading icon={MessageSquareText} count={decisions.length}>Key Decisions</SectionHeading>
      {decisions.length === 0 ? (
        <p className="text-sm text-slate-muted">No explicit decisions detected.</p>
      ) : (
        <div className="space-y-2">
          {decisions.map((d, i) => {
            const style = DECISION_STYLES[d.classification] || { text: "text-slate-muted", bg: "bg-cloud", label: "Needs confirmation" };
            return (
              <div key={i} className="rounded-lg border border-slate-line/70 p-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm text-slate-ink">{d.decision}</p>
                  <span className={classNames("text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0", style.bg, style.text)}>
                    {style.label}
                  </span>
                </div>
                {typeof d.confidence === "number" && (
                  <p className="text-[11px] text-slate-muted mt-1">Confidence: {Math.round(d.confidence * 100)}%</p>
                )}
                <EvidenceNote ids={d.sourceMessageIds} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ActionItemsSection({ actionItems = [] }) {
  return (
    <div>
      <SectionHeading icon={ListChecks} count={actionItems.length}>Action Items</SectionHeading>
      {actionItems.length === 0 ? (
        <p className="text-sm text-slate-muted">No actionable items detected.</p>
      ) : (
        <div className="space-y-2">
          {actionItems.map((a, i) => (
            <div key={i} className="rounded-lg border border-slate-line/70 p-3">
              <p className="text-sm font-semibold text-slate-ink">{a.title}</p>
              <div className="flex flex-wrap gap-1.5 mt-1.5">
                <span
                  className={classNames(
                    "text-[10px] font-semibold px-2 py-0.5 rounded-full",
                    a.assigneeStatus === "RESOLVED" ? "bg-mint-soft text-mint" : "bg-cloud text-slate-muted"
                  )}
                >
                  {a.assigneeStatus === "RESOLVED" ? `Assigned: ${a.assigneeName}` : "Assignee needs confirmation"}
                </span>
                <span
                  className={classNames(
                    "text-[10px] font-semibold px-2 py-0.5 rounded-full",
                    a.deadlineStatus === "RESOLVED" ? "bg-brand-soft text-brand" : "bg-cloud text-slate-muted"
                  )}
                >
                  {a.deadlineStatus === "RESOLVED" ? `Due: ${a.deadline}` : "Deadline needs confirmation"}
                </span>
                {a.priority && (
                  <span className={classNames("text-[10px] font-semibold px-2 py-0.5 rounded-full bg-cloud", PRIORITY_STYLES[a.priority])}>
                    {a.priority.toUpperCase()} priority
                  </span>
                )}
              </div>
              {typeof a.confidence === "number" && (
                <p className="text-[11px] text-slate-muted mt-1.5">Confidence: {Math.round(a.confidence * 100)}%</p>
              )}
              <EvidenceNote ids={a.sourceMessageId ? [a.sourceMessageId] : []} />
            </div>
          ))}
          <p className="text-xs text-slate-muted bg-cloud rounded-lg px-3 py-2 mt-1">
            Action items extracted here are for review only. Task creation can be handled through the existing task
            workflow (e.g. Meetings → Convert Action Items) — analysis never creates a task automatically.
          </p>
        </div>
      )}
    </div>
  );
}

function BlockersSection({ blockers = [] }) {
  return (
    <div>
      <SectionHeading icon={AlertOctagon} count={blockers.length}>Blockers</SectionHeading>
      {blockers.length === 0 ? (
        <p className="text-sm text-slate-muted">No blockers detected.</p>
      ) : (
        <div className="space-y-2">
          {blockers.map((b, i) => (
            <div key={i} className="rounded-lg border border-slate-line/70 p-3">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm text-slate-ink">{b.text}</p>
                <span
                  className={classNames(
                    "text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0",
                    b.status === "OPEN" ? "bg-coral-soft text-coral" : "bg-mint-soft text-mint"
                  )}
                >
                  {b.status === "OPEN" ? "Open" : "Resolved"}
                </span>
              </div>
              {b.relatedTaskId && <p className="text-[11px] text-slate-muted mt-1">Related task linked.</p>}
              <EvidenceNote ids={b.sourceMessageIds} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function UnresolvedSection({ unresolvedItems = [], onViewConflicts }) {
  return (
    <div>
      <SectionHeading icon={ShieldAlert} count={unresolvedItems.length}>Unresolved Items</SectionHeading>
      {unresolvedItems.length === 0 ? (
        <p className="text-sm text-slate-muted">No unresolved items detected.</p>
      ) : (
        <div className="space-y-2">
          {unresolvedItems.map((u, i) => (
            <div key={i} className="rounded-lg border border-slate-line/70 p-3">
              <p className="text-sm text-slate-ink">{u.text}</p>
              <div className="flex items-center flex-wrap gap-2 mt-1.5">
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-cloud text-slate-muted">
                  {(u.type || "UNRESOLVED").replace(/_/g, " ")}
                </span>
                {u.existingConflictId && (
                  <button
                    type="button"
                    onClick={onViewConflicts}
                    className="inline-flex items-center gap-1 text-[11px] font-semibold text-brand hover:text-brand-deep transition-colors"
                  >
                    <Link2 className="w-3 h-3" /> Tracked in Conflict Resolution
                  </button>
                )}
              </div>
              <EvidenceNote ids={u.sourceMessageIds} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function FollowUpsSection({ followUps = [] }) {
  return (
    <div>
      <SectionHeading icon={History} count={followUps.length}>Follow-Up Items</SectionHeading>
      {followUps.length === 0 ? (
        <p className="text-sm text-slate-muted">No follow-up items detected.</p>
      ) : (
        <ul className="space-y-1.5">
          {followUps.map((f, i) => (
            <li key={i} className="text-sm text-slate-ink">
              • {f.text}
              <EvidenceNote ids={f.sourceMessageIds} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function RisksSection({ risks = [] }) {
  return (
    <div>
      <SectionHeading icon={Flag} count={risks.length}>Meeting Risks</SectionHeading>
      {risks.length === 0 ? (
        <p className="text-sm text-slate-muted">No risks mentioned.</p>
      ) : (
        <ul className="space-y-1.5">
          {risks.map((r, i) => (
            <li key={i} className="text-sm text-slate-ink">
              • {r.text}
              <EvidenceNote ids={r.sourceMessageIds} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function HealthSignals({ signals }) {
  if (!signals) return null;
  const cards = [
    { label: "Decisions", value: signals.decisionsCount },
    { label: "Action Items", value: signals.actionItemCount },
    { label: "Assigned", value: signals.assignedActionItemCount },
    { label: "Deadlines Defined", value: signals.deadlineDefinedActionItemCount },
    { label: "Blockers", value: signals.blockerCount },
    { label: "Unresolved", value: signals.unresolvedItemCount },
    { label: "Follow-ups", value: signals.followUpCount },
  ];
  return (
    <div>
      <SectionHeading icon={Sparkles}>Meeting Health</SectionHeading>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {cards.map((c) => (
          <div key={c.label} className="rounded-lg bg-cloud px-3 py-2 text-center">
            <p className="text-lg font-bold text-slate-ink">{c.value ?? 0}</p>
            <p className="text-[11px] text-slate-muted">{c.label}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function EffectivenessBlock({ effectiveness }) {
  return (
    <div>
      <SectionHeading icon={Sparkles}>Meeting Effectiveness</SectionHeading>
      {effectiveness === "INSUFFICIENT_DATA" || !effectiveness ? (
        <p className="text-sm text-slate-muted">Not enough evidence to calculate meeting effectiveness.</p>
      ) : (
        <div className="space-y-2">
          <p className="text-2xl font-bold text-slate-ink">
            {effectiveness.overall ?? "—"}
            <span className="text-sm font-medium text-slate-muted">/100</span>
          </p>
          <div className="grid grid-cols-2 gap-2 text-xs text-slate-muted">
            {["decisionClarity", "ownershipClarity", "deadlineClarity", "blockerResolution"].map((k) =>
              effectiveness[k] === null || effectiveness[k] === undefined ? null : (
                <p key={k}>
                  {k.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase())}:{" "}
                  <span className="font-semibold text-slate-ink">{Math.round(effectiveness[k] * 100)}%</span>
                </p>
              )
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ConflictsSection({ conflicts = [], onViewConflicts }) {
  if (conflicts.length === 0) return null;
  return (
    <div>
      <SectionHeading icon={ShieldAlert} count={conflicts.length}>Conflict / Attention</SectionHeading>
      <div className="space-y-2">
        {conflicts.map((c, i) => (
          <div key={i} className="rounded-lg border border-slate-line/70 p-3">
            <p className="text-sm font-semibold text-slate-ink">{c.title}</p>
            <p className="text-xs text-slate-muted mt-0.5">{c.summary}</p>
            {c.existingConflictId && (
              <button
                type="button"
                onClick={onViewConflicts}
                className="inline-flex items-center gap-1 text-[11px] font-semibold text-brand hover:text-brand-deep transition-colors mt-1.5"
              >
                <Link2 className="w-3 h-3" /> View in Conflict Resolution
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */

const MeetingIntelligencePanel = ({ groupId, isGuideOrLeader = true, onViewConflicts }) => {
  const [meetings, setMeetings] = useState([]);
  const [meetingsLoading, setMeetingsLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);

  const [selection, setSelection] = useState({ mode: "meeting", meetingId: "", startTime: "", endTime: "" });
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  const [history, setHistory] = useState([]);
  const [historyOpen, setHistoryOpen] = useState(false);

  useEffect(() => {
    if (!groupId || !isGuideOrLeader) {
      setMeetingsLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setMeetingsLoading(true);
      try {
        const list = await meetingService.getMeetings(groupId);
        if (cancelled) return;
        setMeetings(list || []);
        if (!list?.length) setSelection((s) => ({ ...s, mode: "window" }));
      } catch {
        if (!cancelled) setMeetings([]);
      } finally {
        if (!cancelled) setMeetingsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [groupId, isGuideOrLeader]);

  const loadHistory = async () => {
    try {
      const list = await meetingIntelligenceService.getMeetingIntelligenceHistory(groupId);
      setHistory(list || []);
    } catch {
      /* history is a convenience — a failed fetch shouldn't block anything else */
    }
  };

  const toggleHistory = () => {
    setHistoryOpen((v) => !v);
    if (!historyOpen && history.length === 0) loadHistory();
  };

  const canAnalyze =
    !analyzing &&
    ((selection.mode === "meeting" && selection.meetingId) ||
      (selection.mode === "window" && selection.startTime && selection.endTime));

  const runAnalysis = async () => {
    if (!canAnalyze) return;
    setAnalyzing(true);
    setError(null);
    try {
      const opts =
        selection.mode === "meeting"
          ? { meetingId: selection.meetingId }
          : { startTime: new Date(selection.startTime).toISOString(), endTime: new Date(selection.endTime).toISOString() };
      const data = await meetingIntelligenceService.analyzeMeeting(groupId, opts);
      setResult(data);
      setHistory([]); // stale — will refetch next time history is opened
    } catch (e) {
      const friendly = friendlyError(e);
      if (friendly === "FORBIDDEN") setForbidden(true);
      else setError(friendly);
    } finally {
      setAnalyzing(false);
    }
  };

  const openPastSnapshot = async (id) => {
    setError(null);
    try {
      const data = await meetingIntelligenceService.getMeetingIntelligenceById(groupId, id);
      setResult(data);
    } catch {
      setError("Couldn't load that past analysis.");
    }
  };

  if (!isGuideOrLeader || forbidden) {
    return (
      <div className="bg-paper border border-slate-line rounded-xl2 p-5 shadow-panel">
        <p className="flex items-center gap-2 text-sm font-semibold text-slate-ink mb-1">
          <Brain className="w-4 h-4 text-brand" /> AI Meeting Intelligence
        </p>
        <p className="text-sm text-slate-muted">Your guide can turn meeting discussions into structured project actions.</p>
      </div>
    );
  }

  const outcomeStyle = result ? OUTCOME_STYLES[result.outcome] || OUTCOME_STYLES.INSUFFICIENT_DATA : null;

  return (
    <div className="bg-paper border border-slate-line rounded-xl2 p-5 shadow-panel space-y-5">
      <div className="flex items-center justify-between">
        <p className="flex items-center gap-2 text-sm font-semibold text-slate-ink">
          <Brain className="w-4 h-4 text-brand" /> AI Meeting Intelligence
        </p>
        <button
          type="button"
          onClick={toggleHistory}
          className="inline-flex items-center gap-1 text-xs font-semibold text-slate-muted hover:text-slate-ink transition-colors"
        >
          <History className="w-3.5 h-3.5" /> Recent {historyOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </button>
      </div>

      {historyOpen && (
        <div className="rounded-lg bg-cloud/60 p-3 space-y-1.5">
          {history.length === 0 ? (
            <p className="text-xs text-slate-muted">No past analyses yet.</p>
          ) : (
            history.map((h) => {
              const style = OUTCOME_STYLES[h.outcome] || OUTCOME_STYLES.INSUFFICIENT_DATA;
              return (
                <button
                  key={h.id}
                  type="button"
                  onClick={() => openPastSnapshot(h.id)}
                  className="w-full flex items-center justify-between text-left text-xs px-2 py-1.5 rounded-md hover:bg-paper transition-colors"
                >
                  <span className="text-slate-ink">{fmtDateTime(h.generatedAt || h.createdAt)}</span>
                  <span className={classNames("font-semibold px-2 py-0.5 rounded-full", style.bg, style.text)}>{style.label}</span>
                </button>
              );
            })
          )}
        </div>
      )}

      <MeetingPicker groupId={groupId} meetings={meetings} meetingsLoading={meetingsLoading} selection={selection} setSelection={setSelection} />

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={runAnalysis}
          disabled={!canAnalyze}
          className="inline-flex items-center gap-1.5 bg-brand text-white text-sm font-semibold rounded-lg px-4 py-2 hover:bg-brand-deep transition-colors disabled:opacity-60"
        >
          {analyzing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
          {analyzing ? "Analyzing…" : "Analyze Meeting"}
        </button>
        <p className="text-xs text-slate-muted flex items-center gap-1">
          <Info className="w-3.5 h-3.5 shrink-0" /> Analysis never modifies project data.
        </p>
      </div>

      {error && <p className="text-sm text-coral bg-coral-soft rounded-lg px-4 py-3">{error}</p>}

      {result && (
        <div className="space-y-5 border-t border-slate-line/60 pt-5">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <p className="text-xs font-semibold text-slate-muted uppercase tracking-wide">Meeting outcome</p>
              <span className={classNames("inline-block mt-1 text-sm font-semibold px-3 py-1 rounded-full", outcomeStyle.bg, outcomeStyle.text)}>
                {outcomeStyle.label}
              </span>
            </div>
            <p className="text-xs text-slate-muted flex items-center gap-1">
              <CalendarClock className="w-3.5 h-3.5" /> {fmtDate(result.scope?.startTime)} – {fmtDate(result.scope?.endTime)}
            </p>
          </div>

          <div>
            <SectionHeading icon={MessageSquareText}>Meeting Summary</SectionHeading>
            {result.summary?.headline || result.summary?.summary ? (
              <div className="space-y-1.5">
                <p className="text-sm font-semibold text-slate-ink">{result.summary.headline}</p>
                {result.summary.summary && <p className="text-sm text-slate-muted">{result.summary.summary}</p>}
                {result.summary.topics?.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-1">
                    {result.summary.topics.map((t) => (
                      <span key={t} className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-cloud text-slate-muted">
                        {t}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <p className="text-sm text-slate-muted">Summary unavailable for this meeting.</p>
            )}
          </div>

          <HealthSignals signals={result.healthSignals} />
          <EffectivenessBlock effectiveness={result.effectiveness} />
          <DecisionsSection decisions={result.decisions} />
          <ActionItemsSection actionItems={result.actionItems} />
          <BlockersSection blockers={result.blockers} />
          <UnresolvedSection unresolvedItems={result.unresolvedItems} onViewConflicts={onViewConflicts} />
          <ConflictsSection conflicts={result.conflicts} onViewConflicts={onViewConflicts} />
          <FollowUpsSection followUps={result.followUps} />
          <RisksSection risks={result.risks} />

          {(result.priorityChanges?.length > 0 || result.responsibilityChanges?.length > 0) && (
            <div className="grid sm:grid-cols-2 gap-4">
              {result.priorityChanges?.length > 0 && (
                <div>
                  <SectionHeading icon={Flag} count={result.priorityChanges.length}>Priority Changes</SectionHeading>
                  <ul className="space-y-1">
                    {result.priorityChanges.map((p, i) => (
                      <li key={i} className="text-sm text-slate-ink">• {p.text}</li>
                    ))}
                  </ul>
                </div>
              )}
              {result.responsibilityChanges?.length > 0 && (
                <div>
                  <SectionHeading icon={Users} count={result.responsibilityChanges.length}>Responsibility Changes</SectionHeading>
                  <ul className="space-y-1">
                    {result.responsibilityChanges.map((r, i) => (
                      <li key={i} className="text-sm text-slate-ink">• {r.text}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default MeetingIntelligencePanel;
