// src/pages/Dashboard.jsx
import { useState, useEffect, useCallback, useMemo } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/useAuth";
import { supabase } from "../supabase/client";
import { playChatNotification } from '../utils/sound';
import { useChatNotifications } from '../chat/hooks/useChatNotifications';
import { useUnreadCount } from '../chat/hooks/useUnreadCount';
import {
  CHAT_CHANNEL_PATROL,
  CHAT_CHANNEL_RESIDENT,
  canAccessPatrolOpsChat,
  defaultChatChannel,
} from '../chat/utils/chatChannels';
import { useSharedGeolocation } from '../hooks/useSharedGeolocation';
import ActiveThreatsBanner from "../components/patrol/ActiveThreatsBanner";
import ActiveSosBanner from "../components/patrol/ActiveSosBanner";
import PatrollerPhotoPreview from '../components/patrol/PatrollerPhotoPreview';
import ErrorState from '../components/ui/ErrorState';
import PageSkeleton from '../components/layout/PageSkeleton';
import { canAccessAdminPanel, canReviewFeedback, isStaffForModerationAlerts } from '../auth/staffRoles';
import { canAccessPatrolSchedule, canAccessSosBoard, canStartOrEndPatrol, canStaffVerifyResident, canUseHouseholdMode, canViewCityHub, canViewIntelligence, homePathForRole, isHouseholdModeRole } from '../auth/roleMatrix';
import { hasHydratedAppRole } from '../auth/appRole';
import { useProfileAccessGate } from '../auth/useProfileAccessGate';
import ProfileLoadRecovery from '../components/ProfileLoadRecovery';
import { useActiveOrganization } from '../auth/useActiveOrganization';
import { useScopedOrganization } from '../utils/organizationScope';
import { useUnreadCityHubCount } from '../hooks/useUnreadCityHubCount';
import { useEquipmentPendingCounts } from '../hooks/useEquipmentPendingCounts';
import { equipmentAdminBadgeCount, equipmentMyBadgeCount } from '../utils/equipment';
import { normalizeVehicleType } from '../components/VehicleIcon';
import { isLightMobilityVehicleType, getVehicleTypePublicLabel } from '../utils/vehicleTypeConstants';
import { formatWatchDate } from '../utils/watchTime';
import { chatNotificationTag } from '../utils/chatNotificationGuard';
import PatrolShareSheet from '../components/patrol/share/PatrolShareSheet';
import { DEFAULT_SHARE_TIME_ZONE } from '../utils/patrolFormat';
import { playThrottled } from './dashboard/patrolTiming';
import { usePatrolLifecycle } from './dashboard/usePatrolLifecycle';
import DashboardHeader from './dashboard/DashboardHeader';
import ActivePatrolsPanel from './dashboard/ActivePatrolsPanel';
import PatrolStatusColumn from './dashboard/PatrolStatusColumn';
import GpsTrackingPanel from './dashboard/GpsTrackingPanel';
import DashboardProfileCard from './dashboard/DashboardProfileCard';
import DashboardPrimaryActions from './dashboard/DashboardPrimaryActions';
import DashboardShortcutGrid from './dashboard/DashboardShortcutGrid';
import { PatrolWarningModal, VehiclePickerModal } from './dashboard/PatrolDialogs';

export default function Dashboard() {
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const { view: profileView, retryProfile, signOut: gateSignOut } = useProfileAccessGate();
  const { activeOrganization, isGlobalOperator } = useActiveOrganization();
  const { scope, activeOrganizationId, includeUnscoped } = useScopedOrganization();
  const equipmentCounts = useEquipmentPendingCounts(Boolean(user?.id), activeOrganizationId);
  const equipmentMine = equipmentMyBadgeCount(equipmentCounts);
  const equipmentBadge = equipmentMine + equipmentAdminBadgeCount(equipmentCounts);

  const userLocation = useSharedGeolocation('banner');

  const isOpsChat = canAccessPatrolOpsChat(user?.role);
  const { count: patrolUnread, refetch: refetchPatrolUnread } = useUnreadCount(
    isOpsChat ? user?.id : null,
    CHAT_CHANNEL_PATROL
  );
  const { count: neighbourUnread, refetch: refetchNeighbourUnread } = useUnreadCount(
    isOpsChat ? user?.id : null,
    CHAT_CHANNEL_RESIDENT
  );
  const { count: residentUnread, refetch: refetchResidentUnread } = useUnreadCount(
    !isOpsChat ? user?.id : null,
    defaultChatChannel(user?.role)
  );
  const unreadCount = isOpsChat ? patrolUnread + neighbourUnread : residentUnread;
  const refetchUnread = useCallback(() => {
    if (isOpsChat) {
      refetchPatrolUnread();
      refetchNeighbourUnread();
    } else {
      refetchResidentUnread();
    }
  }, [isOpsChat, refetchPatrolUnread, refetchNeighbourUnread, refetchResidentUnread]);

  const handleNewMessage = useCallback((message) => {
    refetchUnread();
    if (Notification.permission === 'granted') {
      const title = message?.is_critical
        ? 'SOS'
        : message?.visibility === 'resident'
          ? 'Neighbour chat'
          : 'Patrol ops';
      new Notification(title, {
        body: `${message.sender_name}: ${message.text?.substring(0, 50)}...`,
        icon: '/favicon.ico',
        tag: chatNotificationTag(message),
      });
    }
  }, [refetchUnread]);

  useChatNotifications(user?.id, handleNewMessage);

  const [pendingIncidentCount, setPendingIncidentCount] = useState(0);

  const fetchPendingIncidentCount = useCallback(async () => {
    if (!isStaffForModerationAlerts(user?.role)) return;
    try {
      const { count, error } = await scope(
        supabase.from("incidents").select("*", { count: "exact", head: true })
      ).eq("status", "pending").not("type", "ilike", "SOS");
      if (error) throw error;
      setPendingIncidentCount(count || 0);
    } catch {
      /* RLS or network — leave badge unchanged */
    }
  }, [user?.role, scope]);

  const [pendingFeedbackCount, setPendingFeedbackCount] = useState(0);

  const fetchPendingFeedbackCount = useCallback(async () => {
    if (!canReviewFeedback(user?.role)) return;
    try {
      const { count, error } = await scope(
        supabase.from("feedback").select("*", { count: "exact", head: true })
      ).is("reviewed_at", null);
      if (error) throw error;
      setPendingFeedbackCount(count || 0);
    } catch {
      /* RLS or missing table before migration */
    }
  }, [user?.role, scope]);

  useEffect(() => {
    if (!isStaffForModerationAlerts(user?.role)) {
      setPendingIncidentCount(0);
      return undefined;
    }
    void fetchPendingIncidentCount();
    const channel = supabase
      .channel("dashboard-pending-incidents")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "incidents" },
        () => {
          void fetchPendingIncidentCount();
        }
      )
      .subscribe();
    const onVisible = () => {
      if (document.visibilityState === "visible") void fetchPendingIncidentCount();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      supabase.removeChannel(channel);
    };
  }, [user?.role, fetchPendingIncidentCount]);

  useEffect(() => {
    if (!canReviewFeedback(user?.role)) {
      setPendingFeedbackCount(0);
      return undefined;
    }
    void fetchPendingFeedbackCount();
    const channel = supabase
      .channel("dashboard-pending-feedback")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "feedback" },
        (payload) => {
          void fetchPendingFeedbackCount();
          if (payload.eventType === "INSERT") {
            playThrottled("dashboard-feedback", playChatNotification);
            if (typeof Notification !== "undefined" && Notification.permission === "granted") {
              try {
                new Notification("New feedback submitted", {
                  body: "Open Admin → Feedback reviews",
                });
              } catch {
                /* ignore */
              }
            }
          }
        }
      )
      .subscribe();
    const onVisible = () => {
      if (document.visibilityState === "visible") void fetchPendingFeedbackCount();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      supabase.removeChannel(channel);
    };
  }, [user?.role, fetchPendingFeedbackCount]);

  useEffect(() => {
    if (typeof navigator === 'undefined') return;
    const nav = navigator;
    if (unreadCount > 0 && 'setAppBadge' in nav && typeof nav.setAppBadge === 'function') {
      nav.setAppBadge(unreadCount).catch(() => {});
    } else if ('clearAppBadge' in nav && typeof nav.clearAppBadge === 'function') {
      nav.clearAppBadge().catch(() => {});
    }
  }, [unreadCount]);

  useEffect(() => {
    let cancelled = false;
    const handleVisibilityChange = () => {
      if (!document.hidden && !cancelled) refetchUnread();
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => { cancelled = true; document.removeEventListener('visibilitychange', handleVisibilityChange); };
  }, [refetchUnread]);

  useEffect(() => {
    let cancelled = false;
    const handleFocus = () => { if (!cancelled) refetchUnread(); };
    window.addEventListener('focus', handleFocus);
    return () => { cancelled = true; window.removeEventListener('focus', handleFocus); };
  }, [refetchUnread]);

  const primaryVehicle = useMemo(() => {
    if (user?.vehicles && user.vehicles.length > 0) {
      return user.vehicles.find(v => v.is_primary) || user.vehicles[0];
    }
    return null;
  }, [user]);

  const primaryVehicleSummaryText = useMemo(() => {
    if (!primaryVehicle) return '';
    const norm = normalizeVehicleType(
      primaryVehicle.vehicle_type,
      primaryVehicle.car_type || user?.carType
    );
    if (isLightMobilityVehicleType(norm)) return getVehicleTypePublicLabel(norm);
    return `${primaryVehicle.make_model}${primaryVehicle.registration ? ` (${primaryVehicle.registration})` : ''}`;
  }, [primaryVehicle, user?.carType]);

  const initials = useMemo(() => {
    if (user?.fullName) {
      return user.fullName.split(" ").map(n => n[0]).join("").toUpperCase().substring(0, 2);
    }
    return user?.email?.charAt(0).toUpperCase() || "U";
  }, [user]);

  const firstName = user?.fullName?.split(" ")[0] || "there";
  const canUsePatrolSchedule = canAccessPatrolSchedule(user?.role);
  const canUseSosBoard = canAccessSosBoard(user?.role);
  const canDoPatrolOps = canStartOrEndPatrol(user?.role);
  const canUseIntelligence = canViewIntelligence(user?.role);
  const canUseCityHub = canViewCityHub(user?.role, user?.platformRole);
  const unreadCityHubCount = useUnreadCityHubCount(canUseCityHub && !!(user?.id || user?.uid), user?.id || user?.uid);
  const canVerifyResidents = canStaffVerifyResident(user?.role);
  const canOpenHousehold = isHouseholdModeRole(user?.role) && canUseHouseholdMode(user?.role);
  const canAccessAdmin = canAccessAdminPanel(user?.role);
  const todayDate = new Date().toLocaleDateString("en-US", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
  });

  const patrol = usePatrolLifecycle({
    user,
    scope,
    activeOrganization,
    activeOrganizationId,
    includeUnscoped,
    canDoPatrolOps,
    refetchUnread,
  });

  if (profileView === "session" || profileView === "pending" || !hasHydratedAppRole(user?.role)) {
    if (profileView === "offline" || profileView === "error") {
      return (
        <ProfileLoadRecovery
          variant={profileView}
          onRetry={() => {
            void retryProfile?.();
          }}
          onSignOut={() => {
            void (gateSignOut || signOut)?.();
          }}
        />
      );
    }
    return <PageSkeleton message="Checking access…" />;
  }
  const home = homePathForRole(user.role, user.platformRole);
  if (home !== "/dashboard") {
    return <Navigate to={home} replace />;
  }

  if (patrol.fetchError && !patrol.activePatrol && patrol.loadingPatrol === false) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <ErrorState
          title="Error loading patrol"
          message={patrol.fetchError}
          onRetry={() => window.location.reload()}
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800 md:pb-8 motion-safe:scroll-smooth">
      {canUseSosBoard ? <ActiveSosBanner /> : null}
      {userLocation && (
        <ActiveThreatsBanner userLocation={userLocation} maxDistanceKm={2} />
      )}
      {patrol.shareTarget ? (
        <PatrolShareSheet
          kind={patrol.shareTarget.kind}
          patrol={patrol.shareTarget.patrol}
          organizationName={activeOrganization?.name || ''}
          timeZone={activeOrganization?.timezone || DEFAULT_SHARE_TIME_ZONE}
          phone={user?.phone || ''}
          viewerUid={user?.uid || ''}
          viewerFullName={user?.fullName || ''}
          viewerNameParts={[user?.user_metadata?.first_name, user?.user_metadata?.last_name]}
          location={userLocation}
          onClose={() => patrol.setShareTarget(null)}
          onShared={(sharedAt) => {
            const ref = patrol.shareTarget.patrol?.share_ref;
            if (patrol.shareTarget.kind === 'start' && ref) {
              patrol.setActivePatrol((prev) => (prev && prev.share_ref === ref ? { ...prev, start_shared_at: sharedAt } : prev));
            }
            patrol.setShareRefreshKey((k) => k + 1);
          }}
        />
      ) : null}

      <div className="max-w-6xl mx-auto px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <DashboardHeader
          user={user}
          firstName={firstName}
          initials={initials}
          todayDate={todayDate}
          activeOrganization={activeOrganization}
          isGlobalOperator={isGlobalOperator}
          onRefresh={patrol.refreshData}
          onOpenProfile={() => navigate('/profile')}
          onChangeArea={() => navigate("/choose-area")}
        />

        <ActivePatrolsPanel
          fetchAllError={patrol.fetchAllError}
          fetchAllLoading={patrol.fetchAllLoading}
          allActivePatrols={patrol.allActivePatrols}
          viewer={user}
          nowMs={patrol.nowMs}
          onRetry={patrol.refreshData}
          onPreviewPhoto={patrol.setPatrolPhotoPreview}
        />

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 mb-8 items-stretch">
          <PatrolStatusColumn
            activePatrol={patrol.activePatrol}
            canDoPatrolOps={canDoPatrolOps}
            canUsePatrolSchedule={canUsePatrolSchedule}
            shareRefreshKey={patrol.shareRefreshKey}
            onOpenShare={patrol.setShareTarget}
            elapsed={patrol.elapsed}
            loadingPatrol={patrol.loadingPatrol}
            onCheckIn={patrol.handleCheckIn}
            onCheckOut={patrol.handleCheckOut}
            upcomingScheduleRefresh={patrol.upcomingScheduleRefresh}
          />
          {patrol.activePatrol && (
            <GpsTrackingPanel
              isTracking={patrol.isTracking}
              totalDistance={patrol.totalDistance}
              routePoints={patrol.routePoints}
            />
          )}
          <DashboardProfileCard
            user={user}
            primaryVehicle={primaryVehicle}
            primaryVehicleSummaryText={primaryVehicleSummaryText}
          />
        </div>

        <DashboardPrimaryActions
          onReportIncident={() => navigate("/incident/new")}
          onOpenChat={() => {
            if (isOpsChat && neighbourUnread > 0 && patrolUnread === 0) {
              navigate('/chat?room=resident');
            } else if (isOpsChat) {
              navigate('/chat?room=patrol');
            } else {
              navigate('/chat');
            }
          }}
          isOpsChat={isOpsChat}
          patrolUnread={patrolUnread}
          neighbourUnread={neighbourUnread}
          unreadCount={unreadCount}
          onOpenPatrolChat={() => navigate('/chat?room=patrol')}
          onOpenNeighbourChat={() => navigate('/chat?room=resident')}
          canUseIntelligence={canUseIntelligence}
          onOpenIntelligence={() => navigate('/intelligence')}
        />

        <DashboardShortcutGrid
          canOpenHousehold={canOpenHousehold}
          canUsePatrolSchedule={canUsePatrolSchedule}
          canUseIntelligence={canUseIntelligence}
          canUseSosBoard={canUseSosBoard}
          canVerifyResidents={canVerifyResidents}
          canAccessAdmin={canAccessAdmin}
          canUseCityHub={canUseCityHub}
          equipmentMine={equipmentMine}
          equipmentBadge={equipmentBadge}
          pendingIncidentCount={pendingIncidentCount}
          pendingFeedbackCount={pendingFeedbackCount}
          unreadCityHubCount={unreadCityHubCount}
          onNavigate={navigate}
        />

        <div className="mt-8 text-center text-xs text-gray-500 dark:text-gray-400 flex justify-between items-center border-t border-gray-200 dark:border-gray-700 pt-4">
          <span>Neighbourhood Watch Platform • Member since {user?.createdAt ? formatWatchDate(user.createdAt) || "recently" : "recently"}</span>
          <button type="button" onClick={signOut} className="text-gray-500 dark:text-gray-400 hover:text-red-600 dark:hover:text-red-400 transition text-xs underline">Sign Out</button>
        </div>
      </div>

      <PatrolWarningModal
        showWarning={patrol.showWarning}
        autoCloseAt={patrol.autoCloseAt}
        startTime={patrol.startTime}
        warningTriggeredRef={patrol.warningTriggeredRef}
        onDismissWarning={() => patrol.setShowWarning(false)}
        onScheduleAutoClose={patrol.setAutoCloseAt}
        onEndPatrol={() => patrol.handleCheckOut(false)}
      />
      <VehiclePickerModal
        open={patrol.showVehiclePicker}
        vehicles={patrol.vehiclesList}
        onPick={(vehicleId) => {
          patrol.setShowVehiclePicker(false);
          patrol.startPatrolWithVehicle(vehicleId);
        }}
        onClose={() => patrol.setShowVehiclePicker(false)}
      />

      <PatrollerPhotoPreview
        open={!!patrol.patrolPhotoPreview}
        onClose={() => patrol.setPatrolPhotoPreview(null)}
        name={patrol.patrolPhotoPreview?.name}
        imageUrl={patrol.patrolPhotoPreview?.imageUrl}
      />
    </div>
  );
}
