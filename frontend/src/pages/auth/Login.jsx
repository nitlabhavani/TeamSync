import { useState } from "react";
import { Link, useNavigate } from "@/lib/router-compat";
import { Mail, Lock, Eye, EyeOff, ArrowRight } from "lucide-react";
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
      // If we got here from an invitation page or link with ?redirect=...,
      // go back there. Also checks sessionStorage resume target.
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
    <div>
      <span className="inline-flex w-11 h-11 rounded-xl2 bg-brand-soft items-center justify-center mb-5">
        <ArrowRight className="w-5 h-5 text-brand rotate-[-45deg]" strokeWidth={2.5} />
      </span>
      <h2 className="font-display text-2xl font-semibold text-slate-ink mb-1.5">Welcome back</h2>
      <p className="text-sm text-slate-muted mb-8">Log in to your TeamSync AI workspace.</p>

      <form onSubmit={handleSubmit} className="space-y-4">
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
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-xs font-medium text-slate-ink block">Password</label>
            <Link to={ROUTES.FORGOT_PASSWORD} className="text-xs text-brand font-medium hover:underline">
              Forgot password?
            </Link>
          </div>
          <div className="flex items-center gap-2 border border-slate-line bg-cloud/40 rounded-lg px-3.5 py-2.5 focus-within:border-brand focus-within:bg-paper focus-within:ring-4 focus-within:ring-brand/10 transition-all">
            <Lock className="w-4 h-4 text-slate-muted" />
            <input
              type={showPassword ? "text" : "password"}
              required
              placeholder="••••••••"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              className="flex-1 outline-none text-sm bg-transparent"
            />
            <button type="button" onClick={() => setShowPassword((v) => !v)} className="text-slate-muted hover:text-slate-ink transition-colors">
              {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {error && (
          <p className="text-xs text-coral bg-coral-soft rounded-lg px-3 py-2 animate-fade-up">{error}</p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="btn-premium w-full flex items-center justify-center gap-2 bg-brand hover:bg-brand-deep disabled:opacity-70 text-white text-sm font-semibold py-3 rounded-lg"
        >
          {loading ? "Logging in…" : "Log in"} {!loading && <ArrowRight className="w-4 h-4" />}
        </button>
      </form>

      <p className="text-sm text-slate-muted text-center mt-8">
        New to TeamSync AI?{" "}
        <Link to={ROUTES.SIGNUP} className="text-brand font-semibold hover:underline">
          Create an account
        </Link>
      </p>
    </div>
  );
};

export default Login;
