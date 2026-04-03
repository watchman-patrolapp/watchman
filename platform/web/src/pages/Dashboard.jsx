// src/pages/Dashboard.jsx
import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/useAuth";
import { supabase } from "../supabase/client";
import { FaUser, FaMapMarkerAlt, FaEnvelope, FaPlay, FaStop, FaTrophy, FaSync, FaMapMarkerAlt as FaMapPin, FaRoute, FaRoad, FaCalendarAlt, FaClipboardList, FaCar, FaBook, FaInfoCircle, FaShieldAlt, FaPhone, FaClock, FaStopwatch } from "react-icons/fa";
import ActiveThreatsBanner from "../components/patrol/ActiveThreatsBanner";
import toast from 'react-hot-toast';
import SoundToggle from "../components/SoundToggle";
import ThemeToggle from "../components/ThemeToggle";
import VehicleIcon, { normalizeVehicleType, PatrolInfoIcon, ProfileVehicleGlyph } from '../components/VehicleIcon';
import { getVehicleDisplayText } from '../utils/vehicleDisplay';
import { 
  playChatNotification,
  playPatrolStart, 
  playPatrolEnd, 
  playPatrolWarning, 
  playPatrolAutoEnd,
  playPatrolSigninNotification
} from '../utils/sound';
import { useChatNotifications, useUnreadCount, isActiveChatPath, markChatVisited } from '../chat';
import { Avatar } from '../chat/components/common/Avatar';
import { useGPSTracking } from '../hooks/useGPSTracking';
import { enrichPatrolRowsWithAvatars } from '../utils/enrichPatrolAvatars';
import { resolvePatrolAvatarUrl } from '../utils/patrolAvatarUrl';
import { syncActivePatrolVehicleFromVehicleList } from '../utils/syncActivePatrolVehicle';
import { isLightMobilityVehicleType, getVehicleTypePublicLabel } from '../utils/vehicleTypeConstants';
import PatrollerPhotoPreview from '../components/patrol/PatrollerPhotoPreview';
import UpcomingScheduledPatrollers from '../components/patrol/UpcomingScheduledPatrollers';
import { DEFAULT_PATROL_ZONE, formatPatrolPlaceLabel } from '../config/neighborhoodRegions';
import { adaptivePollIntervalMs, subscribeDataBudgetHints } from '../utils/dataSaverProfile';
import startPatrolIcon from '../assets/start-patrol-icon.png';
import appMark from '../assets/app-mark.png';
import BrandedLoader from '../components/layout/BrandedLoader';
import { canAccessAdminPanel, canReviewFeedback, isStaffForModerationAlerts } from '../auth/staffRoles';

// --- Constants ---
/** Warn after this many seconds on patrol (2h). */
const PATROL_WARNING_SECONDS = 7200;
/** Grace period after the 2h mark before auto-end if the patroller does not end (30m). Guide: total 2.5h. */
const AUTO_CLOSE_EXTENSION_SECONDS = 1800;
/** Absolute patrol end from start_time = 2h + 30m (matches Guide / auto-end RPC expectations). */
const PATROL_MAX_ELAPSED_MS = (PATROL_WARNING_SECONDS + AUTO_CLOSE_EXTENSION_SECONDS) * 1000;

// Sound throttling
const soundThrottleRef = {};
function playThrottled(key, fn) {
  const now = Date.now();
  if (!soundThrottleRef[key] || now - soundThrottleRef[key] > 1000) {
    fn();
    soundThrottleRef[key] = now;
  }
}

// Reliable audio unlock (Web Audio API)
let audioUnlocked = false;
function unlockAudio() {
  if (audioUnlocked) return;
  audioUnlocked = true;
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const buf = ctx.createBuffer(1, 1, 22050);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(ctx.destination);
  src.start(0);
  ctx.resume();
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------
export default function Dashboard() {
  const navigate = useNavigate();
  const { user, signOut } = useAuth();

  // --- Patrol state ---
  const [activePatrol, setActivePatrol] = useState(null);
  const [startTime, setStartTime] = useState(null);
  const [loadingPatrol, setLoadingPatrol] = useState(true);
  const [allActivePatrols, setAllActivePatrols] = useState([]);
  const [fetchError, setFetchError] = useState(null);
  const [fetchAllError, setFetchAllError] = useState(null);
  const [fetchAllLoading, setFetchAllLoading] = useState(false);

  const [showWarning, setShowWarning] = useState(false);
  const [autoCloseAt, setAutoCloseAt] = useState(null);
  const [showVehiclePicker, setShowVehiclePicker] = useState(false);
  const [vehiclesList, setVehiclesList] = useState([]);
  const [patrolPhotoPreview, setPatrolPhotoPreview] = useState(null);

  // --- Criminal Intelligence Integration ---
  const [userLocation, setUserLocation] = useState(null);

  const warningTriggeredRef = useRef(false);
  const isEndingRef = useRef(false);
  const [, setTick] = useState(0);
  const prevPatrolsRef = useRef(null);
  const patrolAvatarUrlByUserIdRef = useRef({});
  const [upcomingScheduleRefresh, setUpcomingScheduleRefresh] = useState(0);

  // Handle location updates for threat detection (clear watch on leave — avoids geolocation + Google 403 noise on other routes e.g. admin)
  useEffect(() => {
    if (!navigator.geolocation) return undefined;
    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        setUserLocation({
          lat: position.coords.latitude,
          lng: position.coords.longitude
        });
      },
      () => { /* expected in dev / blocked network location */ },
      { enableHighAccuracy: true, maximumAge: 30000, timeout: 27000 }
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, []);

  // --- New: Unread count via hook ---
  const { count: unreadCount, refetch: refetchUnread } = useUnreadCount(user?.id);

  // Handle new messages
  const handleNewMessage = useCallback((message) => {
    refetchUnread();
    if (Notification.permission === 'granted') {
      new Notification('New Emergency Message', {
        body: `${message.sender_name}: ${message.text?.substring(0, 50)}...`,
        icon: '/favicon.ico',
      });
    }
    if (!isActiveChatPath()) {
      playThrottled('chat', playChatNotification);
    }
  }, [refetchUnread]);

  // Subscribe to chat notifications
  useChatNotifications(user?.id, handleNewMessage);

  const [pendingIncidentCount, setPendingIncidentCount] = useState(0);

  const fetchPendingIncidentCount = useCallback(async () => {
    if (!isStaffForModerationAlerts(user?.role)) return;
    try {
      const { count, error } = await supabase
        .from("incidents")
        .select("*", { count: "exact", head: true })
        .eq("status", "pending");
      if (error) throw error;
      setPendingIncidentCount(count || 0);
    } catch {
      /* RLS or network — leave badge unchanged */
    }
  }, [user?.role]);

  const [pendingFeedbackCount, setPendingFeedbackCount] = useState(0);

  const fetchPendingFeedbackCount = useCallback(async () => {
    if (!canReviewFeedback(user?.role)) return;
    try {
      const { count, error } = await supabase
        .from("feedback")
        .select("*", { count: "exact", head: true })
        .is("reviewed_at", null);
      if (error) throw error;
      setPendingFeedbackCount(count || 0);
    } catch {
      /* RLS or missing table before migration */
    }
  }, [user?.role]);

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

  // PWA / Chromium: badge on home-screen icon when there are unread chat messages
  useEffect(() => {
    if (typeof navigator === 'undefined') return;
    const nav = navigator;
    if (unreadCount > 0 && 'setAppBadge' in nav && typeof nav.setAppBadge === 'function') {
      nav.setAppBadge(unreadCount).catch(() => {});
    } else if ('clearAppBadge' in nav && typeof nav.clearAppBadge === 'function') {
      nav.clearAppBadge().catch(() => {});
    }
  }, [unreadCount]);

  // --- Memoized derived values ---
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
  const todayDate = new Date().toLocaleDateString("en-US", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
  });

  const elapsed = startTime ? Math.floor((Date.now() - startTime) / 1000) : 0;

  // --- Fetch all active patrols ---
  const fetchAll = useCallback(async () => {
    let cancelled = false;
    setFetchAllLoading(prev => {
      if (prevPatrolsRef.current === null) return true;
      return prev;
    });
    try {
      const { data, error } = await supabase.from('active_patrols').select('*');
      if (cancelled) return;
      if (error) throw error;
      const incoming = await enrichPatrolRowsWithAvatars(supabase, data || []);
      incoming.forEach((p) => {
        patrolAvatarUrlByUserIdRef.current[p.user_id] = p.patrol_avatar_url;
      });
      const incomingIds = incoming.map(p => p.user_id).sort();
      const prevIds = (prevPatrolsRef.current || []).map(p => p.user_id).sort();
      if (JSON.stringify(incomingIds) !== JSON.stringify(prevIds)) {
        setAllActivePatrols(incoming);
        prevPatrolsRef.current = incoming;
      }
      setFetchAllError(null);
    } catch (err) {
      if (cancelled) return;
      setFetchAllError(err.message);
    } finally {
      if (!cancelled) setFetchAllLoading(false);
    }
    return () => { cancelled = true; };
  }, []);

  // --- Manual refresh ---
  const refreshData = useCallback(() => {
    fetchAll();
    refetchUnread();
    setUpcomingScheduleRefresh((n) => n + 1);
  }, [fetchAll, refetchUnread]);

  // Polling fallback (interval stretches on slow / Data Saver / background tab)
  useEffect(() => {
    let timeoutId = 0;
    let cancelled = false;
    const schedule = () => {
      if (timeoutId) window.clearTimeout(timeoutId);
      const ms = adaptivePollIntervalMs(30000, { maxMs: 120000 });
      timeoutId = window.setTimeout(() => {
        if (cancelled) return;
        void fetchAll();
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
  }, [fetchAll]);

  // Visibility change
  useEffect(() => {
    let cancelled = false;
    const handleVisibilityChange = () => {
      if (!document.hidden && !cancelled) refetchUnread();
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => { cancelled = true; document.removeEventListener('visibilitychange', handleVisibilityChange); };
  }, [refetchUnread]);

  // Window focus
  useEffect(() => {
    let cancelled = false;
    const handleFocus = () => { if (!cancelled) refetchUnread(); };
    window.addEventListener('focus', handleFocus);
    return () => { cancelled = true; window.removeEventListener('focus', handleFocus); };
  }, [refetchUnread]);

  // --- Real‑time subscriptions ---
  useEffect(() => {
    if (!user) return;
    const subscription = supabase
      .channel('patrol-starts')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'active_patrols' }, (payload) => {
        if (payload.new.user_id !== user.id) playThrottled('patrol-start', playPatrolSigninNotification);
      })
      .subscribe();
    return () => supabase.removeChannel(subscription);
  }, [user]);

  useEffect(() => {
    const subscription = supabase
      .channel('all-active-patrols')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'active_patrols' }, async (payload) => {
        const row = payload.new;
        if (!row?.user_id) return;
        const [enriched] = await enrichPatrolRowsWithAvatars(supabase, [row]);
        const next = enriched ?? {
          ...row,
          patrol_avatar_url:
            patrolAvatarUrlByUserIdRef.current[row.user_id] ??
            (user?.id === row.user_id ? user.avatarUrl : null) ??
            null,
          patroller_phone: null,
        };
        setAllActivePatrols((prev) => {
          if (prev.some((p) => p.user_id === next.user_id)) return prev;
          patrolAvatarUrlByUserIdRef.current[next.user_id] = next.patrol_avatar_url;
          return [...prev, next];
        });
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'active_patrols' }, (payload) => {
        setAllActivePatrols(prev => prev.filter(p => p.user_id !== payload.old.user_id));
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'active_patrols' }, (payload) => {
        setAllActivePatrols(prev => prev.map(p => {
          if (p.user_id !== payload.new.user_id) return p;
          return {
            ...payload.new,
            patrol_avatar_url:
              p.patrol_avatar_url ??
              patrolAvatarUrlByUserIdRef.current[payload.new.user_id] ??
              null,
            patroller_phone: p.patroller_phone ?? null,
          };
        }));
      })
      .subscribe();
    return () => supabase.removeChannel(subscription);
  }, [user?.id, user?.avatarUrl]);

  // --- GPS Tracking Hook ---
  // DB: active_patrols_pkey is (user_id) — there is no separate id column. patrol_locations.patrol_id FK targets that key.
  // Map/history scope by start_time so points from past sessions (same user_id) don’t stitch into one line.
  const { 
    isTracking, 
    totalDistance, 
    routePoints,
    startTracking, 
    stopTracking,
    setupAutoStopTimer
  } = useGPSTracking({ 
    patrolId: activePatrol?.user_id,
    userId: user?.id 
  });

  useEffect(() => {
    if (activePatrol?.user_id && user?.id && !isTracking) {
      startTracking();
    }
  }, [activePatrol?.user_id, user?.id, isTracking, startTracking]);

  // Keep active_patrols vehicle_* in sync with user_vehicles (map reads DB; stale color after vehicle swap)
  useEffect(() => {
    if (!user?.id || !activePatrol || activePatrol.user_id !== user.id) return;
    if (!user.vehicles?.length) return;
    let cancelled = false;
    (async () => {
      const { updated, data } = await syncActivePatrolVehicleFromVehicleList(
        supabase,
        user.id,
        user.vehicles,
        activePatrol
      );
      if (cancelled || !updated || !data) return;
      setActivePatrol(data);
      setAllActivePatrols((prev) => prev.map((p) => (p.user_id === user.id ? { ...p, ...data } : p)));
    })();
    return () => { cancelled = true; };
  }, [
    user?.id,
    user?.vehicles,
    activePatrol?.user_id,
    activePatrol?.vehicle_id,
    activePatrol?.vehicle_color,
    activePatrol?.vehicle_make_model,
    activePatrol?.vehicle_reg,
  ]);

  // --- Patrol logic ---
  const startPatrolWithVehicle = useCallback(async (vehicleId) => {
    const vehicle = user.vehicles.find(v => v.id === vehicleId);
    try {
      const { data, error } = await supabase
        .from('active_patrols')
        .upsert({
          user_id: user.id,
          user_name: user.fullName || user.email,
          vehicle_id: vehicleId,
          vehicle_type: vehicle.vehicle_type || (vehicle.make_model?.toLowerCase().includes('bike') ? 'bicycle' : vehicle.make_model?.toLowerCase().includes('foot') ? 'on_foot' : 'car'),
          vehicle_make_model: vehicle.make_model,
          vehicle_reg: vehicle.registration,
          vehicle_color: vehicle.color,
          start_time: new Date(),
          zone: DEFAULT_PATROL_ZONE,
        }, { onConflict: 'user_id' })
        .select();
      if (error) throw error;
      if (data && data.length > 0) {
        const newPatrol = data[0];
        setActivePatrol(newPatrol);
        setStartTime(new Date(newPatrol.start_time));
        toast.success("Patrol started!");
        playPatrolStart();
        
        // Start GPS tracking
        startTracking();
        
        // Set up auto-stop timer for GPS tracking (synced with patrol)
        // Default 8 hours (480 minutes) max patrol duration
        setupAutoStopTimer(480);
      }
    } catch (err) {
      console.error("Check-in failed:", err);
      toast.error("Check-in failed: " + err.message);
    }
  }, [user, startTracking, setupAutoStopTimer]);

  const startPatrolWithLegacy = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('active_patrols')
        .upsert({
          user_id: user.id,
          user_name: user.fullName || user.email,
          vehicle_type: normalizeVehicleType(user.carType, null),
          car_type: user.carType || "—",
          reg_number: user.registrationNumber || "—",
          vehicle_color: user.vehicleColor || "gray",
          start_time: new Date(),
          zone: DEFAULT_PATROL_ZONE,
        }, { onConflict: 'user_id' })
        .select();
      if (error) throw error;
      if (data && data.length > 0) {
        const newPatrol = data[0];
        setActivePatrol(newPatrol);
        setStartTime(new Date(newPatrol.start_time));
        toast.success("Patrol started!");
        playPatrolStart();
        
        // Start GPS tracking for legacy too
        startTracking();
        setupAutoStopTimer(480);
      }
    } catch (err) {
      console.error("Check-in failed:", err);
      toast.error("Check-in failed: " + err.message);
    }
  }, [user, startTracking, setupAutoStopTimer]);

  const handleCheckIn = useCallback(async () => {
    if (!user) return;
    if (user.vehicles && user.vehicles.length > 1) {
      setVehiclesList(user.vehicles);
      setShowVehiclePicker(true);
      return;
    }
    if (user.vehicles && user.vehicles.length === 1) {
      await startPatrolWithVehicle(user.vehicles[0].id);
      return;
    }
    await startPatrolWithLegacy();
  }, [user, startPatrolWithVehicle, startPatrolWithLegacy]);

  const handleCheckOut = useCallback(async (autoClosed = false) => {
    if (!activePatrol || isEndingRef.current) return;
    isEndingRef.current = true;
    try {
      // Stop GPS tracking before ending patrol
      await stopTracking();
      
      const { error: rpcError } = await supabase.rpc('end_patrol', { p_user_id: user.id });
      if (rpcError) throw rpcError;
      setAllActivePatrols(prev => prev.filter(p => p.user_id !== user.id));
      setActivePatrol(null);
      setStartTime(null);
      setShowWarning(false);
      setAutoCloseAt(null);
      warningTriggeredRef.current = false;
      toast.success(autoClosed ? "Patrol auto-ended (time limit reached)." : "Patrol ended. Log saved.");
      if (autoClosed) playPatrolAutoEnd();
      else playPatrolEnd();
    } catch (err) {
      console.error("Check-out failed:", err);
      toast.error("Check-out failed: " + err.message);
    } finally {
      isEndingRef.current = false;
    }
  }, [activePatrol, user, stopTracking]);

  useEffect(() => {
    if (!startTime) return;
    const startMs = startTime.getTime();

    const updateTimer = () => {
      const now = Date.now();
      const diff = Math.floor((now - startMs) / 1000);
      setTick((prev) => prev + 1);

      // First time past 2h: show modal + schedule auto-end at patrol start + 2.5h (not start + 30m — that was a bug).
      if (
        diff >= PATROL_WARNING_SECONDS &&
        !warningTriggeredRef.current &&
        !showWarning &&
        autoCloseAt == null
      ) {
        warningTriggeredRef.current = true;
        setShowWarning(true);
        playPatrolWarning();
        setAutoCloseAt(startMs + PATROL_MAX_ELAPSED_MS);
      }

      if (autoCloseAt != null && now >= autoCloseAt) {
        void handleCheckOut(true);
      }
    };

    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [startTime, showWarning, autoCloseAt, handleCheckOut]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const fetchInitial = async () => {
      try {
        const { data, error } = await supabase
          .from('active_patrols').select('*').eq('user_id', user.id).maybeSingle();
        if (cancelled) return;
        if (error) throw error;
        if (data) { 
          setActivePatrol(data); 
          setStartTime(new Date(data.start_time)); 
        }
        else setActivePatrol(null);
        setFetchError(null);
      } catch (err) {
        if (cancelled) return;
        setFetchError(err.message);
      } finally {
        if (!cancelled) setLoadingPatrol(false);
      }
    };
    fetchInitial();
    fetchAll();
    return () => { cancelled = true; };
  }, [user, fetchAll]);

  const formatTime = (seconds) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  const formatElapsed = (seconds) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return `${h}h ${m}m`;
  };

  useEffect(() => {
    const clickHandler = () => unlockAudio();
    document.addEventListener('click', clickHandler, { once: true });
    return () => document.removeEventListener('click', clickHandler);
  }, []);

  if (fetchError && !activePatrol && loadingPatrol === false) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-600 mb-4">Error loading patrol  {fetchError}</p>
          <button onClick={() => window.location.reload()} className="bg-blue-600 text-white px-4 py-2 rounded">Retry</button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800 md:pb-8 motion-safe:scroll-smooth">
      {/* ACTIVE THREATS BANNER - CRITICAL INTEGRATION */}
      {userLocation && (
        <ActiveThreatsBanner userLocation={userLocation} maxDistanceKm={2} />
      )}

      <div className="max-w-6xl mx-auto px-4 py-6 sm:px-6 lg:px-8 lg:py-8">

        {/* App brand + zone — one line; lg+ larger hit area + right rail for future zone switcher */}
        <div className="mb-5 flex min-w-0 items-center gap-2 sm:gap-3">
          <div className="flex min-w-0 flex-nowrap items-center gap-2 sm:gap-3 lg:gap-4">
            <img
              src={appMark}
              alt=""
              width={128}
              height={128}
              decoding="async"
              className="h-9 w-9 shrink-0 rounded-xl object-contain sm:h-10 sm:w-10 lg:h-11 lg:w-11"
            />
            <span className="truncate text-base font-bold tracking-tight text-gray-900 dark:text-white sm:text-lg lg:text-xl">
              Watchman
            </span>
            <span className="shrink-0 text-gray-400 dark:text-gray-500" aria-hidden>
              ·
            </span>
            <span className="min-w-0 truncate text-base font-semibold text-teal-700 dark:text-teal-400 sm:text-lg lg:text-xl">
              {formatPatrolPlaceLabel()}
            </span>
          </div>
          <div
            className="hidden min-h-[2.75rem] min-w-0 flex-1 items-center justify-end lg:flex"
            aria-hidden="true"
          />
        </div>

        {/* Header — compact bento strip */}
        <div className="bg-gradient-to-r from-teal-600 to-teal-700 dark:from-teal-800 dark:to-teal-900 rounded-2xl shadow-xl overflow-hidden mb-6 motion-safe:transition-shadow">
          <div className="px-5 py-6 sm:px-8 sm:py-7">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div className="flex items-center space-x-4 min-w-0">
                <button type="button" onClick={() => navigate('/profile')} className="focus:outline-none focus-visible:ring-2 focus-visible:ring-white rounded-full shrink-0">
                  {user?.avatarUrl ? (
                    <img src={user.avatarUrl} alt="Avatar" className="h-16 w-16 rounded-full object-cover ring-2 ring-white dark:ring-gray-300 shadow-md" />
                  ) : (
                    <div className="h-16 w-16 rounded-full bg-white dark:bg-gray-200 text-teal-600 dark:text-teal-800 flex items-center justify-center text-2xl font-bold shadow-md">
                      {initials}
                    </div>
                  )}
                </button>
                <div>
                  <h1 className="text-2xl sm:text-3xl font-bold text-white">Welcome back, {firstName}!</h1>
                  <p className="text-teal-100 text-sm mt-1">{todayDate}</p>
                  <div className="mt-2">
                    <span className="inline-block bg-yellow-200 dark:bg-yellow-800 text-yellow-800 dark:text-yellow-200 text-xs px-2 py-1 rounded-full">
                      Free Beta
                    </span>
                  </div>
                </div>
              </div>
              <div className="flex space-x-3 shrink-0">
                <button type="button" onClick={refreshData} className="p-2 rounded-full bg-white/20 hover:bg-white/30 motion-safe:transition" title="Refresh data">
                  <FaSync className="w-4 h-4 text-white" />
                </button>
                <SoundToggle />
                <ThemeToggle />
              </div>
            </div>
          </div>
        </div>

        {/* Currently on Patrol (others) */}
        {fetchAllError ? (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-2xl p-4 text-center mb-6">
            <p className="text-red-700 dark:text-red-300 mb-2">Error loading active patrols: {fetchAllError}</p>
            <button onClick={() => window.location.reload()} className="bg-red-600 text-white px-4 py-2 rounded-lg text-sm">Retry</button>
          </div>
        ) : fetchAllLoading ? (
          <div className="mb-6 flex justify-center rounded-2xl border border-amber-200/80 bg-amber-50/90 py-8 dark:border-amber-800/60 dark:bg-amber-950/20">
            <BrandedLoader message="Loading active patrols…" size="md" />
          </div>
        ) : allActivePatrols.length > 0 && (
          <div className="mb-8 rounded-2xl border border-green-200 dark:border-green-800 bg-green-50/90 dark:bg-green-950/25 shadow-soft overflow-hidden">
            <div className="px-6 py-4 border-b border-green-200/80 dark:border-green-800/80 bg-green-100/50 dark:bg-green-900/20">
              <h2 className="text-lg font-semibold text-green-900 dark:text-green-100">🟢 Currently on Patrol</h2>
            </div>
            <div className="p-4 sm:p-5">
              <div className="grid gap-4 sm:grid-cols-2">
                {allActivePatrols.map((p) => {
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
                      className="rounded-xl border border-green-200 dark:border-green-800 bg-white/80 dark:bg-gray-900/60 p-4 shadow-sm"
                    >
                      <div className="flex items-center gap-1.5 min-w-0">
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
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 mb-8 items-stretch">
        {/* Patrol column: status + upcoming schedule (fills height beside profile on large screens) */}
        <div className={`lg:col-span-7 flex flex-col gap-4 min-h-0 h-full ${activePatrol ? 'lg:row-span-2' : ''}`}>
          <div className="shrink-0 min-h-0">
          <div className={`relative overflow-hidden rounded-2xl p-6 motion-safe:transition-all motion-safe:duration-300
            ${activePatrol 
              ? 'bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-lg shadow-emerald-500/25' 
              : 'bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 shadow-card'
            }
          `}>
            {/* Background decoration for active state */}
            {activePatrol && (
              <div className="absolute top-0 right-0 w-64 h-64 bg-white/10 rounded-full -translate-y-1/2 translate-x-1/2 blur-3xl"></div>
            )}
            
            <div className="relative flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div className="flex items-start gap-4">
                <div
                  className={`w-14 h-14 shrink-0 rounded-2xl flex items-center justify-center text-2xl overflow-hidden
                  ${activePatrol
                    ? 'bg-white/20 backdrop-blur-sm'
                    : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300'
                  }
                `}
                >
                  {activePatrol ? (
                    <span className="text-white" aria-hidden>
                      ✓
                    </span>
                  ) : (
                    <img
                      src={startPatrolIcon}
                      alt=""
                      className="h-full w-full object-cover"
                      width={128}
                      height={128}
                      decoding="async"
                    />
                  )}
                </div>
                <div>
                  <h2 className={`text-xl font-bold ${activePatrol ? 'text-white' : 'text-gray-900 dark:text-white'}`}>
                    {activePatrol ? 'Patrol Active' : 'Ready to Start'}
                  </h2>
                  {activePatrol && (
                    <div className="mt-1 flex items-baseline gap-2">
                      <span className="text-4xl font-mono font-bold tracking-tight">
                        {formatTime(elapsed)}
                      </span>
                      <span className="text-emerald-100 text-sm font-medium">elapsed</span>
                    </div>
                  )}
                  {!activePatrol && (
                    <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">
                      Start a patrol to begin tracking your route
                    </p>
                  )}
                </div>
              </div>
              
              <div className="flex items-center gap-3">
                {activePatrol && (
                  <button
                    type="button"
                    onClick={() => handleCheckOut(false)}
                    className="btn bg-red-500 text-white hover:bg-red-600 focus:ring-red-500 shadow-lg shadow-red-500/30"
                  >
                    <FaStop className="mr-2" /> End Patrol
                  </button>
                )}
                {!activePatrol && (
                  <button
                    type="button"
                    onClick={handleCheckIn}
                    disabled={loadingPatrol}
                    className="btn bg-emerald-500 text-white hover:bg-emerald-600 focus:ring-emerald-500 shadow-lg shadow-emerald-500/30"
                  >
                    <FaPlay className="mr-2" /> Start Patrol
                  </button>
                )}
              </div>
            </div>
          </div>
          </div>

          <UpcomingScheduledPatrollers
            className="lg:flex-1"
            refreshNonce={upcomingScheduleRefresh}
          />
        </div>

        {/* GPS — above Your profile on large screens (right column); below patrol on mobile */}
        {activePatrol && (
          <div className="lg:col-span-5 mb-0 overflow-hidden rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-card min-h-0 flex flex-col">
            <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-4 sm:px-6 sm:py-5 bg-gradient-to-r from-slate-50 via-teal-50/60 to-teal-50/80 dark:from-gray-800 dark:via-teal-950/25 dark:to-teal-950/35 border-b border-gray-200/90 dark:border-gray-700/90">
              <div className="flex items-center gap-3 min-w-0">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-teal-100 text-teal-700 shadow-sm dark:bg-teal-900/50 dark:text-teal-200">
                  <FaMapMarkerAlt className="w-5 h-5" aria-hidden />
                </div>
                <div className="min-w-0">
                  <h3 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-white tracking-tight">
                    GPS tracking
                  </h3>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 hidden sm:block">
                    Your route is saved while this patrol is active
                  </p>
                </div>
              </div>
              <div
                className={`inline-flex items-center gap-2 rounded-full px-3.5 py-2 text-sm font-semibold tabular-nums shadow-sm border ${
                  isTracking
                    ? 'bg-green-100 text-green-900 border-green-200/80 dark:bg-green-900/35 dark:text-green-100 dark:border-green-700/50'
                    : 'bg-gray-100 text-gray-700 border-gray-200 dark:bg-gray-700/80 dark:text-gray-200 dark:border-gray-600'
                }`}
                role="status"
                aria-live="polite"
              >
                <span
                  className={`h-2 w-2 shrink-0 rounded-full motion-safe:transition-colors ${
                    isTracking ? 'bg-green-500 motion-safe:animate-pulse' : 'bg-gray-400 dark:bg-gray-500'
                  }`}
                  aria-hidden
                />
                {isTracking ? 'Live · Active' : 'Inactive'}
              </div>
            </div>

            {(totalDistance > 0 || routePoints.length > 0) && (
              <div className="px-5 py-4 sm:px-6 flex flex-wrap gap-3 bg-gray-50/70 dark:bg-gray-900/30">
                {totalDistance > 0 && (
                  <div className="flex flex-1 min-w-[10rem] items-center gap-3 rounded-xl border border-gray-200/80 dark:border-gray-600/80 bg-white dark:bg-gray-800/80 px-4 py-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300">
                      <FaRoad className="w-4 h-4" aria-hidden />
                    </div>
                    <div>
                      <p className="text-[10px] font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                        Distance
                      </p>
                      <p className="text-sm font-semibold text-gray-900 dark:text-white">
                        {totalDistance.toFixed(2)} km
                      </p>
                    </div>
                  </div>
                )}
                {routePoints.length > 0 && (
                  <div className="flex flex-1 min-w-[10rem] items-center gap-3 rounded-xl border border-gray-200/80 dark:border-gray-600/80 bg-white dark:bg-gray-800/80 px-4 py-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
                      <FaRoute className="w-4 h-4" aria-hidden />
                    </div>
                    <div>
                      <p className="text-[10px] font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                        Route points
                      </p>
                      <p className="text-sm font-semibold text-gray-900 dark:text-white">
                        {routePoints.length}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Profile — secondary bento cell */}
        <div className="lg:col-span-5 bento-tile overflow-hidden flex flex-col min-h-[12rem]">
          <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-700 shrink-0">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Your profile</h2>
          </div>
          <div className="p-5 space-y-3 flex-1">
            <div className="flex items-center space-x-3">
              <FaUser className="text-teal-500 dark:text-teal-400 w-5 h-5 shrink-0" />
              <span className="text-gray-700 dark:text-gray-300 text-sm">
                <span className="font-medium">Name:</span> {user?.fullName || "Not provided"}
              </span>
            </div>
            <div className="flex items-center space-x-3">
              <FaMapMarkerAlt className="text-teal-500 dark:text-teal-400 w-5 h-5 shrink-0" />
              <span className="text-gray-700 dark:text-gray-300 text-sm">
                <span className="font-medium">Address:</span> {user?.address || "Not provided"}
              </span>
            </div>
            {primaryVehicle ? (
              <div className="flex items-center space-x-3">
                <ProfileVehicleGlyph
                  type={primaryVehicle.vehicle_type}
                  carType={primaryVehicle.car_type || user.carType}
                />
                <span className="text-gray-700 dark:text-gray-300 text-sm">
                  <span className="font-medium">Primary vehicle:</span>{" "}
                  {primaryVehicleSummaryText}
                </span>
              </div>
            ) : (user?.carType || user?.registrationNumber) && (
              <div className="flex items-center space-x-3">
                <ProfileVehicleGlyph
                  type={user.carType}
                  carType={user.registrationNumber ? 'car' : null}
                />
                <span className="text-gray-700 dark:text-gray-300 text-sm">
                  <span className="font-medium">Vehicle:</span>{" "}
                  {user.carType && user.registrationNumber
                    ? `${user.carType} (${user.registrationNumber})`
                    : user.carType || user.registrationNumber}
                </span>
              </div>
            )}
            <div className="flex items-center space-x-3">
              <FaEnvelope className="text-teal-500 dark:text-teal-400 w-5 h-5 shrink-0" />
              <span className="text-gray-700 dark:text-gray-300 text-sm break-all">
                <span className="font-medium">Email:</span> {user?.email}
              </span>
            </div>
            <div className="flex items-center space-x-3">
              <FaPhone className="text-teal-500 dark:text-teal-400 w-5 h-5 shrink-0" />
              <span className="text-gray-700 dark:text-gray-300 text-sm">
                <span className="font-medium">Phone:</span> {user?.phone?.trim() ? user.phone : 'Not provided'}
              </span>
            </div>
          </div>
        </div>
        </div>

        {/* Primary actions — gradient + SVG (matches bento; scales cleanly vs raster PNGs) */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-3 gap-3 mb-4">
          <button
            type="button"
            onClick={() => navigate("/incident/new")}
            className="bento-tile-interactive flex flex-col items-center justify-center gap-2 min-h-[5.5rem] rounded-lg border-0 bg-gradient-to-br from-emerald-600 to-teal-600 text-white font-semibold p-4 shadow-lg shadow-emerald-900/20 hover:shadow-xl transition dark:from-emerald-700 dark:to-teal-800"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            <span className="text-sm text-center leading-tight">Report incident</span>
          </button>
          <button
            type="button"
            onClick={() => {
              void markChatVisited(null);
              navigate('/chat');
            }}
            aria-label="Open emergency chat"
            className="bento-tile-interactive relative flex flex-col items-center justify-center gap-2 min-h-[5.5rem] rounded-lg border-0 bg-gradient-to-br from-violet-600 to-purple-800 text-white font-semibold p-4 shadow-lg shadow-purple-900/25 hover:shadow-xl transition dark:from-violet-700 dark:to-purple-900"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
            <span className="text-sm text-center leading-tight">Emergency chat</span>
            {unreadCount > 0 && (
              <span className="absolute top-2 right-2 bg-red-500 text-white text-xs font-bold rounded-full min-w-[1.25rem] h-5 px-1 flex items-center justify-center motion-safe:animate-pulse">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => navigate('/intelligence')}
            className="bento-tile-interactive col-span-2 sm:col-span-1 flex flex-col items-center justify-center gap-2 min-h-[5.5rem] rounded-lg border-0 bg-gradient-to-br from-red-600 to-red-400 text-white font-semibold p-4 shadow-lg shadow-red-900/25 hover:shadow-xl transition dark:from-red-700 dark:to-red-600"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <span className="text-sm text-center leading-tight">Intelligence</span>
          </button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-8">
          <button type="button" onClick={() => navigate('/schedule')} className="bento-tile-interactive p-3 text-sm font-medium text-gray-800 dark:text-gray-100 flex items-center justify-center gap-2 text-center">
            <FaCalendarAlt className="text-indigo-500 dark:text-indigo-400 shrink-0" aria-hidden />
            <span>Patrol schedule</span>
          </button>
          <button type="button" onClick={() => navigate('/incidents')} className="bento-tile-interactive p-3 text-sm font-medium text-gray-800 dark:text-gray-100 flex items-center justify-center gap-2 text-center">
            <FaClipboardList className="text-emerald-600 dark:text-emerald-400 shrink-0" aria-hidden />
            <span>View incidents</span>
          </button>
          <button type="button" onClick={() => navigate('/vehicles')} className="bento-tile-interactive p-3 text-sm font-medium text-gray-800 dark:text-gray-100 flex items-center justify-center gap-2 text-center">
            <FaCar className="text-slate-600 dark:text-slate-300 shrink-0" aria-hidden />
            <span>Vehicles</span>
          </button>
          <button type="button" onClick={() => navigate('/leaderboard')} className="bento-tile-interactive p-3 text-sm font-medium text-gray-800 dark:text-gray-100 flex items-center justify-center gap-2 text-center">
            <FaTrophy className="text-amber-500 shrink-0" aria-hidden />
            <span>Leaderboard</span>
          </button>
          <button type="button" onClick={() => navigate('/guide')} className="bento-tile-interactive p-3 text-sm font-medium text-gray-800 dark:text-gray-100 flex items-center justify-center gap-2 text-center">
            <FaBook className="text-violet-600 dark:text-violet-400 shrink-0" aria-hidden />
            <span>Guide</span>
          </button>
          <button type="button" onClick={() => navigate('/about')} className="bento-tile-interactive p-3 text-sm font-medium text-gray-800 dark:text-gray-100 flex items-center justify-center gap-2 text-center">
            <FaInfoCircle className="text-sky-600 dark:text-sky-400 shrink-0" aria-hidden />
            <span>About</span>
          </button>
          {canAccessAdminPanel(user?.role) && (
            <button
              type="button"
              onClick={() => navigate('/admin')}
              className="relative bento-tile-interactive col-span-2 md:col-span-3 lg:col-span-6 p-3 text-sm font-semibold text-teal-700 dark:text-teal-300 flex items-center justify-center gap-2 text-center bg-teal-50/80 dark:bg-teal-950/40 border-teal-200/60 dark:border-teal-800/60"
            >
              <FaShieldAlt className="text-teal-600 dark:text-teal-400 shrink-0" aria-hidden />
              <span>Admin panel</span>
              {(pendingIncidentCount + pendingFeedbackCount) > 0 && (
                <span
                  className="absolute -top-1.5 -right-1.5 sm:top-1 sm:right-2 bg-red-500 text-white text-xs font-bold rounded-full min-w-[1.25rem] h-5 px-1 flex items-center justify-center motion-safe:animate-pulse"
                  aria-label={`${pendingIncidentCount} incident(s) pending, ${pendingFeedbackCount} feedback item(s) pending review`}
                >
                  {(pendingIncidentCount + pendingFeedbackCount) > 99
                    ? '99+'
                    : pendingIncidentCount + pendingFeedbackCount}
                </span>
              )}
            </button>
          )}
        </div>

        {/* Footer */}
        <div className="mt-8 text-center text-xs text-gray-500 dark:text-gray-400 flex justify-between items-center border-t border-gray-200 dark:border-gray-700 pt-4">
          <span>Neighbourhood Watch Platform • Member since {user?.createdAt ? new Date(user.createdAt).toLocaleDateString() : "recently"}</span>
          <button type="button" onClick={signOut} className="text-gray-500 dark:text-gray-400 hover:text-red-600 dark:hover:text-red-400 transition text-xs underline">Sign Out</button>
        </div>
      </div>


      {/* Patrol Time Warning Modal */}
      {showWarning && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl max-w-sm w-full p-6">
            <h2 className="text-xl font-bold mb-4 dark:text-white">Patrol Time Warning</h2>
            <p className="text-gray-700 dark:text-gray-300 mb-4">You've been on patrol for 2 hours. Do you want to continue?</p>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => {
                  setShowWarning(false);
                  setAutoCloseAt(null);
                  // Keep warningTriggeredRef true so the 2h modal does not re-fire every tick while patrol continues.
                  warningTriggeredRef.current = true;
                }}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                Continue
              </button>
              <button onClick={() => handleCheckOut(false)} className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700">
                End Patrol
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Vehicle Picker Modal */}
      {showVehiclePicker && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl max-w-md w-full p-6 shadow-2xl">
            <h2 className="text-xl font-bold mb-4 text-gray-900 dark:text-white">Select Vehicle</h2>
            <div className="space-y-2">
              {vehiclesList.map(v => {
                const reg = v.registration?.trim();
                const norm = normalizeVehicleType(v.vehicle_type, v.make_model);
                const label = isLightMobilityVehicleType(v.vehicle_type)
                  ? getVehicleTypePublicLabel(v.vehicle_type)
                  : reg
                    ? `${v.make_model}  (${reg})`
                    : v.make_model;

                const subtitle = isLightMobilityVehicleType(v.vehicle_type)
                  ? null
                  : `${getVehicleTypePublicLabel(norm)} · ${v.color || 'unknown color'}`;

                return (
                  <button
                    key={v.id}
                    onClick={() => { setShowVehiclePicker(false); startPatrolWithVehicle(v.id); }}
                    className="w-full text-left p-3 border border-gray-100 dark:border-gray-600 rounded-xl hover:bg-slate-50 dark:hover:bg-gray-700 transition"
                  >
                    <div className="flex items-center gap-3">
                      <div style={{
                        width: 36, height: 36,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        borderRadius: '50%',
                        backgroundColor: '#f1f5f9',
                        flexShrink: 0,
                      }}>
                        <VehicleIcon type={v.vehicle_type || 'car'} color={v.color} size="md" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-gray-900 dark:text-white truncate">{label}</p>
                        {subtitle && (
                          <p className="text-xs text-gray-400 dark:text-gray-500 capitalize">{subtitle}</p>
                        )}
                      </div>
                      {v.is_primary && (
                        <span className="ml-auto text-xs px-2 py-0.5 bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300 rounded-full font-medium flex-shrink-0">
                          Primary
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
            <button
              onClick={() => setShowVehiclePicker(false)}
              className="mt-4 w-full py-2 text-sm text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-200 transition rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <PatrollerPhotoPreview
        open={!!patrolPhotoPreview}
        onClose={() => setPatrolPhotoPreview(null)}
        name={patrolPhotoPreview?.name}
        imageUrl={patrolPhotoPreview?.imageUrl}
      />
    </div>
  );
}