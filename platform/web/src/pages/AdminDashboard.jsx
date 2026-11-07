// src/pages/AdminDashboard.jsx
import { useState, useEffect, useCallback, useMemo, useRef, lazy, Suspense } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/useAuth";
import { hasHydratedAppRole } from "../auth/appRole";
import { canAccessAdminPanel, canReviewFeedback } from "../auth/staffRoles";
import { canAccessPlatformConsole } from "../auth/platformRoles";
import { canPreviewResidentHome, canManageEmergencyDirectory, canPostAreaBroadcast, canUseHouseholdMode, isGlobalAppRole, isHouseholdModeRole, canReviewPatrollerRequests, normalizeAppRole } from "../auth/roleMatrix";
import { supabase } from "../supabase/client";
import { useSupabaseQuery } from "../hooks/useSupabaseQuery";
import toast from '../utils/notify';
import { FaArrowLeft, FaFileExcel, FaPrint, FaFilePdf, FaUsers, FaClock, FaShieldAlt, FaTrophy, FaToolbox } from "react-icons/fa";
import LivePatrolMap from '../components/LivePatrolMap';
import AdminPatrolRoutesSection from '../components/admin/AdminPatrolRoutesSection';
import HouseholdsAwayCard from '../components/patrol/HouseholdsAwayCard';
import { enrichPatrolRowsWithAvatars } from '../utils/enrichPatrolAvatars';
import PatrollerPhotoPreview from '../components/patrol/PatrollerPhotoPreview';
import { ChartSkeleton, StatCard, SectionCard } from '../components/admin/dashboard/AdminDashboardWidgets';
import {
  OnPatrolSection,
  TopVolunteersSection,
  RecentActivitySection,
  PatrolSlotsSection,
} from '../components/admin/dashboard/AdminDashboardSections';
import ThemeToggle from '../components/ThemeToggle';
import AppNotificationBell from '../components/layout/AppNotificationBell';
import BrandedLoader from '../components/layout/BrandedLoader';
import { DEFAULT_PATROL_ZONE, displayPatrolZone, displayWatchAreaName } from '../config/neighborhoodRegions';
import { adaptivePollIntervalMs, subscribeDataBudgetHints } from '../utils/dataSaverProfile';
import { useActiveOrganization } from '../auth/useActiveOrganization';
import { useScopedOrganization } from '../utils/organizationScope';
import { periodStartDate, logOverlapsSince, watchDayStamp, addCalendarDays, parsePatrolTime, durationMinutesFromLog } from '../utils/watchTime';
import { fetchAllQueryPages } from '../utils/fetchPagedRows';
import AreaContextBar from '../components/layout/AreaContextBar';
import AdminToolsMenu from '../components/admin/AdminToolsMenu';
import { canManageWishlist } from '../utils/equipmentWishlist';
import { canManageEquipment as canManageEquipmentRole, equipmentAdminBadgeCount } from '../utils/equipment';
import { useEquipmentPendingCounts } from '../hooks/useEquipmentPendingCounts';
import { useNewWishlistOffersCount } from '../hooks/useNewWishlistOffersCount';
import { countPendingPatrollerRequests } from '../utils/residentVerification';

const adminCharts = () => import('../components/admin/AdminPatrolCharts');
const AdminVolunteerHoursChart = lazy(() => adminCharts().then((m) => ({ default: m.AdminVolunteerHoursChart })));
const AdminLast7Chart = lazy(() => adminCharts().then((m) => ({ default: m.AdminLast7Chart })));

export default function AdminDashboard() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { activeOrganizationId, activeOrganization } = useActiveOrganization();
  const { scope } = useScopedOrganization();

  // Role guard (skip until public.users.role is loaded — not JWT "authenticated")
  useEffect(() => {
    if (!user) return;
    if (!hasHydratedAppRole(user.role)) return;
    if (!canAccessAdminPanel(user.role)) {
      toast.error("Access denied.");
      navigate("/dashboard", { replace: true });
    }
  }, [user, navigate]);

  const [activePatrols, setActivePatrols] = useState([]);
  const [activePatrolsLoading, setActivePatrolsLoading] = useState(true);
  const [activePatrolsError, setActivePatrolsError] = useState(null);
  const [recentActivity, setRecentActivity] = useState([]);
  const [recentActivityLoading, setRecentActivityLoading] = useState(false);
  const [recentActivityError, setRecentActivityError] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [patrolPhotoPreview, setPatrolPhotoPreview] = useState(null);
  const [forceEndBusyId, setForceEndBusyId] = useState(null);
  const [slotDeleteBusy, setSlotDeleteBusy] = useState(false);
  const activePatrolsGen = useRef(0);
  const recentActivityGen = useRef(0);
  const [todayLocal, setTodayLocal] = useState(() => watchDayStamp());

  useEffect(() => {
    const syncDay = () => {
      const next = watchDayStamp();
      setTodayLocal((prev) => (prev === next ? prev : next));
    };
    const id = window.setInterval(syncDay, 60_000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') syncDay();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  const isFeedbackReviewer = canReviewFeedback(user?.role);
  const isPatrollerReviewer = canReviewPatrollerRequests(user?.role);
  const isPlatformConsoleUser = canAccessPlatformConsole(user?.platformRole);
  const isGlobalAppUser = isGlobalAppRole(user?.role);
  const canOpenResidentPreview = canPreviewResidentHome(user?.role);
  const canOpenHousehold = isHouseholdModeRole(user?.role) && canUseHouseholdMode(user?.role);
  const canEditEmergencyContacts = canManageEmergencyDirectory(user?.role, user?.platformRole);
  const canSendAreaNotice = canPostAreaBroadcast(user?.role, user?.platformRole);
  const canManageNeeds = canManageWishlist(user?.role, user?.platformRole);
  const canManageEquipment = canManageEquipmentRole(user?.role, user?.platformRole);
  const equipmentPendingCount = equipmentAdminBadgeCount(useEquipmentPendingCounts(canManageEquipment, activeOrganizationId));
  const { count: newOffersCount } = useNewWishlistOffersCount(canManageNeeds, user?.id, activeOrganizationId);
  const canOpenAuditLog = isGlobalAppUser || normalizeAppRole(user?.role) === "nw_admin";

  // ---------------------------------------------------------------------------
  // useSupabaseQuery hooks
  // ---------------------------------------------------------------------------
  const fetchPatrolLogs = useCallback(async () => {
    return fetchAllQueryPages(() =>
      scope(supabase.from('patrol_logs').select('*')).order('start_time', { ascending: false, nullsFirst: false })
    );
  }, [scope]);

  const fetchPatrolSlots = useCallback(async () => {
    const { data, error } = await scope(
      supabase.from('patrol_slots').select('*')
    )
      .gte('date', todayLocal)
      .order('date', { ascending: true })
      .order('start_time', { ascending: true });
    if (error) throw error;
    return data || [];
  }, [todayLocal, scope]);

  const fetchPendingCount = useCallback(async () => {
    const { count, error } = await scope(
      supabase.from('incidents').select('*', { count: 'exact', head: true })
      ).eq('status', 'pending').not('type', 'ilike', 'SOS');
    if (error) throw error;
    return count || 0;
  }, [scope]);

  const fetchPendingFeedbackCount = useCallback(async () => {
    const { count, error } = await scope(
      supabase.from('feedback').select('*', { count: 'exact', head: true })
    ).is('reviewed_at', null);
    if (error) throw error;
    return count || 0;
  }, [scope]);

  const { data: patrolLogs = [], loading: logsLoading, error: logsError, refetch: refetchLogs } =
    useSupabaseQuery(fetchPatrolLogs, [activeOrganizationId]);
  const { data: patrolSlots = [], loading: slotsLoading, error: slotsError, refetch: refetchSlots } =
    useSupabaseQuery(fetchPatrolSlots, [activeOrganizationId, todayLocal]);
  const { data: pendingCount = 0, loading: pendingLoading, error: pendingError, refetch: refetchPending } =
    useSupabaseQuery(fetchPendingCount, [activeOrganizationId]);
  const {
    data: pendingFeedbackCount = 0,
    loading: pendingFeedbackLoading,
    error: pendingFeedbackError,
    refetch: refetchPendingFeedback,
  } = useSupabaseQuery(fetchPendingFeedbackCount, [user?.role, activeOrganizationId], { enabled: isFeedbackReviewer });

  const fetchPendingPatrollerCount = useCallback(async () => {
    return countPendingPatrollerRequests();
  }, []);
  const { data: pendingPatrollerCount = 0 } = useSupabaseQuery(
    fetchPendingPatrollerCount,
    [user?.role, activeOrganizationId],
    { enabled: isPatrollerReviewer }
  );

  // Patrol signups table is static after initial load unless we refetch — volunteers delete from Schedule without this page mounted.
  useEffect(() => {
    if (!user) return undefined;
    const ch = supabase
      .channel("admin-patrol-slots-live")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "patrol_slots" },
        () => {
          void refetchSlots();
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [user, refetchSlots]);

  useEffect(() => {
    if (!user || !isFeedbackReviewer) return undefined;
    const ch = supabase
      .channel("admin-feedback-count-live")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "feedback" },
        () => {
          void refetchPendingFeedback();
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [user, isFeedbackReviewer, refetchPendingFeedback]);

  // ---------------------------------------------------------------------------
  // Active patrols with realtime
  // ---------------------------------------------------------------------------
  const fetchActivePatrols = useCallback(async (opts = {}) => {
    const silent = opts.silent === true;
    const gen = ++activePatrolsGen.current;
    if (!silent) setActivePatrolsLoading(true);
    try {
      const { data, error } = await scope(supabase.from('active_patrols').select('*'));
      if (error) throw error;
      const enriched = await enrichPatrolRowsWithAvatars(supabase, data || []);
      if (gen !== activePatrolsGen.current) return;
      setActivePatrols(enriched);
      setActivePatrolsError(null);
    } catch (err) {
      if (gen !== activePatrolsGen.current) return;
      setActivePatrolsError(err.message);
    } finally {
      if (gen === activePatrolsGen.current && !silent) setActivePatrolsLoading(false);
    }
  }, [scope]);

  useEffect(() => {
    fetchActivePatrols();
    const channel = supabase
      .channel('admin-active-patrols')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'active_patrols' }, () =>
        void fetchActivePatrols({ silent: true })
      )
      .subscribe();
    // Realtime alone can miss updates if the tab is backgrounded or the socket drops; interval backs off on mobile data saver / slow networks.
    let pollTimeoutId = 0;
    const schedulePoll = () => {
      if (pollTimeoutId) window.clearTimeout(pollTimeoutId);
      const ms = adaptivePollIntervalMs(20000, { maxMs: 120000 });
      pollTimeoutId = window.setTimeout(() => {
        void fetchActivePatrols({ silent: true });
        schedulePoll();
      }, ms);
    };
    schedulePoll();
    const unsubBudget = subscribeDataBudgetHints(() => schedulePoll());
    const onVisible = () => {
      if (document.visibilityState === 'visible') void fetchActivePatrols({ silent: true });
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      if (pollTimeoutId) window.clearTimeout(pollTimeoutId);
      unsubBudget();
      document.removeEventListener('visibilitychange', onVisible);
      supabase.removeChannel(channel);
    };
  }, [fetchActivePatrols]);

  // ---------------------------------------------------------------------------
  // Recent activity (last 24h)
  // ---------------------------------------------------------------------------
  const fetchRecentActivity = useCallback(async () => {
    const gen = ++recentActivityGen.current;
    setRecentActivityLoading(true);
    setRecentActivityError(null);
    try {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const activeQuery = scope(supabase.from('active_patrols').select('*')).gte('start_time', since);
      const completedQuery = scope(supabase.from('patrol_logs').select('*')).gte('start_time', since);
      const [{ data: active, error: e1 }, { data: completed, error: e2 }] = await Promise.all([
        activeQuery,
        completedQuery,
      ]);
      if (e1) throw e1;
      if (e2) throw e2;
      if (gen !== recentActivityGen.current) return;
      const combined = [
        ...(active || []).map(p => ({ ...p, type: 'active', end_time: null, duration_minutes: null })),
        ...(completed || []).map(p => ({ ...p, type: 'completed' })),
      ].sort((a, b) => {
        const tb = parsePatrolTime(b.start_time)?.getTime() ?? 0;
        const ta = parsePatrolTime(a.start_time)?.getTime() ?? 0;
        return tb - ta;
      });
      setRecentActivity(combined);
    } catch (err) {
      if (gen !== recentActivityGen.current) return;
      setRecentActivityError(err.message);
    } finally {
      if (gen === recentActivityGen.current) setRecentActivityLoading(false);
    }
  }, [scope]);

  useEffect(() => {
    void fetchRecentActivity();
    let timeoutId = 0;
    let cancelled = false;
    const schedule = () => {
      if (timeoutId) window.clearTimeout(timeoutId);
      const ms = adaptivePollIntervalMs(60000, { maxMs: 300000 });
      timeoutId = window.setTimeout(() => {
        if (cancelled) return;
        void fetchRecentActivity();
        schedule();
      }, ms);
    };
    schedule();
    const unsub = subscribeDataBudgetHints(() => {
      if (!cancelled) schedule();
    });
    return () => {
      cancelled = true;
      if (timeoutId) window.clearTimeout(timeoutId);
      unsub();
    };
  }, [fetchRecentActivity]);

  // ---------------------------------------------------------------------------
  // Derived stats (memoized)
  // ---------------------------------------------------------------------------
  const stats = useMemo(() => {
    const logs = patrolLogs ?? [];
    const now = new Date();
    const weekStart = periodStartDate('week', now);

    const thisWeek = logs.filter(l => logOverlapsSince(l, weekStart, now));
    const totalMinutes = logs.reduce((s, l) => s + durationMinutesFromLog(l), 0);
    const avgMinutes = logs.length ? Math.round(totalMinutes / logs.length) : 0;

    // Group by user_id when present so two volunteers with the same first name don't merge
    const byVolunteer = logs.reduce((acc, log) => {
      const id =
        log.user_id != null && String(log.user_id).length > 0
          ? String(log.user_id)
          : `name:${(log.user_name || 'unknown').toString()}`;
      const displayName = (log.user_name || log.user_id || 'Unknown').toString().trim();
      if (!acc[id]) acc[id] = { id, displayName, totalMinutes: 0, patrols: 0 };
      acc[id].totalMinutes += durationMinutesFromLog(log);
      acc[id].patrols += 1;
      return acc;
    }, {});
    const volunteerList = Object.values(byVolunteer).sort((a, b) => b.totalMinutes - a.totalMinutes);

    const thirtyAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const byDay = days.map(d => ({ day: d, patrols: 0, hours: 0 }));
    logs.forEach(l => {
      const started = parsePatrolTime(l.start_time);
      if (!started || started < thirtyAgo) return;
      const stamp = watchDayStamp(started);
      if (!stamp) return;
      const [y, m, d] = stamp.split('-').map(Number);
      const dow = new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay();
      byDay[dow].patrols += 1;
      byDay[dow].hours += durationMinutesFromLog(l) / 60;
    });
    byDay.forEach(d => { d.hours = Math.round(d.hours * 10) / 10; });

    const todayStamp = watchDayStamp(now);
    const last7 = Array.from({ length: 7 }, (_, i) => {
      const stamp = addCalendarDays(todayStamp, i - 6);
      const [y, m, d] = stamp.split('-').map(Number);
      const labelDate = new Date(Date.UTC(y, m - 1, d, 12));
      return {
        date: labelDate.toLocaleDateString('en-ZA', { weekday: 'short', day: 'numeric', timeZone: 'UTC' }),
        dateStr: stamp,
        patrols: 0,
        hours: 0,
      };
    });
    logs.forEach(l => {
      const ds = watchDayStamp(l.start_time);
      const entry = last7.find(d => d.dateStr === ds);
      if (entry) {
        entry.patrols += 1;
        entry.hours += durationMinutesFromLog(l) / 60;
      }
    });
    last7.forEach(d => { d.hours = Math.round(d.hours * 10) / 10; });

    const topVolunteers = volunteerList.slice(0, 8).map((v) => ({
      name: v.displayName.split(/\s+/)[0] || v.displayName,
      fullName: v.displayName,
      hours: Math.round((v.totalMinutes / 60) * 10) / 10,
      patrols: v.patrols,
    }));

    return {
      totalPatrols: logs.length,
      thisWeekCount: thisWeek.length,
      totalHours: Math.round(totalMinutes / 60),
      avgDuration: avgMinutes,
      volunteerList,
      topVolunteers,
      byDay,
      last7,
      topVolunteer: volunteerList[0] || null,
    };
  }, [patrolLogs]);

  // ---------------------------------------------------------------------------
  // Force end patrol
  // ---------------------------------------------------------------------------
  const handleForceEnd = async (patrol) => {
    if (!patrol?.user_id || forceEndBusyId) return;
    setForceEndBusyId(patrol.user_id);
    try {
      const end = new Date();
      const started = parsePatrolTime(patrol.start_time);
      const durationMinutes = started
        ? Math.max(1, Math.floor((end.getTime() - started.getTime()) / 60000))
        : 1;
      const { error: insertError } = await supabase.from('patrol_logs').insert({
        user_id: patrol.user_id,
        user_name: patrol.user_name,
        start_time: patrol.start_time,
        end_time: end.toISOString(),
        duration_minutes: durationMinutes,
        zone: displayPatrolZone(patrol.zone) || DEFAULT_PATROL_ZONE,
        auto_closed: false,
        admin_ended: true,
        vehicle_make_model: patrol.vehicle_make_model || patrol.car_type || null,
        vehicle_reg: patrol.vehicle_reg || patrol.reg_number || null,
        vehicle_color: patrol.vehicle_color || 'gray',
        organization_id: activeOrganizationId || patrol.organization_id || user?.organizationId || null,
      });
      if (insertError) throw insertError;
      const { error: deleteError } = await supabase.from('active_patrols').delete().eq('user_id', patrol.user_id);
      if (deleteError) throw deleteError;
      setActivePatrols(prev => prev.filter(p => p.user_id !== patrol.user_id));
      setConfirmEnd(null);
      void refetchLogs();
      void fetchRecentActivity();
      toast.success(`Patrol for ${patrol.user_name} ended.`);
    } catch (err) {
      console.error('Force-end failed:', err);
      toast.error('Failed to end patrol.');
    } finally {
      setForceEndBusyId(null);
    }
  };

  // ---------------------------------------------------------------------------
  // Delete slot
  // ---------------------------------------------------------------------------
  const handleDeleteSlot = async (slotId) => {
    if (!slotId || slotDeleteBusy || forceEndBusyId) return;
    setSlotDeleteBusy(true);
    try {
      const { error } = await supabase.rpc('admin_delete_patrol_slot', {
        p_slot_id: slotId,
      });
      if (error) throw error;
      setConfirmDelete(null);
      refetchSlots();
      toast.success('Slot deleted.');
    } catch (err) {
      toast.error("Delete failed: " + err.message);
    } finally {
      setSlotDeleteBusy(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Export
  // ---------------------------------------------------------------------------
  const exportToExcel = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const ExcelJS = (await import('exceljs')).default;
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Patrol Logs');
      worksheet.columns = [
        { header: 'Volunteer',     key: 'volunteer', width: 20 },
        { header: 'Date',          key: 'date',      width: 15 },
        { header: 'Start Time',    key: 'startTime', width: 15 },
        { header: 'End Time',      key: 'endTime',   width: 15 },
        { header: 'Duration (min)',key: 'duration',  width: 15 },
        { header: 'Zone',          key: 'zone',      width: 10 },
      ];
      worksheet.getRow(1).font = { bold: true };
      worksheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EAF6' } };

      (patrolLogs || []).forEach(log => {
        const start = parsePatrolTime(log.start_time);
        const end = parsePatrolTime(log.end_time);
        worksheet.addRow({
          volunteer: log.user_name || '—',
          date:      start ? start.toLocaleDateString('en-ZA') : '—',
          startTime: start ? start.toLocaleTimeString('en-ZA') : '—',
          endTime:   end ? end.toLocaleTimeString('en-ZA') : '—',
          duration:  durationMinutesFromLog(log) || 0,
          zone:      displayPatrolZone(log.zone) || '—',
        });
      });

      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `patrol_logs_${watchDayStamp()}.xlsx`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      toast.success(`Exported ${(patrolLogs || []).length} patrol logs.`);
    } catch (err) {
      toast.error("Export failed: " + err.message);
    } finally {
      setExporting(false);
    }
  };

  const formatDuration = (minutes) => {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  };

  const formatElapsed = (seconds) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return `${h}h ${m}m`;
  };

  const isLoading =
    activePatrolsLoading ||
    logsLoading ||
    slotsLoading ||
    pendingLoading ||
    (isFeedbackReviewer && pendingFeedbackLoading);
  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-gray-900">
        <BrandedLoader message="Loading admin data…" size="lg" />
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

        {/* Header */}
        <div className="mb-8 space-y-3 border-b border-gray-200 pb-4 dark:border-gray-700">
          <div className="flex items-center gap-2">
            <button
              onClick={() => navigate("/dashboard")}
              className="inline-flex items-center gap-2 px-3 py-2 bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded-xl hover:bg-gray-300 dark:hover:bg-gray-600 transition text-sm font-medium"
            >
              <FaArrowLeft className="w-3 h-3" aria-hidden="true" />
              Dashboard
            </button>
            <h1 className="text-[1.35rem] sm:text-3xl font-bold text-gray-900 dark:text-white leading-tight">Admin Dashboard</h1>
            {canManageEquipment ? (
              <button
                type="button"
                onClick={() => navigate(equipmentPendingCount ? "/equipment/admin/requests" : "/equipment/admin")}
                className="ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-gradient-to-r from-teal-600 to-emerald-600 px-2.5 py-2 text-xs font-medium text-white shadow-sm transition hover:from-teal-700 hover:to-emerald-700 sm:px-3 sm:text-sm"
              >
                <FaToolbox className="h-4 w-4" aria-hidden="true" />
                Equipment
                {equipmentPendingCount ? (
                  <span className="inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white" aria-label={`${equipmentPendingCount} waiting`}>
                    {equipmentPendingCount > 99 ? "99+" : equipmentPendingCount}
                  </span>
                ) : null}
              </button>
            ) : null}
          </div>
          {activeOrganization ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">{displayWatchAreaName(activeOrganization.name)}</p>
          ) : null}
          <AreaContextBar />
          <div className="flex flex-nowrap items-center gap-1.5 sm:gap-2">
            <AppNotificationBell variant="toolbar" />
            <ThemeToggle variant="toolbar" />
            <button
              type="button"
              onClick={exportToExcel}
              disabled={exporting || !patrolLogs?.length}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-green-600 px-2.5 py-2 text-xs font-medium text-white shadow-sm transition hover:bg-green-700 disabled:opacity-50 sm:gap-2 sm:px-3 sm:text-sm"
            >
              <FaFileExcel className="h-4 w-4" aria-hidden="true" />
              {exporting ? 'Exporting...' : 'Export'}
            </button>
            <button
              type="button"
              onClick={() => navigate("/admin/print")}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-purple-600 px-2.5 py-2 text-xs font-medium text-white shadow-sm transition hover:bg-purple-700 sm:gap-2 sm:px-3 sm:text-sm"
            >
              <FaPrint className="h-4 w-4" aria-hidden="true" />
              Print
            </button>
            <button
              type="button"
              onClick={() => navigate("/admin/print?intent=pdf")}
              title="Save as PDF"
              className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-indigo-700 px-2.5 py-2 text-xs font-medium text-white shadow-sm transition hover:bg-indigo-800 sm:gap-2 sm:px-3 sm:text-sm"
            >
              <FaFilePdf className="h-4 w-4" aria-hidden="true" />
              <span className="sm:hidden">PDF</span>
              <span className="hidden sm:inline">Save as PDF</span>
            </button>
          </div>
        </div>

        {/* Management tools — operations first; collapsible on mobile */}
        <AdminToolsMenu
          pendingCount={pendingCount}
          pendingFeedbackCount={pendingFeedbackCount}
          pendingPatrollerCount={pendingPatrollerCount}
          showRetryCounts={Boolean(pendingError || (isFeedbackReviewer && pendingFeedbackError))}
          isFeedbackReviewer={isFeedbackReviewer}
          isPlatformConsoleUser={isPlatformConsoleUser}
          isGlobalAppUser={isGlobalAppUser}
          canOpenResidentPreview={canOpenResidentPreview}
          canOpenHousehold={canOpenHousehold}
          canEditEmergencyContacts={canEditEmergencyContacts}
          canSendAreaNotice={canSendAreaNotice}
          canManageNeeds={canManageNeeds}
          canManageEquipment={canManageEquipment}
          equipmentPendingCount={equipmentPendingCount}
          newOffersCount={newOffersCount}
          canOpenAuditLog={canOpenAuditLog}
          onNavigate={(to) => navigate(to)}
          onRetryCounts={() => {
            if (pendingError) void refetchPending();
            if (isFeedbackReviewer && pendingFeedbackError) void refetchPendingFeedback();
          }}
        />

        <HouseholdsAwayCard className="mb-8" />

        {/* ── Currently on Patrol (live ops first) ── */}
        <OnPatrolSection
          activePatrolsError={activePatrolsError}
          fetchActivePatrols={fetchActivePatrols}
          activePatrols={activePatrols}
          user={user}
          setPatrolPhotoPreview={setPatrolPhotoPreview}
          confirmEnd={confirmEnd}
          setConfirmEnd={setConfirmEnd}
          handleForceEnd={handleForceEnd}
          formatElapsed={formatElapsed}
        />

        {/* ── Live Map ── */}
        <SectionCard title="🗺️ Live Patrol Map">
          <LivePatrolMap />
        </SectionCard>

        <SectionCard title="🛤️ Patrol route history">
          <AdminPatrolRoutesSection patrolLogs={patrolLogs} volunteerOptions={stats.volunteerList} />
        </SectionCard>

        {/* ── Stats Cards ── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <StatCard
            icon={FaShieldAlt}
            label="Total patrols"
            value={stats.totalPatrols}
            sub={`${stats.thisWeekCount} this week`}
            color="teal"
          />
          <StatCard
            icon={FaClock}
            label="Total hours"
            value={`${stats.totalHours}h`}
            sub={`Avg ${formatDuration(stats.avgDuration)} / patrol`}
            color="emerald"
          />
          <StatCard
            icon={FaUsers}
            label="Active now"
            value={activePatrols.length}
            sub="on patrol"
            color="amber"
          />
          <StatCard
            icon={FaTrophy}
            label="Top volunteer"
            value={stats.topVolunteer?.displayName.split(/\s+/)[0] || '—'}
            sub={stats.topVolunteer ? `${Math.round(stats.topVolunteer.totalMinutes / 60)}h total` : ''}
            color="rose"
          />
        </div>

        {/* ── Charts row ── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">

          {/* Patrol hours per volunteer — data from patrol_logs (rows created when a patrol ends) */}
          <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-6 shadow-sm">
            <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-4">Patrol hours by volunteer</h3>
            {logsError ? (
              <div className="text-center py-8">
                <p className="text-sm text-red-600 dark:text-red-400 mb-2">{logsError}</p>
                <button type="button" onClick={refetchLogs} className="text-sm text-teal-600 dark:text-teal-400 font-medium hover:underline">
                  Retry
                </button>
              </div>
            ) : logsLoading ? (
              <div className="flex justify-center py-8">
                <BrandedLoader message="Loading patrol logs…" size="md" />
              </div>
            ) : stats.topVolunteers.length === 0 ? (
              <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-8">
                No completed patrols in the log yet. Hours appear after volunteers end patrols (or after auto-end / admin force-end).
              </p>
            ) : (
              <Suspense fallback={<ChartSkeleton />}>
                <AdminVolunteerHoursChart data={stats.topVolunteers} />
              </Suspense>
            )}
          </div>

          {/* Activity last 7 days */}
          <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-6 shadow-sm">
            <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-4">Activity — last 7 days</h3>
            {logsError ? (
              <div className="text-center py-8">
                <p className="text-sm text-red-600 dark:text-red-400 mb-2">{logsError}</p>
                <button type="button" onClick={refetchLogs} className="text-sm text-teal-600 dark:text-teal-400 font-medium hover:underline">
                  Retry
                </button>
              </div>
            ) : logsLoading ? (
              <div className="flex justify-center py-8">
                <BrandedLoader message="Loading activity…" size="md" />
              </div>
            ) : stats.last7.every(d => d.patrols === 0) ? (
              <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-8">No patrols logged in the last 7 days.</p>
            ) : (
              <Suspense fallback={<ChartSkeleton />}>
                <AdminLast7Chart data={stats.last7} />
              </Suspense>
            )}
          </div>
        </div>

        {/* ── Top Volunteers Leaderboard ── */}
        <TopVolunteersSection
          logsError={logsError}
          refetchLogs={refetchLogs}
          volunteerList={stats.volunteerList}
          formatDuration={formatDuration}
        />

        {/* ── Recent Activity ── */}
        <RecentActivitySection
          recentActivityError={recentActivityError}
          fetchRecentActivity={fetchRecentActivity}
          recentActivityLoading={recentActivityLoading}
          recentActivity={recentActivity}
          formatDuration={formatDuration}
        />

        {/* ── Patrol Slots ── */}
        <PatrolSlotsSection
          slotsError={slotsError}
          refetchSlots={refetchSlots}
          patrolSlots={patrolSlots}
          todayLocal={todayLocal}
          confirmDelete={confirmDelete}
          setConfirmDelete={setConfirmDelete}
          handleDeleteSlot={handleDeleteSlot}
        />

        <PatrollerPhotoPreview
          open={!!patrolPhotoPreview}
          onClose={() => setPatrolPhotoPreview(null)}
          name={patrolPhotoPreview?.name}
          imageUrl={patrolPhotoPreview?.imageUrl}
        />
      </div>
    </div>
  );
}