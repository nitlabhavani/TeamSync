import { getRiskRadar } from "./riskService";

const SEVERITY = { high: "high", medium: "medium", low: "low" };

/**
 * Guide alerts are derived from the backend risk radar rather than mock data.
 */
export const getGuideAlerts = async () => {
  const rows = await getRiskRadar();
  const alerts = [];
  rows.forEach((row) => {
    (row.drivers.length ? row.drivers : ["No risk signals detected"]).forEach((driver, i) => {
      alerts.push({
        id: `${row.groupId}_${i}`,
        groupId: row.groupId,
        groupName: row.name,
        severity: SEVERITY[row.level] || "low",
        message: `${row.name}: ${driver}`,
        time: new Date().toISOString(),
      });
    });
  });
  return alerts;
};
