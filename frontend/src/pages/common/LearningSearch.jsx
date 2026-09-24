import { useState, useEffect } from "react";
import { useSearch } from "@/lib/router-compat";
import {
  Search as SearchIcon,
  X,
  ExternalLink,
  Sparkles,
  BookOpen,
  HelpCircle,
  AlertTriangle,
  RotateCcw,
  Clock,
  Trash2,
  Compass,
} from "lucide-react";
import Navbar from "../../components/navbar/Navbar";
import { searchLearning } from "../../services/learningSearchService";

const SUGGESTIONS = [
  "Explain React hooks",
  "How does WebRTC work?",
  "What is inheritance in Java?",
  "How does MongoDB indexing work?",
  "What is overfitting in machine learning?",
  "Explain binary search with an example",
  "What is quantum superposition?",
  "Percentage aptitude problems formula",
];

const STORAGE_KEY = "teamsync_learning_recent_queries";

const ResultsSkeleton = () => (
  <div className="space-y-3 animate-pulse">
    {[0, 1, 2].map((i) => (
      <div key={i} className="bg-paper border border-slate-line rounded-xl2 p-5 space-y-3">
        <div className="flex items-center gap-2">
          <div className="h-4 w-24 bg-cloud rounded-full" />
          <div className="h-4 w-16 bg-cloud/70 rounded-full" />
        </div>
        <div className="h-5 w-3/4 bg-cloud rounded" />
        <div className="space-y-1.5 pt-1">
          <div className="h-3.5 w-full bg-cloud/80 rounded" />
          <div className="h-3.5 w-5/6 bg-cloud/60 rounded" />
        </div>
      </div>
    ))}
  </div>
);

const LearningSearch = () => {
  const searchParams = useSearch({ strict: false }) || {};
  const initialQ = (searchParams?.q || searchParams?.query || "").trim();
  const [query, setQuery] = useState(initialQ);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [data, setData] = useState(null);
  const [recentQueries, setRecentQueries] = useState(() => {
    try {
      return JSON.parse(sessionStorage.getItem(STORAGE_KEY) || "[]");
    } catch {
      return [];
    }
  });

  useEffect(() => {
    if (initialQ && initialQ.length >= 2) {
      handleSearch(initialQ);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQ]);

  const saveRecentQuery = (q) => {
    try {
      const updated = [q, ...recentQueries.filter((item) => item.toLowerCase() !== q.toLowerCase())].slice(0, 8);
      setRecentQueries(updated);
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    } catch {
      /* session storage unavailable */
    }
  };

  const clearRecentQueries = () => {
    setRecentQueries([]);
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  };

  const handleSearch = async (searchQuery) => {
    const term = (searchQuery ?? query).trim();
    if (!term || term.length < 2) return;

    setLoading(true);
    setError(null);
    if (searchQuery !== undefined) {
      setQuery(searchQuery);
    }

    try {
      const res = await searchLearning(term);
      setData(res);
      saveRecentQuery(term);
    } catch (err) {
      setError(err?.message || "Search failed. Please check your connection and try again.");
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  const onSubmit = (e) => {
    e.preventDefault();
    handleSearch();
  };

  return (
    <>
      <Navbar
        title="Learning Search"
        subtitle="Search programming concepts, educational doubts, and study topics"
      />
      <main className="flex-1 px-4 sm:px-8 py-6 space-y-6 max-w-4xl w-full mx-auto">
        {/* Search Bar */}
        <form onSubmit={onSubmit} className="relative">
          <div className="flex items-center gap-2 bg-paper border border-slate-line rounded-2xl px-4 py-3.5 shadow-sm focus-within:border-brand focus-within:ring-2 focus-within:ring-brand-soft transition-all">
            <SearchIcon className="w-5 h-5 text-slate-muted shrink-0" />
            <input
              autoFocus
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Ask any educational question or search a concept…"
              className="flex-1 bg-transparent outline-none text-sm text-slate-ink placeholder:text-slate-muted"
            />
            {query && (
              <button
                type="button"
                onClick={() => {
                  setQuery("");
                  setData(null);
                  setError(null);
                }}
                aria-label="Clear search"
                className="w-7 h-7 rounded-full hover:bg-cloud flex items-center justify-center text-slate-muted hover:text-slate-ink transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            )}
            <button
              type="submit"
              disabled={loading || query.trim().length < 2}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-brand text-white text-xs font-semibold hover:bg-brand/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? "Searching…" : "Search"}
            </button>
          </div>
        </form>

        {/* Suggestion Chips */}
        <div className="space-y-2">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-muted uppercase tracking-wider">
            <Sparkles className="w-3.5 h-3.5 text-brand" /> Suggested Topics
          </p>
          <div className="flex flex-wrap gap-2">
            {SUGGESTIONS.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                onClick={() => handleSearch(suggestion)}
                className="text-xs bg-paper hover:bg-cloud border border-slate-line text-slate-ink hover:border-brand/40 px-3 py-1.5 rounded-full transition-colors flex items-center gap-1"
              >
                {suggestion}
              </button>
            ))}
          </div>
        </div>

        {/* Loading Skeleton */}
        {loading && <ResultsSkeleton />}

        {/* Error State */}
        {!loading && error && (
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-coral-soft/70 border border-coral/30 rounded-xl2 p-4">
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="w-5 h-5 text-coral shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-coral">Search Error</p>
                <p className="text-xs text-slate-muted mt-0.5">{error}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => handleSearch()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-paper border border-coral/40 text-xs font-medium text-coral hover:bg-coral hover:text-white transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" /> Retry
            </button>
          </div>
        )}

        {/* Unconfigured Provider State */}
        {!loading && data && data.configured === false && (
          <div className="bg-amber-soft/60 border border-amber/30 rounded-xl2 p-5 text-center space-y-2">
            <Compass className="w-8 h-8 text-amber mx-auto" />
            <p className="text-sm font-semibold text-slate-ink">External Search Provider Not Configured</p>
            <p className="text-xs text-slate-muted max-w-md mx-auto">
              {data.message || "To enable external search, set LEARNING_SEARCH_PROVIDER or configure an API key in backend/.env."}
            </p>
          </div>
        )}

        {/* Warning Banner */}
        {!loading && data && data.warning && (
          <div className="flex items-center gap-2 bg-amber-soft/50 border border-amber/20 rounded-xl px-4 py-2.5 text-xs text-amber-900">
            <AlertTriangle className="w-4 h-4 text-amber shrink-0" />
            <span>{data.warning}</span>
          </div>
        )}

        {/* Direct Answer Card */}
        {!loading && data?.answer && (
          <div className="bg-brand-soft/40 border border-brand/20 rounded-xl2 p-5 space-y-2">
            <p className="flex items-center gap-2 text-xs font-semibold text-brand uppercase tracking-wider">
              <BookOpen className="w-4 h-4" /> Direct Summary
            </p>
            <p className="text-sm text-slate-ink leading-relaxed whitespace-pre-line">{data.answer}</p>
          </div>
        )}

        {/* Search Results List */}
        {!loading && data && data.results && data.results.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-slate-muted">
                Showing {data.results.length} result{data.results.length === 1 ? "" : "s"} for “{data.query}”
              </p>
            </div>
            <div className="space-y-3">
              {data.results.map((result, idx) => (
                <article
                  key={result.url || idx}
                  className="bg-paper border border-slate-line rounded-xl2 p-5 hover:border-brand/40 transition-colors shadow-xs"
                >
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-brand bg-brand-soft rounded-md px-2 py-0.5">
                      {result.domain || "Reference"}
                    </span>
                    <a
                      href={result.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-slate-muted hover:text-brand transition-colors p-1"
                      aria-label={`Open ${result.title} in new tab`}
                    >
                      <ExternalLink className="w-4 h-4" />
                    </a>
                  </div>
                  <h3 className="text-base font-semibold text-slate-ink hover:text-brand transition-colors">
                    <a href={result.url} target="_blank" rel="noopener noreferrer">
                      {result.title}
                    </a>
                  </h3>
                  <p className="text-xs text-slate-muted mt-2 leading-relaxed">
                    {result.snippet}
                  </p>
                  <div className="mt-3 pt-2.5 border-t border-slate-line/50 flex items-center justify-between text-[11px] text-slate-muted">
                    <span className="truncate max-w-sm">{result.url}</span>
                    <a
                      href={result.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 font-medium text-brand hover:underline shrink-0"
                    >
                      Read full article <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                </article>
              ))}
            </div>
          </div>
        )}

        {/* Empty Search Results State */}
        {!loading && data && data.results && data.results.length === 0 && !data.warning && (
          <div className="flex flex-col items-center text-center gap-2 border border-dashed border-slate-line rounded-xl2 py-12 px-6">
            <span className="w-12 h-12 rounded-full bg-cloud flex items-center justify-center">
              <HelpCircle className="w-6 h-6 text-slate-muted" />
            </span>
            <p className="text-sm font-semibold text-slate-ink">No results found for “{data.query}”</p>
            <p className="text-xs text-slate-muted max-w-sm">
              Try rephrasing your question or using broader programming keywords (e.g. “React hooks” or “binary search”).
            </p>
          </div>
        )}

        {/* Initial Empty State with Recent Searches */}
        {!loading && !data && !error && (
          <div className="space-y-6">
            {recentQueries.length > 0 && (
              <div className="bg-paper border border-slate-line rounded-xl2 p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-muted uppercase tracking-wider">
                    <Clock className="w-3.5 h-3.5 text-slate-muted" /> Recent In-App Searches
                  </p>
                  <button
                    type="button"
                    onClick={clearRecentQueries}
                    className="inline-flex items-center gap-1 text-xs text-slate-muted hover:text-coral transition-colors"
                  >
                    <Trash2 className="w-3 h-3" /> Clear
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {recentQueries.map((item) => (
                    <button
                      key={item}
                      type="button"
                      onClick={() => handleSearch(item)}
                      className="text-xs bg-cloud hover:bg-cloud/80 text-slate-ink px-3 py-1.5 rounded-full transition-colors"
                    >
                      {item}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="flex flex-col items-center text-center gap-3 border border-dashed border-slate-line rounded-xl2 py-14 px-6 bg-paper/50">
              <span className="w-12 h-12 rounded-full bg-brand-soft flex items-center justify-center">
                <BookOpen className="w-6 h-6 text-brand" />
              </span>
              <h2 className="text-sm font-semibold text-slate-ink">Ask and Learn Without Leaving TeamSync AI</h2>
              <p className="text-xs text-slate-muted max-w-md">
                Type your programming doubt, technical question, or project concept above. Searches are completely private and never visible to other students, guides, or group AI analytics.
              </p>
            </div>
          </div>
        )}
      </main>
    </>
  );
};

export default LearningSearch;
