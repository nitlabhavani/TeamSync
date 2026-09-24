import { useEffect, useState } from "react";
import {
  CalendarPlus,
  Sparkles,
  Users,
  Clock3,
  CheckCircle2,
  AlertTriangle,
  Lightbulb,
  Video,
  ExternalLink,
  Copy,
  Check,
  Plus,
  Edit2,
} from "lucide-react";
import Navbar from "../../components/navbar/Navbar";
import { useAuth } from "../../hooks/useAuth";
import { useGroups } from "../../hooks/useGroups";
import { nameOf as dirName } from "../../services/userDirectory";
import * as meetingService from "../../services/meetingService";

const nameOf = (id) => dirName(id, id);
const fmt = (iso) =>
  new Date(iso).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

const validateHttpsUrl = (url) => {
  if (!url || !url.trim()) return null;
  const str = url.trim();
  if (!str.toLowerCase().startsWith("https://")) {
    return "Meeting link must start with https://";
  }
  if (/[<>\r\n\t\0]/.test(str)) {
    return "Meeting link contains invalid characters or HTML";
  }
  try {
    const parsed = new URL(str);
    if (parsed.protocol !== "https:") return "URL must use https:";
    if (
      parsed.hostname === "localhost" ||
      parsed.hostname.endsWith(".localhost") ||
      parsed.hostname.endsWith(".local")
    ) {
      return "Localhost is not allowed for meeting links";
    }
    if (!parsed.hostname.includes(".")) return "Please enter a valid domain name";
    return null;
  } catch {
    return "Invalid URL format";
  }
};

const formatShortUrl = (url) => {
  if (!url) return "";
  try {
    const parsed = new URL(url);
    const path = parsed.pathname === "/" ? "" : parsed.pathname;
    return `${parsed.hostname}${path}`;
  } catch {
    return url.replace(/^https?:\/\//, "");
  }
};

const Meetings = () => {
  const { user } = useAuth();
  const { groups } = useGroups();
  const [groupId, setGroupId] = useState(null);
  const [meetings, setMeetings] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [notes, setNotes] = useState("");
  const [summary, setSummary] = useState(null);
  const [summarizing, setSummarizing] = useState(false);
  const [form, setForm] = useState({ title: "", days: 1, durationMins: 30, agenda: "", meetingLink: "" });
  const [formError, setFormError] = useState("");
  const [copiedLink, setCopiedLink] = useState(false);
  const [editingLink, setEditingLink] = useState(false);
  const [newMeetingLink, setNewMeetingLink] = useState("");
  const [editLinkError, setEditLinkError] = useState("");
  const [savingLink, setSavingLink] = useState(false);

  useEffect(() => {
    if (!groupId && groups.length) setGroupId(groups[0].id);
  }, [groups, groupId]);

  useEffect(() => {
    if (!groupId) return;
    meetingService.getMeetings(groupId).then((m) => {
      setMeetings(m);
      setActiveId(m[0]?.id || null);
      setSummary(null);
    });
  }, [groupId]);

  const group = groups.find((g) => g.id === groupId);
  const isGuide = user?.role === "guide" || user?.role === "admin" || (group && (group.guideId === user?.id || group.guideId === user?._id));
  const isLeader = Boolean(
    group &&
      (group.leaderId === user?.id ||
        group.leaderId === user?._id ||
        (group.leaderEmail && user?.email && group.leaderEmail.toLowerCase() === user.email.toLowerCase()))
  );
  const canManageLink = isGuide || isLeader;

  const active = meetings.find((m) => m.id === activeId);

  useEffect(() => {
    setNotes(active?.notes || "");
    setSummary(null);
    setEditingLink(false);
    setNewMeetingLink(active?.meetingLink || "");
    setEditLinkError("");
    setCopiedLink(false);
  }, [activeId, active?.notes, active?.meetingLink]);

  const handleSchedule = async (e) => {
    e.preventDefault();
    if (!form.title.trim()) return;
    setFormError("");

    const linkToUse = form.meetingLink.trim();
    if (linkToUse) {
      const err = validateHttpsUrl(linkToUse);
      if (err) {
        setFormError(err);
        return;
      }
    }

    try {
      const created = await meetingService.scheduleMeeting(groupId, {
        title: form.title.trim(),
        when: new Date(Date.now() + Number(form.days) * 86400000).toISOString(),
        durationMins: Number(form.durationMins) || 30,
        agenda: form.agenda.split("\n").map((a) => a.trim()).filter(Boolean),
        attendeeIds: group?.memberIds || [],
        ...(canManageLink && linkToUse ? { meetingLink: linkToUse } : {}),
      });
      setMeetings((prev) => [created, ...prev]);
      setActiveId(created.id);
      setForm({ title: "", days: 1, durationMins: 30, agenda: "", meetingLink: "" });
    } catch (err) {
      setFormError(err.message || "Failed to schedule meeting");
    }
  };

  const handleCopyLink = async (link) => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2500);
    } catch {
      /* ignore */
    }
  };

  const handleSaveMeetingLink = async (e) => {
    if (e) e.preventDefault();
    if (!active) return;
    setEditLinkError("");

    const linkTrimmed = newMeetingLink.trim();
    if (linkTrimmed) {
      const err = validateHttpsUrl(linkTrimmed);
      if (err) {
        setEditLinkError(err);
        return;
      }
    }

    setSavingLink(true);
    try {
      const updated = await meetingService.updateMeeting(groupId, active.id, {
        meetingLink: linkTrimmed || null,
      });
      setMeetings((prev) => prev.map((m) => (m.id === active.id ? { ...m, meetingLink: updated.meetingLink } : m)));
      setEditingLink(false);
    } catch (err) {
      setEditLinkError(err.message || "Failed to update meeting link");
    } finally {
      setSavingLink(false);
    }
  };

  const handleSummarize = async () => {
    if (!active) return;
    setSummarizing(true);
    await meetingService.saveNotes(groupId, active.id, notes);
    setMeetings((prev) => prev.map((m) => (m.id === active.id ? { ...m, notes, status: "completed" } : m)));
    const result = await meetingService.summarizeMeeting({ ...active, notes }, groupId);
    setSummary(result);
    setSummarizing(false);
  };

  return (
    <>
      <Navbar title="Meetings & smart notes" subtitle="Schedule syncs and let AI turn raw notes into decisions and actions" />
      <main className="flex-1 px-5 md:px-8 py-6 space-y-6">
        <div className="flex gap-1.5 rounded-full bg-cloud p-1 w-fit">
          {groups.map((g) => (
            <button
              key={g.id}
              onClick={() => setGroupId(g.id)}
              className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${
                g.id === groupId ? "bg-paper text-slate-ink shadow-sm" : "text-slate-muted hover:text-slate-ink"
              }`}
            >
              {g.name}
            </button>
          ))}
        </div>

        <div className="grid gap-5 lg:grid-cols-[300px_1fr]">
          <div className="space-y-4">
            <div className="rounded-xl2 border border-slate-line bg-paper shadow-panel">
              <h2 className="border-b border-slate-line px-4 py-3 font-display text-sm font-semibold text-slate-ink">
                Meetings
              </h2>
              <ul className="max-h-[320px] overflow-y-auto p-2">
                {meetings.map((m) => (
                  <li key={m.id}>
                    <button
                      onClick={() => setActiveId(m.id)}
                      className={`w-full rounded-lg px-3 py-2.5 text-left transition-colors ${
                        m.id === activeId ? "bg-brand-soft" : "hover:bg-cloud"
                      }`}
                    >
                      <p className="text-sm font-medium text-slate-ink leading-snug">{m.title}</p>
                      <p className="mt-0.5 text-[11px] text-slate-muted">{fmt(m.when)}</p>
                      <span
                        className={`mt-1.5 inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${
                          m.status === "completed" ? "bg-mint-soft text-mint" : "bg-amber-soft text-amber"
                        }`}
                      >
                        {m.status}
                      </span>
                    </button>
                  </li>
                ))}
                {!meetings.length && <li className="px-3 py-4 text-xs text-slate-muted">No meetings yet.</li>}
              </ul>
            </div>

            <form onSubmit={handleSchedule} className="space-y-2.5 rounded-xl2 border border-slate-line bg-paper p-4 shadow-panel">
              <div className="flex items-center gap-2">
                <CalendarPlus className="w-4 h-4 text-brand" />
                <h2 className="font-display text-sm font-semibold text-slate-ink">Schedule a sync</h2>
              </div>
              <input
                value={form.title}
                onChange={(e) => {
                  setForm({ ...form, title: e.target.value });
                  if (formError) setFormError("");
                }}
                placeholder="Meeting title"
                className="w-full rounded-lg border border-slate-line bg-cloud px-3 py-2 text-sm outline-none focus:border-brand"
              />
              <div className="flex gap-2">
                <input
                  type="number"
                  min="0"
                  value={form.days}
                  onChange={(e) => setForm({ ...form, days: e.target.value })}
                  className="w-full rounded-lg border border-slate-line bg-cloud px-3 py-2 text-sm outline-none focus:border-brand"
                  placeholder="In days"
                />
                <input
                  type="number"
                  min="10"
                  step="5"
                  value={form.durationMins}
                  onChange={(e) => setForm({ ...form, durationMins: e.target.value })}
                  className="w-full rounded-lg border border-slate-line bg-cloud px-3 py-2 text-sm outline-none focus:border-brand"
                  placeholder="Minutes"
                />
              </div>
              <textarea
                value={form.agenda}
                onChange={(e) => setForm({ ...form, agenda: e.target.value })}
                rows={3}
                placeholder="Agenda — one item per line"
                className="w-full rounded-lg border border-slate-line bg-cloud px-3 py-2 text-sm outline-none focus:border-brand"
              />
              {canManageLink && (
                <div className="space-y-1">
                  <input
                    type="url"
                    value={form.meetingLink}
                    onChange={(e) => {
                      setForm({ ...form, meetingLink: e.target.value });
                      if (formError) setFormError("");
                    }}
                    placeholder="Meeting link (optional, e.g. https://meet.google.com/...)"
                    className="w-full rounded-lg border border-slate-line bg-cloud px-3 py-2 text-sm outline-none focus:border-brand"
                  />
                  <p className="text-[11px] text-slate-muted">
                    Add the online meeting link so participants can join.
                  </p>
                </div>
              )}
              {formError && (
                <p className="text-xs font-medium text-coral">{formError}</p>
              )}
              <button className="w-full rounded-lg bg-brand py-2 text-sm font-medium text-white hover:bg-brand-dark transition-colors">
                Schedule meeting
              </button>
            </form>
          </div>

          {active ? (
            <div className="space-y-5">
              <section className="rounded-xl2 border border-slate-line bg-paper p-5 shadow-panel">
                <h2 className="font-display text-lg font-semibold text-slate-ink">{active.title}</h2>
                <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-slate-muted">
                  <span className="inline-flex items-center gap-1">
                    <Clock3 className="w-3.5 h-3.5" /> {fmt(active.when)} · {active.durationMins} min
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Users className="w-3.5 h-3.5" /> {active.attendeeIds.map((id) => nameOf(id).split(" ")[0]).join(", ") || "—"}
                  </span>
                </div>
                {!!active.agenda?.length && (
                  <ul className="mt-4 space-y-1.5">
                    {active.agenda.map((a, i) => (
                      <li key={i} className="flex gap-2 text-sm text-slate-ink">
                        <span className="text-slate-muted">{i + 1}.</span> {a}
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {/* Meeting access section */}
              <section className="rounded-xl2 border border-slate-line bg-paper p-5 shadow-panel">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Video className="w-4 h-4 text-brand" />
                    <h3 className="font-display text-sm font-semibold text-slate-ink">Meeting access</h3>
                  </div>
                  {active.meetingLink && canManageLink && !editingLink && (
                    <button
                      onClick={() => {
                        setNewMeetingLink(active.meetingLink);
                        setEditingLink(true);
                      }}
                      className="inline-flex items-center gap-1 text-xs text-brand hover:underline font-medium"
                    >
                      <Edit2 className="w-3 h-3" /> Edit link
                    </button>
                  )}
                </div>

                {editingLink ? (
                  <form onSubmit={handleSaveMeetingLink} className="mt-3 space-y-2.5">
                    <div className="flex flex-col sm:flex-row gap-2">
                      <input
                        type="url"
                        value={newMeetingLink}
                        onChange={(e) => {
                          setNewMeetingLink(e.target.value);
                          if (editLinkError) setEditLinkError("");
                        }}
                        placeholder="https://meet.google.com/... or paste Zoom/Teams link"
                        className="flex-1 rounded-lg border border-slate-line bg-cloud px-3 py-2 text-sm outline-none focus:border-brand"
                        autoFocus
                      />
                      <div className="flex gap-2">
                        <button
                          type="submit"
                          disabled={savingLink}
                          className="rounded-lg bg-brand px-4 py-2 text-xs font-semibold text-white hover:bg-brand-dark transition-colors disabled:opacity-50"
                        >
                          {savingLink ? "Saving…" : "Save link"}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingLink(false);
                            setEditLinkError("");
                            setNewMeetingLink(active.meetingLink || "");
                          }}
                          className="rounded-lg border border-slate-line px-3 py-2 text-xs font-semibold text-slate-ink hover:bg-cloud"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                    {editLinkError && (
                      <p className="text-xs font-medium text-coral">{editLinkError}</p>
                    )}
                    <p className="text-[11px] text-slate-muted">
                      Provide a valid HTTPS meeting link (Google Meet, Zoom, Microsoft Teams, etc.).
                    </p>
                  </form>
                ) : active.meetingLink ? (
                  <div className="mt-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-brand/20 bg-brand-soft/30 p-3.5">
                    <div className="min-w-0 flex-1">
                      <span className="block text-[10px] font-bold uppercase tracking-wider text-brand">
                        Online Join Link
                      </span>
                      <a
                        href={active.meetingLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-0.5 inline-flex items-center gap-1 font-mono text-xs text-slate-ink hover:text-brand hover:underline break-all"
                      >
                        {formatShortUrl(active.meetingLink)}
                        <ExternalLink className="w-3 h-3 shrink-0 text-slate-muted" />
                      </a>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => handleCopyLink(active.meetingLink)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-line bg-paper px-3 py-1.5 text-xs font-medium text-slate-ink hover:bg-cloud shadow-2xs transition-colors"
                        title="Copy meeting link to clipboard"
                      >
                        {copiedLink ? (
                          <>
                            <Check className="w-3.5 h-3.5 text-mint" />
                            <span className="text-mint font-semibold">Copied!</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3.5 h-3.5 text-slate-muted" />
                            <span>Copy link</span>
                          </>
                        )}
                      </button>
                      <a
                        href={active.meetingLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-4 py-1.5 text-xs font-semibold text-white hover:bg-brand-dark shadow-sm transition-colors"
                      >
                        <Video className="w-3.5 h-3.5" />
                        Join Meeting
                        <ExternalLink className="w-3 h-3 ml-0.5" />
                      </a>
                    </div>
                  </div>
                ) : canManageLink ? (
                  <div className="mt-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-dashed border-slate-line bg-cloud/40 p-4">
                    <div className="space-y-0.5">
                      <p className="text-xs font-medium text-slate-ink">Meeting link not added yet.</p>
                      <p className="text-[11px] text-slate-muted">Add a meeting link so participants can join.</p>
                    </div>
                    <button
                      onClick={() => setEditingLink(true)}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-paper border border-slate-line px-3 py-1.5 text-xs font-semibold text-brand hover:bg-brand-soft/50 transition-colors shadow-2xs self-start sm:self-center"
                    >
                      <Plus className="w-3.5 h-3.5" /> Add meeting link
                    </button>
                  </div>
                ) : (
                  <div className="mt-3 rounded-xl border border-dashed border-slate-line bg-cloud/30 p-3.5 text-center sm:text-left">
                    <p className="text-xs text-slate-muted">The organizer has not added a meeting link yet.</p>
                  </div>
                )}
              </section>

              <section className="rounded-xl2 border border-slate-line bg-paper p-5 shadow-panel">
                <h3 className="font-display text-sm font-semibold text-slate-ink">Raw notes</h3>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={6}
                  placeholder="Paste or type what was discussed…"
                  className="mt-3 w-full rounded-lg border border-slate-line bg-cloud px-3 py-2.5 text-sm leading-relaxed outline-none focus:border-brand"
                />
                <button
                  onClick={handleSummarize}
                  disabled={summarizing || !notes.trim()}
                  className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-slate-ink px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
                >
                  <Sparkles className="w-4 h-4" /> {summarizing ? "Summarizing…" : "Generate smart notes"}
                </button>
              </section>

              {summary && (
                <section className="rounded-xl2 border border-brand/30 bg-brand-soft/50 p-5">
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-brand" />
                    <h3 className="font-display text-sm font-semibold text-slate-ink">AI smart notes</h3>
                  </div>
                  <p className="mt-3 text-sm leading-relaxed text-slate-ink">{summary.summary}</p>

                  <div className="mt-4 grid gap-3 md:grid-cols-3">
                    {[
                      { title: "Decisions", icon: CheckCircle2, items: summary.decisions, tone: "text-mint" },
                      { title: "Action items", icon: Lightbulb, items: summary.actions, tone: "text-brand" },
                      { title: "Risks", icon: AlertTriangle, items: summary.risks, tone: "text-coral" },
                    ].map(({ title, icon: Icon, items, tone }) => (
                      <div key={title} className="rounded-xl border border-slate-line bg-paper p-3.5">
                        <div className={`flex items-center gap-1.5 text-xs font-semibold ${tone}`}>
                          <Icon className="w-3.5 h-3.5" /> {title} ({items.length})
                        </div>
                        <ul className="mt-2 space-y-2">
                          {items.map((it, i) => (
                            <li key={i} className="text-xs leading-relaxed text-slate-ink">
                              {it.owner && <span className="font-medium">{it.owner}: </span>}
                              {it.text}
                            </li>
                          ))}
                          {!items.length && <li className="text-xs text-slate-muted">None detected.</li>}
                        </ul>
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </div>
          ) : (
            <div className="grid place-items-center rounded-xl2 border border-dashed border-slate-line p-10 text-sm text-slate-muted">
              Select or schedule a meeting to get started.
            </div>
          )}
        </div>
      </main>
    </>
  );
};

export default Meetings;
