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
        className="inline-flex items-center gap-1.5 text-xs text-slate-muted hover:text-slate-ink mb-6 transition-colors"
      >
        <ArrowLeft className="w-3.5 h-3.5" /> Back
      </Link>

      <span className="inline-flex w-11 h-11 rounded-xl2 bg-brand-soft items-center justify-center mb-5">
        <ShieldCheck className="w-5 h-5 text-brand" strokeWidth={2.5} />
      </span>

      <h2 className="font-display text-2xl font-semibold text-slate-ink mb-1.5">
        {isReset ? "Reset your password" : "Verify your code"}
      </h2>
      <p className="text-sm text-slate-muted mb-8">
        {isReset
          ? `Enter the 6-digit code sent to ${email || "your email"} and choose a new password.`
          : "Enter the 6-digit code we sent to your email."}
      </p>

      <form onSubmit={handleSubmit} className="space-y-4">
        <OtpInput value={otp} onChange={setOtp} disabled={loading} />

        {isReset && (
          <div className="space-y-4">
            <div>
              <label className="text-xs font-medium text-slate-ink mb-1.5 block">New password</label>
              <div className="flex items-center gap-2 border border-slate-line bg-cloud/40 rounded-lg px-3.5 py-2.5 focus-within:border-brand focus-within:bg-paper focus-within:ring-4 focus-within:ring-brand/10 transition-all">
                <Lock className="w-4 h-4 text-slate-muted" />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 8 characters"
                  className="flex-1 outline-none text-sm bg-transparent"
                />
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-slate-ink mb-1.5 block">Confirm password</label>
              <div className="flex items-center gap-2 border border-slate-line bg-cloud/40 rounded-lg px-3.5 py-2.5 focus-within:border-brand focus-within:bg-paper focus-within:ring-4 focus-within:ring-brand/10 transition-all">
                <Lock className="w-4 h-4 text-slate-muted" />
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Re-enter new password"
                  className="flex-1 outline-none text-sm bg-transparent"
                />
              </div>
            </div>
          </div>
        )}

        {notice && <p className="text-xs text-mint bg-mint-soft rounded-lg px-3 py-2 animate-fade-up">{notice}</p>}
        {error && <p className="text-xs text-coral bg-coral-soft rounded-lg px-3 py-2 animate-fade-up">{error}</p>}

        <button
          type="submit"
          disabled={loading}
          className="btn-premium w-full bg-brand hover:bg-brand-deep disabled:opacity-70 disabled:hover:translate-y-0 disabled:hover:shadow-none text-white text-sm font-semibold py-3 rounded-lg"
        >
          {loading ? (isReset ? "Resetting…" : "Verifying…") : isReset ? "Reset password" : "Verify code"}
        </button>
      </form>
    </div>
  );
};

export default VerifyOtp;
