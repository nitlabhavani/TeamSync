import { api, normalize } from "../lib/apiClient";

/**
 * Educational & technical learning search proxy.
 * Calls backend POST /search/learning.
 *
 * @param {string} query
 * @returns {Promise<{ query: string, total: number, configured: boolean, results: Array<{ title: string, url: string, domain: string, snippet: string, source: string }>, answer?: string, warning?: string, message?: string }>}
 */
export const searchLearning = async (query) => {
  const q = (query || "").trim();
  if (!q) {
    return { query: "", total: 0, configured: true, results: [] };
  }

  const res = await api.post("/search/learning", { query: q });
  const data = normalize(res);

  return {
    query: data?.query || q,
    total: data?.total || (data?.results || []).length,
    configured: data?.configured ?? true,
    results: normalize(data?.results || []),
    answer: data?.answer || null,
    warning: data?.warning || null,
    message: data?.message || null,
  };
};
