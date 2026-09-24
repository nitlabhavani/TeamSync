import { api, normalize } from "../lib/apiClient";

/**
 * Calendar is a read-only visualization layer over existing Task/Meeting/
 * SprintPlan/Milestone/project-deadline data — see
 * backend/src/controllers/calendarController.js. This service does not
 * create, cache, or duplicate that data; it only fetches and normalizes it,
 * the same way every other `*Service.js` in this folder does.
 */

const toEvent = (e) => {
  const event = normalize(e);
  return {
    ...event,
    start: event.start ? new Date(event.start) : null,
    end: event.end ? new Date(event.end) : null,
  };
};

/**
 * Fetches calendar events for one group within an optional date range.
 * `range` is optional — omit it to let the backend return everything it has
 * for the group (used sparingly; callers should normally pass the visible
 * calendar range so this stays a bounded query, not a full history fetch).
 */
export const getEvents = async (groupId, range, options = {}) => {
  if (!groupId) return [];
  const params = new URLSearchParams();
  if (range?.start) params.set("start", range.start.toISOString());
  if (range?.end) params.set("end", range.end.toISOString());
  params.set("includeAi", options.includeAi !== false ? "true" : "false");
  if (options.scope) params.set("scope", options.scope);
  const qs = params.toString();
  const data = await api.get(`/groups/${groupId}/calendar${qs ? `?${qs}` : ""}`);
  return (data?.events || []).map(toEvent);
};
