import { Outlet } from "@/lib/router-compat";
import { Sprout, Sparkles, ShieldCheck, MessagesSquare, LineChart } from "lucide-react";

const AuthLayout = () => {
  return (
    <div className="min-h-screen grid md:grid-cols-2 bg-paper">
      {/* Left — brand panel */}
      <div className="hidden md:flex flex-col justify-between bg-ink text-white p-12 relative overflow-hidden">
        <div className="absolute inset-0 auth-grid-bg opacity-30" />
        <div className="absolute -top-24 -left-24 w-96 h-96 rounded-full bg-brand/30 blur-3xl hero-mesh" />
        <div className="absolute -bottom-32 -right-16 w-96 h-96 rounded-full bg-mint/20 blur-3xl" />

        <div className="relative z-10 flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl2 bg-brand flex items-center justify-center shadow-pop">
            <Sprout className="w-[18px] h-[18px] text-white" strokeWidth={2.5} />
          </div>
          <span className="font-display font-semibold text-lg">TeamSync AI</span>
        </div>

        <div className="relative z-10 max-w-md">
          <span className="inline-flex items-center gap-1.5 bg-white/10 border border-white/10 text-white/80 text-xs font-semibold px-3 py-1.5 rounded-full mb-6">
            <Sparkles className="w-3.5 h-3.5 text-mint" /> AI-powered collaboration
          </span>
          <p className="font-display text-3xl font-semibold leading-tight mb-4">
            Where project teams talk, share files, and let AI watch the momentum.
          </p>
          <p className="text-white/60 text-sm leading-relaxed mb-8">
            Group chats are analyzed for collaboration health. Private chats stay
            completely yours — TeamSync AI never reads them.
          </p>

          {/* Floating insight card */}
          <div className="glass-card rounded-xl2 p-4 animate-float-slow shadow-panel">
            <div className="flex items-center gap-2.5 mb-3">
              <span className="w-8 h-8 rounded-lg bg-brand/80 flex items-center justify-center">
                <LineChart className="w-4 h-4 text-white" />
              </span>
              <div>
                <p className="text-xs font-semibold text-white">Team Nimbus</p>
                <p className="text-[11px] text-white/40">Collaboration score</p>
              </div>
              <span className="ml-auto font-display text-lg font-semibold text-mint">82%</span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-white/10 overflow-hidden">
              <div className="h-full w-[82%] rounded-full bg-gradient-to-r from-brand to-mint" />
            </div>
          </div>
        </div>

        <div className="relative z-10 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-white/40">
          <span className="inline-flex items-center gap-1.5">
            <MessagesSquare className="w-3.5 h-3.5" /> Real-time chat
          </span>
          <span className="inline-flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5" /> Secure file sharing
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5" /> AI collaboration scoring
          </span>
        </div>
      </div>

      {/* Right — auth card */}
      <div className="flex items-center justify-center p-6 sm:p-10 bg-cloud/40">
        <div className="w-full max-w-sm animate-fade-up">
          <div className="md:hidden flex items-center gap-2.5 mb-8">
            <div className="w-9 h-9 rounded-xl2 bg-brand flex items-center justify-center">
              <Sprout className="w-[18px] h-[18px] text-white" strokeWidth={2.5} />
            </div>
            <span className="font-display font-semibold text-lg text-slate-ink">TeamSync AI</span>
          </div>
          <div className="bg-paper border border-slate-line rounded-xl2 shadow-panel p-7 sm:p-8 auth-card-premium">
            <Outlet />
          </div>
        </div>
      </div>
    </div>
  );
};

export default AuthLayout;
