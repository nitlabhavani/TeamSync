import { useState } from "react";
import {
  CheckCircle2,
  FolderArchive,
  Sparkles,
  MessagesSquare,
  Bot,
  Layers,
  ArrowUpRight,
  ShieldCheck,
  Download,
  Flame,
  Code2,
  Terminal,
} from "lucide-react";

/**
 * 3D Holographic Perspective Tilt Hero Card
 * Inspired by Uiverse.io glass-cards, CGTrader 3D HUD layers, and Shadcn analytics widgets.
 */
const Interactive3DHeroCard = () => {
  const [activeDemoTab, setActiveDemoTab] = useState("zip");
  const [rotate, setRotate] = useState({ x: 0, y: 0 });
  const [isHovered, setIsHovered] = useState(false);

  const handleMouseMove = (e) => {
    const card = e.currentTarget;
    const rect = card.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;

    const rotateX = ((y - centerY) / centerY) * -8;
    const rotateY = ((x - centerX) / centerX) * 8;

    setRotate({ x: rotateX, y: rotateY });
  };

  const handleMouseLeave = () => {
    setRotate({ x: 0, y: 0 });
    setIsHovered(false);
  };

  return (
    <div
      onMouseMove={handleMouseMove}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={handleMouseLeave}
      className="relative mx-auto w-full max-w-2xl transition-transform duration-200 ease-out"
      style={{
        perspective: "1200px",
      }}
    >
      {/* Dynamic ambient neon glow underneath */}
      <div
        className={`absolute -inset-1 rounded-3xl bg-gradient-to-r from-brand via-purple-500 to-mint opacity-40 blur-2xl transition-all duration-500 ${
          isHovered ? "opacity-70 scale-105" : ""
        }`}
      />

      <div
        className="relative overflow-hidden rounded-2xl border border-white/40 bg-white/80 p-5 shadow-2xl backdrop-blur-xl transition-transform duration-200 dark:border-slate-800/80 dark:bg-slate-900/85"
        style={{
          transform: `rotateX(${rotate.x}deg) rotateY(${rotate.y}deg)`,
          transformStyle: "preserve-3d",
        }}
      >
        {/* Top Window Bar */}
        <div className="flex items-center justify-between border-b border-slate-line/60 pb-3">
          <div className="flex items-center gap-2">
            <span className="h-3 w-3 rounded-full bg-red-400/80" />
            <span className="h-3 w-3 rounded-full bg-yellow-400/80" />
            <span className="h-3 w-3 rounded-full bg-green-400/80" />
            <span className="ml-2 flex items-center gap-1 font-mono text-[11px] font-semibold text-slate-muted">
              <Terminal className="h-3.5 w-3.5 text-brand" /> teamsync-ai-workspace
            </span>
          </div>
          <div className="flex items-center gap-1.5 rounded-full bg-brand/10 px-2.5 py-0.5 text-[11px] font-semibold text-brand">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand" />
            AI Orchestrator Live
          </div>
        </div>

        {/* Demo Selector Tabs */}
        <div className="mt-4 flex gap-1.5 rounded-xl bg-cloud/70 p-1 text-xs">
          <button
            onClick={() => setActiveDemoTab("zip")}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-1.5 font-medium transition-all ${
              activeDemoTab === "zip"
                ? "bg-white text-slate-ink shadow-sm dark:bg-slate-800"
                : "text-slate-muted hover:text-slate-ink"
            }`}
          >
            <FolderArchive className="h-3.5 w-3.5 text-brand" /> Final ZIP Bundle
          </button>
          <button
            onClick={() => setActiveDemoTab("verify")}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-1.5 font-medium transition-all ${
              activeDemoTab === "verify"
                ? "bg-white text-slate-ink shadow-sm dark:bg-slate-800"
                : "text-slate-muted hover:text-slate-ink"
            }`}
          >
            <Sparkles className="h-3.5 w-3.5 text-mint" /> AI ZIP Inspector
          </button>
          <button
            onClick={() => setActiveDemoTab("chat")}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-1.5 font-medium transition-all ${
              activeDemoTab === "chat"
                ? "bg-white text-slate-ink shadow-sm dark:bg-slate-800"
                : "text-slate-muted hover:text-slate-ink"
            }`}
          >
            <MessagesSquare className="h-3.5 w-3.5 text-purple-600" /> Group Chat
          </button>
        </div>

        {/* Interactive Tab Showcase Content */}
        <div className="mt-4 min-h-[220px]">
          {activeDemoTab === "zip" && (
            <div className="space-y-3 rounded-xl border border-mint/20 bg-mint/5 p-4 animate-in fade-in duration-200">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-tr from-mint to-brand text-white shadow-md">
                    <FolderArchive className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-slate-ink">team_vision_complete_project.zip</p>
                    <p className="text-[11px] text-slate-muted">8 task modules combined · 416.1 KB · Auto-assembled</p>
                  </div>
                </div>
                <span className="rounded-full bg-mint/15 px-2.5 py-0.5 text-[10px] font-bold uppercase text-mint">
                  Ready in Chat
                </span>
              </div>

              <div className="space-y-1.5 text-[11px] text-slate-muted">
                <div className="flex items-center justify-between rounded-lg bg-white/70 px-2.5 py-1.5 dark:bg-slate-800/60">
                  <span className="flex items-center gap-1.5 text-slate-ink font-medium">
                    <CheckCircle2 className="h-3.5 w-3.5 text-mint" /> 01-database-schema
                  </span>
                  <span className="text-mint font-semibold">7 files</span>
                </div>
                <div className="flex items-center justify-between rounded-lg bg-white/70 px-2.5 py-1.5 dark:bg-slate-800/60">
                  <span className="flex items-center gap-1.5 text-slate-ink font-medium">
                    <CheckCircle2 className="h-3.5 w-3.5 text-mint" /> 02-authentication-jwt
                  </span>
                  <span className="text-mint font-semibold">8 files</span>
                </div>
                <div className="flex items-center justify-between rounded-lg bg-white/70 px-2.5 py-1.5 dark:bg-slate-800/60">
                  <span className="flex items-center gap-1.5 text-slate-ink font-medium">
                    <CheckCircle2 className="h-3.5 w-3.5 text-mint" /> 03-frontend-dashboard
                  </span>
                  <span className="text-mint font-semibold">30 files</span>
                </div>
              </div>

              <div className="flex items-center justify-between pt-1">
                <span className="text-[11px] font-medium text-slate-ink">
                  🤖 Automatically sent to Group Chat with README summary
                </span>
                <button className="inline-flex items-center gap-1 rounded-lg bg-mint px-2.5 py-1 text-[11px] font-semibold text-white shadow-sm hover:bg-mint/90 transition-colors">
                  <Download className="h-3 w-3" /> Download ZIP
                </button>
              </div>
            </div>
          )}

          {activeDemoTab === "verify" && (
            <div className="space-y-2.5 rounded-xl border border-brand/20 bg-brand-soft/50 p-4 animate-in fade-in duration-200">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <Sparkles className="h-4 w-4 text-brand" />
                  <span className="text-xs font-bold text-slate-ink">AI Code Review & Topic Validation</span>
                </div>
                <span className="rounded-full bg-mint/15 px-2 py-0.5 text-[11px] font-bold text-mint">
                  95% Match
                </span>
              </div>

              <div className="rounded-lg bg-white/80 p-2.5 text-[11px] space-y-1 dark:bg-slate-800/80">
                <p className="font-semibold text-mint flex items-center gap-1">
                  <CheckCircle2 className="h-3 w-3" /> What matched in your ZIP folder:
                </p>
                <p className="text-slate-muted pl-4">Models, REST route endpoints, and JWT authentication verified.</p>

                <p className="font-semibold text-amber-600 flex items-center gap-1 pt-1">
                  <Flame className="h-3 w-3 text-amber-500" /> Action steps in simple words:
                </p>
                <p className="text-slate-muted pl-4">Covered all required topics. Ready for Guide human approval!</p>
              </div>

              <div className="space-y-1">
                <div className="flex justify-between text-[10px] text-slate-muted">
                  <span>Task Implementation Progress</span>
                  <span className="font-semibold text-slate-ink">95%</span>
                </div>
                <div className="h-1.5 w-full rounded-full bg-cloud overflow-hidden">
                  <div className="h-full bg-gradient-to-r from-brand to-mint w-[95%]" />
                </div>
              </div>
            </div>
          )}

          {activeDemoTab === "chat" && (
            <div className="space-y-2.5 rounded-xl border border-purple-200 bg-purple-50/50 p-4 dark:border-purple-900/30 dark:bg-purple-950/20 animate-in fade-in duration-200">
              <div className="flex items-center gap-2">
                <div className="h-7 w-7 rounded-full bg-brand flex items-center justify-center text-[10px] font-bold text-white">
                  AI
                </div>
                <div>
                  <p className="text-xs font-bold text-slate-ink">TeamSync AI Bot</p>
                  <p className="text-[10px] text-slate-muted">Automated Project Delivery</p>
                </div>
              </div>
              <div className="rounded-lg bg-white/90 p-2.5 text-[11px] text-slate-ink shadow-xs dark:bg-slate-800">
                <p className="font-medium">
                  🎉 <strong>Consolidated Master Project ZIP Ready!</strong> All 8 tasks have been verified. Download the complete bundle below!
                </p>
                <div className="mt-2 flex items-center justify-between rounded-md border border-slate-line bg-cloud/50 p-1.5 text-[10px]">
                  <span className="font-mono text-slate-ink">team_vision_complete_project.zip</span>
                  <span className="font-semibold text-brand">416.1 KB</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Floating holographic badges */}
        <div className="mt-3 flex items-center justify-between border-t border-slate-line/60 pt-3 text-[11px] text-slate-muted">
          <span className="flex items-center gap-1 font-medium text-slate-ink">
            <ShieldCheck className="h-3.5 w-3.5 text-mint" /> Safe Sandbox Extraction
          </span>
          <span className="flex items-center gap-1 font-medium text-brand">
            <Sparkles className="h-3.5 w-3.5" /> 100% Real-Time Sockets
          </span>
        </div>
      </div>
    </div>
  );
};

export default Interactive3DHeroCard;
