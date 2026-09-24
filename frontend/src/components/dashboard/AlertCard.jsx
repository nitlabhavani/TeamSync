import { AlertTriangle } from "lucide-react";
import { classNames } from "../../utils/helperFunctions";
import { formatRelativeTime } from "../../utils/dateFormatter";

const severityStyle = {
  high: "risk-row high bg-coral-soft/60",
  medium: "risk-row medium bg-amber-soft/60",
  low: "risk-row low bg-mint-soft/60",
};

const AlertCard = ({ severity = "medium", message, time, groupName }) => (
  <div className={classNames("rounded-lg p-3.5 flex items-start gap-3", severityStyle[severity])}>
    <AlertTriangle
      className={classNames(
        "w-4 h-4 mt-0.5 shrink-0",
        severity === "high" ? "text-coral" : severity === "medium" ? "text-amber" : "text-mint"
      )}
    />
    <div className="min-w-0">
      <p className="text-sm text-slate-ink">{message}</p>
      <p className="text-xs text-slate-muted mt-1">
        {groupName && <span className="font-medium">{groupName}</span>}
        {groupName && " · "}
        {formatRelativeTime(time)}
      </p>
    </div>
  </div>
);

export default AlertCard;
