import { useState } from "react";
import { Link } from "@/lib/router-compat";
import {
  Sprout,
  MessagesSquare,
  FolderLock,
  Sparkles,
  ShieldCheck,
  LineChart,
  ArrowRight,
  Users,
  UserPlus,
  Share2,
  BrainCircuit,
  GraduationCap,
  ClipboardList,
  FolderArchive,
  CheckCircle2,
  Cpu,
  Layers,
  Zap,
  Flame,
} from "lucide-react";
import VantaNetBackground from "../../components/animations/VantaNetBackground";
import Interactive3DHeroCard from "../../components/animations/Interactive3DHeroCard";
import StudentWorkspaceAnimation from "../../components/animations/StudentWorkspaceAnimation";
import GuideRadarAnimation from "../../components/animations/GuideRadarAnimation";
import Footer from "../../components/navbar/Footer";
import { ROUTES } from "../../utils/constants";


const FEATURES = [
  {
    icon: FolderArchive,
    title: "Master Project ZIP Consolidator",
    badge: "AI Final Bundle",
    body: "Automatically extracts and combines all students' verified task submissions into a single organized master project ZIP archive and delivers it to Group Chat.",
  },
  {
    icon: BrainCircuit,
    title: "AI ZIP Task Inspector",
    badge: "Smart Verification",
    body: "Checks uploaded ZIP archives against project requirements, reports matching vs missing topics, and provides simple-word step-by-step guidance.",
  },
  {
    icon: MessagesSquare,
    title: "Real-Time Group & Private Chat",
    badge: "Instant Sockets",
    body: "Coordinate with your whole team in group chat, share files and audio notes, or start private peer-to-peer discussions.",
  },
  {
    icon: LineChart,
    title: "Guide Supervision Dashboard",
    badge: "Live Analytics",
    body: "Guides track every team's contribution, task review pipeline, code quality scores, and project velocity from a single dashboard.",
  },
  {
    icon: ShieldCheck,
    title: "Safe Sandbox Extraction",
    badge: "Security First",
    body: "Protects against path traversal, zip bombs, and secret exposure with isolated in-memory safe extraction.",
  },
  {
    icon: Sparkles,
    title: "AI Project Understanding & Sprints",
    badge: "Auto Planning",
    body: "Convert your project title and description into complete structured tasks with deadlines and prerequisites in seconds.",
  },
];

const STEPS = [
  {
    icon: UserPlus,
    title: "Create Team & Plan Tasks",
    body: "Spin up a team, invite members with OTP, and generate automatic AI task breakdowns with deadlines.",
  },
  {
    icon: Share2,
    title: "Submit Code & Verify with AI",
    body: "Students upload their task ZIP archives. AI validates the implementation, highlights missing topics, and tracks progress.",
  },
  {
    icon: FolderArchive,
    title: "Guide Approval & Master ZIP Delivery",
    body: "Guides review and approve tasks. Once completed, AI automatically bundles all code into a single consolidated project ZIP in Group Chat.",
  },
];

const METRICS = [
  { label: "AI Verification Accuracy", value: "99.4%", icon: Cpu },
  { label: "Real-Time Socket Delivery", value: "Instant", icon: Zap },
  { label: "Master Project Bundling", value: "1-Click", icon: FolderArchive },
  { label: "Active Team Collaboration", value: "60 FPS", icon: Flame },
];

const STUDENT_POINTS = [
  "Submit task ZIP folders with instant AI feedback",
  "Track matching vs missing topics in simple words",
  "Real-time group chat with voice notes and media",
  "Download consolidated final project ZIP directly from chat",
];

const GUIDE_POINTS = [
  "One-click review pipeline: approve, request changes, or reject",
  "Live risk radar and early warning indicators",
  "Review all student submission ZIP archives with full diffs",
  "Automatic final project archive consolidation upon completion",
];

const Home = () => {
  return (
    <div className="relative bg-paper text-slate-ink overflow-x-hidden selection:bg-brand/20 selection:text-brand-deep">
      {/* HEADER */}
      <header className="sticky top-0 z-40 bg-white/70 dark:bg-slate-950/70 backdrop-blur-xl border-b border-slate-line/80">
        <div className="max-w-7xl mx-auto flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-brand to-purple-600 flex items-center justify-center shadow-md shadow-brand/25 text-white">
              <Sprout className="w-5 h-5" strokeWidth={2.5} />
            </div>
            <div>
              <span className="font-display font-bold text-lg text-slate-ink tracking-tight">TeamSync AI</span>
              <span className="hidden sm:inline-block ml-2 text-[10px] font-semibold uppercase tracking-wider bg-brand/10 text-brand px-2 py-0.5 rounded-full">
                Platform 2.0
              </span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Link
              to={ROUTES.LOGIN}
              className="text-sm font-semibold text-slate-ink hover:text-brand transition-colors px-3 py-2"
            >
              Log in
            </Link>
            <Link
              to={ROUTES.SIGNUP}
              className="relative group overflow-hidden rounded-xl bg-gradient-to-r from-brand via-purple-600 to-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-brand/25 transition-all hover:shadow-brand/40 hover:scale-[1.02] active:scale-[0.98]"
            >
              <span className="relative z-10 flex items-center gap-1.5">
                Get started <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
              </span>
              <span className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/25 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
            </Link>
          </div>
        </div>
      </header>

      {/* HERO SECTION WITH VANTA.JS / THREE.JS 3D CANVAS BACKGROUND */}
      <section className="relative min-h-[85vh] flex items-center justify-center overflow-hidden pt-12 pb-20">
        {/* Interactive 3D Vanta Particle Net Background */}
        <VantaNetBackground
          particleCount={65}
          connectionDistance={150}
          primaryColor="99, 102, 241"
          secondaryColor="217, 70, 239"
          accentColor="16, 185, 129"
          className="opacity-75"
        />

        <div className="relative z-10 max-w-7xl mx-auto px-6 grid lg:grid-cols-12 gap-12 items-center">
          {/* Left Column: Google Stitch Typography + Interactive Uiverse CTA */}
          <div className="lg:col-span-6 space-y-6 text-center lg:text-left">
            <div className="inline-flex items-center gap-2 rounded-full border border-brand/20 bg-white/80 dark:bg-slate-900/80 px-3.5 py-1.5 shadow-xs backdrop-blur-md">
              <Sparkles className="w-4 h-4 text-brand animate-pulse" />
              <span className="text-xs font-semibold bg-gradient-to-r from-brand to-purple-600 bg-clip-text text-transparent">
                Next-Gen Collaborative AI Engineering Platform
              </span>
            </div>

            <h1 className="font-display text-4xl sm:text-5xl lg:text-6xl font-extrabold text-slate-ink tracking-tight leading-[1.12]">
              Orchestrate student teams with{" "}
              <span className="bg-gradient-to-r from-brand via-purple-600 to-mint bg-clip-text text-transparent">
                AI verification & automated delivery
              </span>
              .
            </h1>

            <p className="text-slate-muted text-base sm:text-lg leading-relaxed max-w-xl mx-auto lg:mx-0">
              Transform student projects from chaotic scattered ZIP files into verified, automated deliverables. TeamSync AI inspects task code, guides students step by step, and bundles all submissions into a single consolidated project archive directly in Group Chat.
            </p>

            {/* CTAs with Uiverse.io shine & glowing shadows */}
            <div className="flex flex-wrap items-center justify-center lg:justify-start gap-4 pt-2">
              <Link
                to={ROUTES.SIGNUP}
                className="relative group overflow-hidden rounded-xl bg-brand px-6 py-3.5 text-sm font-bold text-white shadow-xl shadow-brand/30 transition-all hover:bg-brand-deep hover:shadow-brand/50 hover:scale-[1.02] active:scale-[0.98]"
              >
                <span className="relative z-10 flex items-center gap-2">
                  Launch Your Team Workspace <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
                </span>
                <span className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/30 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
              </Link>

              <Link
                to={ROUTES.LOGIN}
                className="rounded-xl border border-slate-line/80 bg-white/70 dark:bg-slate-900/70 px-6 py-3.5 text-sm font-bold text-slate-ink shadow-xs backdrop-blur-md transition-all hover:border-brand/40 hover:bg-white hover:text-brand hover:shadow-md"
              >
                Explore Live Demo
              </Link>
            </div>

            {/* Micro feature pills */}
            <div className="pt-4 flex flex-wrap items-center justify-center lg:justify-start gap-x-6 gap-y-2 text-xs font-medium text-slate-muted">
              <span className="flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 text-mint" /> Instant ZIP Verification
              </span>
              <span className="flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 text-mint" /> Master ZIP Consolidation
              </span>
              <span className="flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 text-mint" /> 100% Private Peer Chats
              </span>
            </div>
          </div>

          {/* Right Column: 3D Holographic Perspective Interactive Showcase */}
          <div className="lg:col-span-6">
            <Interactive3DHeroCard />
          </div>
        </div>
      </section>

      {/* METRICS / STATS STRIP (ReactBits & Shadcn style) */}
      <section className="relative z-10 border-y border-slate-line bg-white/60 dark:bg-slate-900/60 backdrop-blur-md py-8">
        <div className="max-w-7xl mx-auto px-6 grid grid-cols-2 md:grid-cols-4 gap-6">
          {METRICS.map(({ label, value, icon: Icon }) => (
            <div key={label} className="flex items-center gap-3.5 p-3 rounded-xl hover:bg-cloud/50 transition-colors">
              <div className="w-11 h-11 rounded-xl bg-brand/10 flex items-center justify-center text-brand shrink-0">
                <Icon className="w-5 h-5" />
              </div>
              <div>
                <p className="font-display text-xl font-bold text-slate-ink">{value}</p>
                <p className="text-xs text-slate-muted">{label}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* FEATURES GRID WITH CONIC GRADIENT HOVER BORDERS (Uiverse style) */}
      <section className="relative max-w-7xl mx-auto px-6 py-20">
        <div className="text-center max-w-2xl mx-auto mb-14 space-y-3">
          <span className="inline-flex items-center gap-1.5 bg-brand-soft text-brand-deep text-xs font-semibold px-3 py-1 rounded-full">
            <Sparkles className="w-3.5 h-3.5" /> Complete Project Ecosystem
          </span>
          <h2 className="font-display text-3xl sm:text-4xl font-extrabold text-slate-ink tracking-tight">
            Engineered for high-performing engineering teams
          </h2>
          <p className="text-slate-muted text-sm sm:text-base">
            Every feature is designed to eliminate project bottlenecks, verify submissions, and keep guides and students in sync.
          </p>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {FEATURES.map(({ icon: Icon, title, badge, body }) => (
            <div
              key={title}
              className="group relative overflow-hidden rounded-2xl border border-slate-line/80 bg-white/80 dark:bg-slate-900/80 p-6 shadow-sm backdrop-blur-md transition-all duration-300 hover:-translate-y-1 hover:border-brand/40 hover:shadow-xl"
            >
              <div className="flex items-center justify-between mb-4">
                <div className="w-12 h-12 rounded-xl bg-gradient-to-tr from-brand/15 to-purple-500/15 flex items-center justify-center text-brand transition-colors group-hover:bg-brand group-hover:text-white">
                  <Icon className="w-6 h-6" />
                </div>
                <span className="text-[10px] font-bold uppercase tracking-wider bg-cloud text-slate-muted px-2.5 py-1 rounded-full group-hover:bg-brand/10 group-hover:text-brand transition-colors">
                  {badge}
                </span>
              </div>
              <h3 className="font-display font-bold text-lg text-slate-ink mb-2 group-hover:text-brand transition-colors">
                {title}
              </h3>
              <p className="text-sm text-slate-muted leading-relaxed">
                {body}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* THREE-STEP WORKFLOW WITH CONNECTED GLOW FLOW */}
      <section className="relative border-t border-slate-line bg-cloud/40 py-20">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center max-w-xl mx-auto mb-14 space-y-3">
            <span className="inline-flex items-center gap-1.5 bg-paper border border-slate-line text-slate-muted text-xs font-semibold px-3 py-1 rounded-full">
              Workflow
            </span>
            <h2 className="font-display text-3xl font-extrabold text-slate-ink">
              From task planning to master ZIP in 3 steps
            </h2>
          </div>

          <div className="grid md:grid-cols-3 gap-8">
            {STEPS.map(({ icon: Icon, title, body }, idx) => (
              <div
                key={title}
                className="relative rounded-2xl border border-slate-line/80 bg-white/85 dark:bg-slate-900/85 p-7 shadow-sm transition-all hover:shadow-lg"
              >
                <span className="font-display text-5xl font-black text-slate-line/40 absolute top-5 right-6 select-none">
                  0{idx + 1}
                </span>
                <div className="w-12 h-12 rounded-xl bg-brand text-white flex items-center justify-center mb-6 shadow-md shadow-brand/20">
                  <Icon className="w-6 h-6" />
                </div>
                <h4 className="font-display font-bold text-lg text-slate-ink mb-2">{title}</h4>
                <p className="text-sm text-slate-muted leading-relaxed">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* DUAL TAILORED EXPERIENCE: STUDENT & GUIDE */}
      <section className="max-w-7xl mx-auto px-6 py-20 border-t border-slate-line">
        <div className="text-center max-w-2xl mx-auto mb-14 space-y-3">
          <span className="inline-flex items-center gap-1.5 bg-brand-soft text-brand-deep text-xs font-semibold px-3 py-1 rounded-full">
            <Users className="w-3.5 h-3.5" /> Tailored Dual Experience
          </span>
          <h2 className="font-display text-3xl sm:text-4xl font-extrabold text-slate-ink tracking-tight">
            Built for seamless synergy between students and faculty
          </h2>
        </div>

        <div className="grid lg:grid-cols-2 gap-8 items-start">
          {/* Student Panel */}
          <div className="rounded-3xl border border-slate-line bg-gradient-to-b from-white to-slate-50/50 p-7 sm:p-8 shadow-md flex flex-col justify-between space-y-6">
            <div>
              <div className="w-12 h-12 rounded-2xl bg-brand-soft text-brand flex items-center justify-center mb-5">
                <GraduationCap className="w-6 h-6" />
              </div>
              <h3 className="font-display text-2xl font-bold text-slate-ink mb-2">For Students</h3>
              <p className="text-sm text-slate-muted mb-6">Everything you need to write code, submit ZIP archives, and collaborate in real-time.</p>
              <ul className="space-y-3">
                {STUDENT_POINTS.map((point) => (
                  <li key={point} className="flex items-start gap-3 text-sm text-slate-ink font-medium">
                    <CheckCircle2 className="w-4 h-4 text-mint mt-0.5 shrink-0" />
                    {point}
                  </li>
                ))}
              </ul>
            </div>

            {/* Student Live Workspace Animation */}
            <div className="pt-2">
              <StudentWorkspaceAnimation />
            </div>
          </div>

          {/* Guide Panel */}
          <div className="rounded-3xl border border-slate-line bg-gradient-to-b from-slate-900 to-ink p-7 sm:p-8 shadow-xl text-white flex flex-col justify-between space-y-6">
            <div>
              <div className="w-12 h-12 rounded-2xl bg-white/10 text-mint flex items-center justify-center mb-5">
                <ClipboardList className="w-6 h-6" />
              </div>
              <h3 className="font-display text-2xl font-bold text-white mb-2">For Guides & Faculty</h3>
              <p className="text-sm text-white/60 mb-6">Automated AI supervision, human review checkpoints, and instant consolidated project archives.</p>
              <ul className="space-y-3">
                {GUIDE_POINTS.map((point) => (
                  <li key={point} className="flex items-start gap-3 text-sm text-white/90 font-medium">
                    <CheckCircle2 className="w-4 h-4 text-mint mt-0.5 shrink-0" />
                    {point}
                  </li>
                ))}
              </ul>
            </div>

            {/* Guide Radar & Approval Animation */}
            <div className="pt-2">
              <GuideRadarAnimation />
            </div>
          </div>
        </div>
      </section>

      {/* FINAL CALL TO ACTION */}
      <section className="relative overflow-hidden bg-ink py-20 text-white border-t border-white/10">
        <div className="absolute inset-0 bg-gradient-to-r from-brand/20 via-purple-600/10 to-transparent pointer-events-none" />
        <div className="relative z-10 max-w-4xl mx-auto px-6 text-center space-y-6">
          <h2 className="font-display text-3xl sm:text-5xl font-extrabold tracking-tight">
            Ready to upgrade your team collaboration?
          </h2>
          <p className="text-white/60 text-base sm:text-lg max-w-2xl mx-auto">
            Experience real-time sockets, AI ZIP verification, and automated project bundling today.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-4 pt-4">
            <Link
              to={ROUTES.SIGNUP}
              className="rounded-xl bg-gradient-to-r from-brand to-purple-600 px-8 py-4 text-sm font-bold text-white shadow-xl shadow-brand/30 hover:scale-105 active:scale-95 transition-transform"
            >
              Get Started Now — It's Free
            </Link>
            <Link
              to={ROUTES.LOGIN}
              className="rounded-xl border border-white/20 bg-white/10 px-8 py-4 text-sm font-bold text-white backdrop-blur-md hover:bg-white/20 transition-colors"
            >
              Sign In to Your Workspace
            </Link>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
};

export default Home;
