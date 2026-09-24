import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "@/lib/router-compat";
import { User, Mail, Lock, GraduationCap, ArrowLeft, ShieldCheck, Loader2 } from "lucide-react";
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
      const result = await signup(form);
      setCooldown(RESEND_SECONDS);
      setStep("otp");
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
      // Registering with an invited email auto-joins any pending group
      // invitations for that address (see acceptPendingInvitations on the
      // backend) — send them straight to their new team instead of an
      // empty dashboard, and honor an invitation-page redirect if present.
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
      const result = await authService.resendSignupOtp({ email: form.email });
      setCooldown(RESEND_SECONDS);
      setNotice("A new code is on its way.");
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
      <div>
        <button
          type="button"
          onClick={startOver}
          className="inline-flex items-center gap-1.5 text-xs text-slate-muted hover:text-slate-ink mb-6"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Change details
        </button>

        <span className="inline-flex w-11 h-11 rounded-xl2 bg-brand-soft items-center justify-center mb-5">
          <ShieldCheck className="w-5 h-5 text-brand" strokeWidth={2.5} />
        </span>
        <span className="inline-flex items-center gap-1.5 bg-brand-soft text-brand-deep text-xs font-semibold px-2.5 py-1 rounded-full mb-4">
          <ShieldCheck className="w-3.5 h-3.5" /> Step 2 of 2
        </span>
        <h2 className="font-display text-2xl font-semibold text-slate-ink mb-1.5">Verify your email</h2>
        <p className="text-sm text-slate-muted mb-8">
          We sent a 6-digit code to <span className="font-medium text-slate-ink">{form.email}</span>.
          Your account is created once it's verified.
        </p>

        <form onSubmit={verify}>
          <OtpInput value={otp} onChange={setOtp} disabled={loading} />

          {notice && <p className="text-xs text-mint bg-mint-soft rounded-lg px-3 py-2 mt-3 animate-fade-up">{notice}</p>}
          {error && <p className="text-xs text-coral bg-coral-soft rounded-lg px-3 py-2 mt-3 animate-fade-up">{error}</p>}

          <button
            type="submit"
            disabled={loading || otp.length !== 6}
            className="btn-premium w-full mt-6 bg-brand hover:bg-brand-deep disabled:opacity-60 disabled:hover:translate-y-0 disabled:hover:shadow-none text-white text-sm font-semibold py-3 rounded-lg inline-flex items-center justify-center gap-2"
          >
            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
            {loading ? "Creating account…" : "Verify & create account"}
          </button>

          <p className="text-center text-xs text-slate-muted mt-4">
            Didn't get a code?{" "}
            <button
              type="button"
              onClick={resend}
              disabled={cooldown > 0}
              className="text-brand font-semibold hover:underline disabled:text-slate-muted disabled:no-underline"
            >
              {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend code"}
            </button>
          </p>
        </form>
      </div>
    );
  }

  return (
    <div>
      <span className="inline-flex w-11 h-11 rounded-xl2 bg-brand-soft items-center justify-center mb-5">
        <User className="w-5 h-5 text-brand" strokeWidth={2.5} />
      </span>
      <span className="inline-flex items-center gap-1.5 bg-cloud text-slate-muted text-xs font-semibold px-2.5 py-1 rounded-full mb-4">
        Step 1 of 2
      </span>
      <h2 className="font-display text-2xl font-semibold text-slate-ink mb-1.5">Create your account</h2>
      <p className="text-sm text-slate-muted mb-8">
        We'll email you a verification code to confirm it's really you.
      </p>

      <form onSubmit={requestOtp} className="space-y-4">
        <div className="grid grid-cols-2 gap-2">
          {[ROLES.STUDENT, ROLES.GUIDE].map((role) => (
            <button
              type="button"
              key={role}
              onClick={() => setForm({ ...form, role })}
              className={`flex items-center justify-center gap-2 text-sm font-medium py-2.5 rounded-lg border transition-all ${
                form.role === role
                  ? "bg-brand-soft border-brand text-brand-deep shadow-sm"
                  : "border-slate-line text-slate-muted hover:border-slate-ink/30"
              }`}
            >
              <GraduationCap className="w-4 h-4" />
              {role === ROLES.STUDENT ? "I'm a student" : "I'm a guide"}
            </button>
          ))}
        </div>

        <div>
          <label className="text-xs font-medium text-slate-ink mb-1.5 block">Full name</label>
          <div className="flex items-center gap-2 border border-slate-line bg-cloud/40 rounded-lg px-3.5 py-2.5 focus-within:border-brand focus-within:bg-paper focus-within:ring-4 focus-within:ring-brand/10 transition-all">
            <User className="w-4 h-4 text-slate-muted" />
            <input
              required
              minLength={2}
              placeholder="Aisha Verma"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="flex-1 outline-none text-sm bg-transparent"
            />
          </div>
        </div>

        <div>
          <label className="text-xs font-medium text-slate-ink mb-1.5 block">Email</label>
          <div className="flex items-center gap-2 border border-slate-line bg-cloud/40 rounded-lg px-3.5 py-2.5 focus-within:border-brand focus-within:bg-paper focus-within:ring-4 focus-within:ring-brand/10 transition-all">
            <Mail className="w-4 h-4 text-slate-muted" />
            <input
              type="email"
              required
              placeholder="you@college.edu"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              className="flex-1 outline-none text-sm bg-transparent"
            />
          </div>
        </div>

        <div>
          <label className="text-xs font-medium text-slate-ink mb-1.5 block">Password</label>
          <div className="flex items-center gap-2 border border-slate-line bg-cloud/40 rounded-lg px-3.5 py-2.5 focus-within:border-brand focus-within:bg-paper focus-within:ring-4 focus-within:ring-brand/10 transition-all">
            <Lock className="w-4 h-4 text-slate-muted" />
            <input
              type="password"
              required
              minLength={8}
              placeholder="At least 8 characters"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              className="flex-1 outline-none text-sm bg-transparent"
            />
          </div>
          {form.password && (
            <div className="flex gap-1 mt-1.5">
              {[0, 1, 2, 3].map((i) => (
                <span
                  key={i}
                  className={`h-1 flex-1 rounded-full transition-colors duration-300 ${i < strength.score ? "bg-mint" : "bg-slate-line"}`}
                />
              ))}
            </div>
          )}
        </div>

        {error && <p className="text-xs text-coral bg-coral-soft rounded-lg px-3 py-2 animate-fade-up">{error}</p>}

        <button
          type="submit"
          disabled={loading}
          className="btn-premium w-full bg-brand hover:bg-brand-deep disabled:opacity-70 disabled:hover:translate-y-0 disabled:hover:shadow-none text-white text-sm font-semibold py-3 rounded-lg inline-flex items-center justify-center gap-2"
        >
          {loading && <Loader2 className="w-4 h-4 animate-spin" />}
          {loading ? "Sending code…" : "Send verification code"}
        </button>
      </form>

      <p className="text-sm text-slate-muted text-center mt-8">
        Already have an account?{" "}
        <Link to={ROUTES.LOGIN} className="text-brand font-semibold hover:underline">
          Log in
        </Link>
      </p>
    </div>
  );
};

export default Signup;
