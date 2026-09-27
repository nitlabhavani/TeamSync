import { AlertTriangle, Info, AlertCircle } from "lucide-react";
import { classNames } from "../../utils/helperFunctions";
import { formatRelativeTime } from "../../utils/dateFormatter";

const severityConfig = {
  high: {
    border: "border-coral/30 hover:border-coral/60",
    bg: "bg-coral/10 dark:bg-coral/15",
    topBar: "bg-coral",
    icon: AlertTriangle,
    iconColor: "text-coral",
    badge: "bg-coral/20 text-coral",
    badgeLabel: "High Priority",
  },
  medium: {
    border: "border-amber/30 hover:border-amber/60",
    bg: "bg-amber/10 dark:bg-amber/15",
    topBar: "bg-amber",
    icon: AlertCircle,
    iconColor: "text-amber",
    badge: "bg-amber/20 text-amber",
    badgeLabel: "Medium",
  },
  low: {
    border: "border-mint/30 hover:border-mint/60",
    bg: "bg-mint/10 dark:bg-mint/15",
    topBar: "bg-mint",
    icon: Info,
    iconColor: "text-mint",
    badge: "bg-mint/20 text-mint",
    badgeLabel: "Notice",
  },
};

const AlertCard = ({ severity = "medium", message, time, groupName }) => {
  const cfg = severityConfig[severity] || severityConfig.medium;
  const Icon = cfg.icon;

  return (
    <div
      className={classNames(
        "group relative overflow-hidden rounded-xl border p-4 shadow-sm backdrop-blur-md transition-all duration-300 hover:shadow-md",
        cfg.border,
        cfg.bg
      )}
    >
      <div className={classNames("absolute top-0 left-0 bottom-0 w-1", cfg.topBar)} />
      <div className="flex items-start gap-3 pl-1">
        <Icon className={classNames("w-4.5 h-4.5 mt-0.5 shrink-0", cfg.iconColor)} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2 mb-1">
            {groupName && <span className="text-xs font-bold text-slate-ink truncate">{groupName}</span>}
            <span className={classNames("text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full shrink-0", cfg.badge)}>
              {cfg.badgeLabel}
            </span>
          </div>
          <p className="text-sm font-medium text-slate-ink leading-snug">{message}</p>
          <p className="text-[11px] text-slate-muted mt-1.5">{formatRelativeTime(time)}</p>
        </div>
      </div>
    </div>
  );
};

export default AlertCard;
