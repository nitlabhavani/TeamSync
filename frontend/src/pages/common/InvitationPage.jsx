import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "@/lib/router-compat";
import {
  ArrowLeft,
  Mail,
  UserCheck,
  UserX,
  Loader2,
  PartyPopper,
  AlertTriangle,
  Clock,
  Briefcase,
  User,
  ShieldAlert,
  Calendar,
  Layers,
  ArrowRight,
  LogOut,
} from "lucide-react";
import * as invitationService from "../../services/invitationService";
import * as authService from "../../services/authService";
import * as toastService from "../../services/toastService";
import { useAuth } from "../../hooks/useAuth";
import { ROUTES } from "../../utils/constants";

const InvitationPage = () => {
  const { token } = useParams();
  const navigate = useNavigate();
  const { user, logout } = useAuth();

  const [invitation, setInvitation] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [actionSuccess, setActionSuccess] = useState(null); // { type: 'accepted'|'rejected', message, groupId, groupName }

  useEffect(() => {
    let active = true;
    const fetchInvitation = async () => {
      setError("");
      try {
        const data = await invitationService.getInvitation(token);
        if (active) {
          setInvitation(data);
          // If already accepted, set success state
          if (data?.status === "accepted" && data?.group?.id) {
            setActionSuccess({
              type: "already_accepted",
              message: "This invitation has already been accepted.",
              groupId: data.group.id,
              groupName: data.group.name,
            });
          }
        }
      } catch (err) {
        if (active) setError(err.message || "Failed to load invitation. Link may be invalid or expired.");
      } finally {
        if (active) setLoaded(true);
      }
    };

    if (token) fetchInvitation();
    return () => {
      active = false;
    };
  }, [token]);

  const emailMatches =
    user?.email &&
    invitation?.email &&
    user.email.trim().toLowerCase() === invitation.email.trim().toLowerCase();

  const isExpired =
    invitation?.status === "expired" ||
    (invitation?.expiresAt && new Date(invitation.expiresAt) < new Date());

  const handleAccept = async () => {
    if (!user) {
      authService.setPostLoginRedirect(`/invite/${token}`);
      navigate(`${ROUTES.LOGIN}?redirect=${encodeURIComponent(`/invite/${token}`)}`);
      return;
    }

    if (!emailMatches) return;

    setError("");
    setLoading(true);
    try {
      const res = await invitationService.acceptInvitation(token);
      const groupName = res.data?.groupName || invitation?.group?.name || "the project group";
      const groupId = res.data?.groupId || invitation?.group?.id;

      toastService.showSuccess(`You have joined ${groupName} successfully!`);
      setActionSuccess({
        type: "accepted",
        message: `You have successfully joined ${groupName}!`,
        groupId,
        groupName,
      });

      // Redirect immediately to group after brief moment
      setTimeout(() => {
        if (groupId) {
          navigate(`/app/groups/${groupId}`);
        } else {
          navigate(ROUTES.STUDENT_GROUPS);
        }
      }, 1500);
    } catch (err) {
      setError(err.message || "Failed to accept invitation. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleReject = async () => {
    if (
      !window.confirm(
        `Are you sure you want to reject the invitation to join ${
          invitation?.group?.name || "this group"
        }? This cannot be undone.`
      )
    ) {
      return;
    }

    setError("");
    setLoading(true);
    try {
      await invitationService.rejectInvitation(token);
      setInvitation((prev) => (prev ? { ...prev, status: "rejected" } : prev));
      setActionSuccess({
        type: "rejected",
        message: "You have declined this project invitation.",
      });
      toastService.showToast("Invitation rejected.");
    } catch (err) {
      setError(err.message || "Failed to reject invitation.");
    } finally {
      setLoading(false);
    }
  };

  const handleLoginRedirect = () => {
    authService.setPostLoginRedirect(`/invite/${token}`);
    navigate(`${ROUTES.LOGIN}?redirect=${encodeURIComponent(`/invite/${token}`)}`);
  };

  const handleSwitchAccount = async () => {
    try {
      await logout();
    } catch {
      // ignore
    }
    handleLoginRedirect();
  };

  if (!token) {
    return (
      <div className="max-w-xl mx-auto p-6 mt-12 text-center space-y-4">
        <div className="w-12 h-12 rounded-2xl bg-coral-soft/50 text-coral flex items-center justify-center mx-auto">
          <AlertTriangle className="w-6 h-6" />
        </div>
        <h1 className="text-xl font-semibold text-slate-ink">Invalid Invitation Link</h1>
        <p className="text-sm text-slate-muted">This invitation URL is missing a valid token.</p>
        <Link to={ROUTES.HOME} className="btn-secondary inline-flex items-center gap-2">
          <ArrowLeft className="w-4 h-4" /> Return to Home
        </Link>
      </div>
    );
  }

  if (!loaded) {
    return (
      <div className="max-w-xl mx-auto p-8 mt-12 text-center space-y-4">
        <Loader2 className="w-8 h-8 text-brand animate-spin mx-auto" />
        <p className="text-sm font-medium text-slate-muted">Loading invitation details…</p>
      </div>
    );
  }

  if (error && !invitation) {
    return (
      <div className="max-w-xl mx-auto p-6 mt-12">
        <div className="rounded-3xl border border-slate-line bg-paper p-8 text-center space-y-4">
          <div className="w-12 h-12 rounded-2xl bg-coral-soft/50 text-coral flex items-center justify-center mx-auto">
            <AlertTriangle className="w-6 h-6" />
          </div>
          <h2 className="text-xl font-semibold text-slate-ink">Invitation Not Found</h2>
          <p className="text-sm text-slate-muted">{error}</p>
          <div className="pt-2">
            <Link to={ROUTES.HOME} className="inline-flex items-center gap-2 text-sm font-semibold text-brand hover:underline">
              <ArrowLeft className="w-4 h-4" /> Return to Home
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-xl mx-auto p-4 sm:p-6 my-6 sm:my-10">
      <Link
        to={ROUTES.HOME}
        className="inline-flex items-center gap-1.5 text-xs text-slate-muted hover:text-slate-ink mb-6 transition-colors"
      >
        <ArrowLeft className="w-3.5 h-3.5" /> Back
      </Link>

      <div className="space-y-5">
        {/* Main Invitation Details Card */}
        <div className="rounded-3xl border border-slate-line bg-paper p-6 sm:p-8 shadow-sm">
          {/* Header */}
          <div className="flex items-start gap-4 mb-6">
            <span className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-brand-soft text-brand flex-shrink-0">
              <Mail className="w-6 h-6" />
            </span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap mb-1">
                <span className="text-xs font-semibold uppercase tracking-wider text-brand px-2.5 py-0.5 rounded-full bg-brand-soft">
                  Project Invitation
                </span>
                {invitation?.role === "leader" ? (
                  <span className="text-xs font-semibold text-amber-deep px-2.5 py-0.5 rounded-full bg-amber-soft">
                    Team Leader
                  </span>
                ) : (
                  <span className="text-xs font-medium text-slate-muted px-2.5 py-0.5 rounded-full bg-cloud">
                    Team Member
                  </span>
                )}
              </div>
              <h1 className="text-2xl font-bold text-slate-ink truncate">
                {invitation?.group?.name || "Project Team"}
              </h1>
              <p className="text-xs text-slate-muted mt-0.5">
                Invited email: <strong className="text-slate-ink font-medium">{invitation?.email}</strong>
              </p>
            </div>
          </div>

          {/* Group & Project Information */}
          <div className="grid gap-3.5 py-4 border-y border-slate-line/80 text-sm">
            {invitation?.group?.project && (
              <div className="flex items-start gap-3">
                <Briefcase className="w-4 h-4 text-slate-muted flex-shrink-0 mt-0.5" />
                <div>
                  <span className="text-xs font-semibold text-slate-muted uppercase tracking-wider block">Project</span>
                  <p className="text-slate-ink font-medium">{invitation.group.project}</p>
                </div>
              </div>
            )}

            {invitation?.group?.description && (
              <div className="flex items-start gap-3">
                <Layers className="w-4 h-4 text-slate-muted flex-shrink-0 mt-0.5" />
                <div>
                  <span className="text-xs font-semibold text-slate-muted uppercase tracking-wider block">Description</span>
                  <p className="text-slate-600 text-xs sm:text-sm">{invitation.group.description}</p>
                </div>
              </div>
            )}

            <div className="flex items-start gap-3">
              <User className="w-4 h-4 text-slate-muted flex-shrink-0 mt-0.5" />
              <div>
                <span className="text-xs font-semibold text-slate-muted uppercase tracking-wider block">Project Guide</span>
                <p className="text-slate-ink font-medium">{invitation?.guideName || "Faculty Guide"}</p>
              </div>
            </div>

            {invitation?.group?.expectedCompletion && (
              <div className="flex items-start gap-3">
                <Calendar className="w-4 h-4 text-slate-muted flex-shrink-0 mt-0.5" />
                <div>
                  <span className="text-xs font-semibold text-slate-muted uppercase tracking-wider block">Expected Completion</span>
                  <p className="text-slate-ink text-xs">
                    {new Date(invitation.group.expectedCompletion).toLocaleDateString(undefined, {
                      year: "numeric",
                      month: "short",
                      day: "numeric",
                    })}
                  </p>
                </div>
              </div>
            )}

            {invitation?.expiresAt && (
              <div className="flex items-start gap-3">
                <Clock className="w-4 h-4 text-slate-muted flex-shrink-0 mt-0.5" />
                <div>
                  <span className="text-xs font-semibold text-slate-muted uppercase tracking-wider block">Invitation Expires</span>
                  <p className="text-slate-600 text-xs">
                    {new Date(invitation.expiresAt).toLocaleDateString(undefined, {
                      year: "numeric",
                      month: "short",
                      day: "numeric",
                    })}
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Error message banner */}
        {error && (
          <div className="rounded-2xl border border-coral-soft bg-coral-soft/20 p-4 text-sm text-coral flex items-start gap-3 animate-fade-up">
            <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" />
            <p className="flex-1 font-medium">{error}</p>
          </div>
        )}

        {/* Success States */}
        {actionSuccess?.type === "accepted" && (
          <div className="rounded-3xl border border-mint-soft bg-mint-soft/30 p-6 sm:p-8 text-center space-y-4 animate-fade-up">
            <span className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-mint-soft text-mint mx-auto">
              <PartyPopper className="w-7 h-7" />
            </span>
            <h2 className="text-xl font-bold text-slate-ink">Welcome to the Team!</h2>
            <p className="text-sm text-slate-700 max-w-sm mx-auto">{actionSuccess.message}</p>
            <div className="pt-2">
              <button
                type="button"
                onClick={() =>
                  actionSuccess.groupId
                    ? navigate(`/app/groups/${actionSuccess.groupId}`)
                    : navigate(ROUTES.STUDENT_GROUPS)
                }
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-xl bg-brand px-6 py-3 text-sm font-semibold text-white hover:bg-brand-deep shadow-sm transition-all"
              >
                Go to Group Workspace <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {actionSuccess?.type === "already_accepted" && (
          <div className="rounded-3xl border border-mint-soft bg-mint-soft/30 p-6 sm:p-8 text-center space-y-4">
            <span className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-mint-soft text-mint mx-auto">
              <UserCheck className="w-6 h-6" />
            </span>
            <h2 className="text-lg font-bold text-slate-ink">Invitation Already Accepted</h2>
            <p className="text-sm text-slate-700">
              You or your team member already accepted this invitation to join{" "}
              <strong>{actionSuccess.groupName}</strong>.
            </p>
            <div className="pt-2">
              <Link
                to={`/app/groups/${actionSuccess.groupId}`}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-xl bg-brand px-6 py-3 text-sm font-semibold text-white hover:bg-brand-deep shadow-sm transition-all"
              >
                Open Group Workspace <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
          </div>
        )}

        {actionSuccess?.type === "rejected" && (
          <div className="rounded-3xl border border-slate-line bg-paper p-6 sm:p-8 text-center space-y-4 animate-fade-up">
            <span className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-cloud text-slate-muted mx-auto">
              <UserX className="w-6 h-6" />
            </span>
            <h2 className="text-lg font-bold text-slate-ink">Invitation Declined</h2>
            <p className="text-sm text-slate-muted">{actionSuccess.message}</p>
            <div className="pt-2">
              <Link
                to={user ? ROUTES.STUDENT_DASHBOARD : ROUTES.HOME}
                className="inline-flex items-center gap-2 text-sm font-semibold text-brand hover:underline"
              >
                <ArrowLeft className="w-4 h-4" /> Return to Dashboard
              </Link>
            </div>
          </div>
        )}

        {/* Existing Inactive Statuses (when not coming from recent action) */}
        {!actionSuccess && invitation?.status === "accepted" && (
          <div className="rounded-2xl border border-mint-soft bg-mint-soft/30 p-4 text-sm text-slate-700 flex items-center justify-between gap-4">
            <span>This invitation has already been accepted.</span>
            {invitation?.group?.id && (
              <Link
                to={`/app/groups/${invitation.group.id}`}
                className="text-xs font-semibold text-brand bg-paper px-3 py-1.5 rounded-lg border border-slate-line hover:bg-cloud"
              >
                Open Group
              </Link>
            )}
          </div>
        )}

        {!actionSuccess && invitation?.status === "rejected" && (
          <div className="rounded-2xl border border-coral-soft bg-coral-soft/20 p-5 text-sm text-coral flex items-start gap-3">
            <UserX className="w-5 h-5 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-slate-ink">This invitation was declined</p>
              <p className="text-xs text-slate-600 mt-1">
                This invitation was previously rejected and can no longer be used. If this was a mistake, ask your guide to resend an invitation.
              </p>
            </div>
          </div>
        )}

        {!actionSuccess && isExpired && (
          <div className="rounded-2xl border border-amber-soft bg-amber-soft/30 p-5 text-sm text-amber-deep flex items-start gap-3">
            <Clock className="w-5 h-5 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-slate-ink">This invitation has expired</p>
              <p className="text-xs text-slate-600 mt-1">
                The expiration date for this invitation has passed. Please contact your guide to request a new invitation.
              </p>
            </div>
          </div>
        )}

        {/* Action Panel for Pending Invitations */}
        {!actionSuccess && invitation?.status === "pending" && !isExpired && (
          <div className="space-y-4">
            {/* Condition 1: Not Logged In */}
            {!user && (
              <div className="rounded-3xl border border-slate-line bg-paper p-6 text-center space-y-4">
                <div className="w-10 h-10 rounded-xl bg-brand-soft text-brand flex items-center justify-center mx-auto">
                  <UserCheck className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-slate-ink">Log in to respond</h3>
                  <p className="text-xs text-slate-muted mt-1 max-w-sm mx-auto">
                    Please log in with the account for <strong>{invitation.email}</strong> to accept or reject this invitation.
                  </p>
                </div>
                <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
                  <button
                    type="button"
                    onClick={handleLoginRedirect}
                    className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-xl bg-brand px-6 py-3 text-sm font-semibold text-white hover:bg-brand-deep shadow-sm transition-all"
                  >
                    Log in to Accept <ArrowRight className="w-4 h-4" />
                  </button>
                  <Link
                    to={`${ROUTES.SIGNUP}?email=${encodeURIComponent(invitation.email)}`}
                    onClick={() => {
                      if (invitation?.group?.id) {
                        authService.setPostLoginRedirect(`/invite/${token}`);
                      }
                    }}
                    className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-xl border border-slate-line bg-paper px-5 py-3 text-sm font-semibold text-slate-ink hover:bg-cloud transition-all"
                  >
                    Create Account
                  </Link>
                </div>
              </div>
            )}

            {/* Condition 2: Logged In with Mismatched Email */}
            {user && !emailMatches && (
              <div className="rounded-3xl border border-amber-soft bg-amber-soft/20 p-6 space-y-4">
                <div className="flex items-start gap-3">
                  <ShieldAlert className="w-6 h-6 text-amber-deep flex-shrink-0 mt-0.5" />
                  <div className="space-y-1.5 flex-1">
                    <h3 className="text-sm font-semibold text-slate-ink">Email Address Mismatch</h3>
                    <p className="text-xs text-slate-600 leading-relaxed">
                      You are currently logged in as <strong className="text-slate-ink">{user.email}</strong>, but this
                      invitation was sent to <strong className="text-slate-ink">{invitation.email}</strong>.
                    </p>
                    <p className="text-xs text-slate-600">
                      To accept or reject this invitation, please switch accounts and log in with the invited email.
                    </p>
                  </div>
                </div>
                <div className="pt-2 flex flex-col sm:flex-row gap-3">
                  <button
                    type="button"
                    onClick={handleSwitchAccount}
                    className="inline-flex items-center justify-center gap-2 rounded-xl bg-amber-deep px-5 py-2.5 text-xs font-semibold text-white hover:opacity-90 transition-all"
                  >
                    <LogOut className="w-3.5 h-3.5" /> Switch Account & Log in
                  </button>
                </div>
              </div>
            )}

            {/* Condition 3: Logged In with Matching Email */}
            {user && emailMatches && (
              <div className="rounded-3xl border border-slate-line bg-paper p-6 sm:p-7 space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wider text-slate-muted">Your Response</span>
                  <span className="text-xs text-mint font-medium flex items-center gap-1">
                    <UserCheck className="w-3.5 h-3.5" /> Logged in as {user.email}
                  </span>
                </div>

                <div className="flex flex-col sm:flex-row items-center gap-3 pt-2">
                  <button
                    type="button"
                    onClick={handleAccept}
                    disabled={loading}
                    className="w-full sm:flex-1 inline-flex items-center justify-center gap-2 rounded-xl bg-brand px-5 py-3.5 text-sm font-semibold text-white hover:bg-brand-deep disabled:opacity-60 shadow-sm transition-all"
                  >
                    {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserCheck className="w-4 h-4" />}
                    {loading ? "Joining team…" : "Accept Invitation"}
                  </button>

                  <button
                    type="button"
                    onClick={handleReject}
                    disabled={loading}
                    className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-xl border border-coral-soft bg-paper px-5 py-3.5 text-sm font-semibold text-coral hover:bg-coral-soft/20 disabled:opacity-60 transition-all"
                  >
                    {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserX className="w-4 h-4" />}
                    Reject
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default InvitationPage;
