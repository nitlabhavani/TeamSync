import { useState, useEffect } from "react";
import {
  Upload,
  Sparkles,
  CheckCircle2,
  FolderArchive,
  Terminal,
  FileCode,
  ArrowUpRight,
  ShieldCheck,
  Download,
} from "lucide-react";

/**
 * Interactive Student Task & ZIP Submission Animation
 * Inspired by ReactBits micro-interactions, Uiverse glowing cards, and Shadcn minimalist badges.
 */
const StudentWorkspaceAnimation = () => {
  const [phase, setPhase] = useState("analyzing"); // idle -> uploading -> analyzing -> complete
  const [progress, setProgress] = useState(35);

  useEffect(() => {
    const cycle = setInterval(() => {
      setPhase((prev) => {
        if (prev === "uploading") return "analyzing";
        if (prev === "analyzing") return "complete";
        return "uploading";
      });
    }, 3200);

    return () => clearInterval(cycle);
  }, []);

  useEffect(() => {
    if (phase === "uploading") {
      setProgress(45);
    } else if (phase === "analyzing") {
      setProgress(80);
    } else {
      setProgress(100);
    }
  }, [phase]);

  return (
    <div className="relative overflow-hidden rounded-2xl border border-brand/20 bg-white/95 dark:bg-slate-900/90 p-5 shadow-xl backdrop-blur-xl space-y-4">
      {/* Top Header */}
      <div className="flex items-center justify-between pb-3 border-b border-slate-line">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-brand/10 text-brand flex items-center justify-center font-bold text-xs">
            JS
          </div>
          <div>
            <p className="text-xs font-bold text-slate-ink">task-03_authentication.zip</p>
            <p className="text-[10px] text-slate-muted">Student Task Upload · 284 KB</p>
          </div>
        </div>
        <span
          className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase transition-colors ${
            phase === "complete"
              ? "bg-mint/15 text-mint"
              : phase === "analyzing"
              ? "bg-brand/15 text-brand animate-pulse"
              : "bg-amber/15 text-amber"
          }`}
        >
          {phase === "complete" ? "✅ Verified" : phase === "analyzing" ? "⚡ AI Inspecting" : "📦 Uploading"}
        </span>
      </div>

      {/* Matching Topics Breakdown */}
      <div className="rounded-xl bg-cloud/60 p-3 space-y-2 text-[11px]">
        <p className="font-semibold text-slate-ink flex items-center gap-1.5">
          <Sparkles className="w-3.5 h-3.5 text-brand" /> AI Verification Topics:
        </p>

        <div className="grid grid-cols-2 gap-1.5">
          <div className="flex items-center gap-1.5 rounded-lg bg-white/80 dark:bg-slate-800/80 p-2 shadow-2xs">
            <CheckCircle2 className="w-3.5 h-3.5 text-mint shrink-0" />
            <span className="truncate text-slate-ink font-medium">JWT Auth Tokens</span>
          </div>
          <div className="flex items-center gap-1.5 rounded-lg bg-white/80 dark:bg-slate-800/80 p-2 shadow-2xs">
            <CheckCircle2 className="w-3.5 h-3.5 text-mint shrink-0" />
            <span className="truncate text-slate-ink font-medium">User Schema Model</span>
          </div>
          <div className="flex items-center gap-1.5 rounded-lg bg-white/80 dark:bg-slate-800/80 p-2 shadow-2xs">
            <CheckCircle2 className="w-3.5 h-3.5 text-mint shrink-0" />
            <span className="truncate text-slate-ink font-medium">REST Route Handlers</span>
          </div>
          <div className="flex items-center gap-1.5 rounded-lg bg-white/80 dark:bg-slate-800/80 p-2 shadow-2xs">
            <CheckCircle2 className="w-3.5 h-3.5 text-mint shrink-0" />
            <span className="truncate text-slate-ink font-medium">Safe Extraction</span>
          </div>
        </div>
      </div>

      {/* Progress Bar & Simple Instruction */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-xs font-semibold">
          <span className="text-slate-muted">Task Completion Score</span>
          <span className="text-brand font-mono">{progress}%</span>
        </div>
        <div className="h-2 w-full rounded-full bg-cloud overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-brand via-purple-500 to-mint transition-all duration-700 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>
        <p className="text-[10px] text-slate-muted pt-0.5">
          💡 <strong>Simple Guidance:</strong> All assigned topics covered. Forwarded for Guide approval!
        </p>
      </div>

      {/* Bottom Action Strip */}
      <div className="flex items-center justify-between pt-2 border-t border-slate-line/60 text-[11px]">
        <span className="flex items-center gap-1 text-slate-muted">
          <ShieldCheck className="w-3.5 h-3.5 text-mint" /> 0 Security Vulnerabilities
        </span>
        <span className="font-semibold text-brand flex items-center gap-1">
          Auto-Synced <ArrowUpRight className="w-3 h-3" />
        </span>
      </div>
    </div>
  );
};

export default StudentWorkspaceAnimation;
