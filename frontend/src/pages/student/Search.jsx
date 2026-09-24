import {
  Search as SearchIcon,
  Users,
  UserCircle,
  FolderOpen,
  MessagesSquare,
  Download,
  X,
  AlertTriangle,
} from "lucide-react";
import Navbar from "../../components/navbar/Navbar";
import { useNavigate } from "@/lib/router-compat";
import { useGlobalSearch } from "../../hooks/useGlobalSearch";
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

const ResultSection = ({ title, icon: Icon, count, children }) => (
  <section className="bg-paper border border-slate-line rounded-xl2 p-5">
    <p className="flex items-center gap-2 text-sm font-semibold text-slate-ink mb-3">
      <Icon className="w-4 h-4 text-brand" /> {title}
      <span className="text-xs font-medium text-slate-muted">({count})</span>
    </p>
    {count === 0 ? (
      <p className="text-xs text-slate-muted">No matches in this category.</p>
    ) : (
      children
    )}
  </section>
);

const ResultsSkeleton = () => (
  <div className="space-y-3">
    {[0, 1, 2].map((i) => (
      <div key={i} className="bg-paper border border-slate-line rounded-xl2 p-5 space-y-3 animate-pulse">
        <div className="h-3.5 w-24 bg-cloud rounded-full" />
        <div className="space-y-2">
          {[0, 1].map((j) => (
            <div key={j} className="h-[52px] rounded-xl border border-slate-line bg-cloud/60" />
          ))}
        </div>
      </div>
    ))}
  </div>
);

const EmptyState = ({ icon: Icon = SearchIcon, title, subtitle }) => (
  <div className="flex flex-col items-center text-center gap-2 border border-dashed border-slate-line rounded-xl2 py-12 px-6">
    <span className="w-11 h-11 rounded-full bg-cloud flex items-center justify-center">
      <Icon className="w-5 h-5 text-slate-muted" />
    </span>
    <p className="text-sm font-medium text-slate-ink">{title}</p>
    {subtitle && <p className="text-xs text-slate-muted max-w-xs">{subtitle}</p>}
  </div>
);

const StudentSearch = () => {
  const navigate = useNavigate();
  const { query, setQuery, filter, setFilter, results, loading, error, empty, show } =
    useGlobalSearch({ limit: 25 });

  return (
    <>
      <Navbar title="Search" subtitle="Find groups, members, files and messages in one place" />
      <main className="flex-1 px-5 md:px-8 py-6 space-y-5 max-w-3xl w-full mx-auto">
        <div className="flex items-center gap-2 bg-paper border border-slate-line rounded-full px-4 py-3 focus-within:border-brand focus-within:ring-2 focus-within:ring-brand-soft transition-all">
          <SearchIcon className="w-4 h-4 text-slate-muted shrink-0" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search groups, members, files, messages…"
            className="flex-1 bg-transparent outline-none text-sm text-slate-ink placeholder:text-slate-muted"
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              aria-label="Clear search"
              className="w-6 h-6 rounded-full hover:bg-cloud flex items-center justify-center text-slate-muted hover:text-slate-ink transition-colors"
            >
              <X className="w-4 h-4" />
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
                  : "bg-paper border-slate-line text-slate-muted hover:text-slate-ink hover:border-brand"
              )}
            >
              <Icon className="w-3.5 h-3.5" /> {label}
            </button>
          ))}
        </div>

        {loading && <ResultsSkeleton />}

        {!loading && error && (
          <div className="flex items-center gap-3 bg-coral-soft border border-coral/20 rounded-xl2 px-4 py-3.5">
            <AlertTriangle className="w-4 h-4 text-coral shrink-0" />
            <p className="text-sm text-coral">{error}</p>
          </div>
        )}

        {!loading && !error && !results && (
          <EmptyState
            title="Start typing to search"
            subtitle="Type at least 2 characters to search your groups, members, files and messages."
          />
        )}

        {!loading && !error && empty && (
          <EmptyState
            title={`Nothing matched "${results.query}"`}
            subtitle={
              filter === "all"
                ? "Try a different keyword, or check for typos."
                : `No ${FILTERS.find((f) => f.id === filter)?.label.toLowerCase()} matched this search — try “Everything” to widen the results.`
            }
          />
        )}

        {!loading && results && results.total > 0 && (
          <div className="space-y-4">
            {show("groups") && (
              <ResultSection title="Groups" icon={Users} count={results.groups.length}>
                <div className="space-y-1.5">
                  {results.groups.map((g) => (
                    <button
                      key={g.id}
                      onClick={() => navigate(`/app/groups/${g.id}`)}
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
              </ResultSection>
            )}

            {show("members") && (
              <ResultSection title="Members" icon={UserCircle} count={results.members.length}>
                <div className="space-y-1.5">
                  {results.members.map((m) => (
                    <button
                      key={m.id}
                      onClick={() => navigate(`/app/chat/${m.id}`)}
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
              </ResultSection>
            )}

            {show("files") && (
              <ResultSection title="Files" icon={FolderOpen} count={results.files.length}>
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
                        className="shrink-0 w-8 h-8 rounded-full hover:bg-paper flex items-center justify-center text-slate-muted hover:text-brand transition-colors"
                        aria-label={`Download ${f.name}`}
                      >
                        <Download className="w-4 h-4" />
                      </a>
                    </div>
                  ))}
                </div>
              </ResultSection>
            )}

            {show("messages") && (
              <ResultSection title="Messages" icon={MessagesSquare} count={results.messages.length}>
                <div className="space-y-1.5">
                  {results.messages.map((m) => (
                    <button
                      key={m.id}
                      onClick={() =>
                        navigate(`/app/groups/${m.group?._id || m.group?.id || m.group}`)
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
              </ResultSection>
            )}
          </div>
        )}
      </main>
    </>
  );
};

export default StudentSearch;
