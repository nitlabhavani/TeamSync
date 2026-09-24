import { api, normalize, idOf } from "../lib/apiClient";

const toMeeting = (m) => {
  const meeting = normalize(m);
  return {
    ...meeting,
    meetingLink: meeting.meetingLink || meeting.link || null,
    attendeeIds: (meeting.attendees || []).map(idOf).filter(Boolean),
    agenda: meeting.agenda || [],
    notes: meeting.notes || "",
  };
};

export const getMeetings = async (groupId) =>
  (await api.get(`/groups/${groupId}/meetings`)).map(toMeeting);

export const scheduleMeeting = async (groupId, meeting) => {
  const { attendeeIds, ...rest } = meeting || {};
  return toMeeting(
    await api.post(`/groups/${groupId}/meetings`, {
      durationMins: 30,
      agenda: [],
      ...rest,
      ...(attendeeIds ? { attendees: attendeeIds } : {}),
    }),
  );
};

export const updateMeeting = async (groupId, meetingId, patch) =>
  toMeeting(await api.patch(`/groups/${groupId}/meetings/${meetingId}`, patch));

export const saveNotes = async (groupId, meetingId, notes) =>
  updateMeeting(groupId, meetingId, { notes, status: "completed" });

export const deleteMeeting = async (groupId, meetingId) =>
  api.del(`/groups/${groupId}/meetings/${meetingId}`);

/** AI smart notes — generated on the backend from the saved meeting notes. */
export const summarizeMeeting = async (meeting, groupId) => {
  const gid = groupId || meeting.groupId || idOf(meeting.group);
  const data = await api.post(`/groups/${gid}/meetings/${meeting.id}/summary`, {});
  const summary = data.summary || data;
  return {
    summary: summary.summary || "",
    decisions: summary.decisions || [],
    actions: summary.actions || summary.actionItems || [],
    risks: summary.risks || [],
  };
};

export const convertActionItems = async (groupId, meetingId) =>
  normalize(await api.post(`/groups/${groupId}/meetings/${meetingId}/convert-actions`, {}));

/**
 * STEP 16 — Feature 1: ad-hoc meeting-notes action-item extraction. Does not
 * require (or create) a saved Meeting — for pasting raw notes/transcript
 * text and getting structured action items back immediately.
 */
export const extractActionItems = async (groupId, notes) =>
  normalize(await api.post(`/groups/${groupId}/meeting-action-items`, { notes }));
