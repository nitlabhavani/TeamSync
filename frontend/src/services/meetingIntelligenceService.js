import { api, normalize } from "../lib/apiClient";

/**
 * STEP 26 — AI Meeting Intelligence.
 * Separate from services/meetingService.js (Step 16's per-meeting
 * notes/summary/convert-actions flow, untouched) — calls only the new,
 * additive endpoints in backend/src/controllers/meetingIntelligenceController.js.
 *
 * Matches the ACTUAL Part 1 response shape (see STEP26_PART1_REPORT.md /
 * meetingIntelligenceService.js) — not the shape sketched in the original
 * spec prompt.
 */

/**
 * Runs one analysis. `opts`:
 *   - meetingId?: string — analyze an existing saved Meeting (Step 16)
 *   - startTime?, endTime?: ISO strings — explicit window (overrides meetingId's default window)
 *   - persist?: boolean — defaults true (saves a MeetingIntelligenceSnapshot); false = preview-only, not saved
 */
export const analyzeMeeting = async (groupId, opts = {}) =>
  normalize(await api.post(`/groups/${groupId}/meeting-intelligence/analyze`, opts));

/** Recent analysis history for this group (guide/team-leader only). */
export const getMeetingIntelligenceHistory = async (groupId) =>
  normalize(await api.get(`/groups/${groupId}/meeting-intelligence`));

/** A single saved analysis by id. */
export const getMeetingIntelligenceById = async (groupId, id) =>
  normalize(await api.get(`/groups/${groupId}/meeting-intelligence/${id}`));
