import { Routes, Route, Navigate } from "react-router-dom";
import { Suspense } from "react";
import RequireRole from "../components/RequireRole";
import RequirePlatformRole from "../components/RequirePlatformRole";
import RequireCapability from "../components/RequireCapability";
import { WISHLIST_MANAGER_ROLES } from "../utils/equipmentWishlist";
import { EQUIPMENT_MANAGER_ROLES } from "../utils/equipment";
import RequireActiveOrganization from "../components/RequireActiveOrganization";
import { ADMIN_PANEL_ROLES } from "../auth/staffRoles";
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
} from "../auth/roleMatrix";
import ChatErrorBoundary from '../components/ChatErrorBoundary';
import PageSkeleton from "../components/layout/PageSkeleton";
import { AuthBootstrapGate, PrivateRoute, NeighborhoodRoute } from "./routeGuards";
import {
  Login,
  Register,
  PrivacyPolicy,
  TermsOfUse,
  Dashboard,
  PatrolSchedule,
  AdminDashboard,
  UserManagement,
  AdminResidents,
  AdminMemberProfiles,
  AdminResidentProfiles,
  PrintPatrolLogs,
  IncidentForm,
  IncidentList,
  IncidentModeration,
  PrintIncidents,
  CriminalProfileDetail,
  IncidentDetail,
  PrintIncidentDetail,
  MobileProfileView,
  IntelligenceHome,
  ProfileSearch,
  MatchQueue,
  CreateProfile,
  Hotspots,
  EmergencyChat,
  AdminChatLogs,
  AdminWatchStaffActivity,
  AdminFeedbackReviews,
  Profile,
  Vehicles,
  Guide,
  About,
  ConfirmEmail,
  ForgotPassword,
  UpdatePassword,
  Leaderboard,
  ResidentDashboard,
  ResidentSos,
  ResidentActivityReport,
  ResidentActivityList,
  ResidentNeighbours,
  ResidentSector,
  OrganizationOnboarding,
  CityHub,
  BillingDashboard,
  SecurityMembershipReview,
  SecurityCompanyInsights,
  SecurityCompanyDashboard,
  SecuritySosBoard,
  SecurityBranding,
  EmergencyContacts,
  ServiceListingForm,
  ServiceListingDetail,
  MyServiceListings,
  ResidentGuide,
  AreaBroadcast,
  ResidentModeration,
  NeedsBoard,
  NeedsItemPage,
  EquipmentCatalogue,
  EquipmentItemPage,
  EquipmentUnitPage,
  EquipmentQrResolve,
  EquipmentAdminDashboard,
  EquipmentAdminStocktake,
  EquipmentAdminItems,
  EquipmentAdminLabels,
  EquipmentMine,
  EquipmentAdminRequests,
  EquipmentAdminCertifications,
  EquipmentAdminMaintenance,
  EquipmentHandover,
  NeedsAdmin,
  CityAdminDashboard,
  SosEscalationBoard,
  PilotReadiness,
  RoleAccessGuide,
  ChooseArea,
  ShareCardFixtures,
} from "./lazyPages";

export default function AppRoutes() {
  return (
    <Suspense fallback={<PageSkeleton message="Loading…" />}>
      <Routes>
        {ShareCardFixtures ? <Route path="/dev/share-card" element={<ShareCardFixtures />} /> : null}
        <Route path="/privacy" element={<PrivacyPolicy />} />
        <Route path="/terms" element={<TermsOfUse />} />
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
          path="/resident/broadcast"
          element={
            <NeighborhoodRoute>
              <RequireCapability
                anyCapabilities={["resident_broadcaster", "resident_moderator"]}
                allowedRoles={AREA_BROADCAST_ROLES}
                allowPlatformConsole
              >
                <AreaBroadcast />
              </RequireCapability>
            </NeighborhoodRoute>
          }
        />

        <Route
          path="/resident/moderate"
          element={
            <NeighborhoodRoute>
              <RequireCapability
                anyCapabilities={["resident_moderator"]}
                allowedRoles={INCIDENT_STAFF_ROLES}
                allowPlatformConsole
              >
                <ResidentModeration />
              </RequireCapability>
            </NeighborhoodRoute>
          }
        />

        <Route
          path="/resident/needs"
          element={
            <NeighborhoodRoute>
              <RequireRole allowedRoles={RESIDENT_HOME_ROLES} allowPlatformConsole>
                <NeedsBoard />
              </RequireRole>
            </NeighborhoodRoute>
          }
        />

        <Route
          path="/resident/needs/:id"
          element={
            <NeighborhoodRoute>
              <RequireRole allowedRoles={RESIDENT_HOME_ROLES} allowPlatformConsole>
                <NeedsItemPage />
              </RequireRole>
            </NeighborhoodRoute>
          }
        />

        <Route
          path="/needs"
          element={
            <NeighborhoodRoute>
              <RequireRole allowedRoles={PATROL_MEMBER_ROLES} allowPlatformConsole>
                <NeedsBoard />
              </RequireRole>
            </NeighborhoodRoute>
          }
        />

        <Route
          path="/needs/:id"
          element={
            <NeighborhoodRoute>
              <RequireRole allowedRoles={PATROL_MEMBER_ROLES} allowPlatformConsole>
                <NeedsItemPage />
              </RequireRole>
            </NeighborhoodRoute>
          }
        />
        <Route
          path="/equipment"
          element={
            <NeighborhoodRoute>
              <RequireRole allowedRoles={PATROL_MEMBER_ROLES} allowPlatformConsole>
                <EquipmentCatalogue />
              </RequireRole>
            </NeighborhoodRoute>
          }
        />
        <Route
          path="/equipment/mine"
          element={
            <NeighborhoodRoute>
              <RequireRole allowedRoles={PATROL_MEMBER_ROLES} allowPlatformConsole>
                <EquipmentMine />
              </RequireRole>
            </NeighborhoodRoute>
          }
        />
        <Route
          path="/equipment/items/:id"
          element={
            <NeighborhoodRoute>
              <RequireRole allowedRoles={PATROL_MEMBER_ROLES} allowPlatformConsole>
                <EquipmentItemPage />
              </RequireRole>
            </NeighborhoodRoute>
          }
        />
        <Route
          path="/equipment/units/:id"
          element={
            <NeighborhoodRoute>
              <RequireRole allowedRoles={PATROL_MEMBER_ROLES} allowPlatformConsole>
                <EquipmentUnitPage />
              </RequireRole>
            </NeighborhoodRoute>
          }
        />
        <Route
          path="/equipment/u/:qrToken"
          element={
            <NeighborhoodRoute>
              <RequireRole allowedRoles={PATROL_MEMBER_ROLES} allowPlatformConsole>
                <EquipmentQrResolve />
              </RequireRole>
            </NeighborhoodRoute>
          }
        />
        <Route
          path="/equipment/admin"
          element={
            <PrivateRoute>
              <RequireRole allowedRoles={EQUIPMENT_MANAGER_ROLES} allowPlatformConsole>
                <RequireActiveOrganization>
                  <EquipmentAdminDashboard />
                </RequireActiveOrganization>
              </RequireRole>
            </PrivateRoute>
          }
        />
        <Route
          path="/equipment/admin/stocktake"
          element={
            <PrivateRoute>
              <RequireRole allowedRoles={EQUIPMENT_MANAGER_ROLES} allowPlatformConsole>
                <RequireActiveOrganization>
                  <EquipmentAdminStocktake />
                </RequireActiveOrganization>
              </RequireRole>
            </PrivateRoute>
          }
        />
        <Route
          path="/equipment/admin/items"
          element={
            <PrivateRoute>
              <RequireRole allowedRoles={EQUIPMENT_MANAGER_ROLES} allowPlatformConsole>
                <RequireActiveOrganization>
                  <EquipmentAdminItems />
                </RequireActiveOrganization>
              </RequireRole>
            </PrivateRoute>
          }
        />
        <Route
          path="/equipment/admin/labels"
          element={
            <PrivateRoute>
              <RequireRole allowedRoles={EQUIPMENT_MANAGER_ROLES} allowPlatformConsole>
                <RequireActiveOrganization>
                  <EquipmentAdminLabels />
                </RequireActiveOrganization>
              </RequireRole>
            </PrivateRoute>
          }
        />
        <Route
          path="/equipment/admin/requests"
          element={
            <PrivateRoute>
              <RequireRole allowedRoles={EQUIPMENT_MANAGER_ROLES} allowPlatformConsole>
                <RequireActiveOrganization>
                  <EquipmentAdminRequests />
                </RequireActiveOrganization>
              </RequireRole>
            </PrivateRoute>
          }
        />
        <Route
          path="/equipment/handover/:transferId"
          element={
            <NeighborhoodRoute>
              <RequireRole allowedRoles={PATROL_MEMBER_ROLES} allowPlatformConsole>
                <EquipmentHandover />
              </RequireRole>
            </NeighborhoodRoute>
          }
        />
        <Route
          path="/equipment/admin/maintenance"
          element={
            <PrivateRoute>
              <RequireRole allowedRoles={EQUIPMENT_MANAGER_ROLES} allowPlatformConsole>
                <RequireActiveOrganization>
                  <EquipmentAdminMaintenance />
                </RequireActiveOrganization>
              </RequireRole>
            </PrivateRoute>
          }
        />
        <Route
          path="/equipment/admin/certifications"
          element={
            <PrivateRoute>
              <RequireRole allowedRoles={EQUIPMENT_MANAGER_ROLES} allowPlatformConsole>
                <RequireActiveOrganization>
                  <EquipmentAdminCertifications />
                </RequireActiveOrganization>
              </RequireRole>
            </PrivateRoute>
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
          path="/resident/services/new"
          element={
            <NeighborhoodRoute>
              <RequireRole allowedRoles={RESIDENT_HOME_ROLES}>
                <ServiceListingForm />
              </RequireRole>
            </NeighborhoodRoute>
          }
        />
        <Route
          path="/resident/services/mine"
          element={
            <NeighborhoodRoute>
              <RequireRole allowedRoles={RESIDENT_HOME_ROLES}>
                <MyServiceListings />
              </RequireRole>
            </NeighborhoodRoute>
          }
        />
        <Route
          path="/resident/services/:id/edit"
          element={
            <NeighborhoodRoute>
              <RequireRole allowedRoles={RESIDENT_HOME_ROLES}>
                <ServiceListingForm />
              </RequireRole>
            </NeighborhoodRoute>
          }
        />
        <Route
          path="/resident/services/:id"
          element={
            <NeighborhoodRoute>
              <RequireRole allowedRoles={RESIDENT_HOME_ROLES}>
                <ServiceListingDetail />
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
        
        {/*
          /chat is shared on purpose. Residents open Neighbours
          (defaultChatChannel); canAccessPatrolOpsChat is false for them, so
          ChatContainer never selects the patrol room. Patrol rows are denied
          by RLS (chat_messages_select_channel: visibility = 'resident' OR
          is_chat_ops_member()), not by a route role guard.
        */}
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
              <RequireRole allowedRoles={[...GLOBAL_APP_ROLES, "nw_admin"]} allowPlatformConsole>
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
          path="/admin/needs"
          element={
            <PrivateRoute>
              <RequireCapability
                anyCapabilities={["equipment_custodian"]}
                allowedRoles={WISHLIST_MANAGER_ROLES}
                allowPlatformConsole
              >
                <RequireActiveOrganization>
                  <NeedsAdmin />
                </RequireActiveOrganization>
              </RequireCapability>
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

        {/*
          Static role matrix, no neighborhood queries. Global admins can open
          it before an area is selected, so this route does not use
          RequireActiveOrganization.
        */}
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