import { useState } from "react";
import { Link, useNavigate } from "@/lib/router-compat";
import { Mail, Lock, Eye, EyeOff, ArrowRight, Loader2, Sparkles } from "lucide-react";
import { useAuth } from "../../hooks/useAuth";
import { ROUTES } from "../../utils/constants";
import { consumePostLoginRedirect } from "../../services/authService";

const Login = () => {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ email: "", password: "" });
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const user = await login(form);
      let resume = null;
      if (typeof window !== "undefined") {
        const searchParams = new URLSearchParams(window.location.search);
        resume = searchParams.get("redirect") || consumePostLoginRedirect();
      } else {
        resume = consumePostLoginRedirect();
      }
      if (resume) {
        navigate(resume);
        return;
      }
      navigate(
        user.role === "guide"
          ? ROUTES.GUIDE_DASHBOARD
          : user.joinedGroups > 0
            ? ROUTES.STUDENT_GROUPS
            : ROUTES.STUDENT_DASHBOARD
      );
    } catch (err) {
      setError(err.message || "Something went wrong. Try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <div className="inline-flex items-center gap-1.5 rounded-full bg-brand/10 px-2.5 py-1 text-xs font-semibold text-brand mb-3">
          <Sparkles className="w-3.5 h-3.5" /> Workspace Login
        </div>
        <h2 className="font-display text-2xl sm:text-3xl font-extrabold text-slate-ink tracking-tight">
          Welcome back
        </h2>
        <p className="text-sm text-slate-muted mt-1">
          Sign in to access your projects, tasks, and real-time chat.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="text-xs font-bold uppercase tracking-wider text-slate-ink mb-1.5 block">
            Email Address
          </label>
          <div className="flex items-center gap-2.5 border border-slate-line/80 dark:border-slate-800 bg-cloud/50 dark:bg-slate-950/60 rounded-xl px-3.5 py-3 focus-within:border-brand focus-within:bg-paper dark:focus-within:bg-slate-900 focus-within:ring-4 focus-within:ring-brand/20 transition-all">
            <Mail className="w-4 h-4 text-slate-muted shrink-0" />
            <input
              type="email"
              required
              placeholder="you@college.edu"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              className="flex-1 outline-none text-sm bg-transparent text-slate-ink placeholder:text-slate-muted/70"
            />
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-xs font-bold uppercase tracking-wider text-slate-ink block">
              Password
            </label>
            <Link
              to={ROUTES.FORGOT_PASSWORD}
              className="text-xs text-brand font-semibold hover:underline"
            >
              Forgot password?
            </Link>
          </div>
          <div className="flex items-center gap-2.5 border border-slate-line/80 dark:border-slate-800 bg-cloud/50 dark:bg-slate-950/60 rounded-xl px-3.5 py-3 focus-within:border-brand focus-within:bg-paper dark:focus-within:bg-slate-900 focus-within:ring-4 focus-within:ring-brand/20 transition-all">
            <Lock className="w-4 h-4 text-slate-muted shrink-0" />
            <input
              type={showPassword ? "text" : "password"}
              required
              placeholder="••••••••"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              className="flex-1 outline-none text-sm bg-transparent text-slate-ink placeholder:text-slate-muted/70"
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="text-slate-muted hover:text-slate-ink transition-colors p-1"
            >
              {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {error && (
          <div className="text-xs text-coral font-medium bg-coral-soft/80 border border-coral/30 rounded-xl p-3 animate-fade-up">
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
                <Loader2 className="w-4 h-4 animate-spin" /> Authenticating…
              </>
            ) : (
              <>
                Sign in to workspace <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
              </>
            )}
          </span>
          <span className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/25 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
        </button>
      </form>

      <div className="pt-2 text-center text-xs text-slate-muted border-t border-slate-line/60">
        New to TeamSync AI?{" "}
        <Link to={ROUTES.SIGNUP} className="text-brand font-bold hover:underline ml-1">
          Create an account
        </Link>
      </div>
    </div>
  );
};

export default Login;
