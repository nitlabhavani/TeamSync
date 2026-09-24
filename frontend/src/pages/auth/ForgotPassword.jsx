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
      <Link to={ROUTES.LOGIN} className="inline-flex items-center gap-1.5 text-xs text-slate-muted hover:text-slate-ink mb-6 transition-colors">
        <ArrowLeft className="w-3.5 h-3.5" /> Back to login
      </Link>

      <span className="inline-flex w-11 h-11 rounded-xl2 bg-brand-soft items-center justify-center mb-5">
        <KeyRound className="w-5 h-5 text-brand" strokeWidth={2.5} />
      </span>

      <h2 className="font-display text-2xl font-semibold text-slate-ink mb-1.5">Reset your password</h2>
      <p className="text-sm text-slate-muted mb-8">
        Enter your account email and we'll send you a verification code.
      </p>

      {sent ? (
        <div className="bg-mint-soft text-mint text-sm rounded-lg px-4 py-3.5 flex items-start gap-2.5 animate-fade-up">
          <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
          <span>
            A verification code has been sent to <span className="font-semibold">{email}</span>.
          </span>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-xs font-medium text-slate-ink mb-1.5 block">Email</label>
            <div className="flex items-center gap-2 border border-slate-line bg-cloud/40 rounded-lg px-3.5 py-2.5 focus-within:border-brand focus-within:bg-paper focus-within:ring-4 focus-within:ring-brand/10 transition-all">
              <Mail className="w-4 h-4 text-slate-muted" />
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@college.edu"
                className="flex-1 outline-none text-sm bg-transparent"
              />
            </div>
          </div>

          {error && <p className="text-xs text-coral bg-coral-soft rounded-lg px-3 py-2 animate-fade-up">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="btn-premium w-full bg-brand hover:bg-brand-deep disabled:opacity-70 disabled:hover:translate-y-0 disabled:hover:shadow-none text-white text-sm font-semibold py-3 rounded-lg"
          >
            {loading ? "Sending…" : "Send verification code"}
          </button>
        </form>
      )}

      {sent && (
        <button
          onClick={() => navigate(`${ROUTES.VERIFY_OTP}?mode=reset&email=${encodeURIComponent(email)}`)}
          className="btn-premium w-full mt-4 bg-brand hover:bg-brand-deep text-white text-sm font-semibold py-3 rounded-lg"
        >
          Enter verification code
        </button>
      )}
    </div>
  );
};

export default ForgotPassword;
