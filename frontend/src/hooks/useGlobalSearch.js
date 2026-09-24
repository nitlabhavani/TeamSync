import { useEffect, useMemo, useState } from "react";
import * as searchService from "../services/searchService";

/**
 * Shared global-search data/state logic (query, filter, debounce, results,
 * loading, error). Presentation is left entirely to the caller so different
 * roles (student, guide) can render their own UI on top of the same
 * search behavior without duplicating the fetch/debounce logic.
 *
 * Preserves the original behavior from pages/common/Search.jsx:
 * - 250ms debounce
 * - minimum 2 characters before searching
 * - searchService.search(query, { type, limit }) call signature
 */
export const useGlobalSearch = ({ limit = 25 } = {}) => {
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
        setResults(await searchService.search(q, { type: filter, limit }));
        setError("");
      } catch (e) {
        setError(e?.message || "Search failed.");
        setResults(null);
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => clearTimeout(id);
  }, [query, filter, limit]);

  const empty = useMemo(() => !!results && results.total === 0 && !loading, [results, loading]);

  const show = (type) => filter === "all" || filter === type;

  return { query, setQuery, filter, setFilter, results, loading, error, empty, show };
};
