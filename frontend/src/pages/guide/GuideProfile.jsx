import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "@/lib/router-compat";
import {
  Mail,
  Phone,
  MapPin,
  Building2,
  BadgeCheck,
  BookOpen,
  Briefcase,
  Camera,
  Check,
  Github,
  Globe,
  Linkedin,
  Loader2,
  Pencil,
  Twitter,
  User as UserIcon,
  X,
  RefreshCw,
  AlertTriangle,
  LayoutDashboard,
  BarChart3,
  Users,
  Bell,
  FileText,
  Settings,
  ShieldAlert,
  UserCheck,
  ChevronRight,
} from "lucide-react";
import Navbar from "../../components/navbar/Navbar";
import StatsCard from "../../components/dashboard/StatsCard";
import { useAuth } from "../../hooks/useAuth";
import { getInitials } from "../../utils/helperFunctions";
import { formatDay } from "../../utils/dateFormatter";
import { ROUTES } from "../../utils/constants";
import * as profileService from "../../services/profileService";
import * as analyticsService from "../../services/analyticsService";

const Section = ({ icon: Icon, title, subtitle, action, children }) => (
  <section className="bg-paper border border-slate-line rounded-xl2 p-5 sm:p-6 shadow-panel">
    <div className="flex items-start justify-between gap-3 mb-4">
      <div className="flex items-center gap-2.5">
        <span className="w-8 h-8 rounded-lg bg-brand-soft flex items-center justify-center shrink-0">
          <Icon className="w-4 h-4 text-brand-deep" />
        </span>
        <div>
          <h3 className="font-display font-semibold text-slate-ink leading-tight">{title}</h3>
          {subtitle && <p className="text-xs text-slate-muted mt-0.5">{subtitle}</p>}
        </div>
      </div>
      {action}
    </div>
    {children}
  </section>
);

const EditButton = ({ editing, onEdit, onCancel, onSave, saving }) =>
  editing ? (
    <div className="flex items-center gap-1.5">
      <button onClick={onCancel} className="p-1.5 rounded-lg text-slate-muted hover:bg-cloud" aria-label="Cancel">
        <X className="w-4 h-4" />
      </button>
      <button
        onClick={onSave}
        disabled={saving}
        className="inline-flex items-center gap-1.5 bg-brand hover:bg-brand-deep text-white text-xs font-semibold px-3 py-1.5 rounded-lg disabled:opacity-70"
      >
        {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
        Save
      </button>
    </div>
  ) : (
    <button
      onClick={onEdit}
      className="inline-flex items-center gap-1.5 text-xs font-medium text-brand border border-brand/30 px-2.5 py-1.5 rounded-lg hover:bg-brand-soft"
    >
      <Pencil className="w-3.5 h-3.5" /> Edit
    </button>
  );

const Field = ({ icon: Icon, label, value, editing, onChange, type = "text", placeholder }) => (
  <div className="flex items-start gap-3 bg-cloud rounded-lg px-3.5 py-3">
    {Icon && <Icon className="w-4 h-4 text-slate-muted mt-0.5 shrink-0" />}
    <div className="min-w-0 flex-1">
      <p className="text-xs text-slate-muted">{label}</p>
      {editing ? (
        <input
          type={type}
          value={value ?? ""}
          placeholder={placeholder || label}
          onChange={(e) => onChange(e.target.value)}
          className="w-full mt-1 bg-paper border border-slate-line rounded-md px-2 py-1 text-sm outline-none focus:border-brand"
        />
      ) : (
        <p className="text-sm text-slate-ink truncate">{value || "Not provided"}</p>
      )}
    </div>
  </div>
);

const SOCIALS = [
  { key: "linkedin", label: "LinkedIn", icon: Linkedin, placeholder: "https://linkedin.com/in/username" },
  { key: "github", label: "GitHub", icon: Github, placeholder: "https://github.com/username" },
  { key: "portfolio", label: "Website", icon: Globe, placeholder: "https://yoursite.edu" },
  { key: "twitter", label: "X / Twitter", icon: Twitter, placeholder: "https://x.com/username" },
];

// Quick navigation — routes an already-signed-in guide can always reach, all
// taken from the existing ROUTES constants (no new routes introduced).
const QUICK_LINKS = [
  { to: ROUTES.GUIDE_DASHBOARD, label: "Dashboard", icon: LayoutDashboard },
  { to: ROUTES.GUIDE_TEAM_ANALYTICS, label: "Team Analytics", icon: BarChart3 },
  { to: ROUTES.GUIDE_GROUP_MANAGEMENT, label: "Manage Groups", icon: Users },
  { to: ROUTES.GUIDE_ALERTS, label: "Alerts", icon: Bell },
  { to: ROUTES.GUIDE_REPORTS, label: "Reports", icon: FileText },
  { to: ROUTES.GUIDE_SETTINGS, label: "Settings", icon: Settings },
];

const n = (v) => (v ?? v === 0 ? v : "—");

const HeaderSkeleton = () => (
  <div className="bg-paper border border-slate-line rounded-xl2 p-5 sm:p-6 shadow-panel">
    <div className="flex flex-col sm:flex-row sm:items-center gap-5">
      <div className="w-20 h-20 rounded-2xl bg-cloud animate-pulse shrink-0" />
      <div className="min-w-0 flex-1 space-y-2.5">
        <div className="h-5 w-48 bg-cloud rounded animate-pulse" />
        <div className="h-3.5 w-40 bg-cloud/70 rounded animate-pulse" />
        <div className="h-3.5 w-64 bg-cloud/70 rounded animate-pulse" />
      </div>
    </div>
  </div>
);

const CardSkeleton = ({ lines = 4 }) => (
  <div className="bg-paper border border-slate-line rounded-xl2 p-5 sm:p-6 shadow-panel">
    <div className="h-4 w-32 bg-cloud rounded animate-pulse mb-4" />
    <div className="grid sm:grid-cols-2 gap-3">
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className="h-[52px] rounded-lg bg-cloud/60 animate-pulse" />
      ))}
    </div>
  </div>
);

const StatsSkeleton = () => (
  <div className="grid grid-cols-2 gap-3">
    {Array.from({ length: 4 }).map((_, i) => (
      <div key={i} className="h-[84px] rounded-xl2 border border-slate-line bg-paper animate-pulse" />
    ))}
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
      className="inline-flex items-center gap-1.5 text-xs font-semibold text-coral bg-white/60 hover:bg-white rounded-lg px-3 py-1.5 shrink-0 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-coral"
    >
      <RefreshCw className="w-3.5 h-3.5" /> Retry
    </button>
  </div>
);

const GuideProfile = () => {
  const { user, setUser } = useAuth();
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  // Load failure and save/upload failure are now tracked separately.
  // Previously a single `error` state covered both — a profile that failed
  // to load entirely still fell through to rendering the full edit form
  // (every field showing "—"), with the failure reduced to a banner at the
  // top instead of a real error state blocking the broken form.
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState("");
  const [editing, setEditing] = useState("");
  const [draft, setDraft] = useState({});
  const [busy, setBusy] = useState("");
  const avatarInput = useRef(null);

  // Guide activity overview — reuses the same getTeamStats() call already
  // used on GuideDashboard.jsx (GET /ai/guide-overview). No new endpoint.
  const [stats, setStats] = useState(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [statsError, setStatsError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      setProfile(await profileService.getMyProfile());
    } catch (err) {
      setProfile(null);
      setLoadError(err?.message || "Could not load your profile.");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadStats = useCallback(() => {
    setStatsLoading(true);
    setStatsError("");
    analyticsService
      .getTeamStats()
      .then(setStats)
      .catch((err) => setStatsError(err?.message || "Couldn't load your guide activity."))
      .finally(() => setStatsLoading(false));
  }, []);

  useEffect(() => {
    load();
    loadStats();
  }, [load, loadStats]);

  const persist = async (payload, key) => {
    setSaving(key);
    try {
      const updated = await profileService.updateMyProfile(payload);
      setProfile(updated);
      setUser?.({ ...user, ...updated });
      setEditing("");
      setError("");
    } catch (err) {
      setError(err.message || "Could not save your changes.");
    } finally {
      setSaving("");
    }
  };

  const startEdit = (key, values) => {
    setDraft(values);
    setEditing(key);
    setError("");
  };

  const uploadAvatar = async (file) => {
    if (!file) return;
    setBusy("avatar");
    try {
      await profileService.uploadAvatar(file);
      const refreshed = await profileService.getMyProfile();
      setProfile(refreshed);
      // Keep the shared auth-context user in sync too — persist() already
      // does this for every other field, but the avatar path previously
      // only updated local `profile` state, leaving `useAuth().user` (and
      // anything elsewhere reading it) pointed at the stale avatar.
      setUser?.({ ...user, avatar: refreshed?.avatar, avatarUrl: refreshed?.avatarUrl });
      setError("");
    } catch (err) {
      setError(err.message || "Upload failed.");
    } finally {
      setBusy("");
    }
  };

  const p = profile || {};
  const personal = p.personal || {};
  const pro = p.professional || {};
  const social = p.social || {};
  const roleLabel = p.role ? p.role.charAt(0).toUpperCase() + p.role.slice(1) : "";

  return (
    <>
      <Navbar title="Profile" subtitle="Your guide identity across TeamSync AI" />
      <main className="flex-1 px-5 md:px-8 py-6 max-w-6xl w-full mx-auto space-y-5">
        {loading && !loadError && (
          <>
            <HeaderSkeleton />
            <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
              <div className="space-y-5">
                <CardSkeleton lines={4} />
                <CardSkeleton lines={8} />
                <CardSkeleton lines={4} />
              </div>
              <div className="space-y-5">
                <StatsSkeleton />
              </div>
            </div>
          </>
        )}

        {!loading && loadError && <ErrorState message={loadError} onRetry={load} />}

        {!loading && !loadError && (
          <>
            {error && (
              <div className="bg-coral-soft border border-coral/30 text-coral text-sm rounded-lg px-4 py-3">{error}</div>
            )}

            {/* header */}
            <section className="bg-paper border border-slate-line rounded-xl2 p-5 sm:p-6 shadow-panel">
              <div className="flex flex-col sm:flex-row sm:items-center gap-5">
                <div className="relative shrink-0">
                  <div className="w-20 h-20 rounded-2xl bg-brand-soft overflow-hidden flex items-center justify-center text-brand-deep font-display font-bold text-xl">
                    {p.avatarUrl ? (
                      <img src={p.avatarUrl} alt={p.name} className="w-full h-full object-cover" />
                    ) : (
                      getInitials(p.name || "Guide")
                    )}
                  </div>
                  <button
                    onClick={() => avatarInput.current?.click()}
                    className="absolute -bottom-1.5 -right-1.5 w-8 h-8 rounded-full bg-brand text-white flex items-center justify-center shadow-pop"
                    aria-label="Change profile photo"
                  >
                    {busy === "avatar" ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Camera className="w-3.5 h-3.5" />
                    )}
                  </button>
                  <input
                    ref={avatarInput}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => uploadAvatar(e.target.files?.[0])}
                  />
                </div>

                <div className="min-w-0 flex-1">
                  {editing === "identity" ? (
                    <div className="space-y-2">
                      <input
                        value={draft.name || ""}
                        onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                        className="w-full border border-slate-line rounded-lg px-3 py-2 text-sm outline-none focus:border-brand"
                        placeholder="Full name"
                      />
                      <textarea
                        value={draft.bio || ""}
                        onChange={(e) => setDraft({ ...draft, bio: e.target.value })}
                        rows={3}
                        className="w-full border border-slate-line rounded-lg px-3 py-2 text-sm outline-none focus:border-brand"
                        placeholder="A short note about how you mentor teams"
                      />
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center gap-2 flex-wrap">
                        <h2 className="font-display text-xl font-bold text-slate-ink truncate">{p.name}</h2>
                        {roleLabel && (
                          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-brand-deep bg-brand-soft px-2 py-0.5 rounded-full">
                            <BadgeCheck className="w-3 h-3" /> {roleLabel}
                          </span>
                        )}
                        {p.isActive === false && (
                          <span className="text-[11px] font-semibold text-coral bg-coral-soft px-2 py-0.5 rounded-full">
                            Inactive account
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-slate-muted mt-0.5 truncate">
                        {pro.designation || "Project guide"}
                        {pro.department || p.dept ? ` · ${pro.department || p.dept}` : ""}
                      </p>
                      <p className="text-sm text-slate-ink mt-2 leading-relaxed">
                        {p.bio || "Add a short bio so your students know who is mentoring them."}
                      </p>
                      {p.createdAt && (
                        <p className="text-xs text-slate-muted mt-2">Guide since {formatDay(p.createdAt)}</p>
                      )}
                    </>
                  )}
                </div>

                <EditButton
                  editing={editing === "identity"}
                  saving={saving === "identity"}
                  onEdit={() => startEdit("identity", { name: p.name, bio: p.bio })}
                  onCancel={() => setEditing("")}
                  onSave={() => persist({ name: draft.name, bio: draft.bio }, "identity")}
                />
              </div>
            </section>

            <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
              <div className="space-y-5">
                {/* contact */}
                <Section
                  icon={UserIcon}
                  title="Contact details"
                  subtitle="How students and the department can reach you"
                  action={
                    <EditButton
                      editing={editing === "personal"}
                      saving={saving === "personal"}
                      onEdit={() => startEdit("personal", { ...personal })}
                      onCancel={() => setEditing("")}
                      onSave={() =>
                        persist(
                          {
                            personal: {
                              phone: draft.phone || "",
                              address: draft.address || "",
                              city: draft.city || "",
                              state: draft.state || "",
                            },
                          },
                          "personal"
                        )
                      }
                    />
                  }
                >
                  <div className="grid sm:grid-cols-2 gap-3">
                    <Field icon={Mail} label="Email" value={p.email} />
                    <Field
                      icon={Phone}
                      label="Phone"
                      value={editing === "personal" ? draft.phone : personal.phone}
                      editing={editing === "personal"}
                      onChange={(v) => setDraft({ ...draft, phone: v })}
                    />
                    <Field
                      icon={MapPin}
                      label="Address"
                      value={editing === "personal" ? draft.address : personal.address}
                      editing={editing === "personal"}
                      onChange={(v) => setDraft({ ...draft, address: v })}
                    />
                    <Field
                      icon={MapPin}
                      label="City"
                      value={editing === "personal" ? draft.city : personal.city}
                      editing={editing === "personal"}
                      onChange={(v) => setDraft({ ...draft, city: v })}
                    />
                  </div>
                </Section>

                {/* professional */}
                <Section
                  icon={Briefcase}
                  title="Professional details"
                  subtitle="Designation, department and academic credentials"
                  action={
                    <EditButton
                      editing={editing === "professional"}
                      saving={saving === "professional"}
                      onEdit={() => startEdit("professional", { ...pro, dept: p.dept })}
                      onCancel={() => setEditing("")}
                      onSave={() => {
                        const { dept, ...rest } = draft;
                        persist({ dept, professional: rest }, "professional");
                      }}
                    />
                  }
                >
                  <div className="grid sm:grid-cols-2 gap-3">
                    <Field
                      icon={BadgeCheck}
                      label="Designation"
                      placeholder="Assistant Professor"
                      value={editing === "professional" ? draft.designation : pro.designation}
                      editing={editing === "professional"}
                      onChange={(v) => setDraft({ ...draft, designation: v })}
                    />
                    <Field
                      icon={BadgeCheck}
                      label="Employee ID"
                      value={editing === "professional" ? draft.employeeId : pro.employeeId}
                      editing={editing === "professional"}
                      onChange={(v) => setDraft({ ...draft, employeeId: v })}
                    />
                    <Field
                      icon={Building2}
                      label="College"
                      value={editing === "professional" ? draft.college : pro.college}
                      editing={editing === "professional"}
                      onChange={(v) => setDraft({ ...draft, college: v })}
                    />
                    <Field
                      icon={Building2}
                      label="Department"
                      value={editing === "professional" ? draft.dept : p.dept}
                      editing={editing === "professional"}
                      onChange={(v) => setDraft({ ...draft, dept: v, department: v })}
                    />
                    <Field
                      icon={BookOpen}
                      label="Highest qualification"
                      placeholder="Ph.D. in Computer Science"
                      value={editing === "professional" ? draft.qualification : pro.qualification}
                      editing={editing === "professional"}
                      onChange={(v) => setDraft({ ...draft, qualification: v })}
                    />
                    <Field
                      icon={BookOpen}
                      label="Specialization"
                      placeholder="Machine Learning"
                      value={editing === "professional" ? draft.specialization : pro.specialization}
                      editing={editing === "professional"}
                      onChange={(v) => setDraft({ ...draft, specialization: v })}
                    />
                    <Field
                      icon={Briefcase}
                      label="Years of experience"
                      type="number"
                      value={editing === "professional" ? draft.experienceYears : pro.experienceYears}
                      editing={editing === "professional"}
                      onChange={(v) => setDraft({ ...draft, experienceYears: v })}
                    />
                    <Field
                      icon={Building2}
                      label="Cabin / office"
                      value={editing === "professional" ? draft.officeRoom : pro.officeRoom}
                      editing={editing === "professional"}
                      onChange={(v) => setDraft({ ...draft, officeRoom: v })}
                    />
                    <Field
                      icon={BookOpen}
                      label="Office hours"
                      placeholder="Mon–Fri, 2–4 PM"
                      value={editing === "professional" ? draft.officeHours : pro.officeHours}
                      editing={editing === "professional"}
                      onChange={(v) => setDraft({ ...draft, officeHours: v })}
                    />
                  </div>
                </Section>

                {/* links */}
                <Section
                  icon={Globe}
                  title="Links"
                  subtitle="Optional profiles shared with your students"
                  action={
                    <EditButton
                      editing={editing === "social"}
                      saving={saving === "social"}
                      onEdit={() => startEdit("social", { ...social })}
                      onCancel={() => setEditing("")}
                      onSave={() =>
                        persist(
                          {
                            social: SOCIALS.reduce((acc, s) => ({ ...acc, [s.key]: draft[s.key] || "" }), {}),
                          },
                          "social"
                        )
                      }
                    />
                  }
                >
                  <div className="grid sm:grid-cols-2 gap-3">
                    {SOCIALS.map((s) => (
                      <Field
                        key={s.key}
                        icon={s.icon}
                        label={s.label}
                        placeholder={s.placeholder}
                        value={editing === "social" ? draft[s.key] : social[s.key]}
                        editing={editing === "social"}
                        onChange={(v) => setDraft({ ...draft, [s.key]: v })}
                      />
                    ))}
                  </div>
                </Section>
              </div>

              <div className="space-y-5">
                {/* Guide activity — real metrics only, from the same
                    getTeamStats() rollup GuideDashboard.jsx already uses. */}
                <div className="bg-paper border border-slate-line rounded-xl2 p-5 shadow-panel">
                  <div className="flex items-center gap-2 mb-4">
                    <span className="w-8 h-8 rounded-lg bg-brand-soft flex items-center justify-center shrink-0">
                      <UserCheck className="w-4 h-4 text-brand-deep" />
                    </span>
                    <h3 className="font-display font-semibold text-slate-ink leading-tight">Guide activity</h3>
                  </div>

                  {statsLoading && !statsError && <StatsSkeleton />}

                  {!statsLoading && statsError && <ErrorState message={statsError} onRetry={loadStats} />}

                  {!statsLoading && !statsError && stats && (
                    <div className="grid grid-cols-2 gap-3">
                      <StatsCard label="Groups managed" value={n(stats.totalGroups)} icon={Users} tone="brand" />
                      <StatsCard label="Students" value={n(stats.studentCount)} icon={UserCheck} tone="mint" />
                      <StatsCard label="Active members" value={n(stats.activeMembers)} icon={UserCheck} tone="amber" />
                      <StatsCard
                        label="Need attention"
                        value={n(stats.atRisk?.length)}
                        icon={ShieldAlert}
                        tone="coral"
                      />
                    </div>
                  )}
                </div>

                {/* Quick navigation — existing routes only */}
                <div className="bg-paper border border-slate-line rounded-xl2 p-5 shadow-panel">
                  <h3 className="font-display font-semibold text-slate-ink leading-tight mb-3">Quick navigation</h3>
                  <div className="flex flex-col gap-1.5">
                    {QUICK_LINKS.map(({ to, label, icon: Icon }) => (
                      <Link
                        key={to}
                        to={to}
                        className="flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm text-slate-ink hover:bg-cloud transition-colors"
                      >
                        <Icon className="w-4 h-4 text-slate-muted shrink-0" />
                        <span className="flex-1 min-w-0 truncate">{label}</span>
                        <ChevronRight className="w-3.5 h-3.5 text-slate-muted shrink-0" />
                      </Link>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
      </main>
    </>
  );
};

export default GuideProfile;
