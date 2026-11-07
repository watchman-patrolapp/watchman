import { lazy } from "react";

// Lazy load page components
export const Login = lazy(() => import("../pages/Login"));
export const Register = lazy(() => import("../pages/Register"));
export const PrivacyPolicy = lazy(() => import("../pages/PrivacyPolicy"));
export const TermsOfUse = lazy(() => import("../pages/TermsOfUse"));
export const Dashboard = lazy(() => import("../pages/Dashboard"));
export const PatrolSchedule = lazy(() => import("../pages/PatrolSchedule"));
export const AdminDashboard = lazy(() => import("../pages/AdminDashboard"));
export const UserManagement = lazy(() => import("../pages/UserManagement"));
export const AdminResidents = lazy(() => import("../pages/AdminResidents"));
export const AdminMemberProfiles = lazy(() => import("../pages/AdminMemberProfiles"));
export const AdminResidentProfiles = lazy(() => import("../pages/AdminResidentProfiles"));
export const PrintPatrolLogs = lazy(() => import("../pages/PrintPatrolLogs"));
export const IncidentForm = lazy(() => import("../pages/IncidentForm"));
export const IncidentList = lazy(() => import("../pages/IncidentList"));
export const IncidentModeration = lazy(() => import("../pages/IncidentModeration"));
export const PrintIncidents = lazy(() => import("../pages/PrintIncidents"));
export const CriminalProfileDetail = lazy(() => import("../pages/CriminalProfileDetail"));
export const IncidentDetail = lazy(() => import("../pages/IncidentDetail"));
export const PrintIncidentDetail = lazy(() => import("../pages/PrintIncidentDetail"));

// Intelligence pages
export const MobileProfileView = lazy(() => import("../pages/intelligence/MobileProfileView"));
export const IntelligenceHome = lazy(() => import("../pages/intelligence/IntelligenceHome"));
export const ProfileSearch = lazy(() => import("../pages/intelligence/ProfileSearch"));
export const MatchQueue = lazy(() => import("../pages/intelligence/MatchQueue"));
export const CreateProfile = lazy(() => import("../pages/intelligence/CreateProfile"));
export const Hotspots = lazy(() => import("../pages/Hotspots"));

// ✅ CHAT: New chat moved to pages folder
export const EmergencyChat = lazy(() => import("../pages/EmergencyChat"));

export const AdminChatLogs = lazy(() => import("../pages/AdminChatLogs"));
export const AdminWatchStaffActivity = lazy(() => import("../pages/AdminWatchStaffActivity"));
export const AdminFeedbackReviews = lazy(() => import("../pages/AdminFeedbackReviews"));
export const Profile = lazy(() => import("../pages/Profile"));
export const Vehicles = lazy(() => import("../pages/Vehicles"));
export const Guide = lazy(() => import("../pages/Guide"));
export const About = lazy(() => import("../pages/About"));
export const ConfirmEmail = lazy(() => import("../pages/ConfirmEmail"));
export const ForgotPassword = lazy(() => import("../pages/ForgotPassword"));
export const UpdatePassword = lazy(() => import("../pages/UpdatePassword"));
export const Leaderboard = lazy(() => import("../pages/Leaderboard"));
export const ResidentDashboard = lazy(() => import("../pages/ResidentDashboard"));
export const ResidentSos = lazy(() => import("../pages/ResidentSos"));
export const ResidentActivityReport = lazy(() => import("../pages/ResidentActivityReport"));
export const ResidentActivityList = lazy(() => import("../pages/ResidentActivityList"));
export const ResidentNeighbours = lazy(() => import("../pages/ResidentNeighbours"));
export const ResidentSector = lazy(() => import("../pages/ResidentSector"));
export const OrganizationOnboarding = lazy(() => import("../pages/OrganizationOnboarding"));
export const CityHub = lazy(() => import("../pages/CityHub"));
export const BillingDashboard = lazy(() => import("../pages/BillingDashboard"));
export const SecurityMembershipReview = lazy(() => import("../pages/SecurityMembershipReview"));
export const SecurityCompanyInsights = lazy(() => import("../pages/SecurityCompanyInsights"));
export const SecurityCompanyDashboard = lazy(() => import("../pages/SecurityCompanyDashboard"));
export const SecuritySosBoard = lazy(() => import("../pages/SecuritySosBoard"));
export const SecurityBranding = lazy(() => import("../pages/SecurityBranding"));
export const EmergencyContacts = lazy(() => import("../pages/EmergencyContacts"));
export const ResidentGuide = lazy(() => import("../pages/ResidentGuide"));
export const AreaBroadcast = lazy(() => import("../pages/AreaBroadcast"));
export const ResidentModeration = lazy(() => import("../pages/ResidentModeration"));
export const NeedsBoard = lazy(() => import("../pages/NeedsBoard"));
export const NeedsItemPage = lazy(() => import("../pages/NeedsItemPage"));
export const EquipmentCatalogue = lazy(() => import("../pages/equipment/EquipmentCatalogue"));
export const EquipmentItemPage = lazy(() => import("../pages/equipment/EquipmentItemPage"));
export const EquipmentUnitPage = lazy(() => import("../pages/equipment/EquipmentUnitPage"));
export const EquipmentQrResolve = lazy(() => import("../pages/equipment/EquipmentQrResolve"));
export const EquipmentAdminDashboard = lazy(() => import("../pages/equipment/admin/EquipmentAdminDashboard"));
export const EquipmentAdminStocktake = lazy(() => import("../pages/equipment/admin/EquipmentAdminStocktake"));
export const EquipmentAdminItems = lazy(() => import("../pages/equipment/admin/EquipmentAdminItems"));
export const EquipmentAdminLabels = lazy(() => import("../pages/equipment/admin/EquipmentAdminLabels"));
export const EquipmentMine = lazy(() => import("../pages/equipment/EquipmentMine"));
export const EquipmentAdminRequests = lazy(() => import("../pages/equipment/admin/EquipmentAdminRequests"));
export const EquipmentAdminCertifications = lazy(() => import("../pages/equipment/admin/EquipmentAdminCertifications"));
export const EquipmentAdminMaintenance = lazy(() => import("../pages/equipment/admin/EquipmentAdminMaintenance"));
export const EquipmentHandover = lazy(() => import("../pages/equipment/EquipmentHandover"));
export const NeedsAdmin = lazy(() => import("../pages/admin/NeedsAdmin"));
export const CityAdminDashboard = lazy(() => import("../pages/CityAdminDashboard"));
export const SosEscalationBoard = lazy(() => import("../pages/SosEscalationBoard"));
export const PilotReadiness = lazy(() => import("../pages/PilotReadiness"));
export const RoleAccessGuide = lazy(() => import("../pages/RoleAccessGuide"));
export const ChooseArea = lazy(() => import("../pages/ChooseArea"));
// Dev-only share card fixtures; tree-shaken from production builds.
export const ShareCardFixtures = import.meta.env.DEV ? lazy(() => import("../pages/dev/ShareCardFixtures")) : null;
