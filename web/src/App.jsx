// src/App.jsx
import { BrowserRouter, Routes, Route, Navigate, Link } from "react-router-dom";
import { Suspense, lazy } from "react";
import { AuthProvider } from "./auth/AuthProvider";
import { useAuth } from "./auth/useAuth";
import RequireRole from "./components/RequireRole";
import ChatErrorBoundary from './components/ChatErrorBoundary'; // ✅ NEW IMPORT
import PageSkeleton from "./components/layout/PageSkeleton";
import MobilePatrolDockHost from "./components/layout/MobilePatrolDockHost";

// Lazy load page components
const Login = lazy(() => import("./pages/Login"));
const Register = lazy(() => import("./pages/Register"));
const SOPFlashcards = lazy(() => import("./sop/SOPFlashcards"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const PatrolSchedule = lazy(() => import("./pages/PatrolSchedule"));
const AdminDashboard = lazy(() => import("./pages/AdminDashboard"));
const UserManagement = lazy(() => import("./pages/UserManagement"));
const PrintPatrolLogs = lazy(() => import("./pages/PrintPatrolLogs"));
const IncidentForm = lazy(() => import("./pages/IncidentForm"));
const IncidentList = lazy(() => import("./pages/IncidentList"));
const IncidentModeration = lazy(() => import("./pages/IncidentModeration"));
const PrintIncidents = lazy(() => import("./pages/PrintIncidents"));
const CriminalProfileDetail = lazy(() => import("./pages/CriminalProfileDetail"));
const IncidentDetail = lazy(() => import("./pages/IncidentDetail"));

// Intelligence pages
const MobileProfileView = lazy(() => import("./pages/intelligence/MobileProfileView"));
const IntelligenceHome = lazy(() => import("./pages/intelligence/IntelligenceHome"));
const ProfileSearch = lazy(() => import("./pages/intelligence/ProfileSearch"));
const MatchQueue = lazy(() => import("./pages/intelligence/MatchQueue"));
const CreateProfile = lazy(() => import("./pages/intelligence/CreateProfile"));

// ✅ CHAT: New chat moved to pages folder
const EmergencyChat = lazy(() => import("./pages/EmergencyChat"));

const AdminChatLogs = lazy(() => import("./pages/AdminChatLogs"));
const Profile = lazy(() => import("./pages/Profile"));
const Vehicles = lazy(() => import("./pages/Vehicles"));
const Guide = lazy(() => import("./pages/Guide"));
const About = lazy(() => import("./pages/About"));
const ConfirmEmail = lazy(() => import("./pages/ConfirmEmail"));
const Leaderboard = lazy(() => import("./pages/Leaderboard"));

// PrivateRoute component
function PrivateRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) {
    return <PageSkeleton message="Signing you in…" />;
  }
  return user ? children : <Navigate to="/login" />;
}

// SOPGuard
function SOPGuard({ children }) {
  const { user } = useAuth();
  const needsSOP = !user?.sopVersionAccepted || user.sopVersionAccepted !== "1.0";
  if (needsSOP) {
    return <Navigate to="/sop" replace />;
  }
  return children;
}

function AppRoutes() {
  return (
    <Suspense fallback={<PageSkeleton message="Loading…" />}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/confirm-email" element={<ConfirmEmail />} />
        
        <Route
          path="/sop"
          element={
            <PrivateRoute>
              <SOPFlashcards />
            </PrivateRoute>
          }
        />
        
        <Route
          path="/dashboard"
          element={
            <PrivateRoute>
              <SOPGuard>
                <Dashboard />
              </SOPGuard>
            </PrivateRoute>
          }
        />
        
        <Route
          path="/schedule"
          element={
            <PrivateRoute>
              <SOPGuard>
                <PatrolSchedule />
              </SOPGuard>
            </PrivateRoute>
          }
        />
        
        <Route
          path="/incidents"
          element={
            <PrivateRoute>
              <SOPGuard>
                <IncidentList />
              </SOPGuard>
            </PrivateRoute>
          }
        />
        
        <Route
          path="/incident/new"
          element={
            <PrivateRoute>
              <SOPGuard>
                <IncidentForm />
              </SOPGuard>
            </PrivateRoute>
          }
        />
        
        <Route
          path="/incidents/print"
          element={
            <PrivateRoute>
              <SOPGuard>
                <PrintIncidents />
              </SOPGuard>
            </PrivateRoute>
          }
        />
        
        {/* ✅ CHAT ROUTE - Wrapped with ChatErrorBoundary */}
        <Route
          path="/chat"
          element={
            <PrivateRoute>
              <SOPGuard>
                <ChatErrorBoundary>
                  <EmergencyChat />
                </ChatErrorBoundary>
              </SOPGuard>
            </PrivateRoute>
          }
        />
        
        <Route
          path="/admin/chat"
          element={
            <PrivateRoute>
              <RequireRole allowedRoles={["admin", "committee"]}>
                <AdminChatLogs />
              </RequireRole>
            </PrivateRoute>
          }
        />
        
        <Route
          path="/profile"
          element={
            <PrivateRoute>
              <SOPGuard>
                <Profile />
              </SOPGuard>
            </PrivateRoute>
          }
        />
        
        <Route
          path="/vehicles"
          element={
            <PrivateRoute>
              <SOPGuard>
                <Vehicles />
              </SOPGuard>
            </PrivateRoute>
          }
        />
        
        <Route
          path="/guide"
          element={
            <PrivateRoute>
              <SOPGuard>
                <Guide />
              </SOPGuard>
            </PrivateRoute>
          }
        />
        
        <Route
          path="/about"
          element={
            <PrivateRoute>
              <SOPGuard>
                <About />
              </SOPGuard>
            </PrivateRoute>
          }
        />
        
        <Route
          path="/leaderboard"
          element={
            <PrivateRoute>
              <SOPGuard>
                <Leaderboard />
              </SOPGuard>
            </PrivateRoute>
          }
        />
        
        <Route
          path="/admin"
          element={
            <PrivateRoute>
              <RequireRole allowedRoles={["admin", "committee"]}>
                <AdminDashboard />
              </RequireRole>
            </PrivateRoute>
          }
        />
        
        <Route
          path="/admin/users"
          element={
            <PrivateRoute>
              <RequireRole allowedRoles={["admin", "committee"]}>
                <UserManagement />
              </RequireRole>
            </PrivateRoute>
          }
        />
        
        <Route
          path="/admin/print"
          element={
            <PrivateRoute>
              <RequireRole allowedRoles={["admin", "committee"]}>
                <PrintPatrolLogs />
              </RequireRole>
            </PrivateRoute>
          }
        />
        
        <Route
          path="/admin/incidents"
          element={
            <PrivateRoute>
              <RequireRole allowedRoles={["admin", "committee"]}>
                <IncidentModeration />
              </RequireRole>
            </PrivateRoute>
          }
        />
        
        {/* Intelligence Routes */}
        <Route
          path="/intelligence"
          element={
            <PrivateRoute>
              <RequireRole allowedRoles={["admin", "committee", "patroller"]}>
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
                allowedRoles={["admin", "committee", "patroller", "investigator"]}
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
              <RequireRole allowedRoles={["admin", "committee"]}>
                <MobileProfileView />
              </RequireRole>
            </PrivateRoute>
          }
        />
        
        <Route
          path="/intelligence/nearby"
          element={
            <PrivateRoute>
              <RequireRole allowedRoles={["admin", "committee"]}>
                <div className="min-h-screen bg-gray-100 dark:bg-gray-900 p-6">
                  <div className="max-w-4xl mx-auto">
                    <Link
                      to="/intelligence"
                      className="inline-flex items-center gap-2 text-sm text-teal-600 dark:text-teal-400 hover:underline mb-6"
                    >
                      ← Intelligence home
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
              <RequireRole allowedRoles={["admin", "committee", "patroller"]}>
                <ProfileSearch />
              </RequireRole>
            </PrivateRoute>
          }
        />
        
        <Route
          path="/intelligence/matches"
          element={
            <PrivateRoute>
              <RequireRole allowedRoles={["admin", "committee"]}>
                <MatchQueue />
              </RequireRole>
            </PrivateRoute>
          }
        />

        <Route
          path="/intelligence/profiles/new"
          element={
            <PrivateRoute>
              <RequireRole allowedRoles={["admin", "committee", "patroller"]}>
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
      <AuthProvider>
        <AppRoutes />
        <MobilePatrolDockHost />
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;