import { api, normalize } from "../lib/apiClient";

export const getLatestGroupReport = async (groupId) =>
  normalize(await api.get(`/groups/${groupId}/ai/report`));

export const getGroupPeriodReport = async (groupId, period = "weekly") =>
  normalize(await api.get(`/groups/${groupId}/ai/report/${period}`));

export const getGroupReportHistory = async (groupId) =>
  normalize(await api.get(`/groups/${groupId}/ai/report/history`));

export const getGuideReport = async () => normalize(await api.get("/ai/guide-report"));

export const getExportReportUrl = (groupId, format = "csv") =>
  `/api/groups/${groupId}/ai/report/export?format=${format}`;

