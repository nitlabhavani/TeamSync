import { useEffect, useState } from "react";
import { useNavigate } from "@/lib/router-compat";
import { Search, Sparkles, Users, Tag, CalendarClock } from "lucide-react";
import Navbar from "../../components/navbar/Navbar";
import SectionHeading from "../../components/dashboard/SectionHeading";
import { useGroups } from "../../hooks/useGroups";
import { getInitials, classNames } from "../../utils/helperFunctions";
import { formatDay } from "../../utils/dateFormatter";
import * as chatService from "../../services/chatService";
import { nameOf } from "../../services/userDirectory";
import * as groupService from "../../services/groupService";

// Same status badge palette used on the guide's Group Management page
// (pages/guide/GroupManagement.jsx#GROUP_STATUS_STYLES) — kept in sync so a
// group reads the same "active"/"archived" way for both roles.
const GROUP_STATUS_STYLES = {
  active: "bg-mint-soft text-mint",
  archived: "bg-cloud text-slate-muted",
};

const Groups = () => {
  const { groups, loading } = useGroups();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }
    const id = setTimeout(async () => {
      const data = await groupService.searchUsers(query);
      setResults(data);
    }, 200);
    return () => clearTimeout(id);
  }, [query]);

  const [previews, setPreviews] = useState({});

  useEffect(() => {
    let cancelled = false;
    Promise.all(
      groups.map(async (g) => {
        try {
          const msgs = await chatService.getGroupMessages(g.id, 1);
          return [g.id, msgs[msgs.length - 1] || null];
        } catch {
          return [g.id, null];
        }
      }),
    ).then((entries) => {
      if (!cancelled) setPreviews(Object.fromEntries(entries));
    });
    return () => {
      cancelled = true;
    };
  }, [groups]);

  const lastMessage = (groupId) => previews[groupId];

  return (
    <>
      <Navbar title="Groups & people" subtitle="Your project groups and direct messages" />
      <main className="flex-1 px-5 md:px-8 py-6 max-w-3xl w-full mx-auto space-y-6">
        <div className="flex items-center gap-2 bg-paper border border-slate-line rounded-full px-4 py-2.5">
          <Search className="w-4 h-4 text-slate-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search anyone to start a private chat…"
            className="flex-1 outline-none text-sm bg-transparent"
          />
        </div>

        {results.length > 0 && (
          <section className="space-y-2">
            <SectionHeading title="People" />
            <div className="space-y-1.5">
              {results.map((person) => (
                <button
                  key={person.id}
                  onClick={() => navigate(`/app/chat/${person.id}`)}
                  className="w-full flex items-center gap-3 bg-paper hover:bg-cloud rounded-xl px-3.5 py-2.5 text-left transition-colors"
                >
                  <span
                    className="w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-semibold"
                    style={{ backgroundColor: person.color }}
                  >
                    {getInitials(person.name)}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-ink truncate">{person.name}</p>
                    <p className="text-xs text-slate-muted truncate">{person.dept} · {person.role}</p>
                  </div>
                </button>
              ))}
            </div>
          </section>
        )}

        <section className="space-y-3">
          <SectionHeading icon={Users} title="Project groups" />
          {loading ? (
            <div className="space-y-3">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-[110px] rounded-xl2 border border-slate-line bg-paper animate-pulse" />
              ))}
            </div>
          ) : groups.length === 0 ? (
            <div className="flex flex-col items-center text-center gap-2 border border-dashed border-slate-line rounded-xl2 py-12 px-6 bg-paper">
              <span className="w-11 h-11 rounded-full bg-cloud flex items-center justify-center">
                <Users className="w-5 h-5 text-slate-muted" />
              </span>
              <p className="text-sm font-medium text-slate-ink">No groups yet</p>
              <p className="text-xs text-slate-muted max-w-xs">
                You'll see your project groups here once you're added to one, or invited by a guide.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {groups.map((group) => {
                const last = lastMessage(group.id);
                const memberCount = (group.members || []).length;
                return (
                  <button
                    key={group.id}
                    onClick={() => navigate(`/app/groups/${group.id}`)}
                    className="w-full bg-paper border border-slate-line hover:border-brand rounded-xl2 px-4 py-4 text-left transition-colors shadow-panel"
                  >
                    <div className="flex items-start gap-3">
                      <span className="w-11 h-11 rounded-full bg-brand-deep flex items-center justify-center text-white text-sm font-semibold shrink-0">
                        {getInitials(group.name)}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-sm font-semibold text-slate-ink truncate">{group.name}</p>
                          <span className="flex items-center gap-1 bg-brand-soft text-brand-deep text-[11px] font-semibold px-2 py-0.5 rounded-full shrink-0">
                            <Sparkles className="w-3 h-3" /> {group.collaborationScore}
                          </span>
                        </div>
                        <p className="text-xs text-slate-muted truncate mt-0.5">
                          {last
                            ? `${nameOf(last.senderId, "Someone").split(" ")[0]}: ${last.text}`
                            : `${group.project} · ${memberCount} member${memberCount === 1 ? "" : "s"}`}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 flex-wrap mt-3 ml-[56px]">
                      {group.category && (
                        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-muted bg-cloud px-2.5 py-1 rounded-full">
                          <Tag className="w-3 h-3" /> {group.category}
                        </span>
                      )}
                      {group.status && (
                        <span
                          className={classNames(
                            "inline-flex items-center text-[11px] font-semibold px-2.5 py-1 rounded-full capitalize",
                            GROUP_STATUS_STYLES[group.status] || "bg-cloud text-slate-muted"
                          )}
                        >
                          {group.status}
                        </span>
                      )}
                      {group.expectedCompletion && (
                        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-muted bg-cloud px-2.5 py-1 rounded-full">
                          <CalendarClock className="w-3 h-3" /> Due {formatDay(group.expectedCompletion)}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-3 mt-3 ml-[56px]">
                      <div className="flex-1 h-2 rounded-full bg-cloud overflow-hidden max-w-xs">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-brand to-mint"
                          style={{ width: `${group.progress}%` }}
                        />
                      </div>
                      <span className="font-mono text-[11px] text-slate-muted shrink-0">{group.progress}%</span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </section>
      </main>
    </>
  );
};

export default Groups;
