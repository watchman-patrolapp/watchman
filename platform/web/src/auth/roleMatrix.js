import { canAccessPlatformConsole } from "./platformRoles";

const ROLE_ALIASES = {
  patrol: "patroller",
  technicalsupport: "technical_support",
  tech_support: "technical_support",
  techsupport: "technical_support",
  user: "resident",
};

export function normalizeAppRole(role) {
  if (role == null || String(role).trim() === "") return "";
  let r = String(role).trim().toLowerCase();
  r = r.replace(/\s+/g, "_").replace(/-/g, "_");
  return ROLE_ALIASES[r] || r;
}

export const ROLE_MATRIX = {
  resident: {
    adminPanel: false,
    patrolSchedule: false,
    patrolStartStop: false,
    intelligenceView: false,
    intelligenceModerate: false,
    hotspotManage: false,
    incidentReport: true,
    incidentModerate: false,
    feedbackReview: false,
  },
  volunteer: {
    adminPanel: false,
    patrolSchedule: true,
    patrolStartStop: true,
    intelligenceView: true,
    intelligenceModerate: false,
    hotspotManage: false,
    incidentReport: true,
    incidentModerate: false,
    feedbackReview: false,
  },
  patroller: {
    adminPanel: false,
    patrolSchedule: true,
    patrolStartStop: true,
    intelligenceView: true,
    intelligenceModerate: false,
    hotspotManage: false,
    incidentReport: true,
    incidentModerate: false,
    feedbackReview: false,
  },
  investigator: {
    adminPanel: false,
    patrolSchedule: true,
    patrolStartStop: true,
    intelligenceView: true,
    intelligenceModerate: true,
    hotspotManage: false,
    incidentReport: true,
    incidentModerate: false,
    feedbackReview: false,
  },
  committee: {
    adminPanel: true,
    patrolSchedule: true,
    patrolStartStop: true,
    intelligenceView: true,
    intelligenceModerate: true,
    hotspotManage: true,
    incidentReport: true,
    incidentModerate: true,
    feedbackReview: false,
  },
  nw_admin: {
    adminPanel: true,
    patrolSchedule: true,
    patrolStartStop: true,
    intelligenceView: true,
    intelligenceModerate: true,
    hotspotManage: true,
    incidentReport: true,
    incidentModerate: true,
    feedbackReview: false,
  },
  admin: {
    adminPanel: true,
    patrolSchedule: true,
    patrolStartStop: true,
    intelligenceView: true,
    intelligenceModerate: true,
    hotspotManage: true,
    incidentReport: true,
    incidentModerate: true,
    feedbackReview: false,
  },
  technical_support: {
    adminPanel: true,
    patrolSchedule: true,
    patrolStartStop: true,
    intelligenceView: true,
    intelligenceModerate: true,
    hotspotManage: true,
    incidentReport: true,
    incidentModerate: true,
    feedbackReview: true,
  },
  security_admin: {
    adminPanel: true,
    patrolSchedule: false,
    patrolStartStop: false,
    intelligenceView: true,
    intelligenceModerate: false,
    hotspotManage: true,
    incidentReport: true,
    incidentModerate: false,
    feedbackReview: false,
  },
  city_admin: {
    adminPanel: true,
    patrolSchedule: false,
    patrolStartStop: false,
    intelligenceView: true,
    intelligenceModerate: true,
    hotspotManage: true,
    incidentReport: true,
    incidentModerate: true,
    feedbackReview: false,
  },
};

function roleConfig(role) {
  const normalized = normalizeAppRole(role);
  return ROLE_MATRIX[normalized] || null;
}

export function canAccessAdminPanel(role) {
  return Boolean(roleConfig(role)?.adminPanel);
}

export function canAccessPatrolSchedule(role) {
  return Boolean(roleConfig(role)?.patrolSchedule);
}

export function canAccessSosBoard(role) {
  return Boolean(roleConfig(role));
}

export const SOS_HISTORY_MANAGER_ROLES = ["admin", "technical_support", "nw_admin"];

export function canDeleteSosHistory(role) {
  return SOS_HISTORY_MANAGER_ROLES.includes(normalizeAppRole(role));
}

export const SOS_BOARD_ROLES = Object.keys(ROLE_MATRIX);

export function canStartOrEndPatrol(role) {
  return Boolean(roleConfig(role)?.patrolStartStop);
}

export function canViewIntelligence(role) {
  return Boolean(roleConfig(role)?.intelligenceView);
}

export function canModerateIntelligence(role) {
  return Boolean(roleConfig(role)?.intelligenceModerate);
}

export function canReportIncident(role) {
  return Boolean(roleConfig(role)?.incidentReport);
}

export function canStaffManageIncidents(role) {
  return Boolean(roleConfig(role)?.incidentModerate);
}

export function canManageHotspots(role) {
  return Boolean(roleConfig(role)?.hotspotManage);
}

export function canReviewFeedback(role) {
  return Boolean(roleConfig(role)?.feedbackReview);
}

export function isStaffForModerationAlerts(role) {
  return canAccessAdminPanel(role);
}

export const ADMIN_PANEL_ROLES = Object.keys(ROLE_MATRIX).filter((role) => ROLE_MATRIX[role].adminPanel);
export const RESIDENT_STAFF_VERIFY_ROLES = ["admin", "technical_support", "nw_admin", "patroller", "committee"];
export const RESIDENT_DIRECTORY_ROLES = [...new Set([...ADMIN_PANEL_ROLES, "patroller"])];
export const INTELLIGENCE_MEMBER_ROLES = Object.keys(ROLE_MATRIX).filter((role) => ROLE_MATRIX[role].intelligenceView);
export const INTELLIGENCE_MODERATOR_ROLES = Object.keys(ROLE_MATRIX).filter((role) => ROLE_MATRIX[role].intelligenceModerate);
export const PATROL_MEMBER_ROLES = Object.keys(ROLE_MATRIX).filter((role) => ROLE_MATRIX[role].patrolSchedule);
export const INCIDENT_STAFF_ROLES = Object.keys(ROLE_MATRIX).filter((role) => ROLE_MATRIX[role].incidentModerate);
export const FEEDBACK_REVIEW_ROLES = Object.keys(ROLE_MATRIX).filter((role) => ROLE_MATRIX[role].feedbackReview);
/** Household-only accounts. Login lands on /resident. */
export const RESIDENT_APP_ROLES = ["resident"];
/**
 * Local watch members who also live in the neighbourhood.
 * Same household screens as residents; login still lands on /dashboard.
 */
export const HOUSEHOLD_MODE_ROLES = [
  "volunteer",
  "patroller",
  "investigator",
  "committee",
  "nw_admin",
];
/** Main admin / tech support may open resident screens to preview and moderate. */
export const RESIDENT_HOME_PREVIEW_ROLES = ["admin", "technical_support"];
export const RESIDENT_HOME_ROLES = [
  ...RESIDENT_APP_ROLES,
  ...HOUSEHOLD_MODE_ROLES,
  ...RESIDENT_HOME_PREVIEW_ROLES,
];
export const PATROL_INCIDENT_ROLES = Object.keys(ROLE_MATRIX).filter(
  (role) => ROLE_MATRIX[role].incidentReport && role !== "resident"
);
export const CITY_HUB_VIEW_ROLES = [
  "volunteer",
  "patroller",
  "investigator",
  "committee",
  "nw_admin",
  "admin",
  "technical_support",
  "security_admin",
  "city_admin",
];
export const CITY_HUB_PUBLISH_ROLES = ["admin", "technical_support", "nw_admin", "city_admin", "security_admin"];
export const AREA_BROADCAST_ROLES = ["admin", "technical_support", "nw_admin", "committee"];

export function canPostAreaBroadcast(role, platformRole) {
  if (canAccessPlatformConsole(platformRole)) return true;
  return AREA_BROADCAST_ROLES.includes(normalizeAppRole(role));
}

export function canSetAreaPetrolPrice(role, platformRole) {
  return canPostAreaBroadcast(role, platformRole);
}

export function canViewCityHub(role, platformRole) {
  if (canAccessPlatformConsole(platformRole)) return true;
  return CITY_HUB_VIEW_ROLES.includes(normalizeAppRole(role));
}

export function canPublishCityHub(role, platformRole) {
  if (canAccessPlatformConsole(platformRole)) return true;
  return CITY_HUB_PUBLISH_ROLES.includes(normalizeAppRole(role));
}

export function canAccessResidentHome(role) {
  return RESIDENT_HOME_ROLES.includes(normalizeAppRole(role));
}

export function canPreviewResidentHome(role) {
  return RESIDENT_HOME_PREVIEW_ROLES.includes(normalizeAppRole(role));
}

/** Watch member who lives here — household mode on top of patrol duty. */
export function isHouseholdModeRole(role) {
  return HOUSEHOLD_MODE_ROLES.includes(normalizeAppRole(role));
}

/** Can use household SOS, My sector, away, and security-company membership. */
export function canUseHouseholdMode(role) {
  const normalized = normalizeAppRole(role);
  return RESIDENT_APP_ROLES.includes(normalized) || HOUSEHOLD_MODE_ROLES.includes(normalized);
}

export function canStaffVerifyResident(role) {
  return RESIDENT_STAFF_VERIFY_ROLES.includes(normalizeAppRole(role));
}

/** Main admin, technical support, and NW admin review household → patroller requests. */
export const PATROLLER_REQUEST_REVIEW_ROLES = ["admin", "technical_support", "nw_admin"];

export function canReviewPatrollerRequests(role) {
  return PATROLLER_REQUEST_REVIEW_ROLES.includes(normalizeAppRole(role));
}

export const SECURITY_DASHBOARD_ROLES = ["security_admin"];
export const CITY_ADMIN_DASHBOARD_ROLES = ["city_admin", "admin", "technical_support"];

export function homePathForRole(role, platformRole) {
  const normalized = normalizeAppRole(role);
  if (normalized === "resident") return "/resident";
  if (normalized === "security_admin") return "/security";
  if (normalized === "city_admin") return "/city-admin";
  if (canAccessPlatformConsole(platformRole) && normalized === "city_admin") return "/city-admin";
  return "/dashboard";
}

/** Back link for city-wide pages (City Hub, Hotspots) opened from a role home. */
export function homeBackNav(role, platformRole) {
  const homePath = homePathForRole(role, platformRole);
  const backTo = isGlobalAppRole(role) ? "/admin" : homePath;
  const backLabel =
    backTo === "/security"
      ? "Back to command"
      : backTo === "/city-admin"
        ? "Back to city admin"
        : backTo === "/admin"
          ? "Back to admin"
          : backTo === "/resident"
            ? "Back to home"
            : "Back to dashboard";
  return { backTo, backLabel };
}

/** Platform-wide accounts: not members of any neighborhood organization. */
export const GLOBAL_APP_ROLES = ["admin", "technical_support"];

export const GLOBAL_APP_ROLE_LABELS = {
  admin: "Main admin",
  technical_support: "Technical support",
};

export function isGlobalAppRole(role) {
  return GLOBAL_APP_ROLES.includes(normalizeAppRole(role));
}

/** Household accounts — not watch / operational staff. */
export function isResidentAppRole(role) {
  return normalizeAppRole(role) === "resident";
}

/** Watch / partner roles that can open patrol-only ops chat. */
export function canAccessPatrolOpsChat(role) {
  return Boolean(roleConfig(role)) && !isResidentAppRole(role);
}

/** Main admin, technical support, or platform console staff who can switch neighborhoods. */
export function isGlobalOperatorUser(user) {
  return isGlobalAppRole(user?.role) || canAccessPlatformConsole(user?.platformRole);
}

/** Main admin / tech support: any City Hub post. NW admin: only posts they published or shared. */
export const EMERGENCY_DIRECTORY_MANAGER_ROLES = ["admin", "technical_support", "nw_admin"];

export function canManageEmergencyDirectory(role, platformRole) {
  if (canAccessPlatformConsole(platformRole)) return true;
  return EMERGENCY_DIRECTORY_MANAGER_ROLES.includes(normalizeAppRole(role));
}

export function canManageCityHubPost(role, userId, post, platformRole) {
  if (!post || !userId) return false;
  if (isGlobalAppRole(role) || canAccessPlatformConsole(platformRole)) return true;
  if (normalizeAppRole(role) !== "nw_admin") return false;
  return String(post.created_by_user_id || "") === String(userId);
}
