import { useState } from "react";
import { Link, useLocation, useNavigate } from "@/lib/router-compat";
import { ArrowLeft, ShieldCheck, Lock } from "lucide-react";
import * as authService from "../../services/authService";
import { ROUTES } from "../../utils/constants";
import OtpInput from "../../components/auth/OtpInput";

const VerifyOtp = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const params = new URLSearchParams(location.search || "");
  const mode = params.get("mode") || "verify";
  const email = String(params.get("email") || "").trim();
  const isReset = mode === "reset";

  const [otp, setOtp] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setNotice("");
    setLoading(true);

    if (otp.length !== 6) {
      setError("Enter the full 6-digit code.");
      setLoading(false);
      return;
    }

    if (isReset && !email) {
      setError("Missing email address. Please request a reset code again.");
      setLoading(false);
      return;
    }

    if (isReset) {
      if (password.length < 8) {
        setError("New password must be at least 8 characters.");
        setLoading(false);
        return;
      }
      if (password !== confirmPassword) {
        setError("New passwords do not match.");
        setLoading(false);
        return;
      }
    }

    try {
      if (isReset) {
        await authService.resetPassword({ email, otp, password });
        setNotice("Your password has been updated. You can now log in.");
        navigate(ROUTES.LOGIN);
      } else {
        await authService.verifyOtp({ email, otp });
        navigate(ROUTES.LOGIN);
      }
    } catch (err) {
      setError(err.message || "Could not verify the code. Try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <Link
        to={isReset ? ROUTES.FORGOT_PASSWORD : ROUTES.LOGIN}
        className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-white mb-6 transition-colors"
      >
        <ArrowLeft className="w-3.5 h-3.5" /> Back
      </Link>

      <span className="inline-flex w-11 h-11 rounded-xl bg-brand/20 border border-brand/30 items-center justify-center mb-5">
        <ShieldCheck className="w-5 h-5 text-mint" strokeWidth={2.5} />
      </span>

      <h2 className="font-display text-2xl font-bold text-white mb-1.5">
        {isReset ? "Reset your password" : "Verify your code"}
      </h2>
      <p className="text-sm text-slate-300 mb-8">
        {isReset
          ? `Enter the 6-digit code sent to ${email || "your email"} and choose a new password.`
          : "Enter the 6-digit code we sent to your email."}
      </p>

      <form onSubmit={handleSubmit} className="space-y-4">
        <OtpInput value={otp} onChange={setOtp} disabled={loading} />

        {isReset && (
          <div className="space-y-4">
            <div>
              <label htmlFor="reset-password" className="text-xs font-bold uppercase tracking-wider text-slate-300 mb-1.5 block">New password</label>
              <div className="flex items-center gap-2.5 border border-white/15 bg-slate-950/80 rounded-xl px-3.5 py-3 focus-within:border-brand focus-within:bg-slate-950 focus-within:ring-4 focus-within:ring-brand/20 transition-all">
                <Lock className="w-4 h-4 text-slate-400 shrink-0" />
                <input
                  id="reset-password"
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 8 characters"
                  className="flex-1 outline-none text-sm bg-transparent text-white placeholder:text-slate-500 font-medium caret-brand"
                />
              </div>
            </div>
            <div>
              <label htmlFor="reset-confirm-password" className="text-xs font-bold uppercase tracking-wider text-slate-300 mb-1.5 block">Confirm password</label>
              <div className="flex items-center gap-2.5 border border-white/15 bg-slate-950/80 rounded-xl px-3.5 py-3 focus-within:border-brand focus-within:bg-slate-950 focus-within:ring-4 focus-within:ring-brand/20 transition-all">
                <Lock className="w-4 h-4 text-slate-400 shrink-0" />
                <input
                  id="reset-confirm-password"
                  name="confirmPassword"
                  type="password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Re-enter new password"
                  className="flex-1 outline-none text-sm bg-transparent text-white placeholder:text-slate-500 font-medium caret-brand"
                />
              </div>
            </div>
          </div>
        )}

        {notice && <p className="text-xs text-mint font-medium bg-mint/10 border border-mint/30 rounded-xl px-3.5 py-2.5 animate-fade-up">{notice}</p>}
        {error && <p className="text-xs text-coral font-medium bg-coral/10 border border-coral/30 rounded-xl px-3.5 py-2.5 animate-fade-up">{error}</p>}

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-gradient-to-r from-brand via-purple-600 to-indigo-600 text-white text-sm font-bold py-3.5 rounded-xl shadow-lg shadow-brand/25 hover:shadow-brand/40 transition-all disabled:opacity-70 cursor-pointer"
        >
          {loading ? (isReset ? "Resetting…" : "Verifying…") : isReset ? "Reset password" : "Verify code"}
        </button>
      </form>
    </div>
  );
};

export default VerifyOtp;
