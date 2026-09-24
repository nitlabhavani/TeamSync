export const APP_NAME = "TeamSync AI";

export const ROLES = {
  STUDENT: "student",
  GUIDE: "guide",
};

export const ROUTES = {
  HOME: "/",
  LOGIN: "/login",
  SIGNUP: "/signup",
  FORGOT_PASSWORD: "/forgot-password",
  VERIFY_OTP: "/verify-otp",
  INVITATION: "/invite/:token",
  JOIN: "/join/:token",

  STUDENT_DASHBOARD: "/app/dashboard",
  STUDENT_GROUPS: "/app/groups",
  STUDENT_GROUP_DETAILS: "/app/groups/:groupId",
  STUDENT_PRIVATE_CHAT: "/app/chat/:userId",
  STUDENT_MESSAGES: "/app/messages",
  STUDENT_COMMUNITIES: "/app/messages?tab=communities",
  STUDENT_TASKS: "/app/tasks",
  STUDENT_CALENDAR: "/app/calendar",
  STUDENT_MEETINGS: "/app/meetings",
  STUDENT_PEER_REVIEW: "/app/peer-review",
  STUDENT_PERFORMANCE: "/app/performance",
  STUDENT_NOTIFICATIONS: "/app/notifications",
  STUDENT_PROFILE: "/app/profile",
  STUDENT_SETTINGS: "/app/settings",
  STUDENT_SEARCH: "/app/search",

  GUIDE_DASHBOARD: "/guide/dashboard",
  GUIDE_GROUP_MANAGEMENT: "/guide/groups",
  GUIDE_TEAM_ANALYTICS: "/guide/analytics",
  GUIDE_ANALYTICS: "/guide/analytics",
  GUIDE_PRIVATE_CHAT: "/guide/chat/:userId",
  GUIDE_MESSAGES: "/guide/messages",
  GUIDE_COMMUNITIES: "/guide/messages?tab=communities",
  GUIDE_CALENDAR: "/guide/calendar",
  GUIDE_SUBMISSIONS: "/guide/submissions",
  GUIDE_MEMBER_DETAILS: "/guide/members/:memberId",
  GUIDE_RISK_RADAR: "/guide/risk-radar",
  GUIDE_ALERTS: "/guide/alerts",
  GUIDE_NOTIFICATIONS: "/guide/notifications",
  GUIDE_AI_SUMMARY: "/guide/ai-summary",
  GUIDE_REPORTS: "/guide/reports",
  GUIDE_PROFILE: "/guide/profile",
  GUIDE_SETTINGS: "/guide/settings",
  GUIDE_SEARCH: "/guide/search",
};

export const COLLABORATION_LEVELS = {
  HIGH: { label: "Thriving", color: "mint" },
  MEDIUM: { label: "Steady", color: "amber" },
  LOW: { label: "At risk", color: "coral" },
};

export const MAX_FILE_SIZE_MB = 25;

// PRIVATE VOICE MESSAGES — mirrors backend MAX_VOICE_MB/MAX_VOICE_DURATION_SECONDS
// (see backend/.env.example). Recording auto-stops at this many seconds
// rather than being silently discarded (see useVoiceRecorder.js).
export const MAX_VOICE_RECORDING_SECONDS = 120;
export const MAX_VOICE_FILE_SIZE_MB = 15;

export const ACCEPTED_FILE_TYPES = [
  ".pdf",
  ".doc",
  ".docx",
  ".ppt",
  ".pptx",
  ".xls",
  ".xlsx",
  ".png",
  ".jpg",
  ".jpeg",
  ".zip",
  ".txt",
  ".fig",
];
