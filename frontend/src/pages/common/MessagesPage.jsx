import { useEffect, useState, useMemo, useRef } from "react";
import {
  Search as SearchIcon,
  MessagesSquare,
  UserCircle,
  X,
  AlertTriangle,
  RefreshCw,
  ArrowLeft,
  ShieldCheck,
  Phone,
  Video,
  Mic,
  Paperclip,
  Users,
  PhoneCall,
  PhoneMissed,
  ArrowUpRight,
  ArrowDownLeft,
  Plus,
  Trash2,
  Megaphone,
  FolderKanban,
  ExternalLink,
  Sparkles,
  Info,
  CheckCheck,
  Send,
  Lock,
} from "lucide-react";
import Navbar from "../../components/navbar/Navbar";
import SingleChat from "../../components/chat/SingleChat";
import { useAuth } from "../../hooks/useAuth";
import { useChat } from "../../hooks/useChat";
import { useCall } from "../../hooks/useCall";
import { api, normalize, getToken, SERVER_URL } from "../../lib/apiClient";
import { getUserById, primeUsers } from "../../services/userDirectory";
import { getInitials, classNames } from "../../utils/helperFunctions";
import { formatRelativeTime } from "../../utils/dateFormatter";
import { useNavigate, useParams, useSearch } from "@/lib/router-compat";

const STATUS_COLORS = [
  { name: "Emerald", hex: "#059669" },
  { name: "Sky Blue", hex: "#0284C7" },
  { name: "Violet", hex: "#7C3AED" },
  { name: "Amber", hex: "#D97706" },
  { name: "Rose", hex: "#E11D48" },
  { name: "Slate", hex: "#334155" },
  { name: "Indigo", hex: "#4F46E5" },
  { name: "Teal", hex: "#0D9488" },
];

const COMMUNITY_CATEGORIES = [
  "Department",
  "Batch 2026",
  "Capstone Projects",
  "Research & AI Labs",
  "General",
];

const ConversationsSkeleton = () => (
  <div className="space-y-2 p-3 animate-pulse">
    {[0, 1, 2, 3, 4].map((i) => (
      <div key={i} className="flex items-center gap-3 p-3 rounded-xl border border-slate-line/50 bg-paper">
        <div className="w-10 h-10 rounded-full bg-cloud shrink-0" />
        <div className="flex-1 space-y-1.5 min-w-0">
          <div className="h-3.5 w-24 bg-cloud rounded" />
          <div className="h-3 w-36 bg-cloud/70 rounded" />
        </div>
      </div>
    ))}
  </div>
);

const MessagesPage = ({ routeBase = "/app" }) => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const params = useParams();
  const searchParams = useSearch({ strict: false }) || {};
  const { startCall } = useCall();

  // Selected peer userId from route param ($userId) or query param (?user=...)
  const activeUserId = params?.userId || searchParams?.user || null;

  // Active top-level WhatsApp tab: 'chats' | 'communities' | 'calls'
  const [activeTab, setActiveTab] = useState(
    searchParams?.tab === "updates" ? "chats" : (searchParams?.tab || "chats")
  );

  useEffect(() => {
    if (searchParams?.tab) {
      setActiveTab(searchParams.tab === "updates" ? "chats" : searchParams.tab);
    }
  }, [searchParams?.tab]);

  // Sync tab if user selected from route param
  useEffect(() => {
    if (activeUserId) {
      setActiveTab("chats");
    }
  }, [activeUserId]);

  /* ---------------- CHATS STATE ---------------- */
  const [conversations, setConversations] = useState([]);
  const [loadingConversations, setLoadingConversations] = useState(true);
  const [conversationsError, setConversationsError] = useState(null);

  // User directory search state
  const [userQuery, setUserQuery] = useState("");
  const [userResults, setUserResults] = useState([]);
  const [searchingUsers, setSearchingUsers] = useState(false);

  // Selected peer state
  const [selectedPeer, setSelectedPeer] = useState(null);
  const [loadingPeer, setLoadingPeer] = useState(false);

  const {
    messages,
    isTyping,
    loadPrivateMessages,
    sendMessage,
    simulateTyping,
    deleteMessage,
  } = useChat(activeUserId);

  const [loadingChat, setLoadingChat] = useState(false);
  const [chatError, setChatError] = useState(null);

  /* ---------------- COMMUNITIES STATE ---------------- */
  const [communities, setCommunities] = useState([]);
  const [loadingCommunities, setLoadingCommunities] = useState(false);
  const [selectedCommunity, setSelectedCommunity] = useState(null);
  const [showCreateCommunity, setShowCreateCommunity] = useState(false);
  const [showAnnouncementModal, setShowAnnouncementModal] = useState(false);
  const [newCommName, setNewCommName] = useState("");
  const [newCommDesc, setNewCommDesc] = useState("");
  const [newCommCat, setNewCommCat] = useState("General");
  const [newCommColor, setNewCommColor] = useState("#059669");
  const [creatingComm, setCreatingComm] = useState(false);

  // Announcement state
  const [announcementTitle, setAnnouncementTitle] = useState("");
  const [announcementContent, setAnnouncementContent] = useState("");
  const [postingAnnouncement, setPostingAnnouncement] = useState(false);

  // Link group state
  const [myGroups, setMyGroups] = useState([]);
  const [showLinkGroupModal, setShowLinkGroupModal] = useState(false);
  const [selectedGroupToLink, setSelectedGroupToLink] = useState("");
  const [linkingGroup, setLinkingGroup] = useState(false);

  /* ---------------- CALLS STATE ---------------- */
  const [callLogs, setCallLogs] = useState([]);
  const [loadingCalls, setLoadingCalls] = useState(false);
  const [showNewCallModal, setShowNewCallModal] = useState(false);
  const [callQuery, setCallQuery] = useState("");
  const [callSearchResults, setCallSearchResults] = useState([]);

  /* ==================== 1. FETCH CHAT CONVERSATIONS ==================== */
  const fetchConversations = async () => {
    setLoadingConversations(true);
    setConversationsError(null);
    try {
      const res = await api.get("/chat/conversations");
      const list = normalize(res || []);
      setConversations(list);
      const usersToPrime = list.map((c) => c.user).filter(Boolean);
      if (usersToPrime.length) primeUsers(usersToPrime);
    } catch (err) {
      setConversationsError(err?.message || "Failed to load conversations");
    } finally {
      setLoadingConversations(false);
    }
  };

  useEffect(() => {
    fetchConversations();
  }, []);



  /* ==================== 3. FETCH COMMUNITIES ==================== */
  const fetchCommunities = async () => {
    setLoadingCommunities(true);
    try {
      const res = await api.get("/communities");
      const list = res?.data || res || [];
      setCommunities(Array.isArray(list) ? list : []);
    } catch (err) {
      console.error("Failed to fetch communities:", err);
    } finally {
      setLoadingCommunities(false);
    }
  };

  useEffect(() => {
    if (activeTab === "communities") {
      fetchCommunities();
      api.get("/groups").then((res) => {
        const groups = normalize(res?.data || res || []);
        setMyGroups(Array.isArray(groups) ? groups : []);
      }).catch(() => {});
    }
  }, [activeTab]);

  /* ==================== 4. FETCH CALL HISTORY ==================== */
  const fetchCalls = async () => {
    setLoadingCalls(true);
    try {
      const res = await api.get("/calls/history");
      const list = res?.data || res || [];
      setCallLogs(Array.isArray(list) ? list : []);
    } catch (err) {
      console.error("Failed to fetch call history:", err);
    } finally {
      setLoadingCalls(false);
    }
  };

  useEffect(() => {
    if (activeTab === "calls") {
      fetchCalls();
    }
  }, [activeTab]);

  /* ==================== 5. HANDLE ACTIVE PEER ==================== */
  useEffect(() => {
    if (!activeUserId) {
      setSelectedPeer(null);
      return;
    }

    const cached = getUserById(activeUserId);
    if (cached) {
      setSelectedPeer(cached);
    } else {
      const inConv = conversations.find(
        (c) => String(c.user?._id || c.user?.id) === String(activeUserId)
      );
      if (inConv?.user) {
        const u = inConv.user;
        setSelectedPeer({
          id: u._id || u.id,
          name: u.name || "User",
          color: u.color || "#5B5FEF",
          role: u.role,
          dept: u.dept,
          avatar: u.avatar,
        });
      } else {
        setLoadingPeer(true);
        api
          .get(`/users/${activeUserId}`)
          .then((userData) => {
            if (userData) {
              const normalized = normalize(userData);
              primeUsers([normalized]);
              setSelectedPeer({
                id: normalized.id || normalized._id,
                name: normalized.name,
                color: normalized.color || "#5B5FEF",
                role: normalized.role,
                dept: normalized.dept,
                avatar: normalized.avatar,
              });
            }
          })
          .catch(() => {
            setSelectedPeer({
              id: activeUserId,
              name: "Direct Message",
              color: "#5B5FEF",
            });
          })
          .finally(() => setLoadingPeer(false));
      }
    }
  }, [activeUserId, conversations]);

  const loadChat = () => {
    if (!activeUserId) return;
    setLoadingChat(true);
    setChatError(null);
    loadPrivateMessages(activeUserId)
      .catch((err) => setChatError(err?.message || "Failed to load messages"))
      .finally(() => setLoadingChat(false));
  };

  useEffect(() => {
    if (activeUserId) {
      loadChat();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeUserId]);

  /* ==================== 6. USER DIRECTORY SEARCH ==================== */
  useEffect(() => {
    const q = userQuery.trim();
    if (q.length < 2) {
      setUserResults([]);
      setSearchingUsers(false);
      return undefined;
    }

    setSearchingUsers(true);
    const timer = setTimeout(async () => {
      try {
        const res = await api.get(`/users?q=${encodeURIComponent(q)}`);
        const users = normalize(res || []);
        const filtered = users.filter(
          (u) => String(u.id || u._id) !== String(user?.id)
        );
        setUserResults(filtered);
        primeUsers(filtered);
      } catch {
        setUserResults([]);
      } finally {
        setSearchingUsers(false);
      }
    }, 250);

    return () => clearTimeout(timer);
  }, [userQuery, user?.id]);

  /* ==================== 7. CALL SEARCH ==================== */
  useEffect(() => {
    const q = callQuery.trim();
    if (q.length < 2) {
      setCallSearchResults([]);
      return undefined;
    }

    const timer = setTimeout(async () => {
      try {
        const res = await api.get(`/users?q=${encodeURIComponent(q)}`);
        const users = normalize(res || []);
        const filtered = users.filter(
          (u) => String(u.id || u._id) !== String(user?.id)
        );
        setCallSearchResults(filtered);
      } catch {
        setCallSearchResults([]);
      }
    }, 250);

    return () => clearTimeout(timer);
  }, [callQuery, user?.id]);

  const selectUser = (u) => {
    const targetId = u.id || u._id;
    setUserQuery("");
    setUserResults([]);
    setSelectedPeer({
      id: targetId,
      name: u.name,
      color: u.color || "#5B5FEF",
      role: u.role,
      dept: u.dept,
      avatar: u.avatar,
    });
    const isGuide = routeBase.startsWith("/guide");
    navigate(isGuide ? `/guide/chat/${targetId}` : `/app/chat/${targetId}`);
  };

  const handleStartCall = (peerUser, type = "voice") => {
    if (!peerUser) return;
    startCall(
      {
        id: peerUser._id || peerUser.id,
        name: peerUser.name,
        avatar: peerUser.avatar,
        color: peerUser.color || "#5B5FEF",
      },
      type
    );
  };



  /* ==================== 9. CREATE COMMUNITY ==================== */
  const handleCreateCommunity = async (e) => {
    e.preventDefault();
    if (!newCommName.trim() || creatingComm) return;
    setCreatingComm(true);
    try {
      const res = await api.post("/communities", {
        name: newCommName.trim(),
        description: newCommDesc.trim(),
        category: newCommCat,
        color: newCommColor,
      });
      const created = res?.data || res;
      setCommunities((prev) => [created, ...prev]);
      setSelectedCommunity(created);
      setNewCommName("");
      setNewCommDesc("");
      setShowCreateCommunity(false);
    } catch (err) {
      alert(err?.message || "Failed to create community");
    } finally {
      setCreatingComm(false);
    }
  };

  /* ==================== 10. POST ANNOUNCEMENT ==================== */
  const handlePostAnnouncement = async (e) => {
    e.preventDefault();
    if (!selectedCommunity || !announcementTitle.trim() || !announcementContent.trim() || postingAnnouncement) return;
    setPostingAnnouncement(true);
    try {
      const commId = selectedCommunity._id || selectedCommunity.id;
      await api.post(`/communities/${commId}/announcements`, {
        title: announcementTitle.trim(),
        content: announcementContent.trim(),
      });
      const detailRes = await api.get(`/communities/${commId}`);
      const refreshed = detailRes?.data || detailRes;
      setSelectedCommunity(refreshed);
      setCommunities((prev) =>
        prev.map((c) => (String(c._id || c.id) === String(commId) ? refreshed : c))
      );
      setAnnouncementTitle("");
      setAnnouncementContent("");
      setShowAnnouncementModal(false);
    } catch (err) {
      alert(err?.message || "Failed to post announcement");
    } finally {
      setPostingAnnouncement(false);
    }
  };

  const handleDeleteAnnouncement = async (announcementId) => {
    if (!confirm("Are you sure you want to delete this announcement?")) return;
    try {
      const commId = selectedCommunity._id || selectedCommunity.id;
      await api.delete(`/communities/${commId}/announcements/${announcementId}`);
      setSelectedCommunity((prev) => ({
        ...prev,
        announcements: (prev.announcements || []).filter(
          (a) => String(a._id || a.id) !== String(announcementId)
        ),
      }));
    } catch (err) {
      alert(err?.message || "Failed to delete announcement");
    }
  };

  const handleRemoveGroupFromCommunity = async (groupId) => {
    if (!confirm("Remove this project group from the community?")) return;
    try {
      const commId = selectedCommunity._id || selectedCommunity.id;
      await api.delete(`/communities/${commId}/groups/${groupId}`);
      setSelectedCommunity((prev) => ({
        ...prev,
        groups: (prev.groups || []).filter(
          (g) => String(g._id || g.id) !== String(groupId)
        ),
      }));
    } catch (err) {
      alert(err?.message || "Failed to remove group from community");
    }
  };

  /* ==================== 11. LINK GROUP TO COMMUNITY ==================== */
  const handleLinkGroup = async () => {
    if (!selectedCommunity || !selectedGroupToLink || linkingGroup) return;
    setLinkingGroup(true);
    try {
      const commId = selectedCommunity._id || selectedCommunity.id;
      const res = await api.post(`/communities/${commId}/groups`, {
        groupId: selectedGroupToLink,
      });
      const updated = res?.data || res;
      const detailRes = await api.get(`/communities/${commId}`);
      const refreshed = detailRes?.data || detailRes || updated;
      setSelectedCommunity(refreshed);
      setCommunities((prev) =>
        prev.map((c) => (String(c._id || c.id) === String(commId) ? refreshed : c))
      );
      setShowLinkGroupModal(false);
      setSelectedGroupToLink("");
    } catch (err) {
      alert(err?.message || "Failed to link project group");
    } finally {
      setLinkingGroup(false);
    }
  };

  const handleSelectCommunity = async (comm) => {
    setSelectedCommunity(comm);
    const commId = comm._id || comm.id;
    try {
      const res = await api.get(`/communities/${commId}`);
      if (res?.data || res) {
        setSelectedCommunity(res.data || res);
      }
    } catch (err) {
      console.error("Failed to load community details:", err);
    }
  };

  const isCommunityManager = useMemo(() => {
    if (!selectedCommunity) return false;
    return (
      user?.role === "guide" ||
      user?.role === "admin" ||
      String(selectedCommunity.creator?._id || selectedCommunity.creator) === String(user?.id)
    );
  }, [selectedCommunity, user]);

  const totalUnread = useMemo(() => {
    return conversations.reduce((acc, c) => acc + (c.unreadCount || 0), 0);
  }, [conversations]);

  return (
    <>
      <Navbar
        title="Team Connect"
        subtitle="Direct chats, voice notes, calls & communities · private and excluded from AI analysis"
      />

      <div className="flex-1 min-h-0 flex flex-col md:flex-row overflow-hidden bg-cloud relative">
        {/* ==================== 1. CONNECT NAVIGATION RAIL (DESKTOP) ==================== */}
        <nav className="hidden md:flex md:w-20 bg-paper border-r border-slate-line flex-col items-center py-4 justify-between shrink-0 z-20 shadow-sm">
          <div className="flex flex-col items-center gap-3 w-full">
            {/* Chats Tab */}
            <button
              type="button"
              onClick={() => {
                setActiveTab("chats");
                navigate(routeBase.startsWith("/guide") ? "/guide/messages" : "/app/messages");
              }}
              title="Chats"
              className={classNames(
                "relative p-3 rounded-2xl transition-all flex flex-col items-center gap-1 group",
                activeTab === "chats"
                  ? "bg-brand/10 text-brand font-semibold shadow-sm"
                  : "text-slate-muted hover:bg-cloud hover:text-slate-ink"
              )}
            >
              <MessagesSquare className="w-6 h-6" />
              <span className="text-[10px]">Chats</span>
              {totalUnread > 0 && (
                <span className="absolute top-1 right-1 w-4 h-4 rounded-full bg-brand text-white text-[10px] font-bold flex items-center justify-center animate-pulse">
                  {totalUnread > 9 ? "9+" : totalUnread}
                </span>
              )}
            </button>

            {/* Communities Tab */}
            <button
              type="button"
              onClick={() => setActiveTab("communities")}
              title="Communities"
              className={classNames(
                "relative p-3 rounded-2xl transition-all flex flex-col items-center gap-1 group",
                activeTab === "communities"
                  ? "bg-indigo-500/10 text-indigo-600 font-semibold shadow-sm"
                  : "text-slate-muted hover:bg-cloud hover:text-slate-ink"
              )}
            >
              <Users className="w-6 h-6" />
              <span className="text-[10px]">Communities</span>
            </button>

            {/* Calls Tab */}
            <button
              type="button"
              onClick={() => setActiveTab("calls")}
              title="Calls"
              className={classNames(
                "relative p-3 rounded-2xl transition-all flex flex-col items-center gap-1 group",
                activeTab === "calls"
                  ? "bg-sky-500/10 text-sky-600 font-semibold shadow-sm"
                  : "text-slate-muted hover:bg-cloud hover:text-slate-ink"
              )}
            >
              <PhoneCall className="w-6 h-6" />
              <span className="text-[10px]">Calls</span>
              {callLogs.filter((c) => c.status === "missed").length > 0 && (
                <span className="absolute top-2 right-2 w-2.5 h-2.5 rounded-full bg-rose-500 border-2 border-paper" />
              )}
            </button>
          </div>

          {/* Bottom Rail User Profile & E2E Security */}
          <div className="flex flex-col items-center gap-2">
            <div
              title="End-to-end encrypted · Private chats & calls are isolated from AI"
              className="w-8 h-8 rounded-full bg-mint-soft text-mint flex items-center justify-center cursor-help"
            >
              <ShieldCheck className="w-4 h-4" />
            </div>
            <div
              className="w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-bold ring-2 ring-slate-line"
              style={{ backgroundColor: user?.color || "#5B5FEF" }}
            >
              {getInitials(user?.name || "Me")}
            </div>
          </div>
        </nav>

        {/* ==================== 2. SUB-PANEL / LIST COLUMN ==================== */}
        <aside
          className={classNames(
            "w-full md:w-80 lg:w-96 border-r border-slate-line bg-paper flex flex-col shrink-0 h-full overflow-hidden",
            (activeUserId && activeTab === "chats") || (selectedCommunity && activeTab === "communities")
              ? "hidden md:flex"
              : "flex"
          )}
        >
          {/* TAB 1: CHATS LIST */}
          {activeTab === "chats" && (
            <>
              <div className="p-4 border-b border-slate-line space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-base font-bold text-slate-ink flex items-center gap-2">
                    <MessagesSquare className="w-5 h-5 text-brand" /> Chats
                  </h2>
                  <span className="text-[11px] font-semibold text-mint bg-mint-soft px-2.5 py-0.5 rounded-full flex items-center gap-1">
                    <ShieldCheck className="w-3 h-3" /> Encrypted
                  </span>
                </div>

                <div className="relative">
                  <div className="flex items-center gap-2 bg-cloud border border-slate-line rounded-xl px-3 py-2 text-xs focus-within:border-brand transition-colors">
                    <SearchIcon className="w-4 h-4 text-slate-muted shrink-0" />
                    <input
                      type="text"
                      value={userQuery}
                      onChange={(e) => setUserQuery(e.target.value)}
                      placeholder="Find teammate or supervisor…"
                      className="flex-1 bg-transparent outline-none text-slate-ink placeholder:text-slate-muted min-w-0"
                    />
                    {userQuery && (
                      <button
                        type="button"
                        onClick={() => {
                          setUserQuery("");
                          setUserResults([]);
                        }}
                        aria-label="Clear"
                        className="text-slate-muted hover:text-slate-ink"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>

                  {userQuery.trim().length >= 2 && (
                    <div className="absolute top-full left-0 right-0 mt-1 z-30 bg-paper border border-slate-line rounded-xl shadow-panel max-h-64 overflow-y-auto p-1.5 space-y-1">
                      {searchingUsers ? (
                        <p className="text-xs text-slate-muted text-center py-3">Searching users…</p>
                      ) : userResults.length === 0 ? (
                        <p className="text-xs text-slate-muted text-center py-3">No active users found.</p>
                      ) : (
                        userResults.map((u) => (
                          <button
                            key={u.id || u._id}
                            type="button"
                            onClick={() => selectUser(u)}
                            className="w-full flex items-center gap-2.5 p-2 rounded-lg hover:bg-cloud text-left transition-colors"
                          >
                            <span
                              className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-semibold shrink-0"
                              style={{ backgroundColor: u.color || "#5B5FEF" }}
                            >
                              {getInitials(u.name)}
                            </span>
                            <div className="min-w-0 flex-1">
                              <p className="text-xs font-semibold text-slate-ink truncate">{u.name}</p>
                              <p className="text-[11px] text-slate-muted truncate">
                                {u.role} {u.dept ? `· ${u.dept}` : ""}
                              </p>
                            </div>
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </div>
              </div>

              <div className="flex-1 overflow-y-auto scrollbar-thin divide-y divide-slate-line/50">
                {loadingConversations ? (
                  <ConversationsSkeleton />
                ) : conversationsError ? (
                  <div className="p-4 text-center space-y-2">
                    <AlertTriangle className="w-5 h-5 text-coral mx-auto" />
                    <p className="text-xs text-coral">{conversationsError}</p>
                    <button
                      onClick={fetchConversations}
                      className="text-xs font-medium text-brand hover:underline inline-flex items-center gap-1"
                    >
                      <RefreshCw className="w-3 h-3" /> Retry
                    </button>
                  </div>
                ) : conversations.length === 0 ? (
                  <div className="p-6 text-center space-y-2">
                    <span className="w-10 h-10 rounded-full bg-cloud flex items-center justify-center mx-auto">
                      <UserCircle className="w-5 h-5 text-slate-muted" />
                    </span>
                    <p className="text-xs font-medium text-slate-ink">No conversations yet</p>
                    <p className="text-[11px] text-slate-muted">
                      Search above to start an encrypted private chat or place calls.
                    </p>
                  </div>
                ) : (
                  conversations.map((conv) => {
                    const u = conv.user || {};
                    const uid = u._id || u.id;
                    const active = String(uid) === String(activeUserId);
                    return (
                      <button
                        key={conv.conversation || uid}
                        type="button"
                        onClick={() => selectUser(u)}
                        className={classNames(
                          "w-full flex items-center gap-3 p-3.5 text-left transition-colors hover:bg-cloud/70",
                          active ? "bg-cloud border-l-4 border-l-brand" : "bg-transparent"
                        )}
                      >
                        <span
                          className="w-11 h-11 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0 shadow-sm"
                          style={{ backgroundColor: u.color || "#5B5FEF" }}
                        >
                          {getInitials(u.name || "?")}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-1 mb-0.5">
                            <p className="text-xs font-semibold text-slate-ink truncate">{u.name || "User"}</p>
                            {conv.at && (
                              <span className="text-[10px] text-slate-muted shrink-0">
                                {formatRelativeTime(conv.at)}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-xs text-slate-muted truncate flex items-center gap-1">
                              <CheckCheck className="w-3.5 h-3.5 text-brand shrink-0" />
                              <span className="truncate">{conv.lastMessage || "Started chat"}</span>
                            </p>
                            {conv.unreadCount > 0 && (
                              <span className="w-5 h-5 rounded-full bg-brand text-white text-[10px] font-bold flex items-center justify-center shrink-0">
                                {conv.unreadCount}
                              </span>
                            )}
                          </div>
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </>
          )}



          {/* TAB 3: COMMUNITIES DIRECTORY */}
          {activeTab === "communities" && (
            <div className="flex-1 flex flex-col h-full overflow-hidden">
              <div className="p-4 border-b border-slate-line flex items-center justify-between">
                <h2 className="text-base font-bold text-slate-ink flex items-center gap-2">
                  <Users className="w-5 h-5 text-indigo-600" /> Communities
                </h2>
                <button
                  type="button"
                  onClick={() => setShowCreateCommunity(true)}
                  className="px-3 py-1.5 rounded-xl bg-indigo-600 text-white text-xs font-medium hover:bg-indigo-700 transition-colors flex items-center gap-1 shadow-sm"
                >
                  <Plus className="w-4 h-4" /> New
                </button>
              </div>

              <div className="flex-1 overflow-y-auto scrollbar-thin p-3 space-y-2">
                {loadingCommunities ? (
                  <ConversationsSkeleton />
                ) : communities.length === 0 ? (
                  <div className="p-6 text-center space-y-3">
                    <span className="w-12 h-12 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center mx-auto">
                      <Users className="w-6 h-6" />
                    </span>
                    <h3 className="text-xs font-bold text-slate-ink">No Communities Yet</h3>
                    <p className="text-[11px] text-slate-muted">
                      Communities connect related project groups together under department or batch umbrellas.
                    </p>
                    <button
                      type="button"
                      onClick={() => setShowCreateCommunity(true)}
                      className="text-xs text-indigo-600 font-semibold hover:underline"
                    >
                      + Create first community
                    </button>
                  </div>
                ) : (
                  communities.map((comm) => {
                    const isSelected =
                      selectedCommunity &&
                      String(selectedCommunity._id || selectedCommunity.id) ===
                        String(comm._id || comm.id);
                    return (
                      <button
                        key={comm._id || comm.id}
                        type="button"
                        onClick={() => handleSelectCommunity(comm)}
                        className={classNames(
                          "w-full p-3 rounded-2xl border text-left transition-all",
                          isSelected
                            ? "border-indigo-600 bg-indigo-50/50 shadow-sm"
                            : "border-slate-line bg-paper hover:bg-cloud/60"
                        )}
                      >
                        <div className="flex items-center gap-3 mb-2">
                          <span
                            className="w-10 h-10 rounded-xl flex items-center justify-center text-white text-xs font-bold shrink-0 shadow-sm"
                            style={{ backgroundColor: comm.color || "#4F46E5" }}
                          >
                            {getInitials(comm.name)}
                          </span>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-1">
                              <h4 className="text-xs font-bold text-slate-ink truncate">{comm.name}</h4>
                              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-cloud text-slate-muted shrink-0">
                                {comm.category || "General"}
                              </span>
                            </div>
                            <p className="text-[11px] text-slate-muted truncate mt-0.5">
                              {comm.description || "Community hub"}
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center justify-between text-[10px] text-slate-muted pt-2 border-t border-slate-line/40">
                          <span className="flex items-center gap-1">
                            <FolderKanban className="w-3 h-3 text-indigo-500" />
                            {comm.groups?.length || 0} groups
                          </span>
                          <span className="flex items-center gap-1">
                            <Megaphone className="w-3 h-3 text-amber-500" />
                            {comm.announcements?.length || 0} announcements
                          </span>
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          )}

          {/* TAB 4: CALLS LOGS & HISTORY */}
          {activeTab === "calls" && (
            <div className="flex-1 flex flex-col h-full overflow-hidden">
              <div className="p-4 border-b border-slate-line flex items-center justify-between">
                <h2 className="text-base font-bold text-slate-ink flex items-center gap-2">
                  <PhoneCall className="w-5 h-5 text-sky-600" /> Calls
                </h2>
                <button
                  type="button"
                  onClick={() => setShowNewCallModal(true)}
                  className="px-3 py-1.5 rounded-xl bg-sky-600 text-white text-xs font-medium hover:bg-sky-700 transition-colors flex items-center gap-1 shadow-sm"
                >
                  <Plus className="w-4 h-4" /> Start Call
                </button>
              </div>

              <div className="flex-1 overflow-y-auto scrollbar-thin divide-y divide-slate-line/50">
                {loadingCalls ? (
                  <ConversationsSkeleton />
                ) : callLogs.length === 0 ? (
                  <div className="p-6 text-center space-y-3">
                    <span className="w-12 h-12 rounded-2xl bg-sky-50 text-sky-600 flex items-center justify-center mx-auto">
                      <Phone className="w-6 h-6" />
                    </span>
                    <h3 className="text-xs font-bold text-slate-ink">No Call Logs Yet</h3>
                    <p className="text-[11px] text-slate-muted">
                      Start private encrypted voice or video calls with any active peer.
                    </p>
                    <button
                      type="button"
                      onClick={() => setShowNewCallModal(true)}
                      className="text-xs text-sky-600 font-semibold hover:underline"
                    >
                      + Call a teammate
                    </button>
                  </div>
                ) : (
                  callLogs.map((log) => {
                    const isCaller = String(log.caller?._id || log.caller?.id) === String(user?.id);
                    const peer = isCaller ? log.receiver : log.caller;
                    const isMissed = log.status === "missed" || log.status === "rejected";

                    const durationText =
                      log.durationSeconds > 0
                        ? `${Math.floor(log.durationSeconds / 60)}m ${log.durationSeconds % 60}s`
                        : log.status === "missed"
                        ? "Missed"
                        : log.status === "rejected"
                        ? "Declined"
                        : "No answer";

                    return (
                      <div
                        key={log._id}
                        className="p-3 flex items-center justify-between gap-3 hover:bg-cloud/60 transition-colors"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <span
                            className="w-10 h-10 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0 shadow-sm"
                            style={{ backgroundColor: peer?.color || "#5B5FEF" }}
                          >
                            {getInitials(peer?.name || "?")}
                          </span>
                          <div className="min-w-0">
                            <p className="text-xs font-bold text-slate-ink truncate">{peer?.name || "Peer"}</p>
                            <div className="flex items-center gap-1.5 text-[11px] mt-0.5">
                              {isCaller ? (
                                <ArrowUpRight className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                              ) : isMissed ? (
                                <PhoneMissed className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                              ) : (
                                <ArrowDownLeft className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                              )}
                              <span className={isMissed ? "text-rose-600 font-medium" : "text-slate-muted"}>
                                {durationText}
                              </span>
                              <span className="text-slate-muted">·</span>
                              <span className="text-slate-muted">{formatRelativeTime(log.createdAt)}</span>
                            </div>
                          </div>
                        </div>

                        {/* One-tap WebRTC Redial buttons */}
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => handleStartCall(peer, "voice")}
                            title="Start voice call"
                            className="p-2 rounded-xl text-slate-muted hover:text-emerald-600 hover:bg-emerald-50 transition-all"
                          >
                            <Phone className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleStartCall(peer, "video")}
                            title="Start video call"
                            className="p-2 rounded-xl text-slate-muted hover:text-sky-600 hover:bg-sky-50 transition-all"
                          >
                            <Video className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </aside>

        {/* ==================== 3. MAIN WORKSPACE / DETAIL AREA ==================== */}
        <main
          className={classNames(
            "flex-1 flex flex-col h-full min-w-0 bg-paper overflow-hidden",
            (!activeUserId && activeTab === "chats") ||
            (!selectedCommunity && activeTab === "communities") ||
            activeTab === "calls"
              ? "hidden md:flex"
              : "flex"
          )}
        >
          {/* MAIN TAB 1: ACTIVE CHAT SCREEN */}
          {activeTab === "chats" && (
            activeUserId && selectedPeer ? (
              <SingleChat
                peer={selectedPeer}
                currentUserId={user?.id || "me"}
                messages={messages}
                isTyping={isTyping}
                loading={loadingChat || loadingPeer}
                error={chatError}
                onRetry={loadChat}
                onBack={() => {
                  navigate(routeBase.startsWith("/guide") ? "/guide/messages" : "/app/messages");
                }}
                backTo={routeBase.startsWith("/guide") ? "/guide/messages" : "/app/messages"}
                onSend={(text, attachments) =>
                  sendMessage({
                    conversationId: activeUserId,
                    senderId: user?.id,
                    text,
                    scope: "direct",
                    attachments,
                  })
                }
                onTyping={() => simulateTyping(activeUserId, "direct")}
                onDelete={(msg) => deleteMessage(activeUserId, msg.id)}
              />
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-center p-8 space-y-4">
                <div className="w-20 h-20 rounded-3xl bg-brand/10 text-brand flex items-center justify-center shadow-inner">
                  <MessagesSquare className="w-10 h-10 text-brand" />
                </div>
                <div className="max-w-md space-y-1">
                  <h3 className="text-lg font-bold text-slate-ink">TeamSync AI Private Chats</h3>
                  <p className="text-xs text-slate-muted leading-relaxed">
                    Select an ongoing conversation from the left or search for any student or supervisor to start an encrypted private chat, send voice notes, and make WebRTC audio/video calls.
                  </p>
                </div>
                <div className="flex items-center gap-2 text-xs text-slate-muted bg-cloud border border-slate-line px-4 py-2 rounded-full shadow-sm">
                  <Lock className="w-3.5 h-3.5 text-mint" /> End-to-end private · Zero AI monitoring or group data leakage
                </div>
              </div>
            )
          )}

          {/* MAIN TAB 3: COMMUNITY WORKSPACE */}
          {activeTab === "communities" && (
            selectedCommunity ? (
              <div className="flex-1 flex flex-col h-full overflow-hidden">
                {/* Community Header Banner */}
                <div
                  className="p-5 border-b border-slate-line text-white shadow-sm flex items-center justify-between"
                  style={{
                    background: `linear-gradient(135deg, ${selectedCommunity.color || "#4F46E5"}, #1E1B4B)`,
                  }}
                >
                  <div className="flex items-center gap-2.5 sm:gap-3.5">
                    <button
                      type="button"
                      onClick={() => setSelectedCommunity(null)}
                      aria-label="Back to communities"
                      className="md:hidden w-8 h-8 rounded-full bg-white/20 hover:bg-white/30 flex items-center justify-center text-white shrink-0 -ml-1"
                    >
                      <ArrowLeft className="w-4 h-4" />
                    </button>
                    <span className="w-10 h-10 sm:w-12 sm:h-12 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center text-white text-sm sm:text-base font-bold shadow shrink-0">
                      {getInitials(selectedCommunity.name)}
                    </span>
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-base font-bold">{selectedCommunity.name}</h3>
                        <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-white/20">
                          {selectedCommunity.category || "General"}
                        </span>
                      </div>
                      <p className="text-xs text-white/80 mt-0.5 max-w-xl">
                        {selectedCommunity.description || "Community for inter-team coordination and announcements."}
                      </p>
                    </div>
                  </div>

                  {isCommunityManager && (
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setShowAnnouncementModal(true)}
                        className="px-3 py-1.5 rounded-xl bg-white/20 hover:bg-white/30 text-white text-xs font-semibold transition-colors shadow flex items-center gap-1.5"
                      >
                        <Megaphone className="w-3.5 h-3.5" /> + Announcement
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowLinkGroupModal(true)}
                        className="px-3 py-1.5 rounded-xl bg-white text-slate-ink text-xs font-semibold hover:bg-white/90 transition-colors shadow flex items-center gap-1.5"
                      >
                        <Plus className="w-3.5 h-3.5" /> Link Project Group
                      </button>
                    </div>
                  )}
                </div>

                {/* Community Body: Announcements & Groups */}
                <div className="flex-1 overflow-y-auto p-6 space-y-6">
                  {isCommunityManager && (
                    <div className="p-3.5 rounded-2xl border border-indigo-200 bg-indigo-50/60 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <Megaphone className="w-4 h-4 text-indigo-600 shrink-0" />
                        <p className="text-xs text-indigo-900 truncate">
                          Broadcast official announcements to all linked project groups in this community.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setShowAnnouncementModal(true)}
                        className="px-3 py-1.5 rounded-xl bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 transition-colors shrink-0 shadow-sm"
                      >
                        + New Announcement
                      </button>
                    </div>
                  )}

                  {/* Announcements Feed */}
                  <div className="space-y-3">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-slate-muted flex items-center gap-2">
                      <Megaphone className="w-4 h-4 text-indigo-500" /> Community Announcements ({selectedCommunity.announcements?.length || 0})
                    </h4>
                    {(!selectedCommunity.announcements || selectedCommunity.announcements.length === 0) ? (
                      <p className="text-xs text-slate-muted italic py-2">No announcements broadcasted yet.</p>
                    ) : (
                      <div className="space-y-2.5">
                        {selectedCommunity.announcements.slice().reverse().map((ann, i) => (
                          <div
                            key={ann._id || i}
                            className="p-4 rounded-2xl border border-slate-line bg-paper shadow-sm space-y-1.5"
                          >
                            <div className="flex items-center justify-between">
                              <h5 className="text-xs font-bold text-slate-ink">{ann.title}</h5>
                              <div className="flex items-center gap-2">
                                <span className="text-[10px] text-slate-muted">
                                  {formatRelativeTime(ann.createdAt)}
                                </span>
                                {isCommunityManager && (
                                  <button
                                    type="button"
                                    onClick={() => handleDeleteAnnouncement(ann._id || ann.id)}
                                    className="p-1 text-slate-muted hover:text-rose-600 rounded"
                                    title="Delete announcement"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                )}
                              </div>
                            </div>
                            <p className="text-xs text-slate-muted leading-relaxed whitespace-pre-line">
                              {ann.content}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Connected Project Groups */}
                  <div className="space-y-3">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-slate-muted flex items-center gap-2">
                      <FolderKanban className="w-4 h-4 text-indigo-500" /> Constituent Project Groups ({selectedCommunity.groups?.length || 0})
                    </h4>
                    {(!selectedCommunity.groups || selectedCommunity.groups.length === 0) ? (
                      <div className="p-6 text-center rounded-2xl border border-dashed border-slate-line">
                        <p className="text-xs text-slate-muted">No project groups linked to this community yet.</p>
                        <button
                          type="button"
                          onClick={() => setShowLinkGroupModal(true)}
                          className="text-xs font-semibold text-indigo-600 mt-2 hover:underline"
                        >
                          + Link a project group
                        </button>
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {selectedCommunity.groups.map((grp) => (
                          <div
                            key={grp._id || grp.id}
                            className="p-4 rounded-2xl border border-slate-line bg-paper shadow-sm hover:border-indigo-400 transition-all flex flex-col justify-between"
                          >
                            <div>
                              <div className="flex items-center justify-between mb-1">
                                <h5 className="text-xs font-bold text-slate-ink">{grp.name}</h5>
                                <span className="text-[10px] font-semibold text-mint bg-mint-soft px-2 py-0.5 rounded-full">
                                  {grp.progress || 0}%
                                </span>
                              </div>
                              <p className="text-[11px] text-slate-muted line-clamp-2">
                                {grp.project || grp.description || "Project Workspace"}
                              </p>
                            </div>
                            <div className="mt-4 pt-3 border-t border-slate-line/50 flex items-center justify-between">
                              <span className="text-[10px] text-slate-muted">
                                {grp.members?.length || 0} members
                              </span>
                              <div className="flex items-center gap-2">
                                {isCommunityManager && (
                                  <button
                                    type="button"
                                    onClick={() => handleRemoveGroupFromCommunity(grp._id || grp.id)}
                                    className="px-2 py-1 rounded text-slate-muted hover:text-rose-600 hover:bg-rose-50 transition-colors text-[11px] font-medium flex items-center gap-1"
                                    title="Remove from community"
                                  >
                                    <X className="w-3 h-3" /> Unlink
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() => {
                                    const isGuide = routeBase.startsWith("/guide");
                                    navigate(isGuide ? "/guide/groups" : `/app/groups/${grp._id || grp.id}`);
                                  }}
                                  className="text-xs font-semibold text-indigo-600 hover:text-indigo-700 flex items-center gap-1"
                                >
                                  Open Group <ExternalLink className="w-3 h-3" />
                                </button>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-center p-8 space-y-4">
                <div className="w-20 h-20 rounded-3xl bg-indigo-50 text-indigo-600 flex items-center justify-center shadow-inner">
                  <Users className="w-10 h-10" />
                </div>
                <div className="max-w-md space-y-1">
                  <h3 className="text-lg font-bold text-slate-ink">Select a Community</h3>
                  <p className="text-xs text-slate-muted leading-relaxed">
                    Pick a community from the directory to view its broadcast announcements and interact with constituent project team channels.
                  </p>
                </div>
              </div>
            )
          )}

          {/* MAIN TAB 4: CALLS SHOWCASE & QUICK DIALER */}
          {activeTab === "calls" && (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-8 space-y-5">
              <div className="w-20 h-20 rounded-3xl bg-sky-50 text-sky-600 flex items-center justify-center shadow-inner">
                <PhoneCall className="w-10 h-10" />
              </div>
              <div className="max-w-md space-y-2">
                <h3 className="text-lg font-bold text-slate-ink">TeamSync WebRTC Calls</h3>
                <p className="text-xs text-slate-muted leading-relaxed">
                  Call any teammate or supervisor with crystal clear voice or video. Calls use direct peer-to-peer WebRTC signaling and are strictly isolated from all group chat and AI analytics.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowNewCallModal(true)}
                className="px-5 py-2.5 rounded-xl bg-sky-600 text-white text-xs font-semibold hover:bg-sky-700 transition-colors shadow-md flex items-center gap-2"
              >
                <Plus className="w-4 h-4" /> Place a Call
              </button>
              <div className="flex items-center gap-2 text-xs text-slate-muted bg-cloud border border-slate-line px-4 py-2 rounded-full">
                <ShieldCheck className="w-3.5 h-3.5 text-mint" /> E2E Private · No audio/video data ever leaves the call
              </div>
            </div>
          )}
        </main>

        {/* ==================== MOBILE BOTTOM NAVIGATION BAR ==================== */}
        {!(activeUserId && activeTab === "chats") && !(selectedCommunity && activeTab === "communities") && (
          <nav className="md:hidden flex items-center justify-around bg-paper border-t border-slate-line py-2 px-3 shrink-0 z-30 shadow-md">
            {/* Chats Tab */}
            <button
              type="button"
              onClick={() => {
                setActiveTab("chats");
                navigate(routeBase.startsWith("/guide") ? "/guide/messages" : "/app/messages");
              }}
              className={classNames(
                "relative flex flex-col items-center gap-1 py-1 px-3 rounded-xl transition-all",
                activeTab === "chats" ? "text-brand font-semibold" : "text-slate-muted hover:text-slate-ink"
              )}
            >
              <MessagesSquare className="w-5 h-5" />
              <span className="text-[10px]">Chats</span>
              {totalUnread > 0 && (
                <span className="absolute -top-0.5 right-2 min-w-[16px] h-4 px-1 rounded-full bg-brand text-white text-[10px] font-bold flex items-center justify-center">
                  {totalUnread > 9 ? "9+" : totalUnread}
                </span>
              )}
            </button>



            {/* Communities Tab */}
            <button
              type="button"
              onClick={() => setActiveTab("communities")}
              className={classNames(
                "relative flex flex-col items-center gap-1 py-1 px-3 rounded-xl transition-all",
                activeTab === "communities" ? "text-indigo-600 font-semibold" : "text-slate-muted hover:text-slate-ink"
              )}
            >
              <Users className="w-5 h-5" />
              <span className="text-[10px]">Communities</span>
            </button>

            {/* Calls Tab */}
            <button
              type="button"
              onClick={() => setActiveTab("calls")}
              className={classNames(
                "relative flex flex-col items-center gap-1 py-1 px-3 rounded-xl transition-all",
                activeTab === "calls" ? "text-sky-600 font-semibold" : "text-slate-muted hover:text-slate-ink"
              )}
            >
              <PhoneCall className="w-5 h-5" />
              <span className="text-[10px]">Calls</span>
              {callLogs.filter((c) => c.status === "missed").length > 0 && (
                <span className="absolute top-0 right-3 w-2 h-2 rounded-full bg-rose-500" />
              )}
            </button>
          </nav>
        )}
      </div>



      {/* ==================== MODAL 3: CREATE COMMUNITY ==================== */}
      {showCreateCommunity && (
        <div className="fixed inset-0 z-50 bg-slate-ink/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-paper rounded-3xl shadow-2xl border border-slate-line overflow-hidden">
            <div className="p-5 border-b border-slate-line flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-ink flex items-center gap-2">
                <Users className="w-4 h-4 text-indigo-600" /> Create Community
              </h3>
              <button
                type="button"
                onClick={() => setShowCreateCommunity(false)}
                className="text-slate-muted hover:text-slate-ink"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateCommunity} className="p-5 space-y-4">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-ink">Community Name</label>
                <input
                  type="text"
                  value={newCommName}
                  onChange={(e) => setNewCommName(e.target.value)}
                  placeholder="e.g. CSE Final Year 2026 or AI Capstone Hub"
                  className="w-full bg-cloud border border-slate-line rounded-xl px-3 py-2 text-xs text-slate-ink outline-none focus:border-indigo-600"
                  required
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-ink">Category</label>
                <select
                  value={newCommCat}
                  onChange={(e) => setNewCommCat(e.target.value)}
                  className="w-full bg-cloud border border-slate-line rounded-xl px-3 py-2 text-xs text-slate-ink outline-none focus:border-indigo-600"
                >
                  {COMMUNITY_CATEGORIES.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-ink">Description</label>
                <textarea
                  rows={2}
                  value={newCommDesc}
                  onChange={(e) => setNewCommDesc(e.target.value)}
                  placeholder="Purpose of this community, announcements policy, etc."
                  className="w-full bg-cloud border border-slate-line rounded-xl p-3 text-xs text-slate-ink outline-none focus:border-indigo-600 resize-none"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-ink">Community Color</label>
                <div className="flex items-center gap-2">
                  {STATUS_COLORS.map((c) => (
                    <button
                      key={c.hex}
                      type="button"
                      onClick={() => setNewCommColor(c.hex)}
                      className={classNames(
                        "w-7 h-7 rounded-full transition-transform",
                        newCommColor === c.hex ? "scale-125 ring-2 ring-slate-ink ring-offset-2" : "hover:scale-110"
                      )}
                      style={{ backgroundColor: c.hex }}
                    />
                  ))}
                </div>
              </div>

              <div className="pt-2 flex items-center justify-end gap-2 border-t border-slate-line">
                <button
                  type="button"
                  onClick={() => setShowCreateCommunity(false)}
                  className="px-4 py-2 rounded-xl text-xs font-medium text-slate-muted hover:bg-cloud"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creatingComm || !newCommName.trim()}
                  className="px-5 py-2 rounded-xl bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 disabled:opacity-50 shadow transition-colors flex items-center gap-1.5"
                >
                  <Users className="w-3.5 h-3.5" /> Create Community
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ==================== MODAL 4: LINK PROJECT GROUP TO COMMUNITY ==================== */}
      {showLinkGroupModal && (
        <div className="fixed inset-0 z-50 bg-slate-ink/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-paper rounded-3xl shadow-2xl border border-slate-line overflow-hidden">
            <div className="p-5 border-b border-slate-line flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-ink flex items-center gap-2">
                <FolderKanban className="w-4 h-4 text-indigo-600" /> Link Project Group to {selectedCommunity?.name}
              </h3>
              <button
                type="button"
                onClick={() => setShowLinkGroupModal(false)}
                className="text-slate-muted hover:text-slate-ink"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <p className="text-xs text-slate-muted">
                Select a project group to attach to this community. Members of the community will see the group listed in the constituent directory.
              </p>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-ink">Choose Project Group</label>
                <select
                  value={selectedGroupToLink}
                  onChange={(e) => setSelectedGroupToLink(e.target.value)}
                  className="w-full bg-cloud border border-slate-line rounded-xl px-3 py-2 text-xs text-slate-ink outline-none focus:border-indigo-600"
                >
                  <option value="">-- Select a Group --</option>
                  {myGroups.map((g) => (
                    <option key={g._id || g.id} value={g._id || g.id}>
                      {g.name} ({g.project || "Group"})
                    </option>
                  ))}
                </select>
              </div>

              <div className="pt-2 flex items-center justify-end gap-2 border-t border-slate-line">
                <button
                  type="button"
                  onClick={() => setShowLinkGroupModal(false)}
                  className="px-4 py-2 rounded-xl text-xs font-medium text-slate-muted hover:bg-cloud"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleLinkGroup}
                  disabled={linkingGroup || !selectedGroupToLink}
                  className="px-5 py-2 rounded-xl bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 disabled:opacity-50 shadow transition-colors flex items-center gap-1.5"
                >
                  <Plus className="w-3.5 h-3.5" /> Link Group
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ==================== MODAL 4B: BROADCAST ANNOUNCEMENT MODAL ==================== */}
      {showAnnouncementModal && selectedCommunity && (
        <div className="fixed inset-0 z-50 bg-slate-ink/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-paper rounded-3xl shadow-2xl border border-slate-line overflow-hidden animate-in fade-in zoom-in-95">
            <div className="p-5 border-b border-slate-line flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-ink flex items-center gap-2">
                <Megaphone className="w-4 h-4 text-indigo-600" /> Broadcast to {selectedCommunity.name}
              </h3>
              <button
                type="button"
                onClick={() => setShowAnnouncementModal(false)}
                className="text-slate-muted hover:text-slate-ink"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handlePostAnnouncement} className="p-5 space-y-4">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-ink">Announcement Title</label>
                <input
                  type="text"
                  value={announcementTitle}
                  onChange={(e) => setAnnouncementTitle(e.target.value)}
                  placeholder="e.g. Sprint Review Schedule or Deadline Notice"
                  className="w-full bg-cloud border border-slate-line rounded-xl px-3 py-2 text-xs text-slate-ink outline-none focus:border-indigo-600"
                  required
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-ink">Announcement Message</label>
                <textarea
                  rows={4}
                  value={announcementContent}
                  onChange={(e) => setAnnouncementContent(e.target.value)}
                  placeholder="Broadcast instructions, guidelines, or notices to all project groups in this community…"
                  className="w-full bg-cloud border border-slate-line rounded-xl p-3 text-xs text-slate-ink outline-none focus:border-indigo-600 resize-none"
                  required
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-2 border-t border-slate-line">
                <button
                  type="button"
                  onClick={() => setShowAnnouncementModal(false)}
                  className="px-4 py-2 rounded-xl text-xs font-medium text-slate-muted hover:bg-cloud"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={postingAnnouncement || !announcementTitle.trim() || !announcementContent.trim()}
                  className="px-5 py-2 rounded-xl bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 disabled:opacity-50 shadow transition-colors flex items-center gap-1.5"
                >
                  <Send className="w-3.5 h-3.5" /> Broadcast Announcement
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ==================== MODAL 5: START NEW CALL ==================== */}
      {showNewCallModal && (
        <div className="fixed inset-0 z-50 bg-slate-ink/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-paper rounded-3xl shadow-2xl border border-slate-line overflow-hidden">
            <div className="p-5 border-b border-slate-line flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-ink flex items-center gap-2">
                <PhoneCall className="w-4 h-4 text-sky-600" /> Start WebRTC Audio/Video Call
              </h3>
              <button
                type="button"
                onClick={() => {
                  setShowNewCallModal(false);
                  setCallQuery("");
                  setCallSearchResults([]);
                }}
                className="text-slate-muted hover:text-slate-ink"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div className="relative">
                <div className="flex items-center gap-2 bg-cloud border border-slate-line rounded-xl px-3 py-2 text-xs focus-within:border-sky-600 transition-colors">
                  <SearchIcon className="w-4 h-4 text-slate-muted shrink-0" />
                  <input
                    type="text"
                    value={callQuery}
                    onChange={(e) => setCallQuery(e.target.value)}
                    placeholder="Search teammate or supervisor to call…"
                    className="flex-1 bg-transparent outline-none text-slate-ink placeholder:text-slate-muted min-w-0"
                    autoFocus
                  />
                  {callQuery && (
                    <button
                      type="button"
                      onClick={() => {
                        setCallQuery("");
                        setCallSearchResults([]);
                      }}
                      className="text-slate-muted hover:text-slate-ink"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>

              <div className="max-h-64 overflow-y-auto space-y-1 divide-y divide-slate-line/40">
                {callQuery.trim().length < 2 ? (
                  <p className="text-xs text-slate-muted text-center py-4">
                    Type at least 2 characters to search contacts.
                  </p>
                ) : callSearchResults.length === 0 ? (
                  <p className="text-xs text-slate-muted text-center py-4">No users found.</p>
                ) : (
                  callSearchResults.map((u) => (
                    <div
                      key={u.id || u._id}
                      className="p-2.5 flex items-center justify-between gap-2 hover:bg-cloud rounded-xl transition-colors"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span
                          className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
                          style={{ backgroundColor: u.color || "#5B5FEF" }}
                        >
                          {getInitials(u.name)}
                        </span>
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-slate-ink truncate">{u.name}</p>
                          <p className="text-[11px] text-slate-muted truncate">
                            {u.role} {u.dept ? `· ${u.dept}` : ""}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => {
                            setShowNewCallModal(false);
                            handleStartCall(u, "voice");
                          }}
                          className="p-2 rounded-xl text-emerald-600 hover:bg-emerald-50 transition-colors"
                          title="Voice call"
                        >
                          <Phone className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setShowNewCallModal(false);
                            handleStartCall(u, "video");
                          }}
                          className="p-2 rounded-xl text-sky-600 hover:bg-sky-50 transition-colors"
                          title="Video call"
                        >
                          <Video className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default MessagesPage;
