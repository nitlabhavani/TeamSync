import { formatRelativeTime } from "../../utils/dateFormatter";
import { MessageCircle, FileUp, Sparkles } from "lucide-react";

const iconFor = (type) => (type === "file" ? FileUp : type === "ai" ? Sparkles : MessageCircle);

const RecentActivity = ({ items = [] }) => {
  return (
    <div className="bg-paper/85 backdrop-blur-md rounded-xl2 border border-slate-line/80 p-5 shadow-panel">
      <p className="text-sm font-medium text-slate-ink mb-4">Recent activity</p>
      {items.length === 0 ? (
        <p className="text-sm text-slate-muted">Nothing new yet — activity will show up here.</p>
      ) : (
        <ul className="space-y-4">
          {items.map((item) => {
            const Icon = iconFor(item.type);
            return (
              <li key={item.id} className="flex items-start gap-3">
                <span className="w-8 h-8 rounded-lg bg-brand-soft flex items-center justify-center shrink-0 mt-0.5">
                  <Icon className="w-4 h-4 text-brand" />
                </span>
                <div className="min-w-0">
                  <p className="text-sm text-slate-ink truncate">{item.title}</p>
                  <p className="text-xs text-slate-muted">{formatRelativeTime(item.time)}</p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};

export default RecentActivity;
