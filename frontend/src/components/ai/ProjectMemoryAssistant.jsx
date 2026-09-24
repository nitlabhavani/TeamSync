import { useRef, useState } from "react";
import {
  MessageCircleQuestion,
  Loader2,
  Sparkles,
  Send,
  FileText,
  Info,
  ShieldCheck,
  ListChecks,
} from "lucide-react";
import { classNames } from "../../utils/helperFunctions";
import * as projectMemoryAssistantService from "../../services/projectMemoryAssistantService";

/**
 * STEP 28 — AI Project Memory Assistant / Contextual Project Q&A panel.
 *
 * Grounded deterministic retrieval, not a general chatbot: every answer
 * either cites real evidence (Project Knowledge, Meeting Intelligence,
 * Conflicts, Tasks, or reused Health/Forecast/Risk/Sprint results) or
 * explicitly says there isn't enough project information to answer.
 *
 * Available to any group member — the backend shapes the answer for a
 * plain student automatically (own tasks only, involved-conflicts only,
 * no guide-only meeting/health/forecast/risk/sprint detail). Nothing here
 * decides authorization; this panel just displays whatever the backend
 * already decided was safe to return.
 *
 * Asking is entirely user-triggered (Ask button / Enter key) — nothing
 * here polls or auto-asks on mount.
 */

const EXAMPLE_QUESTIONS = [
  "What decisions were made?",
  "What are the current blockers?",
  "What happened in the last meeting?",
  "What tasks are overdue?",
  "How is the project doing?",
  "What conflicts are open?",
];

const INTENT_LABELS = {
  PROJECT_OVERVIEW: "Project overview",
  DECISIONS: "Decisions",
  RECENT_DECISIONS: "Recent decisions",
  DECISION_REASON: "Decision reasoning",
  TASK_STATUS: "Task status",
  TASK_ASSIGNMENT: "Task assignment",
  DEADLINES: "Deadlines",
  BLOCKERS: "Blockers",
  RISKS: "Team risk",
  CONFLICTS: "Conflicts",
  MEETING_SUMMARY: "Meeting summary",
  MEETING_ACTION_ITEMS: "Meeting action items",
  FOLLOW_UPS: "Follow-ups",
  PROJECT_HEALTH: "Project health",
  PROJECT_FORECAST: "Project forecast",
  SPRINT_STATUS: "Sprint status",
  KNOWLEDGE_SEARCH: "Knowledge search",
  UNKNOWN: "General",
};

const CONFIDENCE_STYLES = {
  HIGH: { text: "text-mint", bg: "bg-mint-soft", label: "High confidence" },
  MEDIUM: { text: "text-amber", bg: "bg-amber-soft", label: "Medium confidence" },
  LOW: { text: "text-coral", bg: "bg-coral-soft", label: "Low confidence" },
  INSUFFICIENT_DATA: { text: "text-slate-muted", bg: "bg-cloud", label: "Insufficient data" },
};

function friendlyError(e) {
  const msg = e?.message || "";
  if (/question is required/i.test(msg)) return "Please type a question first.";
  if (/too long/i.test(msg)) return "That question is too long — try a shorter one.";
  if (/403|not part of this group/i.test(msg)) return "You don't have access to this group's project memory.";
  if (/Could not reach/i.test(msg)) return msg;
  return "Something went wrong. Please try again.";
}

function AnswerCard({ result }) {
  const confidenceStyle = CONFIDENCE_STYLES[result.confidence] || CONFIDENCE_STYLES.INSUFFICIENT_DATA;
  const hasEvidence = (result.evidence || []).length > 0;

  return (
    <div className="rounded-lg border border-slate-line/70 p-4 space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-brand-soft text-brand">
          {INTENT_LABELS[result.intent] || result.intent}
        </span>
        <span className={classNames("text-[10px] font-semibold px-2 py-0.5 rounded-full", confidenceStyle.bg, confidenceStyle.text)}>
          {confidenceStyle.label}
        </span>
      </div>

      <p className="text-sm text-slate-ink whitespace-pre-wrap leading-relaxed">{result.answer}</p>

      {hasEvidence && (
        <div className="border-t border-slate-line/60 pt-3 space-y-1.5">
          <p className="text-xs font-semibold text-slate-muted flex items-center gap-1.5">
            <FileText className="w-3.5 h-3.5" /> Evidence
          </p>
          <ul className="space-y-1">
            {result.evidence.map((ev, i) => (
              <li key={`${ev.sourceType}-${ev.sourceId}-${i}`} className="text-xs text-slate-muted bg-cloud rounded-lg px-3 py-2">
                <span className="font-semibold text-slate-ink">{ev.label}</span>
                {ev.snippet ? <span> — {ev.snippet}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      )}

      {result.relatedItems?.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-semibold text-slate-muted flex items-center gap-1.5">
            <ListChecks className="w-3.5 h-3.5" /> Related items
          </p>
          <ul className="list-disc list-inside text-xs text-slate-muted">
            {result.relatedItems.map((r, i) => (
              <li key={`${r.type}-${r.id}-${i}`}>{r.title}</li>
            ))}
          </ul>
        </div>
      )}

      {result.limitations?.length > 0 && (
        <div className="space-y-1">
          {result.limitations.map((l, i) => (
            <p key={i} className="text-xs text-slate-muted flex items-start gap-1.5">
              <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" /> {l}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

const ProjectMemoryAssistant = ({ groupId }) => {
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  // Defensive race-condition guard (no reproducible bug found in
  // askProjectMemory's actual request/response flow — see final report —
  // but this closes the theoretical gap if two asks are ever in flight at
  // once, e.g. a slow first request and a fast second one): only the
  // response to the MOST RECENTLY sent question is ever applied to state.
  const latestRequestId = useRef(0);

  const runAsk = async (text) => {
    const q = (text ?? question).trim();
    if (!q || !groupId) return;
    const requestId = ++latestRequestId.current;
    setAsking(true);
    setError(null);
    try {
      const data = await projectMemoryAssistantService.askProjectMemory(groupId, q);
      if (requestId !== latestRequestId.current) return; // a newer question already superseded this one
      setResult(data);
    } catch (e) {
      if (requestId !== latestRequestId.current) return;
      setError(friendlyError(e));
      setResult(null);
    } finally {
      if (requestId === latestRequestId.current) setAsking(false);
    }
  };

  const handleChip = (q) => {
    setQuestion(q);
    runAsk(q);
  };

  return (
    <div className="bg-paper border border-slate-line rounded-xl2 p-5 shadow-panel space-y-4">
      <div>
        <p className="flex items-center gap-2 text-sm font-semibold text-slate-ink">
          <MessageCircleQuestion className="w-4 h-4 text-brand" /> AI Project Memory Assistant
        </p>
        <p className="text-xs text-slate-muted mt-0.5">
          Ask grounded questions about project decisions, tasks, meetings, risks and current project status.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <div className="flex-1 min-w-[220px] relative">
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && runAsk()}
            placeholder="Ask about decisions, tasks, meetings, blockers…"
            className="w-full bg-cloud border border-slate-line rounded-lg pl-3 pr-3 py-2 text-sm outline-none focus:border-brand"
          />
        </div>
        <button
          onClick={() => runAsk()}
          disabled={asking || !question.trim()}
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-white bg-brand rounded-lg px-3 py-2 hover:bg-brand-deep transition-colors disabled:opacity-60"
        >
          {asking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />} Ask
        </button>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {EXAMPLE_QUESTIONS.map((q) => (
          <button
            key={q}
            onClick={() => handleChip(q)}
            disabled={asking}
            className="inline-flex items-center gap-1 text-xs font-medium text-brand bg-brand-soft rounded-full px-2.5 py-1 hover:brightness-95 transition-all disabled:opacity-60"
          >
            <Sparkles className="w-3 h-3" /> {q}
          </button>
        ))}
      </div>

      {error && <p className="text-sm text-coral bg-coral-soft rounded-lg px-4 py-3">{error}</p>}

      {asking && !result && <p className="text-sm text-slate-muted">Thinking through the project's stored knowledge…</p>}

      {!asking && result && <AnswerCard result={result} />}

      {!asking && !result && !error && (
        <p className="text-sm text-slate-muted">
          Try one of the example questions above, or ask your own. Answers are grounded only in this
          group's real, stored project information — never invented.
        </p>
      )}

      <p className="text-xs text-slate-muted flex items-center gap-1.5 border-t border-slate-line/60 pt-3">
        <ShieldCheck className="w-3.5 h-3.5 shrink-0" /> Private/direct messages are never read by this assistant. Answers only use
        this group's own project knowledge, tasks, meetings and conflicts.
      </p>
    </div>
  );
};

export default ProjectMemoryAssistant;
