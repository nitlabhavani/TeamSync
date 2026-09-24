import { useEffect, useState } from "react";
import {
  BookMarked,
  Search,
  Loader2,
  Sparkles,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  Archive,
  History,
  AlertTriangle,
  Info,
} from "lucide-react";
import { classNames } from "../../utils/helperFunctions";
import * as projectKnowledgeService from "../../services/projectKnowledgeService";

/**
 * STEP 27 — AI Project Knowledge & Decision Memory panel.
 *
 * Reading is available to any group member — a plain student gets the
 * backend's student-safe shape (ACTIVE/SUPERSEDED only, no confidence
 * reasoning, no conflict-review detail — see projectKnowledgeController.js
 * / projectKnowledgeService.shapeForStudent). Extraction, manual entry,
 * confirmation and archiving are guide/team-leader only; a student simply
 * never sees those controls (backend would 403 anyway).
 *
 * Search is user-triggered (a Search button / Enter key), never fired on
 * every keystroke (spec Phase 21). Extraction is user-triggered only —
 * nothing here polls or auto-scans on mount (spec Phase 33), matching
 * MeetingIntelligencePanel / ConflictResolutionPanel's existing pattern of
 * assistive, never-automatic AI actions.
 */

const TYPE_LABELS = {
  DECISION: "Decision",
  REQUIREMENT: "Requirement",
  TECHNICAL_CHOICE: "Technical Choice",
  PROJECT_CONVENTION: "Convention",
  RESOLVED_ISSUE: "Resolved Issue",
  MEETING_OUTCOME: "Meeting Outcome",
  IMPORTANT_CONTEXT: "Context",
};

const STATUS_STYLES = {
  CANDIDATE: { text: "text-amber", bg: "bg-amber-soft", label: "Candidate" },
  ACTIVE: { text: "text-mint", bg: "bg-mint-soft", label: "Active" },
  SUPERSEDED: { text: "text-slate-muted", bg: "bg-cloud", label: "Superseded" },
  ARCHIVED: { text: "text-slate-muted", bg: "bg-cloud", label: "Archived" },
};

const CONFIDENCE_STYLES = {
  HIGH: { text: "text-mint", label: "High confidence" },
  MEDIUM: { text: "text-amber", label: "Medium confidence" },
  LOW: { text: "text-coral", label: "Low confidence" },
};

const fmtDate = (d) => (d ? new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "—");

function friendlyError(e) {
  const msg = e?.message || "";
  if (/403|guide or team leader/i.test(msg)) return "Only the guide or team leader can manage project knowledge.";
  if (/404|not found/i.test(msg)) return "That item could not be found. It may have been removed.";
  if (/valid knowledge type|meaningful content/i.test(msg)) return "Provide a type and meaningful content.";
  if (/Could not reach/i.test(msg)) return msg;
  return "Something went wrong. Please try again.";
}

function KnowledgeCard({ item, isGuideOrLeader, onConfirm, onArchive, busy }) {
  const [open, setOpen] = useState(false);
  const statusStyle = STATUS_STYLES[item.status] || STATUS_STYLES.CANDIDATE;
  const confidenceStyle = item.confidence ? CONFIDENCE_STYLES[item.confidence] : null;
  const evidenceCount = item.sourceMessageIds?.length || 0;

  return (
    <div className="rounded-lg border border-slate-line/70 p-4">
      <button onClick={() => setOpen((v) => !v)} className="w-full flex items-start justify-between gap-3 text-left">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-brand-soft text-brand">
              {TYPE_LABELS[item.type] || item.type}
            </span>
            <span className={classNames("text-[10px] font-semibold px-2 py-0.5 rounded-full", statusStyle.bg, statusStyle.text)}>
              {statusStyle.label}
            </span>
            {confidenceStyle && (
              <span className={classNames("text-[10px] font-semibold", confidenceStyle.text)}>{confidenceStyle.label}</span>
            )}
          </div>
          <p className="text-sm font-semibold text-slate-ink mt-1.5">{item.title}</p>
          {!open && <p className="text-xs text-slate-muted mt-0.5 line-clamp-2">{item.content}</p>}
        </div>
        {open ? <ChevronUp className="w-4 h-4 text-slate-muted shrink-0 mt-1" /> : <ChevronDown className="w-4 h-4 text-slate-muted shrink-0 mt-1" />}
      </button>

      {open && (
        <div className="mt-3 space-y-3 border-t border-slate-line/60 pt-3">
          <p className="text-sm text-slate-ink whitespace-pre-wrap">{item.content}</p>

          <div className="flex flex-wrap gap-4 text-xs text-slate-muted">
            {evidenceCount > 0 && <span>Based on {evidenceCount} group message{evidenceCount === 1 ? "" : "s"}.</span>}
            {item.sourceMeetingId && <span>From a linked meeting.</span>}
            <span>Updated {fmtDate(item.updatedAt || item.createdAt)}</span>
          </div>

          {item.status === "SUPERSEDED" && (
            <p className="text-xs text-slate-muted bg-cloud rounded-lg px-3 py-2 flex items-center gap-1.5">
              <History className="w-3.5 h-3.5 shrink-0" /> Superseded by a newer decision.
            </p>
          )}

          {item.potentialConflict?.flagged && (
            <p className="text-xs text-coral bg-coral-soft rounded-lg px-3 py-2 flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> Potential conflict with an existing project decision — review before confirming.
            </p>
          )}

          {isGuideOrLeader && item.status === "CANDIDATE" && (
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => onConfirm(item.id)}
                disabled={busy}
                className="inline-flex items-center gap-1.5 text-sm font-semibold text-white bg-brand rounded-lg px-3 py-1.5 hover:bg-brand-deep transition-colors disabled:opacity-60"
              >
                {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />} Confirm
              </button>
              <button
                onClick={() => onArchive(item.id)}
                disabled={busy}
                className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-muted hover:text-slate-ink transition-colors px-3 py-1.5"
              >
                <Archive className="w-3.5 h-3.5" /> Archive
              </button>
            </div>
          )}
          {isGuideOrLeader && item.status === "ACTIVE" && (
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => onArchive(item.id)}
                disabled={busy}
                className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-muted hover:text-slate-ink transition-colors px-3 py-1.5"
              >
                <Archive className="w-3.5 h-3.5" /> Archive
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const ProjectKnowledgePanel = ({ groupId, isGuideOrLeader = true }) => {
  const [q, setQ] = useState("");
  const [type, setType] = useState("");
  const [status, setStatus] = useState("");
  const [items, setItems] = useState(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [extracting, setExtracting] = useState(false);
  const [extractNote, setExtractNote] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const runSearch = async () => {
    if (!groupId) return;
    setLoading(true);
    setError(null);
    try {
      const { items: found, meta } = await projectKnowledgeService.searchKnowledge(groupId, { q, type, status, limit: 50 });
      setItems(found);
      setTotal(meta.total ?? found.length);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (groupId) runSearch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId, type, status]);

  const handleExtract = async () => {
    setExtracting(true);
    setExtractNote(null);
    setError(null);
    try {
      const result = await projectKnowledgeService.extractKnowledgeFromMessages(groupId);
      const createdCount = result.created?.length || 0;
      const updatedCount = result.updated?.length || 0;
      setExtractNote(
        createdCount || updatedCount
          ? `Found ${createdCount} new and ${updatedCount} updated knowledge item(s) from recent group chat — review candidates below.`
          : "No new project knowledge found in recent group chat."
      );
      runSearch();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setExtracting(false);
    }
  };

  const handleConfirm = async (knowledgeId) => {
    setBusyId(knowledgeId);
    try {
      await projectKnowledgeService.confirmKnowledge(groupId, knowledgeId);
      runSearch();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusyId(null);
    }
  };

  const handleArchive = async (knowledgeId) => {
    setBusyId(knowledgeId);
    try {
      await projectKnowledgeService.archiveKnowledge(groupId, knowledgeId);
      runSearch();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="bg-paper border border-slate-line rounded-xl2 p-5 shadow-panel space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="flex items-center gap-2 text-sm font-semibold text-slate-ink">
            <BookMarked className="w-4 h-4 text-brand" /> AI Project Knowledge
          </p>
          <p className="text-xs text-slate-muted mt-0.5">Keep important project decisions and requirements easy to find.</p>
        </div>
        {isGuideOrLeader && (
          <button
            onClick={handleExtract}
            disabled={extracting}
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-white bg-brand rounded-lg px-3 py-1.5 hover:bg-brand-deep transition-colors disabled:opacity-60"
          >
            {extracting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />} Scan recent chat
          </button>
        )}
      </div>

      {extractNote && (
        <p className="text-xs text-slate-ink bg-brand-soft rounded-lg px-3 py-2 flex items-center gap-1.5">
          <Info className="w-3.5 h-3.5 shrink-0" /> {extractNote}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <div className="flex-1 min-w-[180px] relative">
          <Search className="w-3.5 h-3.5 text-slate-muted absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && runSearch()}
            placeholder="Search knowledge…"
            className="w-full bg-cloud border border-slate-line rounded-lg pl-8 pr-3 py-1.5 text-sm outline-none focus:border-brand"
          />
        </div>
        <select
          value={type}
          onChange={(e) => setType(e.target.value)}
          className="bg-cloud border border-slate-line rounded-lg px-2.5 py-1.5 text-sm outline-none focus:border-brand"
        >
          <option value="">All types</option>
          {Object.entries(TYPE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
        {isGuideOrLeader && (
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="bg-cloud border border-slate-line rounded-lg px-2.5 py-1.5 text-sm outline-none focus:border-brand"
          >
            <option value="">All statuses</option>
            <option value="CANDIDATE">Candidate</option>
            <option value="ACTIVE">Active</option>
            <option value="SUPERSEDED">Superseded</option>
            <option value="ARCHIVED">Archived</option>
          </select>
        )}
        <button
          onClick={runSearch}
          className="text-sm font-semibold text-brand bg-brand-soft rounded-lg px-3 py-1.5 hover:brightness-95 transition-all"
        >
          Search
        </button>
      </div>

      {loading && <p className="text-sm text-slate-muted">Loading project knowledge…</p>}
      {error && <p className="text-sm text-coral bg-coral-soft rounded-lg px-4 py-3">{error}</p>}

      {!loading && !error && items && items.length === 0 && (
        <p className="text-sm text-slate-muted">
          No project knowledge found yet{isGuideOrLeader ? " — scan recent group chat to get started." : "."}
        </p>
      )}

      {!loading && !error && items && items.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs text-slate-muted">{total} result{total === 1 ? "" : "s"}</p>
          {items.map((item) => (
            <KnowledgeCard
              key={item.id}
              item={item}
              isGuideOrLeader={isGuideOrLeader}
              onConfirm={handleConfirm}
              onArchive={handleArchive}
              busy={busyId === item.id}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default ProjectKnowledgePanel;
