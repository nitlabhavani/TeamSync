import { useContext, useEffect } from "react";
import { GroupContext } from "../context/GroupContext";

export const useGroups = () => {
  const ctx = useContext(GroupContext);
  if (!ctx) throw new Error("useGroups must be used within a GroupProvider");

  useEffect(() => {
    if (ctx.groups.length === 0) ctx.fetchGroups();
    // Intentionally empty deps: this must only run once on mount to trigger
    // an initial fetch, not on every ctx/fetchGroups identity change. (Note:
    // eslint's react-hooks plugin is only configured for .ts/.tsx files in
    // this project, not this .js file, so no exhaustive-deps disable
    // comment is needed/checked here — a stray one previously caused
    // `npm run lint` to fail with "Definition for rule ... was not found".)
  }, []);

  return ctx;
};
