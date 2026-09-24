import { useEffect, useState } from "react";
import { useParams } from "@/lib/router-compat";
import { MessagesSquare, FolderOpen, Sparkles, Users, MailCheck, Tag, CalendarClock, Wand2 } from "lucide-react";
import Navbar from "../../components/navbar/Navbar";
import GroupChat from "../../components/chat/GroupChat";
import SharedFiles from "../../components/fileSharing/SharedFiles";
import UploadFile from "../../components/fileSharing/UploadFile";
import ChatSummary from "../../components/ai/ChatSummary";
import RecommendationPanel from "../../components/ai/RecommendationPanel";
import AIInsights from "../../components/ai/AIInsights";
import AIProjectPlanModal from "../../components/groups/AIProjectPlanModal";
import { useAuth } from "../../hooks/useAuth";
import { useChat } from "../../hooks/useChat";
import { useSocket } from "../../hooks/useSocket";
import { useGroups } from "../../hooks/useGroups";
import * as toastService from "../../services/toastService";
import * as groupService from "../../services/groupService";
import * as fileService from "../../services/fileService";
import * as aiService from "../../services/aiService";
import { formatDay } from "../../utils/dateFormatter";
import { classNames } from "../../utils/helperFunctions";

const TABS = [
  { id: "chat", label: "Group chat", icon: MessagesSquare },
  { id: "team", label: "Team", icon: Users },
  { id: "files", label: "Files", icon: FolderOpen },
  { id: "ai", label: "AI insights", icon: Sparkles },
];

const GroupDetails = () => {
  const { groupId } = useParams();
  const { user } = useAuth();
  const { joinGroup, leaveGroup, subscribeGroupEvent, subscribeUserEvent } = useSocket();
  const { setActiveGroupId, consumePendingMessageTarget } = useGroups();

  // Keep the app-wide "active group" (GroupContext) in sync with whichever
  // group's workspace the student is currently viewing. This is the exact
  // MongoDB groupId from the route param — never a name — so pages like
  // Tasks that don't carry :groupId in their own route can still resume the
  // correct group (including when two groups share the same display name)
  // instead of silently falling back to groups[0].
  useEffect(() => {
    if (groupId) setActiveGroupId(groupId);
  }, [groupId, setActiveGroupId]);
  const [tab, setTab] = useState("chat");
  const [group, setGroup] = useState(null);
  const [groupLoadError, setGroupLoadError] = useState(null);
  const [members, setMembers] = useState([]);
  const [files, setFiles] = useState([]);
  const [summary, setSummary] = useState("");
  const [recommendations, setRecommendations] = useState([]);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [insights, setInsights] = useState(null);
  const [invites, setInvites] = useState([]);
  const [invitesLoaded, setInvitesLoaded] = useState(false);
  const [planModalOpen, setPlanModalOpen] = useState(false);

  // STEP 34 — chat-specific loading/error state (distinct from the
  // page-level `!group` guard below, which only covers the initial
  // group/members/files fetch). Message loading can fail independently
  // (e.g. the group loaded fine but /messages 500s), and the chat tab
  // needs its own retry affordance rather than blocking the whole page.
  const [messagesLoading, setMessagesLoading] = useState(true);
  const [messagesError, setMessagesError] = useState(null);
  // The exact message a group-message notification pointed at (see
  // GroupContext.consumePendingMessageTarget) — GroupChat scrolls to and
  // briefly highlights it once, then this is cleared so it never re-fires.
  const [highlightMessageId, setHighlightMessageId] = useState(null);

  const { messages, isTyping, loadGroupMessages, sendMessage, simulateTyping, deleteMessage } = useChat(groupId);

  const handleDeleteFile = async (file) => {
    await fileService.deleteFile(groupId, file.id);
    setFiles((prev) => prev.filter((f) => f.id !== file.id));
  };

  const handleDownloadFile = (file) => {
    window.open(fileService.downloadUrl(groupId, file.id), "_blank", "noopener");
  };

  useEffect(() => {
    const handleFileUploaded = ({ files: newFiles }) => {
      const parsedFiles = newFiles.map((file) => ({
        ...file,
        uploadedByUser: file.uploadedBy,
        id: file.id || file._id,
        url: file.url,
      }));
      setFiles((prev) => {
        const existingIds = new Set(prev.map((f) => f.id || f._id));
        const trulyNew = parsedFiles.filter((f) => !existingIds.has(f.id));
        return trulyNew.length ? [...trulyNew, ...prev] : prev;
      });
      const uploaderName = parsedFiles[0]?.uploadedByUser?.name;
      if (uploaderName && uploaderName !== user?.name) {
        toastService.showToast(`New file uploaded by ${uploaderName}`);
      }
    };

    const handleFileDeleted = ({ fileId }) => {
      setFiles((prev) => prev.filter((file) => file.id !== fileId && file._id !== fileId));
    };

    const handleAiReady = ({ fileId, fileName, uploadedBy, aiAnalysis }) => {
      setFiles((prev) =>
        prev.map((file) =>
          file.id === fileId || file._id === fileId
            ? { ...file, aiAnalysis }
            : file
        )
      );
      if (user?.role === "guide") {
        toastService.showToast(`AI analysis ready for ${fileName} by ${uploadedBy.name}`);
      }
    };

    joinGroup(groupId);
    const unsubUploaded = subscribeGroupEvent("group:file:uploaded", handleFileUploaded);
    const unsubDeleted = subscribeGroupEvent("group:file:deleted", handleFileDeleted);
    const unsubAiReady = subscribeUserEvent("guide:file:ai-ready", handleAiReady);

    return () => {
      unsubUploaded?.();
      unsubDeleted?.();
      unsubAiReady?.();
      leaveGroup(groupId);
    };
  }, [groupId, joinGroup, leaveGroup, subscribeGroupEvent, subscribeUserEvent, user?.role]);

  useEffect(() => {
    let alive = true;
    setGroupLoadError(null);
    (async () => {
      try {
        const [g, m, f] = await Promise.all([
          groupService.getGroupById(groupId),
          groupService.getGroupMembers(groupId),
          fileService.getGroupFiles(groupId),
        ]);
        if (!alive) return;
        setGroup(g);
        setMembers(m);
        setFiles(f);
      } catch (err) {
        if (alive) setGroupLoadError(err?.message || "Failed to load this group");
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId]);

  // Loading messages is intentionally a separate effect/request from the
  // group/members/files fetch above: it has its own loading/error state so
  // a slow or failing /messages call doesn't block the Team/Files/AI tabs,
  // and so it can retry at a higher limit for exact-message targeting
  // without re-fetching everything else.
  useEffect(() => {
    if (!groupId) return;
    let alive = true;
    setMessagesLoading(true);
    setMessagesError(null);
    setHighlightMessageId(null);
    (async () => {
      try {
        let loaded = await loadGroupMessages(groupId);
        if (!alive) return;

        // STEP 34 — exact-message targeting from a notification click.
        // Only ever resolved against *this* group's own loaded messages —
        // never fabricated, never borrowed from another group/conversation.
        const targetMessageId = consumePendingMessageTarget(groupId);
        if (targetMessageId) {
          const alreadyLoaded = loaded.some((msg) => String(msg.id) === String(targetMessageId));
          if (!alreadyLoaded) {
            // The default page (50 most recent) didn't contain it — reuse
            // the existing /groups/:groupId/messages endpoint's own `limit`
            // param (backend caps it at 200) instead of inventing a new
            // "fetch by messageId" API.
            loaded = await loadGroupMessages(groupId, 200).catch(() => loaded);
          }
          if (alive && loaded.some((msg) => String(msg.id) === String(targetMessageId))) {
            setHighlightMessageId(targetMessageId);
          }
          // If it's still not found (older than the group's last 200
          // messages), we simply don't highlight anything — the correct
          // group chat is still open, which satisfies the "at minimum open
          // the correct group chat" fallback from the spec.
        }
      } catch (err) {
        if (alive) setMessagesError(err?.message || "Failed to load messages");
      } finally {
        if (alive) setMessagesLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId]);

  const retryLoadMessages = () => {
    setMessagesError(null);
    setMessagesLoading(true);
    loadGroupMessages(groupId)
      .catch((err) => setMessagesError(err?.message || "Failed to load messages"))
      .finally(() => setMessagesLoading(false));
  };

  useEffect(() => {
    if (tab !== "team" || !groupId || invitesLoaded) return;
    (async () => {
      try {
        setInvites((await groupService.getInvitations(groupId)) || []);
      } catch {
        setInvites([]);
      } finally {
        setInvitesLoaded(true);
      }
    })();
  }, [tab, groupId, invitesLoaded]);

  useEffect(() => {
    if (tab !== "ai" || !groupId) return;
    setSummaryLoading(true);
    (async () => {
      const [s, r, i] = await Promise.all([
        aiService.getChatSummary(groupId),
        aiService.getRecommendations(groupId),
        aiService.getGroupInsights(groupId).catch(() => null),
      ]);
      setSummary(s);
      setRecommendations(r);
      setInsights(i);
      setSummaryLoading(false);
    })();
  }, [tab, groupId]);

  if (groupLoadError) {
    return (
      <>
        <Navbar title="Group" subtitle="Couldn't load this group" />
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center px-6">
          <p className="text-sm font-medium text-coral">Couldn't load this group</p>
          <p className="text-xs text-slate-muted max-w-xs">{groupLoadError}</p>
          <button
            onClick={() => window.location.reload()}
            className="inline-flex items-center gap-1.5 rounded-full bg-paper border border-coral/30 px-3.5 py-1.5 text-xs font-medium text-coral hover:bg-coral hover:text-white transition-colors"
          >
            Retry
          </button>
        </div>
      </>
    );
  }

  if (!group) {
    return (
      <>
        <Navbar title="Group" subtitle="Loading…" />
        <div className="flex-1 flex items-center justify-center text-sm text-slate-muted">Loading group…</div>
      </>
    );
  }

  const isLeader =
    (group.leaderId && String(group.leaderId) === String(user?.id)) ||
    (group.leader && (String(group.leader.id || group.leader._id || group.leader) === String(user?.id))) ||
    (group.leaderEmail && user?.email && String(group.leaderEmail).toLowerCase() === String(user.email).toLowerCase()) ||
    user?.role === "guide" ||
    user?.role === "admin";

  return (
    <>
      <Navbar title={group.name} subtitle={group.project || "Project group"} />
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        {/* Compact project-overview strip — visible on every tab (Chat's own
            ChatHeader repeats name/members/score only while the Chat tab is
            active; this keeps that context available on Team/Files/AI too). */}
        <div className="flex items-center gap-2 flex-wrap px-4 sm:px-6 py-2.5 border-b border-slate-line bg-paper/60">
          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-muted bg-cloud px-2.5 py-1 rounded-full">
            <Users className="w-3 h-3" /> {members.length} member{members.length === 1 ? "" : "s"}
          </span>
          {group.category && (
            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-muted bg-cloud px-2.5 py-1 rounded-full">
              <Tag className="w-3 h-3" /> {group.category}
            </span>
          )}
          {group.expectedCompletion && (
            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-muted bg-cloud px-2.5 py-1 rounded-full">
              <CalendarClock className="w-3 h-3" /> Due {formatDay(group.expectedCompletion)}
            </span>
          )}
          <span className="inline-flex items-center gap-1 bg-brand-soft text-brand-deep text-[11px] font-semibold px-2.5 py-1 rounded-full">
            <Sparkles className="w-3 h-3" /> {group.collaborationScore} collaboration
          </span>
          {isLeader && (
            <button
              onClick={() => setPlanModalOpen(true)}
              title="Analyze Project Title & Description with AI"
              className="inline-flex items-center gap-1.5 bg-brand-soft hover:bg-brand-soft/80 text-brand-deep text-[11px] font-semibold px-2.5 py-1 rounded-full transition-colors cursor-pointer"
            >
              <Wand2 className="w-3 h-3" /> AI Project Understanding
            </button>
          )}
          <div className="flex items-center gap-2 ml-auto min-w-[120px]">
            <div className="w-20 h-1.5 rounded-full bg-cloud overflow-hidden">
              <div className="h-full rounded-full bg-gradient-to-r from-brand to-mint" style={{ width: `${group.progress}%` }} />
            </div>
            <span className="font-mono text-[11px] text-slate-muted shrink-0">{group.progress}%</span>
          </div>
        </div>

        <div className="flex border-b border-slate-line bg-paper px-4 sm:px-6 shrink-0">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={classNames(
                "flex items-center gap-1.5 text-sm font-medium px-4 py-3 border-b-2 transition-colors",
                tab === id ? "border-brand text-brand" : "border-transparent text-slate-muted hover:text-slate-ink"
              )}
            >
              <Icon className="w-4 h-4" /> {label}
            </button>
          ))}
        </div>

        <div className="flex-1 min-h-0 flex flex-col">
          {tab === "chat" && (
            <GroupChat
              group={group}
              members={members}
              currentUserId={user?.id || "me"}
              messages={messages}
              isTyping={isTyping}
              loading={messagesLoading}
              error={messagesError}
              onRetry={retryLoadMessages}
              highlightMessageId={highlightMessageId}
              onHighlightShown={() => setHighlightMessageId(null)}
              onSend={(text, attachments) =>
                sendMessage({ conversationId: groupId, senderId: user?.id, text, scope: "group", attachments })
              }
              onTyping={() => simulateTyping(groupId)}
              onDelete={(msg) => deleteMessage(groupId, msg.id)}
            />
          )}

          {tab === "team" && (
            <div className="flex-1 overflow-y-auto scrollbar-thin px-5 sm:px-8 py-6 space-y-6 max-w-2xl mx-auto w-full">
              <div>
                <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-muted mb-2">
                  <Users className="w-3.5 h-3.5" /> Team members
                </p>
                {/* One member per row — a horizontal wrap of pills makes emails
                    unreadable and breaks on small screens. */}
                <div className="flex flex-col gap-2">
                  {(members || [])
                    .slice()
                    .sort((a, b) => (a.id === group.leaderId ? -1 : b.id === group.leaderId ? 1 : 0))
                    .map((m) => {
                      const isLeader = m.id === group.leaderId;
                      return (
                        <div
                          key={m.id}
                          className={classNames(
                            "flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5",
                            isLeader ? "border-brand-soft bg-brand-soft/40" : "border-slate-line bg-cloud/60"
                          )}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span
                              className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-semibold text-white shrink-0"
                              style={{ backgroundColor: m.color || "#4347C4" }}
                            >
                              {(m.name || "?").slice(0, 1).toUpperCase()}
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
                          </div>
                          <span
                            className={classNames(
                              "shrink-0 text-[10px] font-semibold uppercase tracking-wide px-2 py-1 rounded-full",
                              isLeader ? "text-brand-deep bg-white/70" : "text-slate-muted bg-white"
                            )}
                          >
                            {isLeader ? "Team leader" : "Member"}
                          </span>
                        </div>
                      );
                    })}
                  {(members || []).length === 0 && (
                    <p className="text-xs text-slate-muted">No members have joined yet.</p>
                  )}
                </div>
              </div>

              <div>
                <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-muted mb-2">
                  <MailCheck className="w-3.5 h-3.5" /> Pending invitations
                </p>
                <div className="flex flex-col gap-2">
                  {invites
                    .filter((inv) => inv.status !== "accepted")
                    .map((inv) => (
                      <div
                        key={inv.id}
                        className={classNames(
                          "flex items-center justify-between gap-3 rounded-xl px-3 py-2.5",
                          inv.status === "rejected" ? "bg-coral-soft text-coral" : "bg-amber-50 text-amber-800"
                        )}
                      >
                        <span className="min-w-0 text-xs font-medium" style={{ wordBreak: "break-all", overflowWrap: "anywhere" }}>
                          {inv.email}
                        </span>
                        <span className="shrink-0 uppercase text-[9px] font-semibold tracking-wide opacity-70">
                          {inv.status === "rejected" ? "Invitation rejected" : "Pending invitation"}
                        </span>
                      </div>
                    ))}
                  {invitesLoaded && invites.filter((inv) => inv.status !== "accepted").length === 0 && (
                    <p className="text-xs text-slate-muted">No pending invitations.</p>
                  )}
                </div>
              </div>
            </div>
          )}

          {tab === "files" && (
            <div className="flex-1 overflow-y-auto scrollbar-thin px-5 sm:px-8 py-6 space-y-6 max-w-2xl mx-auto w-full">
              <UploadFile groupId={groupId} uploadedBy={user?.id} onUploaded={(f) => setFiles((prev) => [f, ...prev])} />
              <SharedFiles
                files={files}
                currentUserId={user?.id}
                canDeleteAll={user?.role === "guide" || user?.role === "admin"}
                onDelete={handleDeleteFile}
                onDownload={handleDownloadFile}
              />
            </div>
          )}

          {tab === "ai" && (
            <div className="flex-1 overflow-y-auto scrollbar-thin px-5 sm:px-8 py-6 space-y-5 max-w-2xl mx-auto w-full">
              <ChatSummary summary={summary} loading={summaryLoading} />
              <AIInsights data={insights} loading={summaryLoading} />
              <RecommendationPanel recommendations={recommendations} />
            </div>
          )}
        </div>
      </div>
      <AIProjectPlanModal
        open={planModalOpen}
        group={group}
        onClose={() => setPlanModalOpen(false)}
        onTasksCreated={() => {
          setPlanModalOpen(false);
          toastService.showToast("AI tasks created and assigned to team members!");
        }}
      />
    </>
  );
};

export default GroupDetails;
