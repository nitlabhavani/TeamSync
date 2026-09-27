import { useState } from "react";
import { Bell, ChevronDown, LogOut, Menu, Search, Settings, UserCircle } from "lucide-react";
import { useAuth } from "../../hooks/useAuth";
import { useNotifications } from "../../hooks/useNotifications";
import { getInitials } from "../../utils/helperFunctions";
import { useNavigate } from "@/lib/router-compat";
import { ROUTES } from "../../utils/constants";
import { useSidebar } from "../../context/SidebarContext";

const Navbar = ({ title, subtitle, onSearch, showSearch = false }) => {
  const { user, logout } = useAuth();
  const { unreadCount } = useNotifications();
  const [menuOpen, setMenuOpen] = useState(false);
  const navigate = useNavigate();
  const { openMobile } = useSidebar();

  return (
    <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-slate-line/80 bg-paper/85 backdrop-blur-md px-4 py-3.5 md:px-8 md:gap-4 shadow-xs">
      <button
        onClick={openMobile}
        className="md:hidden shrink-0 w-9 h-9 rounded-lg hover:bg-cloud flex items-center justify-center transition-colors"
        aria-label="Open navigation menu"
      >
        <Menu className="w-5 h-5 text-slate-ink" />
      </button>

      <div className="flex-1 min-w-0">
        <h1 className="font-display text-lg font-semibold text-slate-ink truncate">{title}</h1>
        {subtitle && <p className="text-xs text-slate-muted mt-0.5 truncate">{subtitle}</p>}
      </div>

      {showSearch && (
        <div className="hidden sm:flex items-center gap-2 bg-cloud rounded-full px-3.5 py-2 w-64">
          <Search className="w-4 h-4 text-slate-muted" />
          <input
            onChange={(e) => onSearch?.(e.target.value)}
            placeholder="Search people, groups…"
            className="bg-transparent text-sm outline-none flex-1 placeholder:text-slate-muted"
          />
        </div>
      )}

      <button
        onClick={() => navigate(user?.role === "guide" ? ROUTES.GUIDE_NOTIFICATIONS : ROUTES.STUDENT_NOTIFICATIONS)}
        className="relative w-10 h-10 rounded-full hover:bg-cloud flex items-center justify-center transition-colors"
        aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications"}
      >
        <Bell className="w-5 h-5 text-slate-ink" />
        {unreadCount > 0 && (
          <span
            className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-coral text-white text-[10px] font-semibold leading-4 text-center"
            aria-hidden="true"
          >
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      <div className="relative">
        <button
          onClick={() => setMenuOpen((v) => !v)}
          className="flex items-center gap-2 pl-1 pr-2 py-1 rounded-full hover:bg-cloud transition-colors"
        >
          <span
            className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-semibold"
            style={{ backgroundColor: user?.color || "#5B5FEF" }}
          >
            {getInitials(user?.name || "You")}
          </span>
          <ChevronDown className="w-4 h-4 text-slate-muted hidden sm:block" />
        </button>

        {menuOpen && (
          <div className="absolute right-0 mt-2 w-52 bg-paper rounded-xl shadow-panel border border-slate-line py-1.5 animate-popIn">
            <div className="px-3.5 py-2 border-b border-slate-line">
              <p className="text-sm font-medium text-slate-ink truncate">{user?.name}</p>
              <p className="text-xs text-slate-muted truncate">{user?.email}</p>
            </div>
            <button
              onClick={() => {
                setMenuOpen(false);
                navigate(user?.role === "guide" ? ROUTES.GUIDE_PROFILE : ROUTES.STUDENT_PROFILE);
              }}
              className="w-full flex items-center gap-2 px-3.5 py-2 text-sm text-slate-ink hover:bg-cloud"
            >
              <UserCircle className="w-4 h-4" /> Profile
            </button>
            <button
              onClick={() => {
                setMenuOpen(false);
                navigate(user?.role === "guide" ? ROUTES.GUIDE_SETTINGS : ROUTES.STUDENT_SETTINGS);
              }}
              className="w-full flex items-center gap-2 px-3.5 py-2 text-sm text-slate-ink hover:bg-cloud"
            >
              <Settings className="w-4 h-4" /> Settings
            </button>
            <button
              onClick={async () => {
                await logout();
                navigate(ROUTES.LOGIN);
              }}
              className="w-full flex items-center gap-2 px-3.5 py-2 text-sm text-coral hover:bg-coral-soft"
            >
              <LogOut className="w-4 h-4" /> Log out
            </button>
          </div>
        )}
      </div>
    </header>
  );
};

export default Navbar;
