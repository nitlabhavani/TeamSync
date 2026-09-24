const TypingIndicator = ({ name }) => (
  <div className="flex items-center gap-2 mb-3 pl-9">
    <div className="bg-paper border border-slate-line rounded-2xl rounded-bl-sm px-3.5 py-3 flex items-center gap-1">
      <span className="w-1.5 h-1.5 rounded-full bg-slate-muted animate-typingDot" style={{ animationDelay: "0ms" }} />
      <span className="w-1.5 h-1.5 rounded-full bg-slate-muted animate-typingDot" style={{ animationDelay: "150ms" }} />
      <span className="w-1.5 h-1.5 rounded-full bg-slate-muted animate-typingDot" style={{ animationDelay: "300ms" }} />
    </div>
    {name && <span className="text-xs text-slate-muted">{name} is typing</span>}
  </div>
);

export default TypingIndicator;
