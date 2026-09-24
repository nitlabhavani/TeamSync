import { api, normalize } from "../lib/apiClient";

/**
 * Global search across groups, members, files and group messages.
 * type: "all" | "groups" | "members" | "files" | "messages"
 */
export const search = async (query, { type = "all", limit = 20 } = {}) => {
  const q = (query || "").trim();
  if (!q) return { query: "", groups: [], members: [], files: [], messages: [], total: 0 };
  const data = normalize(
    await api.get(`/search?q=${encodeURIComponent(q)}&type=${type}&limit=${limit}`),
  );
  return {
    query: q,
    groups: normalize(data.groups || []),
    members: normalize(data.members || []),
    files: normalize(data.files || []),
    messages: normalize(data.messages || []),
    total: data.total || 0,
  };
};

export const searchGroups = async (q) => (await search(q, { type: "groups" })).groups;
export const searchMembers = async (q) => (await search(q, { type: "members" })).members;
export const searchFiles = async (q) => (await search(q, { type: "files" })).files;
