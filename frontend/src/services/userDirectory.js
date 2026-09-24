import { api, normalize } from "../lib/apiClient";

/**
 * Small in-memory directory of users so components can resolve a user id to a
 * name/colour without every one of them refetching. Populated once after login.
 */
const cache = new Map();
let loaded = null;

export const primeUsers = (users = []) => {
  users.filter(Boolean).forEach((u) => u.id && cache.set(String(u.id), u));
};

export const loadDirectory = async () => {
  if (!loaded) {
    loaded = api
      .get("/users")
      .then((users) => {
        primeUsers(normalize(users));
        return [...cache.values()];
      })
      .catch(() => {
        loaded = null;
        return [];
      });
  }
  return loaded;
};

export const resetDirectory = () => {
  cache.clear();
  loaded = null;
};

export const getUserById = (id) => (id ? cache.get(String(id)) : null);
export const nameOf = (id, fallback = "Unassigned") => getUserById(id)?.name || fallback;
export const colorOf = (id, fallback = "#94A3B8") => getUserById(id)?.color || fallback;
export const allUsers = () => [...cache.values()];
