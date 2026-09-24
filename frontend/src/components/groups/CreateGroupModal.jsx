import { useEffect, useState } from "react";
import { X, Mail, Plus, Loader2, Users, Sparkles, Calendar } from "lucide-react";
import * as groupService from "../../services/groupService";

const EMAIL_RE = /^\S+@\S+\.\S+$/;

const STUDENT_FIELDS = [
  { key: "student1", label: "Student 1 — Team Leader", placeholder: "leader@college.edu" },
  { key: "student2", label: "Student 2 — Team Member", placeholder: "member1@college.edu" },
  { key: "student3", label: "Student 3 — Team Member", placeholder: "member2@college.edu" },
  { key: "student4", label: "Student 4 — Team Member", placeholder: "member3@college.edu" },
];

/**
 * Guide-only dialog: name the team, add the initial 4 students, send the invites,
 * and automatically trigger AI project planning and task assignment.
 */
const CreateGroupModal = ({ open, onClose, onCreated }) => {
  const [form, setForm] = useState({
    name: "",
    project: "",
    description: "",
    expectedCompletion: "",
    autoGenerateTasks: true,
  });
  const [students, setStudents] = useState({ student1: "", student2: "", student3: "", student4: "" });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setForm({
        name: "",
        project: "",
        description: "",
        expectedCompletion: "",
        autoGenerateTasks: true,
      });
      setStudents({ student1: "", student2: "", student3: "", student4: "" });
      setError("");
    }
  }, [open]);

  if (!open) return null;

  const setStudentEmail = (key, value) => {
    setStudents((prev) => ({ ...prev, [key]: value }));
    setError("");
  };

  const submit = async (e) => {
    e.preventDefault();
    setError("");

    // Ordered exactly as entered — order 0 is the future Team Leader.
    const ordered = STUDENT_FIELDS.map((f) => students[f.key].trim().toLowerCase()).filter(Boolean);

    if (!ordered.length) {
      return setError("Enter at least the Team Leader's email address.");
    }
    const invalid = ordered.find((e) => !EMAIL_RE.test(e));
    if (invalid) {
      return setError(`"${invalid}" is not a valid email address.`);
    }
    const seen = new Set();
    const dupe = ordered.find((e) => (seen.has(e) ? true : (seen.add(e), false)));
    if (dupe) {
      return setError(`"${dupe}" was entered more than once. Each student needs a different email address.`);
    }

    setSaving(true);
    try {
      const group = await groupService.createGroup({
        name: form.name,
        project: form.project,
        description: form.description,
        expectedCompletion: form.expectedCompletion ? new Date(form.expectedCompletion) : null,
        autoGenerateTasks: form.autoGenerateTasks,
        memberEmails: ordered,
      });
      onCreated?.(group, ordered.length, group.autoTasksCreated || 0);
      onClose();
    } catch (err) {
      setError(err.message || "Could not create the group.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-ink/40 p-0 sm:p-6">
      <div className="bg-paper w-full sm:max-w-lg rounded-t-2xl sm:rounded-xl2 border border-slate-line max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-line sticky top-0 bg-paper z-10">
          <div className="flex items-center gap-2.5">
            <span className="w-9 h-9 rounded-full bg-brand-soft flex items-center justify-center">
              <Users className="w-4 h-4 text-brand-deep" />
            </span>
            <div>
              <h3 className="font-display font-semibold text-slate-ink">Create group</h3>
              <p className="text-xs text-slate-muted">Invite students and auto-plan project tasks</p>
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" className="text-slate-muted hover:text-slate-ink">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={submit} className="px-5 py-5 space-y-4">
          <div>
            <label className="text-xs font-medium text-slate-ink mb-1.5 block">Team / group title</label>
            <input
              required
              autoFocus
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Team Nebula"
              className="w-full border border-slate-line rounded-lg px-3.5 py-2.5 text-sm outline-none focus:border-brand"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-slate-ink mb-1.5 block">Project title</label>
            <input
              required
              value={form.project}
              onChange={(e) => setForm({ ...form, project: e.target.value })}
              placeholder="Smart Campus Navigator"
              className="w-full border border-slate-line rounded-lg px-3.5 py-2.5 text-sm outline-none focus:border-brand"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-slate-ink mb-1.5 block">
              Project description <span className="text-slate-muted font-normal">(used by AI to generate tasks)</span>
            </label>
            <textarea
              rows={3}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="Describe the project scope, architecture, key features, and deliverables..."
              className="w-full border border-slate-line rounded-lg px-3.5 py-2.5 text-sm outline-none focus:border-brand resize-none"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-slate-ink mb-1.5 block flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5 text-slate-muted" /> Target project deadline{" "}
              <span className="text-slate-muted font-normal">(optional)</span>
            </label>
            <input
              type="date"
              value={form.expectedCompletion}
              onChange={(e) => setForm({ ...form, expectedCompletion: e.target.value })}
              className="w-full border border-slate-line rounded-lg px-3.5 py-2.5 text-sm outline-none focus:border-brand bg-white"
            />
          </div>

          {/* AI Task Planning Toggle */}
          <div className="bg-brand-soft/40 border border-brand-soft rounded-xl p-3.5">
            <label className="flex items-start gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={form.autoGenerateTasks}
                onChange={(e) => setForm({ ...form, autoGenerateTasks: e.target.checked })}
                className="mt-0.5 w-4 h-4 text-brand rounded focus:ring-brand border-slate-line"
              />
              <div className="flex-1">
                <div className="flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-brand" />
                  <span className="text-xs font-semibold text-slate-ink">
                    Automatically generate & assign tasks with AI
                  </span>
                </div>
                <p className="text-[11px] text-slate-muted mt-0.5 leading-relaxed">
                  TeamSync AI analyzes project title & description, structures modular tasks with steps & deliverables, and assigns them to team members with realistic deadlines.
                </p>
              </div>
            </label>
          </div>

          <div className="space-y-3 pt-1">
            <label className="text-xs font-medium text-slate-ink block">Initial team (4 students)</label>
            {STUDENT_FIELDS.map((f, idx) => (
              <div key={f.key}>
                <label className="text-[11px] font-medium text-slate-muted mb-1 flex items-center gap-1.5">
                  {f.label}
                  {idx === 0 && (
                    <span className="text-[10px] font-semibold text-brand-deep bg-brand-soft rounded-full px-1.5 py-0.5">
                      Auto-assigned
                    </span>
                  )}
                </label>
                <div className="flex items-center gap-1.5 border border-slate-line rounded-lg px-3 py-2 focus-within:border-brand">
                  <Mail className="w-3.5 h-3.5 text-slate-muted shrink-0" />
                  <input
                    type="email"
                    required={idx === 0}
                    value={students[f.key]}
                    onChange={(e) => setStudentEmail(f.key, e.target.value)}
                    placeholder={f.placeholder}
                    className="flex-1 text-sm outline-none bg-transparent"
                  />
                </div>
              </div>
            ))}
            <p className="text-[11px] text-slate-muted">
              Student 1 automatically becomes the Team Leader once they accept their invitation.
              Registered students join instantly; everyone else gets an invite email and is added the
              moment they sign up.
            </p>
          </div>

          {error && <p className="text-xs text-coral bg-coral-soft rounded-lg px-3 py-2">{error}</p>}

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 border border-slate-line text-slate-ink text-sm font-semibold py-2.5 rounded-lg hover:bg-cloud"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 bg-brand hover:bg-brand-deep disabled:opacity-70 text-white text-sm font-semibold py-2.5 rounded-lg inline-flex items-center justify-center gap-2"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              {saving
                ? form.autoGenerateTasks && form.description
                  ? "Creating & planning tasks…"
                  : "Creating…"
                : "Create & invite"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default CreateGroupModal;
