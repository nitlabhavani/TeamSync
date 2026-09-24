import { Sparkles } from "lucide-react";

const ChatSummary = ({ summary, loading }) => (
  <div className="bg-gradient-to-br from-brand to-brand-deep rounded-xl2 p-5 text-white">
    <div className="flex items-center gap-2 mb-3">
      <Sparkles className="w-4 h-4" />
      <p className="text-sm font-semibold">AI chat summary</p>
    </div>
    {loading ? (
      <div className="space-y-2">
        <div className="h-3 bg-white/20 rounded animate-pulse w-full" />
        <div className="h-3 bg-white/20 rounded animate-pulse w-5/6" />
        <div className="h-3 bg-white/20 rounded animate-pulse w-2/3" />
      </div>
    ) : (
      <p className="text-sm text-white/90 leading-relaxed">{summary}</p>
    )}
  </div>
);

export default ChatSummary;
