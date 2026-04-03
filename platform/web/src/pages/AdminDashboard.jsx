// src/pages/AdminDashboard.jsx
import { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/useAuth";
import { hasHydratedAppRole } from "../auth/appRole";
import { canAccessAdminPanel } from "../auth/staffRoles";
import { supabase } from "../supabase/client";
import { useSupabaseQuery } from "../hooks/useSupabaseQuery";
import ExcelJS from 'exceljs';
import toast from 'react-hot-toast';
import { FaCar, FaTrash, FaArrowLeft, FaFileExcel, FaPrint, FaFilePdf, FaUsers, FaClock, FaShieldAlt, FaTrophy, FaWalking, FaBicycle, FaMapMarkerAlt, FaPhone, FaStopwatch, FaIdCard, FaComments } from "react-icons/fa";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  LineChart, Line, CartesianGrid, Legend
} from "recharts";
import VehicleIcon, { COLOR_HEX, normalizeVehicleType, PatrolInfoIcon } from '../components/VehicleIcon';
import LivePatrolMap from '../components/LivePatrolMap';
import AdminPatrolRoutesSection from '../components/admin/AdminPatrolRoutesSection';
import { getVehicleDisplayText } from '../utils/vehicleDisplay';
import { enrichPatrolRowsWithAvatars } from '../utils/enrichPatrolAvatars';
import { resolvePatrolAvatarUrl } from '../utils/patrolAvatarUrl';
import { Avatar } from '../chat/components/common/Avatar';
import PatrollerPhotoPreview from '../components/patrol/PatrollerPhotoPreview';
import ThemeToggle from '../components/ThemeToggle';
import BrandedLoader from '../components/layout/BrandedLoader';
import { DEFAULT_PATROL_ZONE, displayPatrolZone } from '../config/neighborhoodRegions';
import { adaptivePollIntervalMs, subscribeDataBudgetHints } from '../utils/dataSaverProfile';

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatCard({ icon: Icon, label, value, sub, color = 'teal' }) {
  const colorSchemes = {
    teal: 'from-teal-500 to-purple-600 bg-teal-50 text-teal-600 dark:bg-teal-900/30 dark:text-teal-300',
    emerald: 'from-emerald-500 to-teal-600 bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-300',
    amber: 'from-amber-400 to-orange-500 bg-amber-50 text-amber-600 dark:bg-amber-900/30 dark:text-amber-300',
    rose: 'from-rose-500 to-pink-600 bg-rose-50 text-rose-600 dark:bg-rose-900/30 dark:text-rose-300',
  };

  return (
    <div className="card card-hover p-5 relative overflow-hidden">
      <div className={`absolute top-0 right-0 w-24 h-24 bg-gradient-to-br ${colorSchemes[color]} opacity-10 rounded-full -translate-y-1/2 translate-x-1/2`}></div>
      <div className="relative flex items-start justify-between">
        <div>
          <p className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">{label}</p>
          <p className="text-3xl font-bold text-gray-900 dark:text-white tracking-tight">{value}</p>
          {sub && <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">{sub}</p>}
        </div>
        <div className={`w-12 h-12 rounded-xl ${colorSchemes[color]} flex items-center justify-center`}>
          <Icon className="w-6 h-6" />
        </div>
      </div>
    </div>
  );
}

function SectionCard({ title, subtitle, children, action }) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden mb-8">
      <div className="px-6 py-5 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">{title}</h2>
          {subtitle ? (
            <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{subtitle}</p>
          ) : null}
        </div>
        {action}
      </div>
      <div className="p-6">{children}</div>
    </div>
  );
}

function InlineConfirm({ label, onConfirm, onCancel, danger = true }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-gray-500 dark:text-gray-400">{label}</span>
      <button
        onClick={onConfirm}
        className={`px-2 py-1 text-white text-xs rounded-lg transition ${danger ? 'bg-red-600 hover:bg-red-700' : 'bg-teal-600 hover:bg-teal-700'}`}
      >
        Yes
      </button>
      <button
        onClick={onCancel}
        className="px-2 py-1 bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-200 text-xs rounded-lg transition"
      >
        No
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export default function AdminDashboard() {
  const navigate = useNavigate();
  const { user } = useAuth();

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
  const todayLocal = useMemo(() => {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }, []);

  // ---------------------------------------------------------------------------
  // useSupabaseQuery hooks
  // ---------------------------------------------------------------------------
  const fetchPatrolLogs = useCallback(async () => {
    const { data, error } = await supabase
      .from('patrol_logs').select('*').order('start_time', { ascending: false });
    if (error) throw error;
    return data || [];
  }, []);

  const fetchPatrolSlots = useCallback(async () => {
    const { data, error } = await supabase
      .from('patrol_slots')
      .select('*')
      .gte('date', todayLocal)
      .order('date', { ascending: true })
      .order('start_time', { ascending: true });
    if (error) throw error;
    return data || [];
  }, [todayLocal]);

  const fetchPendingCount = useCallback(async () => {
    const { count, error } = await supabase
      .from('incidents').select('*', { count: 'exact', head: true }).eq('status', 'pending');
    if (error) throw error;
    return count || 0;
  }, []);

  const fetchPendingFeedbackCount = useCallback(async () => {
    const { count, error } = await supabase
      .from('feedback')
      .select('*', { count: 'exact', head: true })
      .is('reviewed_at', null);
    if (error) throw error;
    return count || 0;
  }, []);

  const { data: patrolLogs = [], loading: logsLoading, error: logsError, refetch: refetchLogs } =
    useSupabaseQuery(fetchPatrolLogs);
  const { data: patrolSlots = [], loading: slotsLoading, error: slotsError, refetch: refetchSlots } =
    useSupabaseQuery(fetchPatrolSlots);
  const { data: pendingCount = 0, loading: pendingLoading, error: pendingError, refetch: refetchPending } =
    useSupabaseQuery(fetchPendingCount);
  const {
    data: pendingFeedbackCount = 0,
    loading: pendingFeedbackLoading,
    error: pendingFeedbackError,
    refetch: refetchPendingFeedback,
  } = useSupabaseQuery(fetchPendingFeedbackCount);

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
    if (!user) return undefined;
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
  }, [user, refetchPendingFeedback]);

  // ---------------------------------------------------------------------------
  // Active patrols with realtime
  // ---------------------------------------------------------------------------
  const fetchActivePatrols = useCallback(async (opts = {}) => {
    const silent = opts.silent === true;
    if (!silent) setActivePatrolsLoading(true);
    try {
      const { data, error } = await supabase.from('active_patrols').select('*');
      if (error) throw error;
      const enriched = await enrichPatrolRowsWithAvatars(supabase, data || []);
      setActivePatrols(enriched);
      setActivePatrolsError(null);
    } catch (err) {
      setActivePatrolsError(err.message);
    } finally {
      if (!silent) setActivePatrolsLoading(false);
    }
  }, []);

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
    setRecentActivityLoading(true);
    setRecentActivityError(null);
    try {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const [{ data: active, error: e1 }, { data: completed, error: e2 }] = await Promise.all([
        supabase.from('active_patrols').select('*').gte('start_time', since),
        supabase.from('patrol_logs').select('*').gte('start_time', since),
      ]);
      if (e1) throw e1;
      if (e2) throw e2;
      const combined = [
        ...(active || []).map(p => ({ ...p, type: 'active', end_time: null, duration_minutes: null })),
        ...(completed || []).map(p => ({ ...p, type: 'completed' })),
      ].sort((a, b) => new Date(b.start_time) - new Date(a.start_time));
      setRecentActivity(combined);
    } catch (err) {
      setRecentActivityError(err.message);
    } finally {
      setRecentActivityLoading(false);
    }
  }, []);

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
    const weekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);

    const thisWeek = logs.filter(l => new Date(l.start_time) >= weekAgo);
    const totalMinutes = logs.reduce((s, l) => s + (l.duration_minutes || 0), 0);
    const avgMinutes = logs.length ? Math.round(totalMinutes / logs.length) : 0;

    // Group by user_id when present so two volunteers with the same first name don't merge
    const byVolunteer = logs.reduce((acc, log) => {
      const id =
        log.user_id != null && String(log.user_id).length > 0
          ? String(log.user_id)
          : `name:${(log.user_name || 'unknown').toString()}`;
      const displayName = (log.user_name || log.user_id || 'Unknown').toString().trim();
      if (!acc[id]) acc[id] = { id, displayName, totalMinutes: 0, patrols: 0 };
      acc[id].totalMinutes += Number(log.duration_minutes) || 0;
      acc[id].patrols += 1;
      return acc;
    }, {});
    const volunteerList = Object.values(byVolunteer).sort((a, b) => b.totalMinutes - a.totalMinutes);

    const thirtyAgo = new Date(now - 30 * 24 * 60 * 60 * 1000);
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const byDay = days.map(d => ({ day: d, patrols: 0, hours: 0 }));
    logs.filter(l => new Date(l.start_time) >= thirtyAgo).forEach(l => {
      const d = new Date(l.start_time).getDay();
      byDay[d].patrols += 1;
      byDay[d].hours += (l.duration_minutes || 0) / 60;
    });
    byDay.forEach(d => { d.hours = Math.round(d.hours * 10) / 10; });

    const last7 = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(now);
      d.setDate(d.getDate() - (6 - i));
      return {
        date: d.toLocaleDateString('en-ZA', { weekday: 'short', day: 'numeric' }),
        dateStr: d.toISOString().slice(0, 10),
        patrols: 0,
        hours: 0,
      };
    });
    logs.forEach(l => {
      const ds = new Date(l.start_time).toISOString().slice(0, 10);
      const entry = last7.find(d => d.dateStr === ds);
      if (entry) {
        entry.patrols += 1;
        entry.hours += (l.duration_minutes || 0) / 60;
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
    try {
      const end = new Date();
      const durationMinutes = Math.floor((end - new Date(patrol.start_time)) / 60000);
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
      });
      if (insertError) throw insertError;
      const { error: deleteError } = await supabase.from('active_patrols').delete().eq('user_id', patrol.user_id);
      if (deleteError) throw deleteError;
      setActivePatrols(prev => prev.filter(p => p.user_id !== patrol.user_id));
      setConfirmEnd(null);
      toast.success(`Patrol for ${patrol.user_name} ended.`);
    } catch (err) {
      console.error('Force-end failed:', err);
      toast.error('Failed to end patrol.');
    }
  };

  // ---------------------------------------------------------------------------
  // Delete slot
  // ---------------------------------------------------------------------------
  const handleDeleteSlot = async (slotId) => {
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
    }
  };

  // ---------------------------------------------------------------------------
  // Export
  // ---------------------------------------------------------------------------
  const exportToExcel = async () => {
    setExporting(true);
    try {
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
        worksheet.addRow({
          volunteer: log.user_name || '—',
          date:      new Date(log.start_time).toLocaleDateString(),
          startTime: new Date(log.start_time).toLocaleTimeString(),
          endTime:   log.end_time ? new Date(log.end_time).toLocaleTimeString() : '—',
          duration:  log.duration_minutes || 0,
          zone:      displayPatrolZone(log.zone) || '—',
        });
      });

      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `patrol_logs_${new Date().toISOString().slice(0, 10)}.xlsx`;
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
    activePatrolsLoading || logsLoading || slotsLoading || pendingLoading || pendingFeedbackLoading;
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
        <div className="mb-8 space-y-3">
          <div className="flex items-center gap-2">
            <button
              onClick={() => navigate("/dashboard")}
              className="inline-flex items-center gap-2 px-3 py-2 bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded-xl hover:bg-gray-300 dark:hover:bg-gray-600 transition text-sm font-medium"
            >
              <FaArrowLeft className="w-3 h-3" aria-hidden="true" />
              Dashboard
            </button>
            <h1 className="text-[1.35rem] sm:text-3xl font-bold text-gray-900 dark:text-white leading-tight">Admin Dashboard</h1>
          </div>
          <div className="flex flex-nowrap overflow-x-auto gap-2 sm:gap-3 items-center">
            <ThemeToggle variant="toolbar" />
            <button
              type="button"
              onClick={exportToExcel}
              disabled={exporting || !patrolLogs?.length}
              className="inline-flex shrink-0 items-center gap-2 px-3 py-2 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white rounded-xl transition text-sm font-medium shadow-sm"
            >
              <FaFileExcel className="w-4 h-4" aria-hidden="true" />
              {exporting ? 'Exporting...' : 'Export'}
            </button>
            <button
              type="button"
              onClick={() => navigate("/admin/print")}
              className="inline-flex shrink-0 items-center gap-2 px-3 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-xl transition text-sm font-medium shadow-sm"
            >
              <FaPrint className="w-4 h-4" aria-hidden="true" />
              Print
            </button>
            <button
              type="button"
              onClick={() => navigate("/admin/print?intent=pdf")}
              className="inline-flex shrink-0 items-center gap-2 px-3 py-2 bg-indigo-700 hover:bg-indigo-800 text-white rounded-xl transition text-sm font-medium shadow-sm"
            >
              <FaFilePdf className="w-4 h-4" aria-hidden="true" />
              Save as PDF
            </button>
          </div>
        </div>

        {/* Management Buttons */}
        <div className="flex flex-wrap gap-3 mb-8">
          <button
            type="button"
            onClick={() => navigate("/admin/members")}
            className="inline-flex items-center gap-2 px-4 py-2 bg-cyan-600 hover:bg-cyan-700 text-white rounded-xl transition text-sm font-medium shadow-sm"
          >
            <FaIdCard className="w-4 h-4" aria-hidden />
            Member profiles
          </button>
          <button onClick={() => navigate("/admin/users")} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl transition text-sm font-medium shadow-sm">
            Manage Users
          </button>
          <button onClick={() => navigate("/admin/incidents")} className="relative px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-xl transition text-sm font-medium shadow-sm">
            Moderate Incidents
            {pendingCount > 0 && (
              <span className="absolute -top-2 -right-2 bg-red-500 text-white text-xs font-bold rounded-full h-5 w-5 flex items-center justify-center animate-pulse">
                {pendingCount}
              </span>
            )}
          </button>
          <button onClick={() => navigate("/admin/chat")} className="px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-xl transition text-sm font-medium shadow-sm">
            Chat Logs
          </button>
          <button
            type="button"
            onClick={() => navigate("/admin/feedback")}
            className="relative inline-flex items-center gap-2 px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-xl transition text-sm font-medium shadow-sm"
          >
            <FaComments className="w-4 h-4" aria-hidden />
            Feedback reviews
            {pendingFeedbackCount > 0 && (
              <span className="absolute -top-2 -right-2 bg-red-500 text-white text-xs font-bold rounded-full h-5 w-5 flex items-center justify-center animate-pulse">
                {pendingFeedbackCount > 99 ? "99+" : pendingFeedbackCount}
              </span>
            )}
          </button>
          {(pendingError || pendingFeedbackError) && (
            <button
              type="button"
              onClick={() => {
                if (pendingError) void refetchPending();
                if (pendingFeedbackError) void refetchPendingFeedback();
              }}
              className="px-3 py-1 bg-yellow-500 hover:bg-yellow-600 text-white rounded-lg text-sm"
            >
              Retry counts
            </button>
          )}
        </div>

        {/* ── Currently on Patrol (live ops first) ── */}
        <div className="mb-8 rounded-2xl border border-green-200 dark:border-green-800 bg-green-50/90 dark:bg-green-950/25 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-green-200/80 dark:border-green-800/80 bg-green-100/50 dark:bg-green-900/20">
            <h2 className="text-lg font-semibold text-green-900 dark:text-green-100">🟢 Currently on Patrol</h2>
          </div>
          <div className="p-4 sm:p-5">
            {activePatrolsError ? (
              <div className="text-center">
                <p className="text-red-600 dark:text-red-400 mb-2">{activePatrolsError}</p>
                <button type="button" onClick={fetchActivePatrols} className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm">Retry</button>
              </div>
            ) : activePatrols.length === 0 ? (
              <p className="text-gray-600 dark:text-gray-400 text-center py-2">No active patrols.</p>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {activePatrols.map((p) => {
                  const started = new Date(p.start_time);
                  const elapsedSec = Math.floor((Date.now() - started) / 1000);
                  const vehicleType = normalizeVehicleType(p.vehicle_type, p.car_type);
                  const vehicleColor = p.vehicle_color || 'gray';
                  const vehicleDisplay = getVehicleDisplayText(
                    p.vehicle_type,
                    p.car_type,
                    p.vehicle_make_model,
                    p.vehicle_reg,
                    p.reg_number
                  );
                  const patrolAvatarDisplayUrl = resolvePatrolAvatarUrl(p, user);

                  return (
                    <div
                      key={p.user_id}
                      className="relative rounded-xl border border-green-200 dark:border-green-800 bg-white/80 dark:bg-gray-900/60 p-4 shadow-sm"
                    >
                      <div className="flex items-center gap-1.5 min-w-0 pr-10">
                        <button
                          type="button"
                          className="inline-flex items-center justify-center shrink-0 rounded-full border-0 bg-transparent p-0 m-0 appearance-none focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-gray-900"
                          onClick={() =>
                            setPatrolPhotoPreview({
                              name: p.user_name || 'Patrol',
                              imageUrl: patrolAvatarDisplayUrl,
                            })
                          }
                          aria-label={`View photo of ${p.user_name || 'patroller'}`}
                        >
                          <Avatar name={p.user_name || 'Patrol'} avatarUrl={patrolAvatarDisplayUrl} size="sm" />
                        </button>
                        <p className="font-semibold text-gray-900 dark:text-white truncate">{p.user_name}</p>
                      </div>
                      <div className="mt-2 space-y-1 text-sm text-gray-600 dark:text-gray-400">
                        <div className="flex items-center gap-1.5">
                          <VehicleIcon type={vehicleType} color={vehicleColor} size="sm" />
                          <span>{vehicleDisplay}</span>
                        </div>
                        {(p.patroller_phone || '').trim() ? (
                          <div className="flex items-center gap-1.5 min-w-0">
                            <PatrolInfoIcon icon={FaPhone} colorKey={vehicleColor} />
                            <span className="truncate">{p.patroller_phone}</span>
                          </div>
                        ) : null}
                        <div className="flex items-center gap-1.5 min-w-0">
                          <PatrolInfoIcon icon={FaClock} colorKey={vehicleColor} />
                          <span>Started: {started.toLocaleTimeString()}</span>
                        </div>
                        <div className="flex items-center gap-1.5 min-w-0">
                          <PatrolInfoIcon icon={FaStopwatch} colorKey={vehicleColor} />
                          <span>Elapsed: {formatElapsed(elapsedSec)}</span>
                        </div>
                      </div>
                      <div className="absolute top-3 right-3">
                        {confirmEnd === p.user_id ? (
                          <InlineConfirm
                            label="End?"
                            onConfirm={() => handleForceEnd(p)}
                            onCancel={() => setConfirmEnd(null)}
                          />
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmEnd(p.user_id)}
                            className="p-2 bg-red-500 hover:bg-red-600 text-white rounded-lg transition"
                            title="Force-end patrol"
                            aria-label={`Force end patrol for ${p.user_name}`}
                          >
                            <FaTrash size={12} aria-hidden="true" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

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
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={stats.topVolunteers} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#94a3b8" opacity={0.5} />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#64748b' }} />
                  <YAxis tick={{ fontSize: 11, fill: '#64748b' }} unit="h" />
                  <Tooltip
                    formatter={(val, key) => [key === 'hours' ? `${val} h` : val, key === 'hours' ? 'Hours' : 'Patrols']}
                    labelFormatter={(label, payload) => payload?.[0]?.payload?.fullName || label}
                    contentStyle={{
                      backgroundColor: '#ffffff',
                      color: '#111827',
                      borderRadius: 8,
                      border: '1px solid #e5e7eb',
                      fontSize: 12,
                    }}
                    labelStyle={{ color: '#111827', fontWeight: 600 }}
                    itemStyle={{ color: '#0f766e' }}
                  />
                  <Bar dataKey="hours" fill="#0d9488" radius={[4, 4, 0, 0]} name="hours" />
                </BarChart>
              </ResponsiveContainer>
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
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={stats.last7} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#94a3b8" opacity={0.5} />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#64748b' }} />
                  <YAxis tick={{ fontSize: 11, fill: '#64748b' }} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#ffffff',
                      color: '#111827',
                      borderRadius: 8,
                      border: '1px solid #e5e7eb',
                      fontSize: 12,
                    }}
                    labelStyle={{ color: '#111827', fontWeight: 600 }}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Line type="monotone" dataKey="patrols" stroke="#0d9488" strokeWidth={2} dot={{ r: 3 }} name="Patrols" />
                  <Line type="monotone" dataKey="hours" stroke="#22c55e" strokeWidth={2} dot={{ r: 3 }} name="Hours" />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* ── Top Volunteers Leaderboard ── */}
        <SectionCard title="🏆 Top Volunteers">
          {logsError ? (
            <div className="text-center">
              <p className="text-red-600 dark:text-red-400 mb-2">{logsError}</p>
              <button onClick={refetchLogs} className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm">Retry</button>
            </div>
          ) : stats.volunteerList.length === 0 ? (
            <p className="text-gray-500 dark:text-gray-400 text-center">No patrol data yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700 text-sm">
                <thead className="bg-gray-50 dark:bg-gray-900">
                  <tr>
                    {['Rank', 'Volunteer', 'Patrols', 'Total time', 'Avg duration'].map(h => (
                      <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                  {stats.volunteerList.map((v, i) => (
                    <tr key={v.id} className="hover:bg-gray-50 dark:hover:bg-gray-700 transition">
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className={`font-bold ${i === 0 ? 'text-yellow-500' : i === 1 ? 'text-gray-400' : i === 2 ? 'text-amber-600' : 'text-gray-400 dark:text-gray-500'}`}>
                          {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`}
                        </span>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap font-medium text-gray-900 dark:text-white">{v.displayName}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-gray-500 dark:text-gray-400">{v.patrols}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-gray-500 dark:text-gray-400">{formatDuration(v.totalMinutes)}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-gray-500 dark:text-gray-400">
                        {formatDuration(Math.round(v.totalMinutes / v.patrols))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>

        {/* ── Recent Activity ── */}
        <SectionCard title="📋 Recent Patrol Activity (last 24h)">
          {recentActivityError ? (
            <div className="text-center">
              <p className="text-red-600 dark:text-red-400 mb-2">{recentActivityError}</p>
              <button onClick={fetchRecentActivity} className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm">Retry</button>
            </div>
          ) : recentActivityLoading ? (
            <div className="flex justify-center py-8">
              <BrandedLoader message="Loading recent activity…" size="md" />
            </div>
          ) : recentActivity.length === 0 ? (
            <p className="text-gray-500 dark:text-gray-400 text-center">No activity in the last 24 hours.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700 text-sm">
                <thead className="bg-gray-50 dark:bg-gray-900">
                  <tr>
                    {['Volunteer', 'Start', 'End', 'Duration', 'Status', 'Vehicle'].map(h => (
                      <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                  {recentActivity.map(item => {
                    // 🔑 Same robust logic for recent activity table
                    const vehicleType = normalizeVehicleType(item.vehicle_type, item.car_type);
                    const vehicleColor = item.vehicle_color || 'gray';
                    const vehicleDisplay = getVehicleDisplayText(
                      item.vehicle_type,
                      item.car_type,
                      item.vehicle_make_model,
                      item.vehicle_reg,
                      item.reg_number
                    );
                    const rowKey =
                      item.type === 'active'
                        ? `active-${item.user_id}`
                        : `completed-${item.id ?? `${item.user_id}-${item.start_time}`}`;

                    return (
                      <tr key={rowKey} className="hover:bg-gray-50 dark:hover:bg-gray-700 transition">
                        <td className="px-4 py-3 whitespace-nowrap font-medium text-gray-900 dark:text-white">{item.user_name}</td>
                        <td className="px-4 py-3 whitespace-nowrap text-gray-500 dark:text-gray-400">{new Date(item.start_time).toLocaleString()}</td>
                        <td className="px-4 py-3 whitespace-nowrap text-gray-500 dark:text-gray-400">{item.end_time ? new Date(item.end_time).toLocaleString() : '—'}</td>
                        <td className="px-4 py-3 whitespace-nowrap text-gray-500 dark:text-gray-400">{item.duration_minutes ? formatDuration(item.duration_minutes) : item.type === 'active' ? 'Active' : '—'}</td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span className={`px-2 py-0.5 text-xs font-semibold rounded-full ${item.type === 'active' ? 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300' : 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300'}`}>
                            {item.type === 'active' ? 'Active' : 'Completed'}
                          </span>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <div className="flex items-center gap-2">
                            <VehicleIcon type={vehicleType} color={vehicleColor} size="sm" />
                            <span className="text-gray-500 dark:text-gray-400">{vehicleDisplay}</span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>

        {/* ── Patrol Slots ── */}
        <SectionCard
          title="Patrol signups (today & upcoming)"
          subtitle={`Past dates hidden · from ${todayLocal}`}
        >
          {slotsError ? (
            <div className="text-center">
              <p className="text-red-600 dark:text-red-400 mb-2">{slotsError}</p>
              <button onClick={refetchSlots} className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm">Retry</button>
            </div>
          ) : patrolSlots?.length === 0 ? (
            <p className="text-gray-500 dark:text-gray-400 text-center">No signups found.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700 text-sm">
                <thead className="bg-gray-50 dark:bg-gray-900">
                  <tr>
                    {['Date', 'Time', 'Zone', 'Volunteer', 'Actions'].map(h => (
                      <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                  {patrolSlots.map(slot => (
                    <tr key={slot.id} className="hover:bg-gray-50 dark:hover:bg-gray-700 transition">
                      <td className="px-4 py-3 whitespace-nowrap text-gray-900 dark:text-gray-200">{slot.date}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-gray-500 dark:text-gray-400">{slot.start_time}–{slot.end_time}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-gray-500 dark:text-gray-400">{displayPatrolZone(slot.zone) || '—'}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-gray-500 dark:text-gray-400">{slot.volunteer_name || '—'}</td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {confirmDelete === slot.id ? (
                          <InlineConfirm
                            onConfirm={() => handleDeleteSlot(slot.id)}
                            onCancel={() => setConfirmDelete(null)}
                          />
                        ) : (
                          <button
                            onClick={() => setConfirmDelete(slot.id)}
                            className="px-3 py-1 bg-red-500 hover:bg-red-600 text-white rounded-lg text-xs transition"
                          >
                            Delete
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>

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