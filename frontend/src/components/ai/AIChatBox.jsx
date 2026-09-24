import { useState, useRef, useEffect } from "react";
import { Sparkles, Send, Loader2 } from "lucide-react";
import * as projectMemoryAssistantService from "../../services/projectMemoryAssistantService";

const SUGGESTIONS = [
  "How is my team doing this week?",
  "Who needs support right now?",
  "Summarize the last group discussion",
];

const AIChatBox = ({ onAsk, groupId, summary, aiPerf, recommendations }) => {
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [log, setLog] = useState([
    {
      from: "ai",
      text: "Ask me anything about this team's collaboration, tasks, or discussions, and I'll analyze the latest project data for you.",
    },
  ]);
  const logContainerRef = useRef(null);

  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [log, loading]);

  const resolveAnswer = async (text) => {
    // 1. If parent provided custom onAsk handler, give it priority
    if (typeof onAsk === "function") {
      const res = await onAsk(text);
      if (typeof res === "string") return res;
      if (res?.answer) return res.answer;
      if (res?.text) return res.text;
    }

    const q = text.toLowerCase().trim();

    // 2. Suggestion chip: "Summarize the last group discussion"
    if (/(summariz|what happened in).*discussion|last.*discussion|group.*discussion|chat.*discussion/i.test(q)) {
      if (summary && summary.trim() && summary !== "No summary available yet.") {
        return `Here is the summary of the team's discussion:\n\n${summary}`;
      }
      if (aiPerf?.chatAnalysis) {
        const updates = (aiPerf.chatAnalysis.progressUpdates || []).map((u) => `• ${u}`).join("\n");
        const blockers = (aiPerf.chatAnalysis.blockers || []).map((b) => `• Blocker: ${b}`).join("\n");
        const combined = [updates, blockers].filter(Boolean).join("\n\n");
        if (combined) {
          return `Here are the latest progress updates and blockers from group discussions:\n\n${combined}`;
        }
      }
    }

    // 3. Suggestion chip: "Who needs support right now?"
    if (/(who needs support|who needs help|struggling|needs support|at risk)/i.test(q)) {
      const students = aiPerf?.studentAnalysis || [];
      const atRisk = students.filter(
        (s) =>
          s.status === "at-risk" ||
          s.riskLevel === "high" ||
          s.riskLevel === "critical" ||
          s.riskLevel === "moderate" ||
          (s.overdueTasks && s.overdueTasks > 0)
      );
      if (atRisk.length > 0) {
        const lines = atRisk.map((s) => {
          const name = s.name || s.studentName || "Team Member";
          const details = s.reasons?.length
            ? s.reasons.join(", ")
            : `${s.overdueTasks || 0} overdue task(s)`;
          return `• ${name} (${s.riskLevel || s.status || "needs attention"}): ${details}`;
        });
        return `Based on current performance and task analysis, the following member(s) may need support:\n\n${lines.join("\n")}`;
      }
      if (students.length > 0) {
        return "All team members are currently on track. No members are flagged as requiring urgent intervention.";
      }
    }

    // 4. Suggestion chip: "How is my team doing this week?"
    if (/(how is (?:my |the |our )?team doing|how are we doing|team progress|project status|how is the team)/i.test(q)) {
      const parts = [];
      const ov = aiPerf?.overview;
      const pred = aiPerf?.projectCompletionPrediction;
      if (ov) {
        parts.push(`The team has completed ${ov.completedTasks ?? 0} of ${ov.totalTasks ?? 0} total tasks.`);
      }
      if (pred) {
        const predText = pred.status ? `Project delivery status is ${pred.status.toLowerCase().replace("_", " ")}` : "";
        const predDate = pred.predictedCompletionDate ? `with estimated completion around ${pred.predictedCompletionDate}` : "";
        if (predText) parts.push(`${predText}${predDate ? ` (${predDate})` : ""}.`);
      }
      if (aiPerf?.collaborationScore != null) {
        parts.push(`Current collaboration health score is ${aiPerf.collaborationScore}/100.`);
      }
      if (parts.length > 0) {
        return parts.join(" ");
      }
    }

    // 5. Query the backend Grounded Project Memory Assistant (tasks, blockers, decisions, meetings)
    if (groupId) {
      try {
        const res = await projectMemoryAssistantService.askProjectMemory(groupId, text);
        if (res?.answer && res?.confidence !== "INSUFFICIENT_DATA") {
          return res.answer;
        }
        // If confidence is INSUFFICIENT_DATA, check if we can fall back to recommendations
        if (recommendations?.length && /(recommend|advice|action|improve)/i.test(q)) {
          const recLines = recommendations
            .slice(0, 3)
            .map((r) => `• ${typeof r === "string" ? r : r.text || r.title}`)
            .join("\n");
          return `Here are the top AI recommendations for this team:\n\n${recLines}`;
        }
        if (res?.answer) {
          return res.answer;
        }
      } catch (err) {
        console.warn("askProjectMemory request failed:", err);
      }
    }

    // 6. Generic advice query fallback
    if (recommendations?.length && /(recommend|advice|action|improve)/i.test(q)) {
      const recLines = recommendations
        .slice(0, 3)
        .map((r) => `• ${typeof r === "string" ? r : r.text || r.title}`)
        .join("\n");
      return `Here are the top recommendations for this team:\n\n${recLines}`;
    }

    return "I couldn't find specific recorded information for that question in this team's tasks, meetings, or decisions. Try asking about team progress, blockers, overdue tasks, or discussion summaries.";
  };

  const ask = async (q) => {
    const text = q ?? question;
    if (!text || !text.trim() || loading) return;
    const cleanText = text.trim();
    setLog((prev) => [...prev, { from: "user", text: cleanText }]);
    setQuestion("");
    setLoading(true);

    try {
      const answer = await resolveAnswer(cleanText);
      setLog((prev) => [...prev, { from: "ai", text: answer }]);
    } catch (err) {
      console.error("AI Assistant error:", err);
      setLog((prev) => [
        ...prev,
        {
          from: "ai",
          text: "Sorry, I encountered an error while retrieving project information. Please try again.",
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-paper rounded-xl2 border border-slate-line shadow-panel flex flex-col h-full">
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-line">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-brand" />
          <p className="text-sm font-semibold text-slate-ink">Ask the AI assistant</p>
        </div>
        <span className="text-[11px] font-medium text-slate-muted bg-cloud px-2 py-0.5 rounded-md">
          Grounded Analysis
        </span>
      </div>

      <div
        ref={logContainerRef}
        className="flex-1 overflow-y-auto scrollbar-thin px-5 py-4 space-y-3 min-h-0"
      >
        {log.map((entry, idx) => (
          <div
            key={idx}
            className={`text-sm rounded-xl px-3.5 py-2.5 max-w-[88%] whitespace-pre-line leading-relaxed ${
              entry.from === "ai"
                ? "bg-brand-soft text-brand-deep shadow-sm"
                : "bg-cloud text-slate-ink ml-auto"
            }`}
          >
            {entry.text}
          </div>
        ))}
        {loading && (
          <div className="flex items-center gap-2 text-xs text-brand bg-brand-soft rounded-xl px-3.5 py-2.5 max-w-[85%]">
            <Loader2 className="w-3.5 h-3.5 animate-spin text-brand shrink-0" />
            <span>AI assistant is analyzing team data…</span>
          </div>
        )}
      </div>

      <div className="px-5 pb-2.5 pt-1 flex flex-wrap gap-1.5">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            disabled={loading}
            onClick={() => ask(s)}
            className="text-xs bg-cloud hover:bg-slate-line text-slate-ink px-2.5 py-1.5 rounded-full transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-left"
          >
            {s}
          </button>
        ))}
      </div>

      <div className="px-5 pb-4 pt-1 flex items-center gap-2">
        <input
          value={question}
          disabled={loading}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && ask()}
          placeholder="Ask about team progress, blockers, meetings…"
          className="flex-1 bg-cloud rounded-full px-4 py-2.5 text-sm outline-none placeholder:text-slate-muted border border-transparent focus:border-brand transition-colors disabled:opacity-60"
        />
        <button
          onClick={() => ask()}
          disabled={loading || !question.trim()}
          aria-label="Send question"
          className="w-10 h-10 rounded-full bg-brand hover:bg-brand/90 disabled:bg-slate-muted/40 disabled:cursor-not-allowed flex items-center justify-center shrink-0 transition-colors shadow-sm"
        >
          {loading ? (
            <Loader2 className="w-4 h-4 text-white animate-spin" />
          ) : (
            <Send className="w-4 h-4 text-white" />
          )}
        </button>
      </div>
    </div>
  );
};

export default AIChatBox;
