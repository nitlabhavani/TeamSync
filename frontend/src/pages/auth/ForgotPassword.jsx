import { useState } from "react";
import { Link, useNavigate } from "@/lib/router-compat";
import { Mail, ArrowLeft, KeyRound, CheckCircle2 } from "lucide-react";
import * as authService from "../../services/authService";
import { ROUTES } from "../../utils/constants";

const ForgotPassword = () => {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await authService.forgotPassword({ email });
      setSent(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <Link to={ROUTES.LOGIN} className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-white mb-6 transition-colors">
        <ArrowLeft className="w-3.5 h-3.5" /> Back to login
      </Link>

      <span className="inline-flex w-11 h-11 rounded-xl bg-brand/20 border border-brand/30 items-center justify-center mb-5">
        <KeyRound className="w-5 h-5 text-mint" strokeWidth={2.5} />
      </span>

      <h2 className="font-display text-2xl font-bold text-white mb-1.5">Reset your password</h2>
      <p className="text-sm text-slate-300 mb-8">
        Enter your account email and we'll send you a verification code.
      </p>

      {sent ? (
        <div className="bg-mint/10 border border-mint/30 text-mint text-sm rounded-xl px-4 py-3.5 flex items-start gap-2.5 animate-fade-up">
          <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
          <span>
            A verification code has been sent to <span className="font-semibold text-white">{email}</span>.
          </span>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="forgot-email" className="text-xs font-bold uppercase tracking-wider text-slate-300 mb-1.5 block">
              Email Address
            </label>
            <div className="flex items-center gap-2.5 border border-white/15 bg-slate-950/80 rounded-xl px-3.5 py-3 focus-within:border-brand focus-within:bg-slate-950 focus-within:ring-4 focus-within:ring-brand/20 transition-all">
              <Mail className="w-4 h-4 text-slate-400 shrink-0" />
              <input
                id="forgot-email"
                name="email"
                type="email"
                autoComplete="email"
                autoFocus
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@college.edu"
                className="flex-1 outline-none text-sm bg-transparent text-white placeholder:text-slate-500 font-medium caret-brand"
              />
            </div>
          </div>

          {error && <p className="text-xs text-coral font-medium bg-coral/10 border border-coral/30 rounded-xl px-3.5 py-2.5 animate-fade-up">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-gradient-to-r from-brand via-purple-600 to-indigo-600 text-white text-sm font-bold py-3.5 rounded-xl shadow-lg shadow-brand/25 hover:shadow-brand/40 transition-all disabled:opacity-70 cursor-pointer"
          >
            {loading ? "Sending…" : "Send verification code"}
          </button>
        </form>
      )}

      {sent && (
        <button
          onClick={() => navigate(`${ROUTES.VERIFY_OTP}?mode=reset&email=${encodeURIComponent(email)}`)}
          className="w-full mt-4 bg-gradient-to-r from-brand via-purple-600 to-indigo-600 text-white text-sm font-bold py-3.5 rounded-xl shadow-lg shadow-brand/25 hover:shadow-brand/40 transition-all cursor-pointer"
        >
          Enter verification code
        </button>
      )}
    </div>
  );
};

export default ForgotPassword;
