import { NavLink } from "@/lib/router-compat";
import {
  LayoutDashboard,
  Users,
  LineChart,
  Bell,
  UserCircle,
  Settings,
  Sparkles,
  AlertTriangle,
  FileBarChart,
  MessagesSquare,
  KanbanSquare,
  CalendarClock,
  CalendarDays,
  Award,
  Radar,
  Sprout,
  Search,
  FileCheck2,
  ChevronsLeft,
  ChevronsRight,
  X,
  LogOut,
  Network,
} from "lucide-react";
import { ROUTES } from "../../utils/constants";
import { useAuth } from "../../hooks/useAuth";
import { useNotifications } from "../../hooks/useNotifications";
import { useSidebar } from "../../context/SidebarContext";
import { getInitials } from "../../utils/helperFunctions";
import { useNavigate } from "@/lib/router-compat";

/**
 * Nav is grouped into short sections so it reads like a real project-management
 * product (Workspace / Insights / Account) instead of one flat list.
 * Routes are the existing ROUTES constants — nothing here is invented.
 */
const studentSections = [
  {
    label: "Workspace",
    links: [
      { to: ROUTES.STUDENT_DASHBOARD, icon: LayoutDashboard, label: "Dashboard" },
      { to: ROUTES.STUDENT_GROUPS, icon: Users, label: "Groups" },
      { to: ROUTES.STUDENT_MESSAGES, icon: MessagesSquare, label: "Messages" },
      { to: ROUTES.STUDENT_TASKS, icon: KanbanSquare, label: "Tasks" },
      { to: ROUTES.STUDENT_CALENDAR, icon: CalendarDays, label: "Calendar" },
      { to: ROUTES.STUDENT_MEETINGS, icon: CalendarClock, label: "Meetings" },
    ],
  },
  {
    label: "Insights",
    links: [
      { to: ROUTES.STUDENT_SEARCH, icon: Search, label: "Learning Search" },
      { to: ROUTES.STUDENT_PEER_REVIEW, icon: Award, label: "Peer review" },
      { to: ROUTES.STUDENT_PERFORMANCE, icon: LineChart, label: "Performance" },
      { to: ROUTES.STUDENT_NOTIFICATIONS, icon: Bell, label: "Notifications" },
    ],
  },
  {
    label: "Account",
    links: [
      { to: ROUTES.STUDENT_PROFILE, icon: UserCircle, label: "Profile" },
      { to: ROUTES.STUDENT_SETTINGS, icon: Settings, label: "Settings" },
    ],
  },
];

const guideSections = [
  {
    label: "Workspace",
    links: [
      { to: ROUTES.GUIDE_DASHBOARD, icon: LayoutDashboard, label: "Overview" },
      { to: ROUTES.GUIDE_GROUP_MANAGEMENT, icon: Users, label: "Groups" },
      { to: ROUTES.GUIDE_MESSAGES, icon: MessagesSquare, label: "Messages" },
      { to: ROUTES.GUIDE_CALENDAR, icon: CalendarDays, label: "Calendar" },
      { to: ROUTES.GUIDE_SUBMISSIONS, icon: FileCheck2, label: "Submissions" },
    ],
  },
  {
    label: "Insights",
    links: [
      { to: ROUTES.GUIDE_SEARCH, icon: Search, label: "Learning Search" },
      { to: ROUTES.GUIDE_TEAM_ANALYTICS, icon: LineChart, label: "Analytics" },
      { to: ROUTES.GUIDE_AI_SUMMARY, icon: Sparkles, label: "AI summary" },
      { to: ROUTES.GUIDE_RISK_RADAR, icon: Radar, label: "Risk radar" },
      { to: ROUTES.GUIDE_ALERTS, icon: AlertTriangle, label: "Alerts" },
      { to: ROUTES.GUIDE_REPORTS, icon: FileBarChart, label: "Reports" },
    ],
  },
  {
    label: "Account",
    links: [
      { to: ROUTES.GUIDE_PROFILE, icon: UserCircle, label: "Profile" },
      { to: ROUTES.GUIDE_SETTINGS, icon: Settings, label: "Settings" },
    ],
  },
];

const NavItem = ({ to, icon: Icon, label, collapsed, onNavigate }) => (
  <NavLink
    to={to}
    onClick={onNavigate}
    title={collapsed ? label : undefined}
    className={({ isActive }) =>
      `group relative flex items-center rounded-lg transition-colors ${
        collapsed ? "w-11 h-11 justify-center mx-auto" : "gap-3 px-3 py-2.5"
      } ${isActive ? "bg-brand text-white shadow-sm" : "text-white/60 hover:text-white hover:bg-white/10"}`
    }
  >
    <Icon className="w-[18px] h-[18px] shrink-0" strokeWidth={2} />
    {!collapsed && <span className="text-sm font-medium truncate">{label}</span>}
    {collapsed && (
      <span className="pointer-events-none absolute left-full ml-3 whitespace-nowrap rounded-md bg-slate-ink px-2.5 py-1.5 text-xs font-medium text-white opacity-0 group-hover:opacity-100 transition-opacity z-50 shadow-panel">
        {label}
      </span>
    )}
  </NavLink>
);

const SidebarContent = ({ role, collapsed, onNavigate, showCollapseToggle }) => {
  const sections = role === "guide" ? guideSections : studentSections;
  const { user, logout } = useAuth();
  const { unreadCount } = useNotifications();
  const navigate = useNavigate();
  const { toggleCollapsed } = useSidebar();

  return (
    <>
      <div className={`flex items-center mb-6 ${collapsed ? "justify-center" : "justify-between px-1"}`}>
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="w-9 h-9 shrink-0 rounded-xl2 bg-brand flex items-center justify-center shadow-pop">
            <Sprout className="w-4.5 h-4.5 text-white" strokeWidth={2.5} />
          </span>
          {!collapsed && (
            <span className="font-display text-sm font-semibold text-white truncate">TeamSync AI</span>
          )}
        </div>
        {showCollapseToggle && !collapsed && (
          <button
            onClick={toggleCollapsed}
            className="hidden md:flex w-7 h-7 items-center justify-center rounded-md text-white/40 hover:text-white hover:bg-white/10 transition-colors"
            aria-label="Collapse sidebar"
            title="Collapse sidebar"
          >
            <ChevronsLeft className="w-4 h-4" />
          </button>
        )}
      </div>

      {showCollapseToggle && collapsed && (
        <button
          onClick={toggleCollapsed}
          className="hidden md:flex w-8 h-8 mx-auto mb-4 items-center justify-center rounded-md text-white/40 hover:text-white hover:bg-white/10 transition-colors"
          aria-label="Expand sidebar"
          title="Expand sidebar"
        >
          <ChevronsRight className="w-4 h-4" />
        </button>
      )}

      <nav className="flex-1 flex flex-col gap-5 overflow-y-auto scrollbar-thin">
        {sections.map((section) => (
          <div key={section.label}>
            {!collapsed && (
              <p className="px-3 mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-white/30">
                {section.label}
              </p>
            )}
            <div className="flex flex-col gap-1">
              {section.links.map((link) => (
                <div key={link.to} className="relative">
                  <NavItem {...link} collapsed={collapsed} onNavigate={onNavigate} />
                  {link.label === "Notifications" && unreadCount > 0 && (
                    <span
                      className={`pointer-events-none absolute min-w-[16px] h-4 px-1 rounded-full bg-coral text-white text-[10px] font-semibold leading-4 text-center ${
                        collapsed ? "top-0.5 right-1" : "top-1/2 -translate-y-1/2 right-3"
                      }`}
                      aria-hidden="true"
                    >
                      {unreadCount > 99 ? "99+" : unreadCount}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </nav>

      <div className={`pt-3 mt-2 border-t border-white/10 ${collapsed ? "flex justify-center" : ""}`}>
        {collapsed ? (
          <button
            onClick={() => navigate(role === "guide" ? ROUTES.GUIDE_PROFILE : ROUTES.STUDENT_PROFILE)}
            title={user?.name || "Account"}
            className="w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-semibold"
            style={{ backgroundColor: user?.color || "#5B5FEF" }}
          >
            {getInitials(user?.name || "You")}
          </button>
        ) : (
          <div className="flex items-center gap-2.5 px-1">
            <button
              onClick={() => navigate(role === "guide" ? ROUTES.GUIDE_PROFILE : ROUTES.STUDENT_PROFILE)}
              className="flex items-center gap-2.5 min-w-0 flex-1 rounded-lg p-1.5 -m-1.5 hover:bg-white/10 transition-colors"
            >
              <span
                className="w-8 h-8 shrink-0 rounded-full flex items-center justify-center text-white text-xs font-semibold"
                style={{ backgroundColor: user?.color || "#5B5FEF" }}
              >
                {getInitials(user?.name || "You")}
              </span>
              <span className="min-w-0 text-left">
                <span className="block text-sm font-medium text-white truncate">{user?.name || "You"}</span>
                <span className="block text-[11px] text-white/40 capitalize truncate">{role}</span>
              </span>
            </button>
            <button
              onClick={async () => {
                await logout();
                navigate(ROUTES.LOGIN);
              }}
              className="w-8 h-8 shrink-0 rounded-lg flex items-center justify-center text-white/40 hover:text-coral hover:bg-white/10 transition-colors"
              aria-label="Log out"
              title="Log out"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    </>
  );
};

const Sidebar = ({ role = "student" }) => {
  const { collapsed, mobileOpen, closeMobile } = useSidebar();

  return (
    <>
      {/* Desktop / tablet sidebar */}
      <aside
        className={`hidden md:flex flex-col shrink-0 bg-ink h-screen sticky top-0 py-5 px-3 transition-[width] duration-200 ${
          collapsed ? "w-[76px]" : "w-64"
        }`}
      >
        <SidebarContent role={role} collapsed={collapsed} showCollapseToggle />
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex">
          <button
            className="absolute inset-0 bg-black/40 animate-popIn"
            aria-label="Close navigation"
            onClick={closeMobile}
          />
          <aside className="relative z-10 flex flex-col w-72 max-w-[80vw] h-full bg-ink py-5 px-3 shadow-panel">
            <button
              onClick={closeMobile}
              className="absolute top-4 right-3 w-8 h-8 flex items-center justify-center rounded-md text-white/50 hover:text-white hover:bg-white/10"
              aria-label="Close navigation"
            >
              <X className="w-4 h-4" />
            </button>
            <SidebarContent role={role} collapsed={false} onNavigate={closeMobile} showCollapseToggle={false} />
          </aside>
        </div>
      )}
    </>
  );
};

export default Sidebar;
