import { Outlet } from "@/lib/router-compat";
import { Sprout, Sparkles, ShieldCheck, MessagesSquare, FolderArchive } from "lucide-react";
import VantaNetBackground from "../components/animations/VantaNetBackground";
import AuthAnimationShowcase from "../components/animations/AuthAnimationShowcase";

const AuthLayout = () => {
  return (
    <div className="relative min-h-screen w-full bg-slate-950 text-slate-100 flex items-center justify-center overflow-x-hidden p-4 sm:p-6 lg:p-10">
      {/* Background Interactive 3D Particle Net */}
      <VantaNetBackground
        particleCount={50}
        connectionDistance={135}
        primaryColor="99, 102, 241"
        secondaryColor="217, 70, 239"
        accentColor="16, 185, 129"
        className="opacity-45"
      />

      {/* Centered, tightly balanced auth container (eliminates middle gap) */}
      <div className="relative z-10 w-full max-w-6xl mx-auto grid lg:grid-cols-12 gap-8 lg:gap-10 items-center">
        {/* Left Column — Brand & Live 3D Simulation Showcase (Takes 6.5 cols) */}
        <div className="hidden lg:flex lg:col-span-7 flex-col justify-center space-y-6 rounded-3xl border border-white/10 bg-slate-900/70 p-8 xl:p-10 backdrop-blur-2xl shadow-2xl">
          {/* Top Logo */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-brand via-purple-600 to-mint flex items-center justify-center shadow-lg shadow-brand/30 text-white">
              <Sprout className="w-5 h-5" strokeWidth={2.5} />
            </div>
            <div>
              <span className="font-display font-bold text-xl text-white tracking-tight">TeamSync AI</span>
              <span className="ml-2 text-[10px] font-semibold uppercase tracking-wider bg-brand/20 text-brand-soft px-2 py-0.5 rounded-full">
                Secured
              </span>
            </div>
          </div>

          {/* Heading & Subtitle */}
          <div className="space-y-3">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-brand/30 bg-brand/10 px-3 py-1 text-xs font-semibold text-brand-soft">
              <Sparkles className="w-3.5 h-3.5 text-mint animate-pulse" /> Autonomous AI Workspace
            </span>
            <h1 className="font-display text-3xl xl:text-4xl font-extrabold text-white tracking-tight leading-snug">
              Collaborate, submit & <span className="bg-gradient-to-r from-brand via-purple-400 to-mint bg-clip-text text-transparent">auto-bundle</span> project code.
            </h1>
            <p className="text-white/65 text-sm leading-relaxed max-w-lg">
              AI checks your task ZIP archives, highlights missing requirements, and combines all student submissions into a unified master project archive.
            </p>
          </div>

          {/* 3D Animated Video Simulation Widget */}
          <AuthAnimationShowcase />

          {/* Bottom Feature Badges */}
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-white/50 border-t border-white/10 pt-4">
            <span className="inline-flex items-center gap-1.5">
              <FolderArchive className="w-3.5 h-3.5 text-mint" /> Final ZIP Consolidator
            </span>
            <span className="inline-flex items-center gap-1.5">
              <MessagesSquare className="w-3.5 h-3.5 text-brand-soft" /> Real-time Sockets
            </span>
            <span className="inline-flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 text-purple-400" /> Private Peer Chat
            </span>
          </div>
        </div>

        {/* Right Column — Cyber Glass Auth Card (Takes 5 cols) */}
        <div className="col-span-12 lg:col-span-5 flex flex-col justify-center items-center">
          <div className="w-full max-w-md animate-fade-up">
            {/* Mobile Header (only on small screens) */}
            <div className="lg:hidden flex items-center gap-2.5 mb-6 justify-center">
              <div className="w-9 h-9 rounded-xl bg-brand flex items-center justify-center text-white">
                <Sprout className="w-5 h-5" strokeWidth={2.5} />
              </div>
              <span className="font-display font-bold text-xl text-white">TeamSync AI</span>
            </div>

            {/* Glass Card Container (Uiverse / ReactBits style) */}
            <div className="relative group">
              <div className="absolute -inset-1 rounded-3xl bg-gradient-to-r from-brand via-purple-600 to-mint opacity-25 blur-xl group-hover:opacity-40 transition-opacity" />
              <div className="relative rounded-3xl border border-white/15 bg-white/95 dark:bg-slate-900/90 p-7 sm:p-9 shadow-2xl backdrop-blur-2xl text-slate-ink">
                <Outlet />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AuthLayout;
