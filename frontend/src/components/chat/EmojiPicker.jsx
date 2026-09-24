import { useState, useRef, useEffect } from "react";
import { Search, X } from "lucide-react";

const EMOJI_CATEGORIES = [
  {
    name: "Smileys",
    icon: "😀",
    emojis: [
      "😀", "😃", "😄", "😁", "😆", "😅", "🤣", "😂", "🙂", "🙃",
      "😉", "😊", "😇", "🥰", "😍", "🤩", "😘", "😗", "😚", "😋",
      "😛", "😜", "🤪", "😝", "🤗", "🤭", "🤫", "🤔", "🤐", "🤨",
      "😐", "😑", "😶", "😏", "😒", "🙄", "😬", "🤥", "😌", "😔",
      "😪", "🤤", "😴", "😷", "🤒", "🤕", "🤢", "🤮", "🤧", "🥵",
      "🥶", "🥴", "😵", "🤯", "🤠", "🥳", "😎", "🤓", "🧐", "😕",
      "😟", "🙁", "😮", "😯", "😲", "😳", "🥺", "😦", "😧", "😨",
      "😰", "😥", "😢", "😭", "😱", "😖", "😣", "😞", "😓", "😩",
    ],
  },
  {
    name: "Gestures",
    icon: "👍",
    emojis: [
      "👍", "👎", "👌", "🤌", "✌️", "🤞", "🤟", "🤘", "🤙", "👈",
      "👉", "👆", "👇", "☝️", "👋", "🤚", "🖐️", "✋", "🖖", "👏",
      "🙌", "👐", "🤲", "🤝", "🙏", "✍️", "💪", "👊", "✊", "🤛",
      "🤜", "🦾", "🦿", "🦵", "🦶", "👂", "👃", "🧠", "👀", "👁️",
    ],
  },
  {
    name: "Hearts & Ideas",
    icon: "❤️",
    emojis: [
      "❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "🤍", "🤎", "💔",
      "❣️", "💕", "💞", "💓", "💗", "💖", "💘", "💝", "🔥", "⭐",
      "🌟", "✨", "💡", "💯", "🎉", "🎊", "🚀", "🏆", "🎯", "✅",
      "❌", "⚠️", "❗", "❓", "💬", "💭", "🔔", "📢", "📌", "📍",
    ],
  },
  {
    name: "Work & Tech",
    icon: "💻",
    emojis: [
      "💻", "📱", "🖥️", "⌨️", "🖱️", "💾", "💿", "📁", "📂", "📄",
      "📋", "📊", "📈", "📉", "📅", "📆", "🗓️", "📇", "✉️", "📧",
      "📦", "🏷️", "📎", "📌", "✏️", "📝", "🔒", "🔓", "🔑", "⚙️",
      "🛠️", "🔧", "🔨", "🧪", "🔬", "🔭", "📡", "⏰", "⏱️", "⏳",
    ],
  },
];

const EmojiPicker = ({ onSelect, onClose }) => {
  const [activeCategory, setActiveCategory] = useState(0);
  const [searchTerm, setSearchTerm] = useState("");
  const pickerRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target)) {
        onClose?.();
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [onClose]);

  const filteredEmojis = searchTerm.trim()
    ? EMOJI_CATEGORIES.flatMap((cat) => cat.emojis).filter((emoji) => emoji.includes(searchTerm.trim()))
    : null;

  return (
    <div
      ref={pickerRef}
      className="absolute bottom-full mb-2 left-0 z-50 w-72 sm:w-80 rounded-2xl border border-slate-line bg-paper shadow-xl p-3 animate-in fade-in zoom-in-95 duration-100"
    >
      {/* Header with Search and Close */}
      <div className="flex items-center gap-2 mb-2 pb-2 border-b border-slate-line">
        <div className="flex-1 flex items-center gap-1.5 bg-cloud rounded-lg px-2.5 py-1 text-xs text-slate-muted">
          <Search className="w-3.5 h-3.5 shrink-0" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search emoji..."
            className="bg-transparent text-slate-ink outline-none w-full text-xs"
            autoFocus
          />
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-1 text-slate-muted hover:text-slate-ink rounded-md hover:bg-cloud transition-colors"
          aria-label="Close emoji picker"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Category Tabs */}
      {!searchTerm && (
        <div className="flex items-center justify-around mb-2 pb-1 border-b border-slate-line/60">
          {EMOJI_CATEGORIES.map((cat, idx) => (
            <button
              key={cat.name}
              type="button"
              onClick={() => setActiveCategory(idx)}
              className={`text-base p-1 rounded-lg transition-colors ${
                activeCategory === idx ? "bg-brand-soft/80 scale-110" : "hover:bg-cloud opacity-70 hover:opacity-100"
              }`}
              title={cat.name}
            >
              {cat.icon}
            </button>
          ))}
        </div>
      )}

      {/* Emoji Grid */}
      <div className="max-h-48 overflow-y-auto grid grid-cols-7 sm:grid-cols-8 gap-1 p-1">
        {(filteredEmojis || EMOJI_CATEGORIES[activeCategory].emojis).map((emoji, i) => (
          <button
            key={`${emoji}-${i}`}
            type="button"
            onClick={() => {
              onSelect(emoji);
            }}
            className="h-8 w-8 text-xl flex items-center justify-center rounded-lg hover:bg-cloud hover:scale-120 transition-all focus:outline-none focus:ring-1 focus:ring-brand"
          >
            {emoji}
          </button>
        ))}
      </div>
    </div>
  );
};

export default EmojiPicker;
