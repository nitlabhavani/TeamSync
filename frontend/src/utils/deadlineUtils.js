/**
 * Shared deadline countdown and status utility.
 *
 * Provides human-readable, calendar-day accurate countdown strings
 * used across Calendar and Tasks views:
 *   - "3 days left", "2 days left", "1 day left"
 *   - "Due today"
 *   - "Overdue by 1 day", "Overdue by 3 days"
 *
 * Gracefully handles missing, null, or invalid dates without throwing.
 */

export function getDeadlineStatus(dueDate, referenceDate = new Date()) {
  if (!dueDate) {
    return {
      status: "none",
      label: "",
      days: null,
      tone: "bg-cloud text-slate-muted",
      accent: "before:bg-slate-line",
    };
  }

  const d = new Date(dueDate);
  if (Number.isNaN(d.getTime())) {
    return {
      status: "none",
      label: "",
      days: null,
      tone: "bg-cloud text-slate-muted",
      accent: "before:bg-slate-line",
    };
  }

  const ref = new Date(referenceDate);
  // Normalize both dates to midnight in local time so we measure full calendar days
  const dueMidnight = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const refMidnight = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate()).getTime();

  const diffDays = Math.round((dueMidnight - refMidnight) / 86400000);

  if (diffDays < 0) {
    const overdueDays = Math.abs(diffDays);
    const label = overdueDays === 1 ? "Overdue by 1 day" : `Overdue by ${overdueDays} days`;
    return {
      status: "overdue",
      label,
      days: diffDays,
      tone: "bg-coral-soft text-coral",
      accent: "before:bg-coral",
    };
  }

  if (diffDays === 0) {
    return {
      status: "today",
      label: "Due today",
      days: 0,
      tone: "bg-amber-soft text-amber",
      accent: "before:bg-amber",
    };
  }

  const label = diffDays === 1 ? "1 day left" : `${diffDays} days left`;
  const tone = diffDays <= 2 ? "bg-amber-soft text-amber" : "bg-cloud text-slate-muted";
  const accent = diffDays <= 2 ? "before:bg-amber" : "before:bg-slate-line";
  return {
    status: "upcoming",
    label,
    days: diffDays,
    tone,
    accent,
  };
}

export function getDeadlineCountdown(dueDate, referenceDate = new Date()) {
  return getDeadlineStatus(dueDate, referenceDate).label;
}
