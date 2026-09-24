import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@/lib/router-compat";
import {
  Search as SearchIcon,
  Users,
  UserCircle,
  FolderOpen,
  MessagesSquare,
  Download,
  Loader2,
  X,
} from "lucide-react";
import Navbar from "../../components/navbar/Navbar";
import { useAuth } from "../../hooks/useAuth";
import * as searchService from "../../services/searchService";
import * as fileService from "../../services/fileService";
import { getInitials, formatFileSize, classNames } from "../../utils/helperFunctions";
import { formatDay } from "../../utils/dateFormatter";

const FILTERS = [
  { id: "all", label: "Everything", icon: SearchIcon },
  { id: "groups", label: "Groups", icon: Users },
  { id: "members", label: "Members", icon: UserCircle },
  { id: "files", label: "Files", icon: FolderOpen },
  { id: "messages", label: "Messages", icon: MessagesSquare },
];

const Section = ({ title, icon: Icon, count, children }) => (
  <section className="bg-paper border border-slate-line rounded-xl2 p-5">
    <p className="flex items-center gap-2 text-sm font-semibold text-slate-ink mb-3">
      <Icon className="w-4 h-4 text-brand" /> {title}
      <span className="text-xs font-medium text-slate-muted">({count})</span>
    </p>
    {count === 0 ? <p className="text-xs text-slate-muted">No matches.</p> : children}
  </section>
);

const SearchPage = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const isGuide = user?.role === "guide" || user?.role === "admin";
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults(null);
      setError("");
      return undefined;
    }
    setLoading(true);
    const id = setTimeout(async () => {
      try {
        setResults(await searchService.search(q, { type: filter, limit: 25 }));
        setError("");
      } catch (e) {
        setError(e?.message || "Search failed.");
        setResults(null);
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => clearTimeout(id);
  }, [query, filter]);

  const show = (t) => filter === "all" || filter === t;
  const groupBase = isGuide ? "/guide/groups" : "/app/groups";

  const empty = useMemo(
    () => results && results.total === 0 && !loading,
    [results, loading]
  );

  return (
    <>
      <Navbar title="Search" subtitle="Find groups, members, files and messages in one place" />
      <main className="flex-1 px-5 md:px-8 py-6 space-y-5 max-w-3xl w-full mx-auto">
        <div className="flex items-center gap-2 bg-paper border border-slate-line rounded-full px-4 py-3 focus-within:border-brand transition-colors">
          <SearchIcon className="w-4 h-4 text-slate-muted shrink-0" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search groups, members, files, messages…"
            className="flex-1 bg-transparent outline-none text-sm"
          />
          {loading && <Loader2 className="w-4 h-4 animate-spin text-brand" />}
          {query && !loading && (
            <button onClick={() => setQuery("")} aria-label="Clear search">
              <X className="w-4 h-4 text-slate-muted" />
            </button>
          )}
        </div>

        <div className="flex gap-1.5 flex-wrap">
          {FILTERS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setFilter(id)}
              className={classNames(
                "inline-flex items-center gap-1.5 text-xs font-medium px-3.5 py-2 rounded-full border transition-colors",
                filter === id
                  ? "bg-brand text-white border-brand"
                  : "border-slate-line text-slate-muted hover:text-slate-ink"
              )}
            >
              <Icon className="w-3.5 h-3.5" /> {label}
            </button>
          ))}
        </div>

        {error && <p className="text-sm text-coral bg-coral-soft rounded-lg px-4 py-3">{error}</p>}

        {!results && !error && (
          <p className="text-sm text-slate-muted text-center py-10">
            Type at least 2 characters to search.
          </p>
        )}

        {empty && (
          <p className="text-sm text-slate-muted text-center py-10">
            Nothing matched “{results.query}”.
          </p>
        )}

        {results && results.total > 0 && (
          <div className="space-y-4">
            {show("groups") && (
              <Section title="Groups" icon={Users} count={results.groups.length}>
                <div className="space-y-1.5">
                  {results.groups.map((g) => (
                    <button
                      key={g.id}
                      onClick={() => navigate(isGuide ? groupBase : `${groupBase}/${g.id}`)}
                      className="w-full flex items-center gap-3 hover:bg-cloud rounded-xl px-3 py-2.5 text-left transition-colors"
                    >
                      <span className="w-9 h-9 rounded-full bg-brand-deep flex items-center justify-center text-white text-xs font-semibold shrink-0">
                        {getInitials(g.name)}
                      </span>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-ink truncate">{g.name}</p>
                        <p className="text-xs text-slate-muted truncate">
                          {g.project} · {(g.members || []).length} members
                        </p>
                      </div>
                    </button>
                  ))}
                </div>
              </Section>
            )}

            {show("members") && (
              <Section title="Members" icon={UserCircle} count={results.members.length}>
                <div className="space-y-1.5">
                  {results.members.map((m) => (
                    <button
                      key={m.id}
                      onClick={() =>
                        navigate(isGuide ? `/guide/members/${m.id}` : `/app/chat/${m.id}`)
                      }
                      className="w-full flex items-center gap-3 hover:bg-cloud rounded-xl px-3 py-2.5 text-left transition-colors"
                    >
                      <span
                        className="w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-semibold shrink-0"
                        style={{ backgroundColor: m.color || "#5B5FEF" }}
                      >
                        {getInitials(m.name)}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-slate-ink truncate">{m.name}</p>
                        <p className="text-xs text-slate-muted truncate">
                          {m.email} · {m.role}
                          {m.dept ? ` · ${m.dept}` : ""}
                        </p>
                      </div>
                      {m.inMyTeams && (
                        <span className="text-[10px] font-semibold text-brand bg-brand-soft rounded-full px-2 py-0.5 shrink-0">
                          My team
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              </Section>
            )}

            {show("files") && (
              <Section title="Files" icon={FolderOpen} count={results.files.length}>
                <div className="space-y-1.5">
                  {results.files.map((f) => (
                    <div
                      key={f.id}
                      className="flex items-center gap-3 hover:bg-cloud rounded-xl px-3 py-2.5"
                    >
                      <span className="w-9 h-9 rounded-lg bg-amber-soft text-amber flex items-center justify-center shrink-0">
                        <FolderOpen className="w-4 h-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-slate-ink truncate">{f.name}</p>
                        <p className="text-xs text-slate-muted truncate">
                          {f.group?.name || "Group"} · {formatFileSize(f.size)} ·{" "}
                          {formatDay(f.createdAt)}
                        </p>
                      </div>
                      <a
                        href={fileService.downloadUrl(f.group?._id || f.group?.id || f.group, f.id)}
                        className="shrink-0 w-8 h-8 rounded-full hover:bg-paper flex items-center justify-center text-slate-muted hover:text-brand"
                        aria-label={`Download ${f.name}`}
                      >
                        <Download className="w-4 h-4" />
                      </a>
                    </div>
                  ))}
                </div>
              </Section>
            )}

            {show("messages") && (
              <Section title="Messages" icon={MessagesSquare} count={results.messages.length}>
                <div className="space-y-1.5">
                  {results.messages.map((m) => (
                    <button
                      key={m.id}
                      onClick={() =>
                        navigate(
                          isGuide
                            ? groupBase
                            : `${groupBase}/${m.group?._id || m.group?.id || m.group}`
                        )
                      }
                      className="w-full text-left hover:bg-cloud rounded-xl px-3 py-2.5 transition-colors"
                    >
                      <p className="text-sm text-slate-ink line-clamp-2">{m.text}</p>
                      <p className="text-xs text-slate-muted mt-0.5">
                        {m.sender?.name || "Member"} · {m.group?.name || "Group"} ·{" "}
                        {formatDay(m.createdAt)}
                      </p>
                    </button>
                  ))}
                </div>
              </Section>
            )}
          </div>
        )}
      </main>
    </>
  );
};

export default SearchPage;
