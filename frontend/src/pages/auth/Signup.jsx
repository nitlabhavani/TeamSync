import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "@/lib/router-compat";
import {
  User,
  Mail,
  Lock,
  GraduationCap,
  ArrowLeft,
  ShieldCheck,
  Loader2,
  Sparkles,
  ArrowRight,
  CheckCircle2,
} from "lucide-react";
import { useAuth } from "../../hooks/useAuth";
import { ROUTES, ROLES } from "../../utils/constants";
import { passwordStrength } from "../../utils/validators";
import * as authService from "../../services/authService";
import OtpInput from "../../components/auth/OtpInput";

const RESEND_SECONDS = 30;

const Signup = () => {
  const { signup, completeSignup } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [step, setStep] = useState("details"); // details | otp
  const [form, setForm] = useState({ name: "", email: "", password: "", role: ROLES.STUDENT });
  const [otp, setOtp] = useState("");
  const [cooldown, setCooldown] = useState(0);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);
  const strength = passwordStrength(form.password);

  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  useEffect(() => {
    const emailFromQuery = new URLSearchParams(location.search || "").get("email")?.trim();
    if (emailFromQuery && !form.email) {
      setForm((prev) => ({ ...prev, email: emailFromQuery }));
    }
  }, [location.search, form.email]);

  const requestOtp = async (e) => {
    e.preventDefault();
    setError("");
    setNotice("");
    if (form.password.length < 8) return setError("Password must be at least 8 characters.");
    setLoading(true);
    try {
      const res = await signup(form);
      setCooldown(RESEND_SECONDS);
      setStep("otp");
      if (res?.devOtp) {
        setOtp(res.devOtp);
        setNotice(`Verification code: ${res.devOtp}`);
      }
    } catch (err) {
      setError(err.message || "Something went wrong. Try again.");
    } finally {
      setLoading(false);
    }
  };

  const verify = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const user = await completeSignup({ email: form.email, otp });
      const resume = authService.consumePostLoginRedirect();
      if (resume) {
        navigate(resume);
        return;
      }
      navigate(
        user.role === ROLES.GUIDE
          ? ROUTES.GUIDE_DASHBOARD
          : user.joinedGroups > 0
            ? ROUTES.STUDENT_GROUPS
            : ROUTES.STUDENT_DASHBOARD
      );
    } catch (err) {
      setError(err.message || "Verification failed.");
    } finally {
      setLoading(false);
    }
  };

  const resend = async () => {
    setError("");
    setNotice("");
    try {
      const res = await authService.resendSignupOtp({ email: form.email });
      setCooldown(RESEND_SECONDS);
      if (res?.devOtp) {
        setOtp(res.devOtp);
        setNotice(`New verification code: ${res.devOtp}`);
      } else {
        setNotice("A new code is on its way.");
      }
    } catch (err) {
      setError(err.message);
    }
  };

  const startOver = async () => {
    await authService.cancelSignup({ email: form.email });
    setOtp("");
    setError("");
    setNotice("");
    setStep("details");
  };

  if (step === "otp") {
    return (
      <div className="space-y-6">
        <button
          type="button"
          onClick={startOver}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-muted hover:text-brand transition-colors"
        >
          <ArrowLeft className="w-4 h-4" /> Edit account details
        </button>

        <div>
          <div className="inline-flex items-center gap-1.5 rounded-full bg-mint/15 px-2.5 py-1 text-xs font-semibold text-mint mb-3">
            <ShieldCheck className="w-3.5 h-3.5" /> Step 2 of 2: Verification
          </div>
          <h2 className="font-display text-2xl sm:text-3xl font-extrabold text-slate-ink tracking-tight">
            Verify your email
          </h2>
          <p className="text-sm text-slate-muted mt-1">
            We sent a 6-digit OTP code to <strong className="text-slate-ink font-mono">{form.email}</strong>.
          </p>
        </div>

        <form onSubmit={verify} className="space-y-5">
          <OtpInput value={otp} onChange={setOtp} disabled={loading} />

          {notice && (
            <div className="text-xs text-mint font-medium bg-mint/10 border border-mint/30 rounded-xl p-3 animate-fade-up flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" /> {notice}
            </div>
          )}

          {error && (
            <div className="text-xs text-coral font-medium bg-coral-soft/80 border border-coral/30 rounded-xl p-3 animate-fade-up">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || otp.length !== 6}
            className="relative group overflow-hidden rounded-xl bg-gradient-to-r from-brand via-purple-600 to-indigo-600 w-full py-3.5 text-sm font-bold text-white shadow-lg shadow-brand/25 transition-all hover:shadow-brand/40 hover:scale-[1.01] active:scale-[0.99] disabled:opacity-50 cursor-pointer"
          >
            <span className="relative z-10 flex items-center justify-center gap-2">
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              {loading ? "Activating account…" : "Verify OTP & Activate Account"}
            </span>
            <span className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/25 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
          </button>

          <p className="text-center text-xs text-slate-muted">
            Didn't receive the code?{" "}
            <button
              type="button"
              onClick={resend}
              disabled={cooldown > 0}
              className="text-brand font-bold hover:underline disabled:text-slate-muted disabled:no-underline ml-1"
            >
              {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend OTP"}
            </button>
          </p>
        </form>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="inline-flex items-center gap-1.5 rounded-full bg-brand/20 border border-brand/30 px-2.5 py-1 text-xs font-semibold text-brand-soft mb-3">
          <Sparkles className="w-3.5 h-3.5 text-mint" /> Instant Team Workspace
        </div>
        <h2 className="font-display text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
          Create your account
        </h2>
        <p className="text-sm text-slate-300 mt-1">
          Join your team workspace and access automated project tools.
        </p>
      </div>

      <form onSubmit={requestOtp} className="space-y-4">
        {/* Role Selector Pills (Uiverse style) */}
        <div className="grid grid-cols-2 gap-2.5 p-1 rounded-xl bg-slate-950/80 border border-white/10">
          {[
            { id: ROLES.STUDENT, label: "Student Team", icon: GraduationCap },
            { id: ROLES.GUIDE, label: "Guide / Faculty", icon: User },
          ].map(({ id, label, icon: Icon }) => (
            <button
              type="button"
              key={id}
              onClick={() => setForm({ ...form, role: id })}
              className={`flex items-center justify-center gap-2 text-xs font-bold py-2.5 rounded-lg transition-all cursor-pointer ${
                form.role === id
                  ? "bg-brand text-white shadow-sm border border-brand/30"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              <Icon className="w-4 h-4" /> {label}
            </button>
          ))}
        </div>

        <div>
          <label htmlFor="signup-name" className="text-xs font-bold uppercase tracking-wider text-slate-300 mb-1.5 block">
            Full Name
          </label>
          <div className="flex items-center gap-2.5 border border-white/15 bg-slate-950/80 rounded-xl px-3.5 py-3 focus-within:border-brand focus-within:bg-slate-950 focus-within:ring-4 focus-within:ring-brand/20 transition-all">
            <User className="w-4 h-4 text-slate-400 shrink-0" />
            <input
              id="signup-name"
              name="name"
              required
              minLength={2}
              placeholder="Aisha Verma"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="flex-1 outline-none text-sm bg-transparent text-white placeholder:text-slate-500 font-medium caret-brand"
            />
          </div>
        </div>

        <div>
          <label htmlFor="signup-email" className="text-xs font-bold uppercase tracking-wider text-slate-300 mb-1.5 block">
            College / Institutional Email
          </label>
          <div className="flex items-center gap-2.5 border border-white/15 bg-slate-950/80 rounded-xl px-3.5 py-3 focus-within:border-brand focus-within:bg-slate-950 focus-within:ring-4 focus-within:ring-brand/20 transition-all">
            <Mail className="w-4 h-4 text-slate-400 shrink-0" />
            <input
              id="signup-email"
              name="email"
              type="email"
              autoComplete="email"
              required
              placeholder="you@college.edu"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              className="flex-1 outline-none text-sm bg-transparent text-white placeholder:text-slate-500 font-medium caret-brand"
            />
          </div>
        </div>

        <div>
          <label htmlFor="signup-password" className="text-xs font-bold uppercase tracking-wider text-slate-300 mb-1.5 block">
            Password
          </label>
          <div className="flex items-center gap-2.5 border border-white/15 bg-slate-950/80 rounded-xl px-3.5 py-3 focus-within:border-brand focus-within:bg-slate-950 focus-within:ring-4 focus-within:ring-brand/20 transition-all">
            <Lock className="w-4 h-4 text-slate-400 shrink-0" />
            <input
              id="signup-password"
              name="password"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              placeholder="At least 8 characters"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              className="flex-1 outline-none text-sm bg-transparent text-white placeholder:text-slate-500 font-medium caret-brand"
            />
          </div>

          {form.password && (
            <div className="mt-2 space-y-1">
              <div className="flex gap-1.5">
                {[0, 1, 2, 3].map((i) => (
                  <span
                    key={i}
                    className={`h-1.5 flex-1 rounded-full transition-colors duration-300 ${
                      i < strength.score ? "bg-mint" : "bg-white/15"
                    }`}
                  />
                ))}
              </div>
              <p className="text-[10px] text-slate-400 text-right font-medium">
                {strength.score >= 3 ? "Strong password" : "Add numbers & special characters"}
              </p>
            </div>
          )}
        </div>

        {error && (
          <div className="text-xs text-coral font-medium bg-coral/10 border border-coral/30 rounded-xl p-3 animate-fade-up">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="relative group overflow-hidden rounded-xl bg-gradient-to-r from-brand via-purple-600 to-indigo-600 w-full py-3.5 text-sm font-bold text-white shadow-lg shadow-brand/25 transition-all hover:shadow-brand/40 hover:scale-[1.01] active:scale-[0.99] disabled:opacity-70 cursor-pointer"
        >
          <span className="relative z-10 flex items-center justify-center gap-2">
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" /> Sending verification code…
              </>
            ) : (
              <>
                Send verification code <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
              </>
            )}
          </span>
          <span className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/25 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
        </button>
      </form>

      <div className="pt-2 text-center text-xs text-slate-400 border-t border-white/10">
        Already have an account?{" "}
        <Link to={ROUTES.LOGIN} className="text-brand-soft font-bold hover:underline ml-1">
          Log in
        </Link>
      </div>
    </div>
  );
};

export default Signup;
