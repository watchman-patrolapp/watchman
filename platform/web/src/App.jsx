// src/App.jsx
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Suspense, lazy } from "react";
import { useAuth } from "./auth/useAuth";
import RequireRole from "./components/RequireRole";
import RequirePlatformRole from "./components/RequirePlatformRole";
import RequireActiveOrganization from "./components/RequireActiveOrganization";
import { ADMIN_PANEL_ROLES } from "./auth/staffRoles";
import {
  PATROL_INCIDENT_ROLES,
  RESIDENT_HOME_ROLES,
  RESIDENT_DIRECTORY_ROLES,
  CITY_HUB_VIEW_ROLES,
  FEEDBACK_REVIEW_ROLES,
  INCIDENT_STAFF_ROLES,
  INTELLIGENCE_MEMBER_ROLES,
  INTELLIGENCE_MODERATOR_ROLES,
  PATROL_MEMBER_ROLES,
  SOS_BOARD_ROLES,
  SECURITY_DASHBOARD_ROLES,
  CITY_ADMIN_DASHBOARD_ROLES,
  EMERGENCY_DIRECTORY_MANAGER_ROLES,
  AREA_BROADCAST_ROLES,
  GLOBAL_APP_ROLES,
} from "./auth/roleMatrix";
import ChatErrorBoundary from './components/ChatErrorBoundary'; // ✅ NEW IMPORT
import PageSkeleton from "./components/layout/PageSkeleton";
import MobilePatrolDockHost from "./components/layout/MobilePatrolDockHost";
import HardwareBackNavHost from "./components/layout/HardwareBackNavHost";
import ScrollToTop from "./components/layout/ScrollToTop";
import PermissionsPrimerModal from "./components/PermissionsPrimerModal";

/** One-time permission intro (location + notifications) after sign-in; not tied to a single page. */
function PermissionFlowHost() {
  const { user, sessionReady } = useAuth();
  if (!sessionReady || !user?.id) return null;
  return <PermissionsPrimerModal userId={user.id} />;
}

// Lazy load page components
const Login = lazy(() => import("./pages/Login"));
const Register = lazy(() => import("./pages/Register"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const PatrolSchedule = lazy(() => import("./pages/PatrolSchedule"));
const AdminDashboard = lazy(() => import("./pages/AdminDashboard"));
const UserManagement = lazy(() => import("./pages/UserManagement"));
const AdminResidents = lazy(() => import("./pages/AdminResidents"));
const AdminMemberProfiles = lazy(() => import("./pages/AdminMemberProfiles"));
const AdminResidentProfiles = lazy(() => import("./pages/AdminResidentProfiles"));
const PrintPatrolLogs = lazy(() => import("./pages/PrintPatrolLogs"));
const IncidentForm = lazy(() => import("./pages/IncidentForm"));
const IncidentList = lazy(() => import("./pages/IncidentList"));
const IncidentModeration = lazy(() => import("./pages/IncidentModeration"));
const PrintIncidents = lazy(() => import("./pages/PrintIncidents"));
const CriminalProfileDetail = lazy(() => import("./pages/CriminalProfileDetail"));
const IncidentDetail = lazy(() => import("./pages/IncidentDetail"));
const PrintIncidentDetail = lazy(() => import("./pages/PrintIncidentDetail"));

// Intelligence pages
const MobileProfileView = lazy(() => import("./pages/intelligence/MobileProfileView"));
const IntelligenceHome = lazy(() => import("./pages/intelligence/IntelligenceHome"));
const ProfileSearch = lazy(() => import("./pages/intelligence/ProfileSearch"));
const MatchQueue = lazy(() => import("./pages/intelligence/MatchQueue"));
const CreateProfile = lazy(() => import("./pages/intelligence/CreateProfile"));
const Hotspots = lazy(() => import("./pages/Hotspots"));

// ✅ CHAT: New chat moved to pages folder
const EmergencyChat = lazy(() => import("./pages/EmergencyChat"));

const AdminChatLogs = lazy(() => import("./pages/AdminChatLogs"));
const AdminWatchStaffActivity = lazy(() => import("./pages/AdminWatchStaffActivity"));
const AdminFeedbackReviews = lazy(() => import("./pages/AdminFeedbackReviews"));
const Profile = lazy(() => import("./pages/Profile"));
const Vehicles = lazy(() => import("./pages/Vehicles"));
const Guide = lazy(() => import("./pages/Guide"));
const About = lazy(() => import("./pages/About"));
const ConfirmEmail = lazy(() => import("./pages/ConfirmEmail"));
const ForgotPassword = lazy(() => import("./pages/ForgotPassword"));
const UpdatePassword = lazy(() => import("./pages/UpdatePassword"));
const Leaderboard = lazy(() => import("./pages/Leaderboard"));
const ResidentDashboard = lazy(() => import("./pages/ResidentDashboard"));
const ResidentSos = lazy(() => import("./pages/ResidentSos"));
const ResidentActivityReport = lazy(() => import("./pages/ResidentActivityReport"));
const ResidentActivityList = lazy(() => import("./pages/ResidentActivityList"));
const ResidentNeighbours = lazy(() => import("./pages/ResidentNeighbours"));
const ResidentSector = lazy(() => import("./pages/ResidentSector"));
const OrganizationOnboarding = lazy(() => import("./pages/OrganizationOnboarding"));
const CityHub = lazy(() => import("./pages/CityHub"));
const BillingDashboard = lazy(() => import("./pages/BillingDashboard"));
const SecurityMembershipReview = lazy(() => import("./pages/SecurityMembershipReview"));
const SecurityCompanyInsights = lazy(() => import("./pages/SecurityCompanyInsights"));
const SecurityCompanyDashboard = lazy(() => import("./pages/SecurityCompanyDashboard"));
const SecuritySosBoard = lazy(() => import("./pages/SecuritySosBoard"));
const SecurityBranding = lazy(() => import("./pages/SecurityBranding"));
const EmergencyContacts = lazy(() => import("./pages/EmergencyContacts"));
const ResidentGuide = lazy(() => import("./pages/ResidentGuide"));
const AreaBroadcast = lazy(() => import("./pages/AreaBroadcast"));
const CityAdminDashboard = lazy(() => import("./pages/CityAdminDashboard"));
const SosEscalationBoard = lazy(() => import("./pages/SosEscalationBoard"));
const PilotReadiness = lazy(() => import("./pages/PilotReadiness"));
const RoleAccessGuide = lazy(() => import("./pages/RoleAccessGuide"));
const ChooseArea = lazy(() => import("./pages/ChooseArea"));

/** Don’t render login/register until INITIAL_SESSION finished — avoids faded sign-in flash on refresh */
function AuthBootstrapGate({ children }) {
  const { sessionReady } = useAuth();
  if (!sessionReady) {
    return <PageSkeleton message="Signing you in…" />;
  }
  return children;
}

// PrivateRoute component
function PrivateRoute({ children }) {
  const { user, loading, sessionReady } = useAuth();
  if (!sessionReady || loading) {
    return <PageSkeleton message="Signing you in…" />;
  }
  return user ? children : <Navigate to="/login" />;
}

function NeighborhoodRoute({ children }) {
  return (
    <PrivateRoute>
      <RequireActiveOrganization>{children}</RequireActiveOrganization>
    </PrivateRoute>
  );
}

function AppRoutes() {
  return (
    <Suspense fallback={<PageSkeleton message="Loading…" />}>
      <Routes>
        <Route
          path="/login"
          element={
            <AuthBootstrapGate>
              <Login />
            </AuthBootstrapGate>
          }
        />
        <Route
          path="/register"
          element={
            <AuthBootstrapGate>
              <Register />
            </AuthBootstrapGate>
          }
        />
        <Route
          path="/forgot-password"
          element={
            <AuthBootstrapGate>
              <ForgotPassword />
            </AuthBootstrapGate>
          }
        />
        <Route
          path="/update-password"
          element={
            <AuthBootstrapGate>
              <UpdatePassword />
            </AuthBootstrapGate>
          }
        />
        <Route
          path="/confirm-email"
          element={
            <AuthBootstrapGate>
              <ConfirmEmail />
            </AuthBootstrapGate>
          }
        />
        
        <Route path="/sop" element={<Navigate to="/dashboard" replace />} />
        
        <Route
          path="/choose-area"
          element={
            <PrivateRoute>
              <ChooseArea />
            </PrivateRoute>
          }
        />

        <Route
          path="/security"
          element={
            <PrivateRoute>
              <RequireRole allowedRoles={SECURITY_DASHBOARD_ROLES} allowPlatformConsole>
                <SecurityCompanyDashboard />
              </RequireRole>
            </PrivateRoute>
          }
        />

        <Route
          path="/security/sos"
          element={
            <PrivateRoute>
              <RequireRole allowedRoles={SECURITY_DASHBOARD_ROLES} allowPlatformConsole>
                <SecuritySosBoard />
              </RequireRole>
            </PrivateRoute>
          }
        />

        <Route
          path="/security/profile"
          element={
            <PrivateRoute>
              <RequireRole allowedRoles={SECURITY_DASHBOARD_ROLES} allowPlatformConsole>
                <SecurityBranding />
              </RequireRole>
            </PrivateRoute>
          }
        />

        <Route path="/security/branding" element={<Navigate to="/security/profile" replace />} />

        <Route
          path="/city-admin"
          element={
            <PrivateRoute>
              <RequireRole allowedRoles={CITY_ADMIN_DASHBOARD_ROLES} allowPlatformConsole>
                <CityAdminDashboard />
              </RequireRole>
            </PrivateRoute>
          }
        />

        <Route
          path="/resident"
          element={
            <NeighborhoodRoute>
              <RequireRole allowedRoles={RESIDENT_HOME_ROLES}>
                <ResidentDashboard />
              </RequireRole>
            </NeighborhoodRoute>
          }
        />

        <Route
          path="/resident/sos"
          element={
            <NeighborhoodRoute>
              <RequireRole allowedRoles={RESIDENT_HOME_ROLES}>
                <ResidentSos />
              </RequireRole>
            </NeighborhoodRoute>
          }
        />

        <Route
          path="/resident/activity/new"
          element={
            <NeighborhoodRoute>
              <RequireRole allowedRoles={RESIDENT_HOME_ROLES}>
                <ResidentActivityReport />
              </RequireRole>
            </NeighborhoodRoute>
          }
        />

        <Route
          path="/resident/activity"
          element={
            <NeighborhoodRoute>
              <RequireRole allowedRoles={RESIDENT_HOME_ROLES}>
                <ResidentActivityList />
              </RequireRole>
            </NeighborhoodRoute>
          }
        />

        <Route
          path="/resident/neighbours"
          element={
            <NeighborhoodRoute>
              <RequireRole allowedRoles={RESIDENT_HOME_ROLES}>
                <ResidentNeighbours />
              </RequireRole>
            </NeighborhoodRoute>
          }
        />

        <Route
          path="/resident/sector"
          element={
            <NeighborhoodRoute>
              <RequireRole allowedRoles={RESIDENT_HOME_ROLES}>
                <ResidentSector />
              </RequireRole>
            </NeighborhoodRoute>
          }
        />

        <Route
          path="/resident/contacts"
          element={
            <NeighborhoodRoute>
              <RequireRole allowedRoles={RESIDENT_HOME_ROLES}>
                <EmergencyContacts />
              </RequireRole>
            </NeighborhoodRoute>
          }
        />

        <Route
          path="/resident/guide"
          element={
            <NeighborhoodRoute>
              <RequireRole allowedRoles={RESIDENT_HOME_ROLES}>
                <ResidentGuide />
              </RequireRole>
            </NeighborhoodRoute>
          }
        />

        <Route path="/resident/about" element={<Navigate to="/resident/guide" replace />} />

        <Route
          path="/dashboard"
          element={
            <NeighborhoodRoute>
              <Dashboard />
            </NeighborhoodRoute>
          }
        />
        
        <Route
          path="/sos"
          element={
            <NeighborhoodRoute>
              <RequireRole allowedRoles={SOS_BOARD_ROLES}>
                <SosEscalationBoard />
              </RequireRole>
            </NeighborhoodRoute>
          }
        />

        <Route
          path="/schedule"
          element={
            <NeighborhoodRoute>
              <RequireRole allowedRoles={PATROL_MEMBER_ROLES}>
                <PatrolSchedule />
              </RequireRole>
            </NeighborhoodRoute>
          }
        />
        
        <Route
          path="/incidents"
          element={
            <NeighborhoodRoute>
              <RequireRole allowedRoles={PATROL_INCIDENT_ROLES}>
                <IncidentList />
              </RequireRole>
            </NeighborhoodRoute>
          }
        />
        
        <Route
          path="/incident/new"
          element={
            <NeighborhoodRoute>
              <RequireRole allowedRoles={PATROL_INCIDENT_ROLES}>
                <IncidentForm />
              </RequireRole>
            </NeighborhoodRoute>
          }
        />

        <Route
          path="/incident/:id/edit"
          element={
            <NeighborhoodRoute>
              <RequireRole allowedRoles={INCIDENT_STAFF_ROLES}>
                <IncidentForm />
              </RequireRole>
            </NeighborhoodRoute>
          }
        />
        
        <Route
          path="/incidents/print"
          element={
            <NeighborhoodRoute>
              <RequireRole allowedRoles={PATROL_INCIDENT_ROLES}>
                <PrintIncidents />
              </RequireRole>
            </NeighborhoodRoute>
          }
        />

        <Route
          path="/incidents/:id/print"
          element={
            <NeighborhoodRoute>
              <RequireRole allowedRoles={PATROL_INCIDENT_ROLES}>
                <PrintIncidentDetail />
              </RequireRole>
            </NeighborhoodRoute>
          }
        />

        <Route
          path="/incidents/:id"
          element={
            <NeighborhoodRoute>
              <RequireRole allowedRoles={PATROL_INCIDENT_ROLES}>
                <IncidentDetail />
              </RequireRole>
            </NeighborhoodRoute>
          }
        />
        
        {/* ✅ CHAT ROUTE - Wrapped with ChatErrorBoundary */}
        <Route
          path="/chat"
          element={
            <NeighborhoodRoute>
              <ChatErrorBoundary>
                <EmergencyChat />
              </ChatErrorBoundary>
            </NeighborhoodRoute>
          }
        />
        
        <Route
          path="/admin/chat"
          element={
            <PrivateRoute>
              <RequireRole allowedRoles={ADMIN_PANEL_ROLES}>
                <RequireActiveOrganization>
                  <AdminChatLogs />
                </RequireActiveOrganization>
              </RequireRole>
            </PrivateRoute>
          }
        />

        <Route
          path="/admin/staff-activity"
          element={
            <PrivateRoute>
              <RequireRole allowedRoles={GLOBAL_APP_ROLES} allowPlatformConsole>
                <RequireActiveOrganization>
                  <AdminWatchStaffActivity />
                </RequireActiveOrganization>
              </RequireRole>
            </PrivateRoute>
          }
        />
        
        <Route
          path="/profile"
          element={
            <PrivateRoute>
              <Profile />
            </PrivateRoute>
          }
        />
        
        <Route
          path="/vehicles"
          element={
            <PrivateRoute>
              <Vehicles />
            </PrivateRoute>
          }
        />
        
        <Route
          path="/guide"
          element={
            <PrivateRoute>
              <Guide />
            </PrivateRoute>
          }
        />
        
        <Route
          path="/about"
          element={
            <PrivateRoute>
              <About />
            </PrivateRoute>
          }
        />
        
        <Route
          path="/leaderboard"
          element={
            <NeighborhoodRoute>
              <Leaderboard />
            </NeighborhoodRoute>
          }
        />
        
        <Route
          path="/admin"
          element={
            <PrivateRoute>
              <RequireRole allowedRoles={ADMIN_PANEL_ROLES}>
                <RequireActiveOrganization>
                  <AdminDashboard />
                </RequireActiveOrganization>
              </RequireRole>
            </PrivateRoute>
          }
        />
        
        <Route
          path="/admin/users"
          element={
            <PrivateRoute>
              <RequireRole allowedRoles={ADMIN_PANEL_ROLES}>
                <RequireActiveOrganization>
                  <UserManagement />
                </RequireActiveOrganization>
              </RequireRole>
            </PrivateRoute>
          }
        />

        <Route
          path="/admin/residents"
          element={
            <PrivateRoute>
              <RequireRole allowedRoles={RESIDENT_DIRECTORY_ROLES}>
                <RequireActiveOrganization>
                  <AdminResidents />
                </RequireActiveOrganization>
              </RequireRole>
            </PrivateRoute>
          }
        />

        <Route
          path="/admin/contacts"
          element={
            <PrivateRoute>
              <RequireRole allowedRoles={EMERGENCY_DIRECTORY_MANAGER_ROLES} allowPlatformConsole>
                <RequireActiveOrganization>
                  <EmergencyContacts />
                </RequireActiveOrganization>
              </RequireRole>
            </PrivateRoute>
          }
        />

        <Route
          path="/admin/broadcast"
          element={
            <PrivateRoute>
              <RequireRole allowedRoles={AREA_BROADCAST_ROLES} allowPlatformConsole>
                <RequireActiveOrganization>
                  <AreaBroadcast />
                </RequireActiveOrganization>
              </RequireRole>
            </PrivateRoute>
          }
        />

        <Route
          path="/admin/members"
          element={
            <PrivateRoute>
              <RequireRole allowedRoles={ADMIN_PANEL_ROLES}>
                <RequireActiveOrganization>
                  <AdminMemberProfiles />
                </RequireActiveOrganization>
              </RequireRole>
            </PrivateRoute>
          }
        />

        <Route
          path="/admin/resident-profiles"
          element={
            <PrivateRoute>
              <RequireRole allowedRoles={ADMIN_PANEL_ROLES}>
                <RequireActiveOrganization>
                  <AdminResidentProfiles />
                </RequireActiveOrganization>
              </RequireRole>
            </PrivateRoute>
          }
        />

        <Route
          path="/admin/print"
          element={
            <PrivateRoute>
              <RequireRole allowedRoles={ADMIN_PANEL_ROLES}>
                <RequireActiveOrganization>
                  <PrintPatrolLogs />
                </RequireActiveOrganization>
              </RequireRole>
            </PrivateRoute>
          }
        />
        
        <Route
          path="/admin/incidents"
          element={
            <PrivateRoute>
              <RequireRole allowedRoles={ADMIN_PANEL_ROLES}>
                <RequireActiveOrganization>
                  <IncidentModeration />
                </RequireActiveOrganization>
              </RequireRole>
            </PrivateRoute>
          }
        />

        <Route
          path="/admin/feedback"
          element={
            <PrivateRoute>
              <RequireRole allowedRoles={FEEDBACK_REVIEW_ROLES}>
                <RequireActiveOrganization>
                  <AdminFeedbackReviews />
                </RequireActiveOrganization>
              </RequireRole>
            </PrivateRoute>
          }
        />

        <Route
          path="/admin/organizations"
          element={
            <PrivateRoute>
              <RequirePlatformRole>
                <OrganizationOnboarding />
              </RequirePlatformRole>
            </PrivateRoute>
          }
        />

        <Route
          path="/city-hub"
          element={
            <PrivateRoute>
              <RequireRole allowedRoles={CITY_HUB_VIEW_ROLES} allowPlatformConsole>
                <CityHub />
              </RequireRole>
            </PrivateRoute>
          }
        />

        <Route
          path="/admin/city-hub"
          element={<Navigate to="/city-hub" replace />}
        />

        <Route
          path="/admin/billing"
          element={
            <PrivateRoute>
              <RequirePlatformRole>
                <BillingDashboard />
              </RequirePlatformRole>
            </PrivateRoute>
          }
        />

        <Route
          path="/admin/security-memberships"
          element={
            <PrivateRoute>
              <RequireRole allowedRoles={GLOBAL_APP_ROLES} allowPlatformConsole>
                <SecurityMembershipReview />
              </RequireRole>
            </PrivateRoute>
          }
        />

        <Route
          path="/admin/security-insights"
          element={
            <PrivateRoute>
              <RequirePlatformRole>
                <SecurityCompanyInsights />
              </RequirePlatformRole>
            </PrivateRoute>
          }
        />

        <Route path="/admin/sos" element={<Navigate to="/sos" replace />} />

        <Route
          path="/admin/pilot-readiness"
          element={
            <PrivateRoute>
              <RequirePlatformRole>
                <PilotReadiness />
              </RequirePlatformRole>
            </PrivateRoute>
          }
        />

        <Route
          path="/admin/roles"
          element={
            <PrivateRoute>
              <RequireRole allowedRoles={ADMIN_PANEL_ROLES}>
                <RoleAccessGuide />
              </RequireRole>
            </PrivateRoute>
          }
        />
        
        {/* Intelligence Routes */}
        <Route
          path="/intelligence"
          element={
            <NeighborhoodRoute>
              <RequireRole allowedRoles={INTELLIGENCE_MEMBER_ROLES}>
                <IntelligenceHome />
              </RequireRole>
            </NeighborhoodRoute>
          }
        />

        <Route
          path="/intelligence/contacts"
          element={
            <NeighborhoodRoute>
              <RequireRole allowedRoles={INTELLIGENCE_MEMBER_ROLES}>
                <EmergencyContacts />
              </RequireRole>
            </NeighborhoodRoute>
          }
        />

        <Route
          path="/intelligence/profiles/:id"
          element={
            <NeighborhoodRoute>
              <RequireRole allowedRoles={INTELLIGENCE_MEMBER_ROLES}>
                <CriminalProfileDetail />
              </RequireRole>
            </NeighborhoodRoute>
          }
        />
        
        <Route
          path="/intelligence/profiles/:id/mobile"
          element={
            <NeighborhoodRoute>
              <RequireRole allowedRoles={ADMIN_PANEL_ROLES}>
                <MobileProfileView />
              </RequireRole>
            </NeighborhoodRoute>
          }
        />
        
        <Route
          path="/intelligence/nearby"
          element={<Navigate to="/intelligence" replace />}
        />
        
        <Route
          path="/intelligence/search"
          element={
            <NeighborhoodRoute>
              <RequireRole allowedRoles={INTELLIGENCE_MEMBER_ROLES}>
                <ProfileSearch />
              </RequireRole>
            </NeighborhoodRoute>
          }
        />
        
        <Route
          path="/intelligence/matches"
          element={
            <NeighborhoodRoute>
              <RequireRole allowedRoles={INTELLIGENCE_MODERATOR_ROLES}>
                <MatchQueue />
              </RequireRole>
            </NeighborhoodRoute>
          }
        />

        <Route
          path="/hotspots"
          element={
            <PrivateRoute>
              <RequireRole allowedRoles={INTELLIGENCE_MEMBER_ROLES}>
                <Hotspots />
              </RequireRole>
            </PrivateRoute>
          }
        />

        <Route
          path="/intelligence/profiles/new"
          element={
            <NeighborhoodRoute>
              <RequireRole allowedRoles={INTELLIGENCE_MEMBER_ROLES}>
                <CreateProfile />
              </RequireRole>
            </NeighborhoodRoute>
          }
        />
        
        <Route path="/" element={<Navigate to="/dashboard" />} />
      </Routes>
    </Suspense>
  );
}

function App() {
  return (
    <BrowserRouter>
      <ScrollToTop />
      <PermissionFlowHost />
      <AppRoutes />
      <HardwareBackNavHost />
      <MobilePatrolDockHost />
    </BrowserRouter>
  );
}

export default App;