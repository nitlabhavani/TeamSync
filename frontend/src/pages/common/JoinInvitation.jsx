import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "@/lib/router-compat";
import { ArrowLeft, Mail, Lock, Loader2, ShieldCheck, PartyPopper } from "lucide-react";
import * as invitationService from "../../services/invitationService";
import * as authService from "../../services/authService";
import OtpInput from "../../components/auth/OtpInput";
import { useAuth } from "../../hooks/useAuth";
import { ROUTES } from "../../utils/constants";

const JoinInvitation = () => {
  const { token } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [invitation, setInvitation] = useState(null);
  const [otp, setOtp] = useState("");
  const [devOtp, setDevOtp] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  // Set once the invitation is actually accepted, so the success state
  // survives instead of the page auto-navigating into a protected route
  // (which, for a student who isn't logged in on this browser, would bounce
  // straight to /login and look like the invitation page "closed").
  const [joined, setJoined] = useState(null); // { groupId, groupName } | null
  const [needsAccount, setNeedsAccount] = useState(false);

  useEffect(() => {
    let active = true;
    const load = async () => {
      setError("");
      try {
        const data = await invitationService.getInvitation(token);
        if (active) setInvitation(data);
      } catch (err) {
        if (active) setError(err.message || "Failed to load invitation.");
      } finally {
        if (active) setLoaded(true);
      }
    };

    if (token) load();
    return () => {
      active = false;
    };
  }, [token]);

  const handleVerify = async (e) => {
    e.preventDefault();
    setError("");
    setNotice("");
    setLoading(true);

    try {
      const result = await invitationService.verifyOtp(token, otp);
      setDevOtp(result?.devOtp || "");
      if (result?.needsAccount) {
        setNeedsAccount(true);
        setNotice("OTP verified. Create your account with this email to finish joining.");
        return;
      }
      if (result?.joined && result?.groupId) {
        // Do NOT auto-navigate — show a persistent success panel instead.
        // (Auto-navigating here used to send an unauthenticated browser
        // straight into a protected /app/groups/:id route, which bounced
        // to /login and made the page look like it had just closed.)
        setJoined({ groupId: result.groupId, groupName: invitation?.group?.name || "the group" });
        setNotice("");
        return;
      }
      setNotice("OTP confirmed. You can now access the team.");
    } catch (err) {
      setError(err.message || "Could not verify the code. Try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleReject = async () => {
    if (!window.confirm("Reject this invitation? This can't be undone — your guide will need to send a new one.")) return;
    setError("");
    setNotice("");
    setLoading(true);
    try {
      const data = await invitationService.rejectInvitation(token);
      setInvitation(data);
      setNotice("Invitation rejected.");
    } catch (err) {
      setError(err.message || "Could not reject the invitation.");
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    setError("");
    setNotice("");
    setLoading(true);
    try {
      const result = await invitationService.resendOtp(token);
      setDevOtp(result?.devOtp || "");
      setNotice(`A new code was sent to ${invitation?.email || "your inbox"}.`);
    } catch (err) {
      setError(err.message || "Could not resend the code.");
    } finally {
      setLoading(false);
    }
  };

  /**
   * The invitation was accepted server-side either way. If this browser is
   * actually signed in, go straight to the group. If not (e.g. the invite
   * was matched to an existing account that isn't logged in on this
   * device), send the student to log in first and resume here afterwards —
   * login/signup already re-validate everything server-side, this only
   * decides where the browser ends up.
   */
  const goToGroup = () => {
    if (!joined) return;
    const path = `/app/groups/${joined.groupId}`;
    if (user) {
      navigate(path);
    } else {
      authService.setPostLoginRedirect(path);
      navigate(ROUTES.LOGIN);
    }
  };

  if (!token) {
    return (
      <div className="p-6 max-w-xl mx-auto">
        <p className="text-sm text-coral">Invalid invitation link.</p>
      </div>
    );
  }

  if (!loaded) {
    return (
      <div className="p-6 max-w-xl mx-auto">
        <div className="text-sm text-slate-muted">Loading invitation…</div>
      </div>
    );
  }

  if (error && !invitation) {
    return (
      <div className="p-6 max-w-xl mx-auto space-y-4">
        <p className="text-sm text-coral">{error}</p>
        <Link to={ROUTES.HOME} className="text-brand font-semibold hover:underline">
          Return to home
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-xl mx-auto p-6">
      <Link to={ROUTES.HOME} className="inline-flex items-center gap-1.5 text-xs text-slate-muted hover:text-slate-ink mb-6">
        <ArrowLeft className="w-3.5 h-3.5" /> Back
      </Link>

      <div className="space-y-4">
        <div className="rounded-3xl border border-slate-line bg-paper p-6">
          <div className="flex items-center gap-3 mb-4">
            <span className="inline-flex items-center justify-center w-10 h-10 rounded-2xl bg-brand-soft text-brand-deep">
              <Mail className="w-5 h-5" />
            </span>
            <div>
              <h1 className="text-xl font-semibold text-slate-ink">Join {invitation?.group?.name || "the team"}</h1>
              <p className="text-sm text-slate-muted">Invitation sent to {invitation?.email}</p>
            </div>
          </div>
          <div className="grid gap-3 text-sm text-slate-600">
            <div>
              <span className="font-semibold text-slate-ink">Project</span>
              <p>{invitation?.group?.project || "—"}</p>
            </div>
            <div>
              <span className="font-semibold text-slate-ink">Guide</span>
              <p>{invitation?.guideName || "—"}</p>
            </div>
            <div>
              <span className="font-semibold text-slate-ink">Role</span>
              <p>{invitation?.role === "leader" ? "Team Leader" : "Team Member"}</p>
            </div>
          </div>
        </div>

        {joined && (
          <div className="rounded-3xl border border-mint-soft bg-mint-soft/30 p-6 text-center space-y-3">
            <span className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-mint-soft text-mint mx-auto">
              <PartyPopper className="w-6 h-6" />
            </span>
            <p className="font-semibold text-slate-ink">Invitation accepted successfully!</p>
            <p className="text-sm text-slate-700">You have joined {joined.groupName}.</p>
            <button
              type="button"
              onClick={goToGroup}
              className="mt-2 w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-lg bg-brand px-5 py-3 text-sm font-semibold text-white hover:bg-brand-deep"
            >
              {user ? "Go to My Group" : "Log in to view my group"}
            </button>
          </div>
        )}

        {!joined && invitation?.status === "accepted" && (
          <div className="rounded-3xl border border-mint-soft bg-mint-soft/30 p-4 text-sm text-slate-700">
            This invitation was already accepted. <Link to={`/app/groups/${invitation.group?.id}`} className="text-brand font-semibold">Open the group</Link>.
          </div>
        )}

        {!joined && invitation?.status === "rejected" && (
          <div className="rounded-3xl border border-coral-soft bg-coral-soft/20 p-4 text-sm text-coral">
            This invitation was rejected and cannot be accepted. Contact your guide for a new invitation.
          </div>
        )}

        {!joined && (
        <form onSubmit={handleVerify} className="space-y-4">
          <div className="rounded-3xl border border-slate-line bg-paper p-6">
            <div className="flex items-center gap-3 mb-4">
              <span className="inline-flex items-center justify-center w-10 h-10 rounded-2xl bg-amber-soft text-amber-deep">
                <Lock className="w-5 h-5" />
              </span>
              <div>
                <h2 className="text-lg font-semibold text-slate-ink">Enter the invitation code</h2>
                <p className="text-sm text-slate-muted">We emailed a 6-digit code to {invitation?.email}.</p>
              </div>
            </div>
            <OtpInput value={otp} onChange={setOtp} disabled={loading || invitation?.status !== "pending"} />
            {devOtp && (
              <p className="mt-4 text-xs text-slate-muted bg-cloud rounded-lg px-3 py-2 font-mono">
                Development code: <span className="font-semibold text-slate-ink">{devOtp}</span>
              </p>
            )}
            {notice && <p className="mt-4 text-xs text-mint bg-mint-soft rounded-lg px-3 py-2">{notice}</p>}
            {error && <p className="mt-4 text-xs text-coral bg-coral-soft rounded-lg px-3 py-2">{error}</p>}
            <button
              type="submit"
              disabled={
                loading || otp.length !== 6 || invitation?.status !== "pending"
              }
              className="mt-6 w-full inline-flex items-center justify-center gap-2 rounded-lg bg-brand px-4 py-3 text-sm font-semibold text-white hover:bg-brand-deep disabled:opacity-60"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
              {loading ? "Verifying…" : "Verify & join"}
            </button>
          </div>
        </form>
        )}

        {!joined && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <button
            type="button"
            onClick={handleResend}
            disabled={loading || invitation?.status !== "pending"}
            className="w-full sm:w-auto rounded-lg border border-slate-line bg-paper px-4 py-3 text-sm font-semibold text-slate-ink hover:bg-cloud disabled:opacity-60"
          >
            Resend code
          </button>
          {invitation?.status === "pending" && (
            <button
              type="button"
              onClick={handleReject}
              disabled={loading}
              className="w-full sm:w-auto rounded-lg border border-coral-soft bg-paper px-4 py-3 text-sm font-semibold text-coral hover:bg-coral-soft/20 disabled:opacity-60"
            >
              Reject invitation
            </button>
          )}
          {invitation?.email && (
            <Link
              to={`${ROUTES.SIGNUP}?email=${encodeURIComponent(invitation.email)}`}
              title={needsAccount ? "OTP verified — finish by creating your account" : undefined}
              onClick={() => {
                // Registering with this email auto-resumes the invitation
                // (see acceptPendingInvitations on the backend). This is a
                // best-effort UX nicety so Signup can route straight back
                // to the group afterwards instead of a generic dashboard.
                if (invitation?.group?.id) {
                  authService.setPostLoginRedirect(`/app/groups/${invitation.group.id}`);
                }
              }}
              className="w-full sm:w-auto text-center rounded-lg bg-brand-soft px-4 py-3 text-sm font-semibold text-brand-deep hover:bg-brand/10"
            >
              Create account with this email
            </Link>
          )}
        </div>
        )}
      </div>
    </div>
  );
};

export default JoinInvitation;
