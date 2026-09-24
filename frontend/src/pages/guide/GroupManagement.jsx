import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "@/lib/router-compat";
import {
  Sparkles,
  Users,
  Plus,
  MailCheck,
  RefreshCw,
  X,
  Loader2,
  Pencil,
  Trash2,
  Check,
  UserMinus,
  UserPlus,
  Wand2,
  Search,
  FolderKanban,
  Gauge,
  CalendarClock,
  Tag,
  AlertTriangle,
  ArrowUpDown,
} from "lucide-react";
import Navbar from "../../components/navbar/Navbar";
import StatsCard from "../../components/dashboard/StatsCard";
import CreateGroupModal from "../../components/groups/CreateGroupModal";
import AIProjectPlanModal from "../../components/groups/AIProjectPlanModal";
import { useGroups } from "../../hooks/useGroups";
import { useAuth } from "../../hooks/useAuth";
import { getInitials, classNames } from "../../utils/helperFunctions";
import { formatDay } from "../../utils/dateFormatter";
import * as groupService from "../../services/groupService";
import { ROLES } from "../../utils/constants";

const EMAIL_RE = /^\S+@\S+\.\S+$/;

const STATUS_STYLES = {
  pending: "bg-amber-50 text-amber-800",
  accepted: "bg-mint-soft text-mint",
  rejected: "bg-coral-soft text-coral",
};

// Group.status only ever comes back as "active" or "archived" (see backend
// models/Group.js) — the list endpoint additionally defaults to status=active,
// so in practice every group loaded here is active, but the badge still reads
// the real field rather than assuming.
const GROUP_STATUS_STYLES = {
  active: "bg-mint-soft text-mint",
  archived: "bg-cloud text-slate-muted",
};

const SORT_OPTIONS = [
  { value: "recent", label: "Most recent" },
  { value: "name", label: "Name (A–Z)" },
  { value: "progress", label: "Progress (high–low)" },
  { value: "members", label: "Members (high–low)" },
];

/** Invitation list with pending / accepted / rejected status chips. */
const InvitationPanel = ({ groupId, refreshKey }) => {
  const [invites, setInvites] = useState([]);
  const [busyId, setBusyId] = useState(null);
  const [loaded, setLoaded] = useState(false);

  const load = async () => {
    try {
      setInvites((await groupService.getInvitations(groupId)) || []);
    } catch {
      setInvites([]);
    } finally {
      setLoaded(true);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId, refreshKey]);

  if (!loaded) return null;

  const act = async (id, fn) => {
    setBusyId(id);
    try {
      await fn();
      await load();
    } finally {
      setBusyId(null);
    }
  };

  const count = (s) => invites.filter((i) => i.status === s).length;
  // Accepted invitations are already reflected in the Team Members list
  // above (as a member/leader row) — showing them again here as invitations
  // would be confusing, so this panel only lists the ones still in flight.
  const pendingAndRejected = invites.filter((i) => i.status !== "accepted");

  return (
    <div className="mt-4 border-t border-slate-line pt-3">
      <p className="flex items-center gap-2 text-xs font-semibold text-slate-muted mb-3 flex-wrap">
        <MailCheck className="w-3.5 h-3.5" /> Pending invitations
        <span className={`px-2 py-0.5 rounded-full ${STATUS_STYLES.pending}`}>Pending {count("pending")}</span>
        {count("rejected") > 0 && (
          <span className={`px-2 py-0.5 rounded-full ${STATUS_STYLES.rejected}`}>Rejected {count("rejected")}</span>
        )}
        {count("accepted") > 0 && (
          <span className={`px-2 py-0.5 rounded-full ${STATUS_STYLES.accepted}`}>Accepted {count("accepted")}</span>
        )}
      </p>

      {pendingAndRejected.length === 0 && (
        <p className="text-xs text-slate-muted">No pending invitations.</p>
      )}

      {/* One invitation per row (not a horizontal wrap of pills) so long
          emails and status/action controls stay legible on any screen size. */}
      <div className="flex flex-col gap-2">
        {pendingAndRejected.map((inv) => (
          <div
            key={inv.id}
            className={`flex items-center justify-between gap-3 rounded-xl px-3 py-2.5 ${
              STATUS_STYLES[inv.status] || "bg-cloud text-slate-ink"
            }`}
          >
            <span className="min-w-0 text-xs font-medium" style={{ wordBreak: "break-all", overflowWrap: "anywhere" }}>
              {inv.email}
            </span>
            <span className="flex items-center gap-2 shrink-0">
              <span className="uppercase text-[9px] font-semibold tracking-wide opacity-70">
                {inv.status === "pending" ? "Pending invitation" : `Invitation ${inv.status}`}
              </span>
              {inv.status === "pending" && (
                <>
                  <button
                    onClick={() => act(inv.id, () => groupService.resendInvitation(groupId, inv.id))}
                    disabled={busyId === inv.id}
                    title="Resend invitation"
                    className="hover:text-brand"
                  >
                    {busyId === inv.id ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <RefreshCw className="w-3 h-3" />
                    )}
                  </button>
                  <button
                    onClick={() => act(inv.id, () => groupService.cancelInvitation(groupId, inv.id))}
                    disabled={busyId === inv.id}
                    title="Cancel invitation"
                    className="hover:text-coral"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </>
              )}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};

const KpiSkeleton = () => (
  <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
    {Array.from({ length: 4 }).map((_, i) => (
      <div key={i} className="h-[92px] rounded-xl2 border border-slate-line bg-paper animate-pulse" />
    ))}
  </div>
);

const GroupCardSkeleton = () => (
  <div className="bg-paper border border-slate-line rounded-xl2 p-5 shadow-panel">
    <div className="flex items-center gap-3">
      <div className="w-12 h-12 rounded-full bg-cloud animate-pulse shrink-0" />
      <div className="flex-1 space-y-2">
        <div className="h-4 w-40 bg-cloud rounded animate-pulse" />
        <div className="h-3 w-56 bg-cloud/70 rounded animate-pulse" />
      </div>
    </div>
    <div className="mt-5 h-2 rounded-full bg-cloud animate-pulse" />
  </div>
);

const EmptyState = ({ icon: Icon, title, subtitle, action }) => (
  <div className="flex flex-col items-center text-center gap-2 border border-dashed border-slate-line rounded-xl2 py-10 px-6 bg-paper">
    <span className="w-11 h-11 rounded-full bg-cloud flex items-center justify-center">
      <Icon className="w-5 h-5 text-slate-muted" />
    </span>
    <p className="text-sm font-medium text-slate-ink">{title}</p>
    {subtitle && <p className="text-xs text-slate-muted max-w-xs">{subtitle}</p>}
    {action}
  </div>
);

const ErrorState = ({ message, onRetry }) => (
  <div className="flex items-center justify-between gap-3 bg-coral-soft border border-coral/20 rounded-xl2 px-4 py-3.5">
    <div className="flex items-center gap-3 min-w-0">
      <AlertTriangle className="w-4 h-4 text-coral shrink-0" />
      <p className="text-sm text-coral truncate">{message}</p>
    </div>
    <button
      onClick={onRetry}
      className="inline-flex items-center gap-1.5 text-xs font-semibold text-coral bg-white/60 hover:bg-white rounded-lg px-3 py-1.5 shrink-0 transition-colors"
    >
      <RefreshCw className="w-3.5 h-3.5" /> Retry
    </button>
  </div>
);

const GroupManagement = () => {
  const { groups, loading: groupsLoading, fetchGroups } = useGroups();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [modalOpen, setModalOpen] = useState(false);
  const [toast, setToast] = useState("");
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [editing, setEditing] = useState(null); // { id, name, project }
  const [inviteFor, setInviteFor] = useState(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [query, setQuery] = useState("");
  const [sortBy, setSortBy] = useState("recent");
  const [planGroup, setPlanGroup] = useState(null); // group the AI Project Plan modal is open for

  const isGuide = user?.role === ROLES.GUIDE || user?.role === "admin";

  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(""), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  // The useGroups hook already triggers an initial fetchGroups() call, but it
  // never surfaces a failure — a network error there just leaves `groups`
  // empty forever with no indication anything went wrong (silent failure).
  // This wraps the same, unmodified fetchGroups() so the page can show a
  // proper error state with a working Retry instead.
  const loadGroups = useCallback(() => {
    setLoadError("");
    return fetchGroups().catch((e) => setLoadError(e?.message || "Couldn't load your groups."));
  }, [fetchGroups]);

  useEffect(() => {
    loadGroups();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const run = async (fn, message) => {
    setBusy(true);
    setError("");
    try {
      await fn();
      await fetchGroups();
      setRefreshKey((k) => k + 1);
      if (message) setToast(message);
    } catch (e) {
      setError(e?.message || "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  const handleCreated = async (group, invited, autoTasksCount = 0) => {
    await fetchGroups();
    const tasksCount = autoTasksCount || group.autoTasksCreated || 0;
    const taskText = tasksCount > 0 ? ` with ${tasksCount} AI project tasks generated & assigned to team members` : "";
    const failed = (group.invitationResults || []).filter((r) => r.status === "pending" && r.emailSent === false);
    if (failed.length) {
      const emailList = failed.map((r) => r.email).join(", ");
      setToast(
        `"${group.name}" created${taskText} — email delivery failed for: ${emailList} (check SMTP settings). Invitations were still created and can be resent once email is fixed.`
      );
      return;
    }
    setToast(
      invited
        ? `"${group.name}" created${taskText} — ${invited} invitation${invited > 1 ? "s" : ""} sent.`
        : `"${group.name}" created${taskText}.`
    );
  };

  const saveEdit = () =>
    run(async () => {
      if (!editing.name.trim() || editing.name.trim().length < 3)
        throw new Error("Team title must be at least 3 characters.");
      await groupService.updateGroup(editing.id, {
        name: editing.name.trim(),
        project: editing.project.trim(),
      });
      setEditing(null);
    }, "Group updated.");

  const removeGroup = (g) => {
    if (!window.confirm(`Delete "${g.name}"? This cannot be undone.`)) return;
    run(() => groupService.deleteGroup(g.id), `"${g.name}" deleted.`);
  };

  const removeMember = (g, member) => {
    if (!window.confirm(`Remove ${member.name} from ${g.name}?`)) return;
    run(() => groupService.removeMember(g.id, member.id), `${member.name} removed.`);
  };

  const handleTasksCreated = async (result) => {
    await fetchGroups();
    setRefreshKey((k) => k + 1);
    setToast(
      result.skipped > 0
        ? `${result.created} task(s) created, ${result.skipped} skipped (already created earlier).`
        : `${result.created} task(s) created from the AI project plan.`
    );
  };

  const sendInvite = (g) =>
    run(async () => {
      const email = inviteEmail.trim().toLowerCase();
      if (!EMAIL_RE.test(email)) throw new Error(`"${inviteEmail}" is not a valid email address.`);
      const updated = await groupService.inviteMembers(g.id, [email]);
      setInviteEmail("");
      setInviteFor(null);
      const failed = (updated.invitationResults || []).some((r) => r.email === email && r.emailSent === false);
      if (failed) throw new Error(`Invitation created for ${email}, but the email failed to send — check SMTP settings. It can be resent from the invitations list.`);
    }, "Invitation sent.");

  // KPI summary — derived entirely from the groups already loaded via
  // useGroups/fetchGroups (no additional API calls, no invented metrics).
  const kpis = useMemo(() => {
    const totalGroups = groups.length;
    const totalMembers = groups.reduce((sum, g) => sum + (g.members || []).length, 0);
    const avgProgress = totalGroups
      ? Math.round(groups.reduce((sum, g) => sum + (g.progress || 0), 0) / totalGroups)
      : 0;
    const avgCollaboration = totalGroups
      ? Math.round(groups.reduce((sum, g) => sum + (g.collaborationScore || 0), 0) / totalGroups)
      : 0;
    return { totalGroups, totalMembers, avgProgress, avgCollaboration };
  }, [groups]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = groups.filter((g) => {
      if (!q) return true;
      return [g.name, g.project, g.description, ...(g.members || []).map((m) => m.name || "")]
        .join(" ")
        .toLowerCase()
        .includes(q);
    });

    const sorted = [...filtered];
    if (sortBy === "name") {
      sorted.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    } else if (sortBy === "progress") {
      sorted.sort((a, b) => (b.progress || 0) - (a.progress || 0));
    } else if (sortBy === "members") {
      sorted.sort((a, b) => (b.members || []).length - (a.members || []).length);
    } else {
      sorted.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    }
    return sorted;
  }, [groups, query, sortBy]);

  const showInitialLoading = groupsLoading && groups.length === 0 && !loadError;
  const hasSearch = query.trim().length > 0;

  return (
    <>
      <Navbar title="Group management" subtitle="All project groups under your supervision" />
      <main className="flex-1 px-5 md:px-8 py-6 space-y-5 max-w-6xl w-full mx-auto">
        {/* KPI overview */}
        {showInitialLoading ? (
          <KpiSkeleton />
        ) : loadError ? (
          <ErrorState message={loadError} onRetry={loadGroups} />
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatsCard label="Total groups" value={kpis.totalGroups} icon={FolderKanban} tone="brand" />
            <StatsCard label="Total members" value={kpis.totalMembers} icon={Users} tone="brand" />
            <StatsCard label="Avg. progress" value={`${kpis.avgProgress}%`} icon={Gauge} tone="mint" />
            <StatsCard label="Avg. collaboration" value={kpis.avgCollaboration} icon={Sparkles} tone="amber" />
          </div>
        )}

        {/* Search / sort / create */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 flex-1 min-w-[220px] flex-wrap">
            <div className="relative flex-1 min-w-[220px]">
              <Search className="w-4 h-4 text-slate-muted absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search groups or members…"
                className="w-full bg-paper border border-slate-line rounded-lg pl-9 pr-3.5 py-2.5 text-sm outline-none focus:border-brand"
              />
            </div>
            <div className="relative">
              <ArrowUpDown className="w-3.5 h-3.5 text-slate-muted absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                className="appearance-none bg-paper border border-slate-line rounded-lg pl-8 pr-3 py-2.5 text-xs font-medium text-slate-ink outline-none focus:border-brand"
              >
                {SORT_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {isGuide && (
            <button
              onClick={() => setModalOpen(true)}
              className="inline-flex items-center gap-1.5 bg-brand hover:bg-brand-deep text-white text-sm font-semibold px-4 py-2.5 rounded-lg transition-colors"
            >
              <Plus className="w-4 h-4" /> Create group
            </button>
          )}
        </div>

        {toast && <p className="text-sm text-mint bg-mint-soft rounded-lg px-4 py-3">{toast}</p>}
        {error && <p className="text-sm text-coral bg-coral-soft rounded-lg px-4 py-3">{error}</p>}

        {showInitialLoading && (
          <div className="space-y-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <GroupCardSkeleton key={i} />
            ))}
          </div>
        )}

        {!showInitialLoading && loadError && groups.length === 0 && (
          <EmptyState
            icon={AlertTriangle}
            title="Groups couldn't be loaded"
            subtitle="Check your connection and try again."
          />
        )}

        {!showInitialLoading && !loadError && visible.length === 0 && (
          <EmptyState
            icon={hasSearch ? Search : Users}
            title={hasSearch ? "No groups match your search" : "No groups found"}
            subtitle={
              hasSearch
                ? "Try a different name, project, or member."
                : isGuide
                ? "Create your first team and invite students by email."
                : "Your guide will add you to a team soon."
            }
          />
        )}

        {!showInitialLoading &&
          visible.map((g) => (
            <div key={g.id} className="bg-paper border border-slate-line rounded-xl2 p-5 shadow-panel">
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="w-12 h-12 rounded-full bg-brand-deep flex items-center justify-center text-white font-semibold shrink-0">
                    {getInitials(g.name)}
                  </span>
                  {editing?.id === g.id ? (
                    <div className="flex flex-col gap-1.5">
                      <input
                        value={editing.name}
                        onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                        className="bg-cloud border border-slate-line rounded-lg px-2.5 py-1.5 text-sm outline-none focus:border-brand"
                        placeholder="Team title"
                      />
                      <input
                        value={editing.project}
                        onChange={(e) => setEditing({ ...editing, project: e.target.value })}
                        className="bg-cloud border border-slate-line rounded-lg px-2.5 py-1.5 text-xs outline-none focus:border-brand"
                        placeholder="Project"
                      />
                    </div>
                  ) : (
                    <div className="min-w-0">
                      <p className="font-display font-semibold text-slate-ink truncate">{g.name}</p>
                      <p className="text-sm text-slate-muted truncate">
                        {g.project} · {(g.members || []).length} members
                      </p>
                      {g.description && (
                        <p className="text-xs text-slate-muted mt-1 line-clamp-2 max-w-md">{g.description}</p>
                      )}
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-2 flex-wrap justify-end">
                  <span className="flex items-center gap-1.5 bg-brand-soft text-brand-deep text-xs font-semibold px-3 py-1.5 rounded-full">
                    <Sparkles className="w-3.5 h-3.5" /> Collaboration {g.collaborationScore}
                  </span>
                  {isGuide && (
                    <button
                      onClick={() => setPlanGroup(g)}
                      title="Analyze project title & description to plan tasks"
                      className="inline-flex items-center gap-1.5 bg-brand-soft hover:bg-brand-soft/70 text-brand-deep text-xs font-semibold px-3 py-1.5 rounded-full transition-colors"
                    >
                      <Wand2 className="w-3.5 h-3.5" /> AI Project Understanding
                    </button>
                  )}
                  {isGuide &&
                    (editing?.id === g.id ? (
                      <>
                        <button
                          onClick={saveEdit}
                          disabled={busy}
                          title="Save"
                          className="p-2 rounded-lg bg-mint-soft text-mint hover:opacity-80"
                        >
                          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                        </button>
                        <button
                          onClick={() => setEditing(null)}
                          title="Cancel"
                          className="p-2 rounded-lg bg-cloud text-slate-muted hover:text-slate-ink"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={() => setEditing({ id: g.id, name: g.name, project: g.project || "" })}
                          title="Edit group title"
                          className="p-2 rounded-lg bg-cloud text-slate-muted hover:text-brand"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => removeGroup(g)}
                          title="Delete group"
                          className="p-2 rounded-lg bg-cloud text-slate-muted hover:text-coral"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </>
                    ))}
                </div>
              </div>

              {/* Meta row — category / status / expected completion. All three
                  come straight from the Group document (category, status,
                  expectedCompletion in backend/src/models/Group.js); shown only
                  when the backend actually provided a value. */}
              <div className="flex items-center gap-2 flex-wrap mt-3">
                {g.category && (
                  <span className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-muted bg-cloud px-2.5 py-1 rounded-full">
                    <Tag className="w-3 h-3" /> {g.category}
                  </span>
                )}
                {g.status && (
                  <span
                    className={classNames(
                      "inline-flex items-center text-[11px] font-semibold px-2.5 py-1 rounded-full capitalize",
                      GROUP_STATUS_STYLES[g.status] || "bg-cloud text-slate-muted"
                    )}
                  >
                    {g.status}
                  </span>
                )}
                <span className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-muted bg-cloud px-2.5 py-1 rounded-full">
                  <CalendarClock className="w-3 h-3" />
                  {g.expectedCompletion ? `Due ${formatDay(g.expectedCompletion)}` : "No deadline set"}
                </span>
              </div>

              {/* Team Members — one row per member (not a horizontal chip
                  line) so names/emails stay readable and long addresses wrap
                  instead of forcing the page wide. */}
              <div className="mt-4">
                <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-muted mb-2">
                  <Users className="w-3.5 h-3.5" /> Team members
                </p>
                <div className="flex flex-col gap-2">
                  {g.leader && (
                    <div className="flex items-center justify-between gap-3 rounded-xl border border-brand-soft bg-brand-soft/40 px-3 py-2.5">
                      <button
                        onClick={() => navigate(`/guide/members/${g.leader.id}`)}
                        className="flex items-center gap-2 min-w-0 hover:opacity-80 text-left"
                      >
                        <span
                          className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-semibold text-white shrink-0"
                          style={{ backgroundColor: g.leader.color || "#4347C4" }}
                        >
                          {getInitials(g.leader.name || "?")}
                        </span>
                        <span className="min-w-0">
                          <span className="block text-sm font-medium text-slate-ink truncate">{g.leader.name}</span>
                          <span
                            className="block text-xs text-slate-muted"
                            style={{ wordBreak: "break-all", overflowWrap: "anywhere" }}
                          >
                            {g.leader.email}
                          </span>
                        </span>
                      </button>
                      <span className="shrink-0 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-brand-deep bg-white/70 px-2 py-1 rounded-full">
                        <Sparkles className="w-3 h-3" /> Team leader
                      </span>
                    </div>
                  )}

                  {(g.members || [])
                    .filter((m) => m.id !== g.leaderId)
                    .map((m) => (
                      <div
                        key={m.id}
                        className="flex items-center justify-between gap-3 rounded-xl border border-slate-line bg-cloud/60 px-3 py-2.5"
                      >
                        <button
                          onClick={() => navigate(`/guide/members/${m.id}`)}
                          className="flex items-center gap-2 min-w-0 hover:opacity-80 text-left"
                        >
                          <span
                            className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-semibold text-white shrink-0"
                            style={{ backgroundColor: m.color || "#4347C4" }}
                          >
                            {getInitials(m.name || "?")}
                          </span>
                          <span className="min-w-0">
                            <span className="block text-sm text-slate-ink truncate">{m.name}</span>
                            <span
                              className="block text-xs text-slate-muted"
                              style={{ wordBreak: "break-all", overflowWrap: "anywhere" }}
                            >
                              {m.email}
                            </span>
                          </span>
                        </button>
                        <span className="shrink-0 flex items-center gap-2">
                          <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-muted bg-white px-2 py-1 rounded-full">
                            Member
                          </span>
                          {isGuide && (
                            <button
                              onClick={() => removeMember(g, m)}
                              title={`Remove ${m.name}`}
                              className="text-slate-muted hover:text-coral"
                            >
                              <UserMinus className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </span>
                      </div>
                    ))}

                  {!g.leader && (g.members || []).length === 0 && (
                    <p className="text-xs text-slate-muted">No members yet — invite students by email below.</p>
                  )}
                </div>

                {isGuide && (
                  <div className="mt-3">
                    {inviteFor === g.id ? (
                      <div className="flex items-center gap-1.5">
                        <input
                          autoFocus
                          value={inviteEmail}
                          onChange={(e) => setInviteEmail(e.target.value)}
                          onKeyDown={(e) => e.key === "Enter" && sendInvite(g)}
                          placeholder="student@college.edu"
                          className="flex-1 min-w-0 bg-cloud border border-slate-line rounded-full px-3 py-1.5 text-xs outline-none focus:border-brand"
                        />
                        <button onClick={() => sendInvite(g)} disabled={busy} className="text-mint shrink-0" title="Send invite">
                          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                        </button>
                        <button onClick={() => setInviteFor(null)} className="text-slate-muted shrink-0" title="Cancel">
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => {
                          setInviteFor(g.id);
                          setInviteEmail("");
                        }}
                        className="flex items-center gap-1 text-xs text-brand hover:text-brand-deep bg-brand-soft rounded-full px-2.5 py-1.5"
                      >
                        <UserPlus className="w-3.5 h-3.5" /> Add member
                      </button>
                    )}
                  </div>
                )}
              </div>

              {isGuide && <InvitationPanel groupId={g.id} refreshKey={refreshKey} />}

              <div className="flex items-center justify-between mt-4">
                <div className="flex-1 mr-4">
                  <div className="h-2 rounded-full bg-cloud overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-brand to-mint"
                      style={{ width: `${g.progress}%` }}
                    />
                  </div>
                </div>
                <span className="font-mono text-xs text-slate-muted">{g.progress}%</span>
              </div>
            </div>
          ))}
      </main>

      <CreateGroupModal open={modalOpen} onClose={() => setModalOpen(false)} onCreated={handleCreated} />
      <AIProjectPlanModal
        open={!!planGroup}
        group={planGroup}
        onClose={() => setPlanGroup(null)}
        onTasksCreated={handleTasksCreated}
      />
    </>
  );
};

export default GroupManagement;
