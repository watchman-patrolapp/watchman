// src/App.jsx
import { BrowserRouter, Routes, Route, Navigate, Link } from "react-router-dom";
import { Suspense, lazy } from "react";
import { useAuth } from "./auth/useAuth";
import RequireRole from "./components/RequireRole";
import { ADMIN_PANEL_ROLES } from "./auth/staffRoles";
import ChatErrorBoundary from './components/ChatErrorBoundary'; // ✅ NEW IMPORT
import PageSkeleton from "./components/layout/PageSkeleton";
import MobilePatrolDockHost from "./components/layout/MobilePatrolDockHost";
import HardwareBackNavHost from "./components/layout/HardwareBackNavHost";
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
const AdminMemberProfiles = lazy(() => import("./pages/AdminMemberProfiles"));
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

// ✅ CHAT: New chat moved to pages folder
const EmergencyChat = lazy(() => import("./pages/EmergencyChat"));

const AdminChatLogs = lazy(() => import("./pages/AdminChatLogs"));
const AdminFeedbackReviews = lazy(() => import("./pages/AdminFeedbackReviews"));
const Profile = lazy(() => import("./pages/Profile"));
const Vehicles = lazy(() => import("./pages/Vehicles"));
const Guide = lazy(() => import("./pages/Guide"));
const About = lazy(() => import("./pages/About"));
const ConfirmEmail = lazy(() => import("./pages/ConfirmEmail"));
const ForgotPassword = lazy(() => import("./pages/ForgotPassword"));
const UpdatePassword = lazy(() => import("./pages/UpdatePassword"));
const Leaderboard = lazy(() => import("./pages/Leaderboard"));

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
          path="/dashboard"
          element={
            <PrivateRoute>
              <Dashboard />
            </PrivateRoute>
          }
        />
        
        <Route
          path="/schedule"
          element={
            <PrivateRoute>
              <PatrolSchedule />
            </PrivateRoute>
          }
        />
        
        <Route
          path="/incidents"
          element={
            <PrivateRoute>
              <IncidentList />
            </PrivateRoute>
          }
        />
        
        <Route
          path="/incident/new"
          element={
            <PrivateRoute>
              <IncidentForm />
            </PrivateRoute>
          }
        />

        <Route
          path="/incident/:id/edit"
          element={
            <PrivateRoute>
              <RequireRole allowedRoles={["admin", "committee", "technical_support"]}>
                <IncidentForm />
              </RequireRole>
            </PrivateRoute>
          }
        />
        
        <Route
          path="/incidents/print"
          element={
            <PrivateRoute>
              <PrintIncidents />
            </PrivateRoute>
          }
        />

        <Route
          path="/incidents/:id/print"
          element={
            <PrivateRoute>
              <PrintIncidentDetail />
            </PrivateRoute>
          }
        />

        <Route
          path="/incidents/:id"
          element={
            <PrivateRoute>
              <IncidentDetail />
            </PrivateRoute>
          }
        />
        
        {/* ✅ CHAT ROUTE - Wrapped with ChatErrorBoundary */}
        <Route
          path="/chat"
          element={
            <PrivateRoute>
              <ChatErrorBoundary>
                <EmergencyChat />
              </ChatErrorBoundary>
            </PrivateRoute>
          }
        />
        
        <Route
          path="/admin/chat"
          element={
            <PrivateRoute>
              <RequireRole allowedRoles={ADMIN_PANEL_ROLES}>
                <AdminChatLogs />
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
            <PrivateRoute>
              <Leaderboard />
            </PrivateRoute>
          }
        />
        
        <Route
          path="/admin"
          element={
            <PrivateRoute>
              <RequireRole allowedRoles={ADMIN_PANEL_ROLES}>
                <AdminDashboard />
              </RequireRole>
            </PrivateRoute>
          }
        />
        
        <Route
          path="/admin/users"
          element={
            <PrivateRoute>
              <RequireRole allowedRoles={ADMIN_PANEL_ROLES}>
                <UserManagement />
              </RequireRole>
            </PrivateRoute>
          }
        />

        <Route
          path="/admin/members"
          element={
            <PrivateRoute>
              <RequireRole allowedRoles={ADMIN_PANEL_ROLES}>
                <AdminMemberProfiles />
              </RequireRole>
            </PrivateRoute>
          }
        />
        
        <Route
          path="/admin/print"
          element={
            <PrivateRoute>
              <RequireRole allowedRoles={ADMIN_PANEL_ROLES}>
                <PrintPatrolLogs />
              </RequireRole>
            </PrivateRoute>
          }
        />
        
        <Route
          path="/admin/incidents"
          element={
            <PrivateRoute>
              <RequireRole allowedRoles={ADMIN_PANEL_ROLES}>
                <IncidentModeration />
              </RequireRole>
            </PrivateRoute>
          }
        />

        <Route
          path="/admin/feedback"
          element={
            <PrivateRoute>
              <RequireRole allowedRoles={["technical_support"]}>
                <AdminFeedbackReviews />
              </RequireRole>
            </PrivateRoute>
          }
        />
        
        {/* Intelligence Routes */}
        <Route
          path="/intelligence"
          element={
            <PrivateRoute>
              <RequireRole
                allowedRoles={[
                  "admin",
                  "committee",
                  "technical_support",
                  "patroller",
                  "investigator",
                  "volunteer",
                  "user",
                ]}
              >
                <IntelligenceHome />
              </RequireRole>
            </PrivateRoute>
          }
        />

        <Route
          path="/intelligence/profiles/:id"
          element={
            <PrivateRoute>
              <RequireRole
                allowedRoles={[
                  "admin",
                  "committee",
                  "technical_support",
                  "patroller",
                  "investigator",
                  "volunteer",
                  "user",
                ]}
              >
                <CriminalProfileDetail />
              </RequireRole>
            </PrivateRoute>
          }
        />
        
        <Route
          path="/intelligence/profiles/:id/mobile"
          element={
            <PrivateRoute>
              <RequireRole allowedRoles={ADMIN_PANEL_ROLES}>
                <MobileProfileView />
              </RequireRole>
            </PrivateRoute>
          }
        />
        
        <Route
          path="/intelligence/nearby"
          element={
            <PrivateRoute>
              <RequireRole allowedRoles={ADMIN_PANEL_ROLES}>
                <div className="min-h-screen bg-gray-100 dark:bg-gray-900 p-6">
                  <div className="max-w-4xl mx-auto">
                    <Link
                      to="/intelligence"
                      className="inline-flex items-center gap-2 text-sm text-teal-600 dark:text-teal-400 hover:underline mb-6"
                    >
                      ← Intelligence hub
                    </Link>
                    <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">Nearby Threats</h1>
                    <p className="text-gray-600 dark:text-gray-400">
                      This page will display high-risk profiles within your patrol area.
                    </p>
                  </div>
                </div>
              </RequireRole>
            </PrivateRoute>
          }
        />
        
        <Route
          path="/intelligence/search"
          element={
            <PrivateRoute>
              <RequireRole
                allowedRoles={[
                  "admin",
                  "committee",
                  "technical_support",
                  "patroller",
                  "investigator",
                  "volunteer",
                  "user",
                ]}
              >
                <ProfileSearch />
              </RequireRole>
            </PrivateRoute>
          }
        />
        
        <Route
          path="/intelligence/matches"
          element={
            <PrivateRoute>
              <RequireRole allowedRoles={ADMIN_PANEL_ROLES}>
                <MatchQueue />
              </RequireRole>
            </PrivateRoute>
          }
        />

        <Route
          path="/intelligence/profiles/new"
          element={
            <PrivateRoute>
              <RequireRole
                allowedRoles={[
                  "admin",
                  "committee",
                  "technical_support",
                  "patroller",
                  "investigator",
                  "volunteer",
                  "user",
                ]}
              >
                <CreateProfile />
              </RequireRole>
            </PrivateRoute>
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
      <PermissionFlowHost />
      <AppRoutes />
      <HardwareBackNavHost />
      <MobilePatrolDockHost />
    </BrowserRouter>
  );
}

export default App;