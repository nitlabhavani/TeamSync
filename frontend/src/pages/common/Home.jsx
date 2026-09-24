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
  BellRing,
  CheckCircle2,
} from "lucide-react";
import Footer from "../../components/navbar/Footer";
import { ROUTES } from "../../utils/constants";

const FEATURES = [
  {
    icon: MessagesSquare,
    title: "Group & private chat",
    body: "Coordinate with your whole team in group chat, or start a private, one-to-one conversation with anyone on the platform.",
  },
  {
    icon: FolderLock,
    title: "Secure file sharing",
    body: "Upload, preview, and download project files in one organized space — no more digging through email threads.",
  },
  {
    icon: Sparkles,
    title: "AI collaboration scoring",
    body: "AI studies group chat activity to generate a collaboration score, progress prediction, and practical suggestions.",
  },
  {
    icon: ShieldCheck,
    title: "Private chats stay private",
    body: "One-to-one conversations are never analyzed. Only group project chats are used for collaboration insights.",
  },
  {
    icon: LineChart,
    title: "Guide dashboards",
    body: "Guides track every group's contribution, health, and progress from a single, real-time view.",
  },
  {
    icon: Users,
    title: "Early-warning alerts",
    body: "If a member goes quiet or a project stalls, guides get notified automatically — before it becomes a bigger problem.",
  },
];

const STEPS = [
  {
    icon: UserPlus,
    title: "Create or join a team",
    body: "Students spin up a project group in seconds and invite teammates. Guides get visibility the moment a team forms.",
  },
  {
    icon: Share2,
    title: "Collaborate and share",
    body: "Chat, share files, assign tasks, and log meetings — all the everyday project activity happens in one workspace.",
  },
  {
    icon: BrainCircuit,
    title: "Get AI-powered insights",
    body: "AI quietly analyzes group activity to surface a collaboration score, progress prediction, and early-warning alerts.",
  },
];

const STUDENT_POINTS = [
  "Collaborate with your team in real time",
  "Manage and track tasks end to end",
  "Communicate through group and private chat",
  "Track your own performance and contribution",
];

const GUIDE_POINTS = [
  "Monitor every project group at a glance",
  "View AI-backed analytics per team and member",
  "Identify at-risk groups before it's too late",
  "Receive automatic alerts and review reports",
];

const Home = () => {
  return (
    <div className="bg-paper overflow-x-hidden">
      <header className="sticky top-0 z-30 bg-paper/80 backdrop-blur-md border-b border-slate-line">
        <div className="max-w-6xl mx-auto flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl2 bg-brand flex items-center justify-center">
              <Sprout className="w-[18px] h-[18px] text-white" strokeWidth={2.5} />
            </div>
            <span className="font-display font-semibold text-lg text-slate-ink">TeamSync AI</span>
          </div>
          <div className="flex items-center gap-3">
            <Link to={ROUTES.LOGIN} className="text-sm font-medium text-slate-ink hover:text-brand transition-colors">
              Log in
            </Link>
            <Link
              to={ROUTES.SIGNUP}
              className="btn-premium bg-brand hover:bg-brand-deep text-white text-sm font-semibold px-4 py-2 rounded-lg"
            >
              Get started
            </Link>
          </div>
        </div>
      </header>

      {/* HERO */}
      <section className="relative">
        <div className="absolute inset-0 -z-10 overflow-hidden">
          <div className="absolute -top-32 left-1/3 w-[36rem] h-[36rem] rounded-full bg-brand/10 blur-3xl hero-mesh" />
          <div className="absolute top-40 -left-24 w-72 h-72 rounded-full bg-mint/10 blur-3xl" />
        </div>

        <div className="max-w-6xl mx-auto px-6 pt-16 sm:pt-20 pb-16 grid md:grid-cols-2 gap-12 items-center">
          <div className="animate-fade-up">
            <span className="inline-flex items-center gap-1.5 bg-brand-soft text-brand-deep text-xs font-semibold px-3 py-1.5 rounded-full mb-5">
              <Sparkles className="w-3.5 h-3.5" /> Built for student project teams
            </span>
            <h1 className="font-display text-4xl sm:text-5xl font-semibold text-slate-ink leading-tight mb-5">
              AI-powered collaboration
              <br />
              for <span className="text-gradient-brand">smarter teams</span>.
            </h1>
            <p className="text-slate-muted text-base leading-relaxed mb-8 max-w-md">
              TeamSync AI brings real-time collaboration, intelligent file sharing, and project
              performance monitoring into one workspace for student teams and their guides — with AI
              that quietly tracks momentum and keeps private chats completely private.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <Link
                to={ROUTES.SIGNUP}
                className="btn-premium flex items-center gap-2 bg-brand hover:bg-brand-deep text-white text-sm font-semibold px-5 py-3 rounded-lg"
              >
                Get started <ArrowRight className="w-4 h-4" />
              </Link>
              <Link
                to={ROUTES.LOGIN}
                className="text-sm font-semibold text-slate-ink border border-slate-line px-5 py-3 rounded-lg hover:border-brand hover:text-brand transition-colors"
              >
                Login / Explore
              </Link>
            </div>
          </div>

          <div className="relative animate-fade-up" style={{ animationDelay: "120ms" }}>
            <div className="bg-ink rounded-xl2 p-5 shadow-panel relative z-10">
              <div className="flex items-center gap-2.5 pb-4 mb-4 border-b border-white/10">
                <span className="w-9 h-9 rounded-full bg-brand flex items-center justify-center text-white text-xs font-semibold">TN</span>
                <div>
                  <p className="text-sm font-semibold text-white">Team Nimbus</p>
                  <p className="text-xs text-white/40">4 members · AI-Based Crop Disease Detection</p>
                </div>
                <span className="ml-auto flex items-center gap-1 bg-white/10 text-white text-xs font-semibold px-2.5 py-1 rounded-full">
                  <Sparkles className="w-3 h-3" /> 82
                </span>
              </div>
              <div className="space-y-3">
                <div className="bg-white/5 rounded-xl rounded-bl-sm px-3.5 py-2.5 max-w-[80%]">
                  <p className="text-xs font-semibold text-mint mb-0.5">Karthik Iyer</p>
                  <p className="text-sm text-white/90">Dataset from the agri-dept finally came through 🎉</p>
                </div>
                <div className="bg-brand rounded-xl rounded-br-sm px-3.5 py-2.5 max-w-[80%] ml-auto">
                  <p className="text-sm text-white">Let's sync at 6pm to divide the model training tasks.</p>
                </div>
              </div>
              <div className="mt-5 pt-4 border-t border-white/10 grid grid-cols-3 gap-3 text-center">
                <div>
                  <p className="font-display text-lg font-semibold text-white">64%</p>
                  <p className="text-[11px] text-white/40">Progress</p>
                </div>
                <div>
                  <p className="font-display text-lg font-semibold text-white">6w</p>
                  <p className="text-[11px] text-white/40">To completion</p>
                </div>
                <div>
                  <p className="font-display text-lg font-semibold text-white">On track</p>
                  <p className="text-[11px] text-white/40">AI status</p>
                </div>
              </div>
            </div>

            {/* Floating insight cards */}
            <div className="hidden sm:flex items-center gap-2.5 absolute -left-8 -bottom-6 bg-paper border border-slate-line rounded-xl2 shadow-panel px-4 py-3 z-20 animate-float-slow">
              <span className="w-8 h-8 rounded-lg bg-mint-soft flex items-center justify-center">
                <LineChart className="w-4 h-4 text-mint" />
              </span>
              <div>
                <p className="text-xs font-semibold text-slate-ink">Momentum up</p>
                <p className="text-[11px] text-slate-muted">+12% this week</p>
              </div>
            </div>
            <div className="hidden sm:flex items-center gap-2.5 absolute -right-6 top-8 bg-paper border border-slate-line rounded-xl2 shadow-panel px-4 py-3 z-20 animate-float-slow-delay">
              <span className="w-8 h-8 rounded-lg bg-brand-soft flex items-center justify-center">
                <BellRing className="w-4 h-4 text-brand" />
              </span>
              <div>
                <p className="text-xs font-semibold text-slate-ink">Alert resolved</p>
                <p className="text-[11px] text-slate-muted">Team Vortex is back on track</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* FEATURES */}
      <section className="max-w-6xl mx-auto px-6 py-16 border-t border-slate-line">
        <div className="max-w-xl mb-10">
          <span className="inline-flex items-center gap-1.5 bg-cloud text-slate-muted text-xs font-semibold px-3 py-1.5 rounded-full mb-4">
            Platform
          </span>
          <h2 className="font-display text-2xl sm:text-3xl font-semibold text-slate-ink mb-2">
            Everything a project team needs
          </h2>
          <p className="text-slate-muted">
            One workspace for communication, files, and AI-backed project insight.
          </p>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {FEATURES.map(({ icon: Icon, title, body }) => (
            <div
              key={title}
              className="feature-card-premium border border-slate-line rounded-xl2 p-5 bg-paper"
            >
              <span className="w-10 h-10 rounded-lg bg-brand-soft flex items-center justify-center mb-4">
                <Icon className="w-5 h-5 text-brand" />
              </span>
              <p className="font-display font-semibold text-slate-ink mb-1.5">{title}</p>
              <p className="text-sm text-slate-muted leading-relaxed">{body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section className="bg-cloud/50 border-t border-slate-line">
        <div className="max-w-6xl mx-auto px-6 py-16">
          <div className="max-w-xl mb-10">
            <span className="inline-flex items-center gap-1.5 bg-paper border border-slate-line text-slate-muted text-xs font-semibold px-3 py-1.5 rounded-full mb-4">
              How it works
            </span>
            <h2 className="font-display text-2xl sm:text-3xl font-semibold text-slate-ink mb-2">
              From kickoff to insight in three steps
            </h2>
          </div>
          <div className="grid sm:grid-cols-3 gap-6">
            {STEPS.map(({ icon: Icon, title, body }, i) => (
              <div key={title} className="relative bg-paper border border-slate-line rounded-xl2 p-6 feature-card-premium">
                <span className="font-display text-4xl font-semibold text-slate-line absolute top-4 right-5">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className="w-10 h-10 rounded-lg bg-brand flex items-center justify-center mb-5">
                  <Icon className="w-5 h-5 text-white" />
                </span>
                <p className="font-display font-semibold text-slate-ink mb-1.5">{title}</p>
                <p className="text-sm text-slate-muted leading-relaxed">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ROLE-BASED SECTION */}
      <section className="max-w-6xl mx-auto px-6 py-16 border-t border-slate-line">
        <div className="max-w-xl mb-10">
          <span className="inline-flex items-center gap-1.5 bg-cloud text-slate-muted text-xs font-semibold px-3 py-1.5 rounded-full mb-4">
            Built for both sides of the team
          </span>
          <h2 className="font-display text-2xl sm:text-3xl font-semibold text-slate-ink mb-2">
            One workspace, two experiences
          </h2>
          <p className="text-slate-muted">
            Students and guides each get a view tailored to what they need to do.
          </p>
        </div>
        <div className="grid md:grid-cols-2 gap-6">
          <div className="rounded-xl2 border border-slate-line bg-paper p-7 feature-card-premium">
            <span className="w-11 h-11 rounded-xl2 bg-brand-soft flex items-center justify-center mb-5">
              <GraduationCap className="w-5 h-5 text-brand" />
            </span>
            <p className="font-display text-xl font-semibold text-slate-ink mb-1">Student</p>
            <p className="text-sm text-slate-muted mb-5">Everything you need to run your project day to day.</p>
            <ul className="space-y-3">
              {STUDENT_POINTS.map((point) => (
                <li key={point} className="flex items-start gap-2.5 text-sm text-slate-ink">
                  <CheckCircle2 className="w-4 h-4 text-mint mt-0.5 shrink-0" />
                  {point}
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-xl2 border border-slate-line bg-ink p-7 feature-card-premium">
            <span className="w-11 h-11 rounded-xl2 bg-white/10 flex items-center justify-center mb-5">
              <ClipboardList className="w-5 h-5 text-mint" />
            </span>
            <p className="font-display text-xl font-semibold text-white mb-1">Guide</p>
            <p className="text-sm text-white/50 mb-5">A real-time, AI-backed view across every team you supervise.</p>
            <ul className="space-y-3">
              {GUIDE_POINTS.map((point) => (
                <li key={point} className="flex items-start gap-2.5 text-sm text-white/90">
                  <CheckCircle2 className="w-4 h-4 text-mint mt-0.5 shrink-0" />
                  {point}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* FINAL CTA */}
      <section className="bg-ink relative overflow-hidden">
        <div className="absolute inset-0 auth-grid-bg opacity-20" />
        <div className="absolute -top-24 right-1/4 w-80 h-80 rounded-full bg-brand/20 blur-3xl hero-mesh" />
        <div className="max-w-6xl mx-auto px-6 py-16 text-center relative z-10">
          <h2 className="font-display text-2xl sm:text-3xl font-semibold text-white mb-3">
            Ready to collaborate smarter?
          </h2>
          <p className="text-white/50 mb-8 max-w-lg mx-auto">
            Set up your workspace in minutes — free for student teams and guides.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Link
              to={ROUTES.SIGNUP}
              className="btn-premium inline-flex items-center gap-2 bg-brand hover:bg-brand-deep text-white text-sm font-semibold px-6 py-3 rounded-lg"
            >
              Get started <ArrowRight className="w-4 h-4" />
            </Link>
            <Link
              to={ROUTES.LOGIN}
              className="inline-flex items-center gap-2 border border-white/15 text-white text-sm font-semibold px-6 py-3 rounded-lg hover:bg-white/5 transition-colors"
            >
              Login
            </Link>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
};

export default Home;
