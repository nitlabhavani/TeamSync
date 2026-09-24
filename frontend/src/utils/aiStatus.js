/**
 * STEP 4 — shared presentation helpers for Step 3 AI status/severity
 * strings. Purely cosmetic (Tailwind class lookups); never invents or
 * changes the underlying AI value, just maps it to a badge style.
 */

export const STATUS_STYLES = {
  ON_TRACK: "bg-mint-soft text-mint",
  ok: "bg-mint-soft text-mint",
  excellent: "bg-mint-soft text-mint",
  good: "bg-mint-soft text-mint",
  AT_RISK: "bg-amber-soft text-amber",
  needs_attention: "bg-amber-soft text-amber",
  BEHIND: "bg-coral-soft text-coral",
  at_risk: "bg-coral-soft text-coral",
  INSUFFICIENT_DATA: "bg-cloud text-slate-muted",
  insufficient_data: "bg-cloud text-slate-muted",
};

export const STATUS_LABELS = {
  ON_TRACK: "On track",
  AT_RISK: "At risk",
  BEHIND: "Behind",
  INSUFFICIENT_DATA: "Insufficient data",
  ok: "OK",
  excellent: "Excellent",
  good: "Good",
  needs_attention: "Needs attention",
  at_risk: "At risk",
  insufficient_data: "Insufficient data",
};

export const statusStyle = (status) => STATUS_STYLES[status] || "bg-cloud text-slate-muted";
export const statusLabel = (status) => STATUS_LABELS[status] || status || "Unknown";

export const SEVERITY_STYLES = {
  high: "bg-coral-soft text-coral",
  medium: "bg-amber-soft text-amber",
  low: "bg-mint-soft text-mint",
};

export const severityStyle = (severity) => SEVERITY_STYLES[severity] || "bg-cloud text-slate-muted";

export const SEVERITY_ICON_STYLES = {
  high: "text-coral",
  medium: "text-amber",
  low: "text-mint",
};

export const severityIconStyle = (severity) => SEVERITY_ICON_STYLES[severity] || "text-slate-muted";

export const confidenceLabel = (confidence) =>
  confidence ? confidence.charAt(0).toUpperCase() + confidence.slice(1) : "Unknown";
