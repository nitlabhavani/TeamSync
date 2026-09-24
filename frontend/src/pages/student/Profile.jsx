import { useEffect, useRef, useState } from "react";
import {
  Mail,
  Phone,
  MapPin,
  Calendar,
  GraduationCap,
  Building2,
  Pencil,
  Check,
  X,
  Plus,
  FileText,
  Upload,
  Download,
  Eye,
  Trash2,
  Award,
  Github,
  Linkedin,
  Globe,
  Twitter,
  Loader2,
  Camera,
  ShieldCheck,
  ShieldAlert,
  CalendarClock,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  UserCircle,
} from "lucide-react";
import Navbar from "../../components/navbar/Navbar";
import { useAuth } from "../../hooks/useAuth";
import { getInitials, formatFileSize } from "../../utils/helperFunctions";
import * as profileService from "../../services/profileService";

/* ---------------------------------------------------------------- helpers */

const Section = ({ icon: Icon, title, subtitle, action, children }) => (
  <section className="bg-paper border border-slate-line rounded-xl2 p-5 sm:p-6">
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
      <button
        onClick={onCancel}
        className="p-1.5 rounded-lg text-slate-muted hover:bg-cloud"
        aria-label="Cancel"
      >
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
          value={value || ""}
          placeholder={placeholder || label}
          onChange={(e) => onChange(e.target.value)}
          className="w-full mt-1 bg-paper border border-slate-line rounded-md px-2 py-1 text-sm outline-none focus:border-brand"
        />
      ) : (
        <p className="text-sm text-slate-ink truncate">{value || "—"}</p>
      )}
    </div>
  </div>
);

const TagEditor = ({ items = [], onAdd, onRemove, placeholder, tone = "brand" }) => {
  const [draft, setDraft] = useState("");
  const toneClass =
    tone === "mint" ? "bg-mint-soft text-mint" : "bg-brand-soft text-brand-deep";

  const add = () => {
    const value = draft.trim();
    if (!value) return;
    onAdd(value);
    setDraft("");
  };

  return (
    <div>
      <div className="flex flex-wrap gap-1.5">
        {items.length === 0 && <p className="text-sm text-slate-muted">Nothing added yet.</p>}
        {items.map((item) => (
          <span
            key={item}
            className={`inline-flex items-center gap-1.5 ${toneClass} text-xs font-medium rounded-full pl-3 pr-1.5 py-1`}
          >
            {item}
            <button onClick={() => onRemove(item)} aria-label={`Remove ${item}`} className="hover:text-coral">
              <X className="w-3 h-3" />
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-2 mt-3">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), add())}
          placeholder={placeholder}
          className="flex-1 border border-slate-line rounded-lg px-3 py-2 text-sm outline-none focus:border-brand"
        />
        <button
          onClick={add}
          className="inline-flex items-center gap-1 bg-cloud hover:bg-slate-line text-slate-ink text-sm font-medium px-3 rounded-lg"
        >
          <Plus className="w-3.5 h-3.5" /> Add
        </button>
      </div>
    </div>
  );
};

const SOCIALS = [
  { key: "github", label: "GitHub", icon: Github, placeholder: "https://github.com/username" },
  { key: "linkedin", label: "LinkedIn", icon: Linkedin, placeholder: "https://linkedin.com/in/username" },
  { key: "portfolio", label: "Portfolio", icon: Globe, placeholder: "https://yoursite.dev" },
  { key: "twitter", label: "X / Twitter", icon: Twitter, placeholder: "https://x.com/username" },
];

const HeaderSkeleton = () => (
  <section className="bg-paper border border-slate-line rounded-xl2 p-5 sm:p-6 animate-pulse">
    <div className="flex flex-col sm:flex-row sm:items-center gap-4">
      <div className="w-20 h-20 rounded-full bg-cloud shrink-0" />
      <div className="min-w-0 flex-1 space-y-2">
        <div className="h-5 w-40 rounded bg-cloud" />
        <div className="h-3.5 w-56 rounded bg-cloud" />
        <div className="h-3 w-32 rounded bg-cloud" />
      </div>
    </div>
    <div className="h-2 w-full rounded-full bg-cloud mt-5" />
  </section>
);

const SectionSkeleton = () => (
  <section className="bg-paper border border-slate-line rounded-xl2 p-5 sm:p-6 animate-pulse">
    <div className="flex items-center gap-2.5 mb-4">
      <span className="w-8 h-8 rounded-lg bg-cloud shrink-0" />
      <div className="h-4 w-36 rounded bg-cloud" />
    </div>
    <div className="grid sm:grid-cols-2 gap-3">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="h-[52px] rounded-lg bg-cloud" />
      ))}
    </div>
  </section>
);

/* ------------------------------------------------------------------- page */

const Profile = () => {
  const { user, setUser } = useAuth();
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState("");
  const [editing, setEditing] = useState("");
  const [draft, setDraft] = useState({});
  const [busy, setBusy] = useState("");
  const [preview, setPreview] = useState(null);
  const [justSaved, setJustSaved] = useState(false);

  const avatarInput = useRef(null);
  const resumeInput = useRef(null);
  const certInput = useRef(null);

  const load = async () => {
    try {
      setProfile(await profileService.getMyProfile());
      setError("");
    } catch (err) {
      setError(err.message || "Could not load your profile.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const persist = async (payload, key) => {
    setSaving(key);
    try {
      const updated = await profileService.updateMyProfile(payload);
      setProfile(updated);
      setUser?.({ ...user, ...updated });
      setEditing("");
      setError("");
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 2500);
      return updated;
    } catch (err) {
      setError(err.message || "Could not save your changes.");
    } finally {
      setSaving("");
    }
  };

  const startEdit = (key, values) => {
    setDraft(values);
    setEditing(key);
  };

  const upload = async (kind, file, extra) => {
    if (!file) return;
    setBusy(kind);
    setError("");
    try {
      if (kind === "avatar") await profileService.uploadAvatar(file);
      if (kind === "resume") await profileService.uploadResume(file);
      if (kind === "certificate") await profileService.uploadCertificate(file, extra);
      await load();
    } catch (err) {
      setError(err.message || "Upload failed.");
    } finally {
      setBusy("");
    }
  };

  if (loading) {
    return (
      <>
        <Navbar title="Profile" subtitle="How your team and guide see you" />
        <main className="flex-1 px-5 md:px-8 py-6 max-w-3xl w-full mx-auto space-y-4">
          <HeaderSkeleton />
          <SectionSkeleton />
          <SectionSkeleton />
        </main>
      </>
    );
  }

  if (!loading && error && !profile) {
    return (
      <>
        <Navbar title="Profile" subtitle="How your team and guide see you" />
        <main className="flex-1 px-5 md:px-8 py-6 max-w-3xl w-full mx-auto">
          <div className="flex flex-col items-center text-center gap-3 border border-dashed border-slate-line rounded-xl2 py-16 px-6">
            <span className="w-12 h-12 rounded-full bg-cloud flex items-center justify-center">
              <AlertTriangle className="w-5 h-5 text-coral" />
            </span>
            <div>
              <p className="text-sm font-medium text-slate-ink">Your profile could not be loaded</p>
              <p className="text-xs text-slate-muted mt-1 max-w-sm">{error}</p>
            </div>
            <button
              onClick={load}
              className="inline-flex items-center gap-1.5 rounded-full bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-deep transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Retry
            </button>
          </div>
        </main>
      </>
    );
  }

  const p = profile || {};
  const personal = p.personal || {};
  const academic = p.academic || {};
  const social = p.social || {};
  const completion = p.profileCompletion ?? 0;

  return (
    <>
      <Navbar title="Profile" subtitle="How your team and guide see you" />
      <main className="flex-1 px-5 md:px-8 py-6 max-w-3xl w-full mx-auto space-y-4">
        {error && (
          <p className="flex items-center gap-2 text-sm text-coral bg-coral-soft rounded-lg px-4 py-3">
            <AlertTriangle className="w-4 h-4 shrink-0" /> {error}
          </p>
        )}
        {justSaved && !error && (
          <p className="flex items-center gap-2 text-sm text-mint bg-mint-soft rounded-lg px-4 py-3">
            <CheckCircle2 className="w-4 h-4 shrink-0" /> Profile updated.
          </p>
        )}

        {/* ---------------------------------------------------------- header */}
        <section className="bg-paper border border-slate-line rounded-xl2 p-5 sm:p-6">
          <div className="flex flex-col sm:flex-row sm:items-center gap-4">
            <div className="relative w-20 h-20 shrink-0">
              {p.avatarUrl ? (
                <img
                  src={p.avatarUrl}
                  alt={`${p.name} profile photo`}
                  className="w-20 h-20 rounded-full object-cover"
                />
              ) : (
                <span
                  className="w-20 h-20 rounded-full flex items-center justify-center text-white text-2xl font-semibold"
                  style={{ backgroundColor: p.color || "#5B5FEF" }}
                >
                  {getInitials(p.name || "You")}
                </span>
              )}
              <button
                onClick={() => avatarInput.current?.click()}
                aria-label="Change profile photo"
                className="absolute -bottom-0.5 -right-0.5 w-7 h-7 rounded-full bg-brand text-white flex items-center justify-center border-2 border-paper hover:bg-brand-deep"
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
                hidden
                onChange={(e) => upload("avatar", e.target.files?.[0])}
              />
            </div>

            <div className="min-w-0 flex-1">
              <h2 className="font-display text-xl font-semibold text-slate-ink">{p.name}</h2>
              <p className="text-sm text-slate-muted">
                {`${p.role === "guide" ? "Project guide" : "Student"}${
                  academic.branch ? ` · ${academic.branch}` : ""
                }`}
              </p>
              <div className="flex flex-wrap items-center gap-3 mt-2 text-xs text-slate-muted">
                <span className="inline-flex items-center gap-1">
                  <Mail className="w-3.5 h-3.5" /> {p.email}
                </span>
                {(personal.city || personal.state) && (
                  <span className="inline-flex items-center gap-1">
                    <MapPin className="w-3.5 h-3.5" /> {[personal.city, personal.state].filter(Boolean).join(", ")}
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="mt-5">
            <div className="flex items-center justify-between text-xs mb-1.5">
              <span className="text-slate-muted">Profile completion</span>
              <span className="font-mono text-slate-ink">{completion}%</span>
            </div>
            <div className="h-2 rounded-full bg-cloud overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-brand to-mint transition-all"
                style={{ width: `${completion}%` }}
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-2 mt-4">
            {SOCIALS.filter((s) => social[s.key]).map((s) => (
              <a
                key={s.key}
                href={social[s.key]}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-1.5 bg-cloud hover:bg-slate-line text-slate-ink text-xs font-medium px-3 py-1.5 rounded-full"
              >
                <s.icon className="w-3.5 h-3.5" /> {s.label}
              </a>
            ))}
          </div>
        </section>

        {/* ------------------------------------------------- personal info */}
        <Section
          icon={Mail}
          title="Personal information"
          action={
            <EditButton
              editing={editing === "personal"}
              saving={saving === "personal"}
              onEdit={() => startEdit("personal", { ...personal, name: p.name, bio: p.bio })}
              onCancel={() => setEditing("")}
              onSave={() => {
                const { name, bio, ...rest } = draft;
                persist({ name, bio, personal: rest }, "personal");
              }}
            />
          }
        >
          <div className="grid sm:grid-cols-2 gap-3">
            <Field
              label="Full name"
              value={editing === "personal" ? draft.name : p.name}
              editing={editing === "personal"}
              onChange={(v) => setDraft({ ...draft, name: v })}
            />
            <Field icon={Mail} label="Email" value={p.email} editing={false} />
            <Field
              icon={Phone}
              label="Phone"
              value={editing === "personal" ? draft.phone : personal.phone}
              editing={editing === "personal"}
              onChange={(v) => setDraft({ ...draft, phone: v })}
            />
            <Field
              icon={Calendar}
              label="Date of birth"
              type="date"
              value={
                editing === "personal"
                  ? (draft.dateOfBirth || "").slice(0, 10)
                  : (personal.dateOfBirth || "").slice(0, 10)
              }
              editing={editing === "personal"}
              onChange={(v) => setDraft({ ...draft, dateOfBirth: v })}
            />
            <Field
              icon={MapPin}
              label="City"
              value={editing === "personal" ? draft.city : personal.city}
              editing={editing === "personal"}
              onChange={(v) => setDraft({ ...draft, city: v })}
            />
            <Field
              label="State"
              value={editing === "personal" ? draft.state : personal.state}
              editing={editing === "personal"}
              onChange={(v) => setDraft({ ...draft, state: v })}
            />
            <Field
              icon={MapPin}
              label="Address"
              value={editing === "personal" ? draft.address : personal.address}
              editing={editing === "personal"}
              onChange={(v) => setDraft({ ...draft, address: v })}
            />
          </div>

          <div className="mt-3">
            <p className="text-xs text-slate-muted mb-1.5">About</p>
            {editing === "personal" ? (
              <textarea
                rows={3}
                maxLength={600}
                value={draft.bio || ""}
                onChange={(e) => setDraft({ ...draft, bio: e.target.value })}
                placeholder="A short introduction for your guide and teammates."
                className="w-full border border-slate-line rounded-lg px-3.5 py-2.5 text-sm outline-none focus:border-brand resize-none"
              />
            ) : (
              <p className="text-sm text-slate-ink whitespace-pre-line">
                {p.bio || "No bio added yet."}
              </p>
            )}
          </div>
        </Section>

        {/* ------------------------------------------------ academic info */}
        <Section
          icon={GraduationCap}
          title="Academic information"
          action={
            <EditButton
              editing={editing === "academic"}
              saving={saving === "academic"}
              onEdit={() => startEdit("academic", { ...academic, dept: p.dept })}
              onCancel={() => setEditing("")}
              onSave={() => {
                const { dept, ...rest } = draft;
                persist({ dept, academic: rest }, "academic");
              }}
            />
          }
        >
          <div className="grid sm:grid-cols-2 gap-3">
            <Field
              icon={Building2}
              label="College / University"
              value={editing === "academic" ? draft.college : academic.college}
              editing={editing === "academic"}
              onChange={(v) => setDraft({ ...draft, college: v })}
            />
            <Field
              label="Department"
              value={editing === "academic" ? draft.dept : p.dept}
              editing={editing === "academic"}
              onChange={(v) => setDraft({ ...draft, dept: v })}
            />
            <Field
              label="Degree"
              placeholder="B.Tech"
              value={editing === "academic" ? draft.degree : academic.degree}
              editing={editing === "academic"}
              onChange={(v) => setDraft({ ...draft, degree: v })}
            />
            <Field
              label="Branch / Specialisation"
              value={editing === "academic" ? draft.branch : academic.branch}
              editing={editing === "academic"}
              onChange={(v) => setDraft({ ...draft, branch: v })}
            />
            <Field
              label="Enrollment number"
              value={editing === "academic" ? draft.enrollmentNumber : academic.enrollmentNumber}
              editing={editing === "academic"}
              onChange={(v) => setDraft({ ...draft, enrollmentNumber: v })}
            />
            <Field
              label="Current semester"
              type="number"
              value={editing === "academic" ? draft.semester : academic.semester}
              editing={editing === "academic"}
              onChange={(v) => setDraft({ ...draft, semester: v })}
            />
            <Field
              label="CGPA"
              value={editing === "academic" ? draft.cgpa : academic.cgpa}
              editing={editing === "academic"}
              onChange={(v) => setDraft({ ...draft, cgpa: v })}
            />
            <Field
              label="Graduation year"
              type="number"
              value={editing === "academic" ? draft.graduationYear : academic.graduationYear}
              editing={editing === "academic"}
              onChange={(v) => setDraft({ ...draft, graduationYear: v })}
            />
          </div>
        </Section>

        {/* -------------------------------------------------- account info */}
        <Section icon={UserCircle} title="Account information" subtitle="Read-only account details">
          <div className="grid sm:grid-cols-2 gap-3">
            {p.role && (
              <div className="flex items-start gap-3 bg-cloud rounded-lg px-3.5 py-3">
                <UserCircle className="w-4 h-4 text-slate-muted mt-0.5 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-slate-muted">Role</p>
                  <p className="text-sm text-slate-ink capitalize">{p.role}</p>
                </div>
              </div>
            )}
            {p.createdAt && (
              <div className="flex items-start gap-3 bg-cloud rounded-lg px-3.5 py-3">
                <CalendarClock className="w-4 h-4 text-slate-muted mt-0.5 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-slate-muted">Member since</p>
                  <p className="text-sm text-slate-ink">{new Date(p.createdAt).toLocaleDateString()}</p>
                </div>
              </div>
            )}
            {typeof p.isVerified === "boolean" && (
              <div className="flex items-start gap-3 bg-cloud rounded-lg px-3.5 py-3">
                {p.isVerified ? (
                  <ShieldCheck className="w-4 h-4 text-mint mt-0.5 shrink-0" />
                ) : (
                  <ShieldAlert className="w-4 h-4 text-amber mt-0.5 shrink-0" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-slate-muted">Email verification</p>
                  <p className={`text-sm ${p.isVerified ? "text-mint" : "text-amber"}`}>
                    {p.isVerified ? "Verified" : "Not verified"}
                  </p>
                </div>
              </div>
            )}
            {typeof p.isActive === "boolean" && (
              <div className="flex items-start gap-3 bg-cloud rounded-lg px-3.5 py-3">
                <span className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${p.isActive ? "bg-mint" : "bg-slate-muted"}`} />
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-slate-muted">Account status</p>
                  <p className="text-sm text-slate-ink">{p.isActive ? "Active" : "Inactive"}</p>
                </div>
              </div>
            )}
          </div>
        </Section>

        {/* --------------------------------------------------------- skills */}
        <Section icon={Award} title="Skills & technologies" subtitle="Press Enter to add">
          <div className="space-y-5">
            {[
              { key: "skills", label: "Core skills", tone: "brand", placeholder: "e.g. System design" },
              {
                key: "programmingLanguages",
                label: "Languages",
                tone: "mint",
                placeholder: "e.g. JavaScript",
              },
              { key: "frameworks", label: "Frameworks", tone: "brand", placeholder: "e.g. React" },
              { key: "tools", label: "Tools", tone: "mint", placeholder: "e.g. Figma" },
            ].map(({ key, label, tone, placeholder }) => (
              <div key={key}>
                <p className="text-xs font-medium text-slate-ink mb-2">{label}</p>
                <TagEditor
                  items={p[key] || []}
                  tone={tone}
                  placeholder={placeholder}
                  onAdd={(value) =>
                    persist({ [key]: [...new Set([...(p[key] || []), value])] }, key)
                  }
                  onRemove={(value) =>
                    persist({ [key]: (p[key] || []).filter((i) => i !== value) }, key)
                  }
                />
              </div>
            ))}
          </div>
        </Section>

        {/* --------------------------------------------------------- resume */}
        <Section
          icon={FileText}
          title="Resume"
          subtitle="PDF only, up to 25 MB"
          action={
            <button
              onClick={() => resumeInput.current?.click()}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-brand border border-brand/30 px-2.5 py-1.5 rounded-lg hover:bg-brand-soft"
            >
              {busy === "resume" ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Upload className="w-3.5 h-3.5" />
              )}
              {p.resume ? "Replace" : "Upload"}
            </button>
          }
        >
          <input
            ref={resumeInput}
            type="file"
            accept="application/pdf"
            hidden
            onChange={(e) => upload("resume", e.target.files?.[0])}
          />
          {p.resume ? (
            <div className="flex items-center gap-3 bg-cloud rounded-lg px-3.5 py-3 flex-wrap">
              <FileText className="w-5 h-5 text-coral shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-sm text-slate-ink truncate">{p.resume.name || "resume.pdf"}</p>
                <p className="text-xs text-slate-muted">
                  {formatFileSize(p.resume.size)}
                  {p.resume.uploadedAt &&
                    ` · uploaded ${new Date(p.resume.uploadedAt).toLocaleDateString()}`}
                </p>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setPreview({ url: p.resume.href, title: "Resume" })}
                  className="inline-flex items-center gap-1 text-xs font-medium text-slate-ink bg-paper border border-slate-line px-2.5 py-1.5 rounded-lg hover:bg-slate-line"
                >
                  <Eye className="w-3.5 h-3.5" /> Preview
                </button>
                <button
                  onClick={() =>
                    profileService.downloadFile(p.resume.url, p.resume.name || "resume.pdf")
                  }
                  className="inline-flex items-center gap-1 text-xs font-medium text-slate-ink bg-paper border border-slate-line px-2.5 py-1.5 rounded-lg hover:bg-slate-line"
                >
                  <Download className="w-3.5 h-3.5" /> Download
                </button>
                <button
                  onClick={async () => {
                    await profileService.deleteResume();
                    load();
                  }}
                  aria-label="Delete resume"
                  className="p-1.5 rounded-lg text-slate-muted hover:text-coral hover:bg-coral-soft"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => resumeInput.current?.click()}
              className="w-full border border-dashed border-slate-line rounded-lg py-8 text-center hover:border-brand hover:bg-brand-soft/40 transition-colors"
            >
              <Upload className="w-5 h-5 text-slate-muted mx-auto mb-2" />
              <p className="text-sm text-slate-ink font-medium">Upload your resume</p>
              <p className="text-xs text-slate-muted mt-0.5">Guides can preview and download it</p>
            </button>
          )}
        </Section>

        {/* ------------------------------------------------- certifications */}
        <Section
          icon={Award}
          title="Certifications"
          subtitle="PDF or image proof"
          action={
            <button
              onClick={() => certInput.current?.click()}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-brand border border-brand/30 px-2.5 py-1.5 rounded-lg hover:bg-brand-soft"
            >
              {busy === "certificate" ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Plus className="w-3.5 h-3.5" />
              )}
              Add
            </button>
          }
        >
          <input
            ref={certInput}
            type="file"
            accept="application/pdf,image/*"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              const name = window.prompt("Certification title", file.name.replace(/\.[^.]+$/, ""));
              if (name === null) return;
              const issuer = window.prompt("Issued by (optional)", "") || "";
              upload("certificate", file, { name, issuer });
            }}
          />
          {(p.certifications || []).length === 0 ? (
            <p className="text-sm text-slate-muted">No certifications added yet.</p>
          ) : (
            <ul className="space-y-2">
              {p.certifications.map((cert) => (
                <li
                  key={cert.id || cert._id}
                  className="flex items-center gap-3 bg-cloud rounded-lg px-3.5 py-3 flex-wrap"
                >
                  <Award className="w-5 h-5 text-mint shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-slate-ink truncate">{cert.name}</p>
                    <p className="text-xs text-slate-muted truncate">
                      {[cert.issuer, cert.issuedOn && new Date(cert.issuedOn).toLocaleDateString()]
                        .filter(Boolean)
                        .join(" · ") || "—"}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {cert.href && (
                      <button
                        onClick={() => setPreview({ url: cert.href, title: cert.name })}
                        className="inline-flex items-center gap-1 text-xs font-medium text-slate-ink bg-paper border border-slate-line px-2.5 py-1.5 rounded-lg hover:bg-slate-line"
                      >
                        <Eye className="w-3.5 h-3.5" /> View
                      </button>
                    )}
                    <button
                      onClick={async () => {
                        await profileService.deleteCertificate(cert.id || cert._id);
                        load();
                      }}
                      aria-label={`Delete ${cert.name}`}
                      className="p-1.5 rounded-lg text-slate-muted hover:text-coral hover:bg-coral-soft"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Section>

        {/* -------------------------------------------------- social links */}
        <Section
          icon={Globe}
          title="Social links"
          action={
            <EditButton
              editing={editing === "social"}
              saving={saving === "social"}
              onEdit={() => startEdit("social", { ...social })}
              onCancel={() => setEditing("")}
              onSave={() => persist({ social: draft }, "social")}
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
      </main>

      {/* -------------------------------------------------- preview overlay */}
      {preview && (
        <div className="fixed inset-0 z-50 bg-slate-ink/60 flex flex-col p-4 sm:p-8">
          <div className="flex items-center justify-between text-white mb-3">
            <p className="font-display font-semibold">{preview.title}</p>
            <button onClick={() => setPreview(null)} aria-label="Close preview">
              <X className="w-5 h-5" />
            </button>
          </div>
          <iframe
            title={preview.title}
            src={preview.url}
            className="flex-1 w-full rounded-xl2 bg-paper"
          />
        </div>
      )}
    </>
  );
};

export default Profile;
