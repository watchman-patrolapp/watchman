// src/pages/Dashboard.jsx
import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/useAuth";
import { supabase } from "../supabase/client";
import { FaUser, FaMapMarkerAlt, FaEnvelope, FaPlay, FaStop, FaComment, FaTrophy, FaSync, FaMapMarkerAlt as FaMapPin, FaRuler } from "react-icons/fa";
import toast from 'react-hot-toast';
import ThemeToggle from "../components/ThemeToggle";
import SoundToggle from "../components/SoundToggle";
import VehicleIcon, { getVehicleDisplayInfo, COLOR_HEX, normalizeVehicleType } from '../components/VehicleIcon'; // ✅ NEW IMPORT
import { 
  playChatNotification,
  playPatrolStart, 
  playPatrolEnd, 
  playPatrolWarning, 
  playPatrolAutoEnd,
  playPatrolSigninNotification
} from '../utils/sound';
import { useChatNotifications, useUnreadCount } from '../chat';
import { useGPSTracking } from '../hooks/useGPSTracking';

// --- Constants ---
const PATROL_WARNING_SECONDS = 7200;
const AUTO_CLOSE_EXTENSION_SECONDS = 1800;
const AUTO_CLOSE_DELAY_MS = AUTO_CLOSE_EXTENSION_SECONDS * 1000;
const POLLING_INTERVAL_MS = 30000;

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

  const warningTriggeredRef = useRef(false);
  const isEndingRef = useRef(false);
  const [, setTick] = useState(0);
  const prevPatrolsRef = useRef(null);

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
    if (window.location.pathname !== '/chat') {
      playThrottled('chat', playChatNotification);
    }
  }, [refetchUnread]);

  // Subscribe to chat notifications
  useChatNotifications(user?.id, handleNewMessage);

  // --- Memoized derived values ---
  const primaryVehicle = useMemo(() => {
    if (user?.vehicles && user.vehicles.length > 0) {
      return user.vehicles.find(v => v.is_primary) || user.vehicles[0];
    }
    return null;
  }, [user]);

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
      const incoming = data || [];
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
  }, [fetchAll, refetchUnread]);

  // Polling fallback
  useEffect(() => {
    const interval = setInterval(() => { fetchAll(); }, POLLING_INTERVAL_MS);
    return () => clearInterval(interval);
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
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'active_patrols' }, (payload) => {
        setAllActivePatrols(prev => {
          if (prev.some(p => p.user_id === payload.new.user_id)) return prev;
          return [...prev, payload.new];
        });
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'active_patrols' }, (payload) => {
        setAllActivePatrols(prev => prev.filter(p => p.user_id !== payload.old.user_id));
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'active_patrols' }, (payload) => {
        setAllActivePatrols(prev => prev.map(p => p.user_id === payload.new.user_id ? payload.new : p));
      })
      .subscribe();
    return () => supabase.removeChannel(subscription);
  }, []);

  // --- GPS Tracking Hook ---
  const { 
    isTracking, 
    currentLocation, 
    totalDistance, 
    routePoints,
    startTracking, 
    stopTracking,
    setupAutoStopTimer
  } = useGPSTracking(user?.id, activePatrol?.id, !!activePatrol);

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
          zone: "Zone A",
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
        setupAutoStopTimer(newPatrol.start_time);
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
          zone: "Zone A",
        }, { onConflict: 'user_id' })
        .select();
      if (error) throw error;
      if (data && data.length > 0) {
        const newPatrol = data[0];
        setActivePatrol(newPatrol);
        setStartTime(new Date(newPatrol.start_time));
        toast.success("Patrol started!");
        playPatrolStart();
      }
    } catch (err) {
      console.error("Check-in failed:", err);
      toast.error("Check-in failed: " + err.message);
    }
  }, [user]);

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
    const updateTimer = () => {
      if (!startTime) return;
      const now = Date.now();
      const diff = Math.floor((now - startTime) / 1000);
      setTick(prev => prev + 1);
      if (diff >= PATROL_WARNING_SECONDS && !warningTriggeredRef.current && !showWarning && !autoCloseAt) {
        warningTriggeredRef.current = true;
        setShowWarning(true);
        playPatrolWarning();
        setAutoCloseAt(startTime + AUTO_CLOSE_DELAY_MS);
      }
      if (autoCloseAt && now >= autoCloseAt) handleCheckOut(true);
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
        if (data) { setActivePatrol(data); setStartTime(new Date(data.start_time)); }
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
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800">
      <div className="max-w-3xl mx-auto px-4 py-8 sm:px-6 lg:px-8">

        {/* Header Card */}
        <div className="bg-gradient-to-r from-indigo-600 to-indigo-700 dark:from-indigo-800 dark:to-indigo-900 rounded-3xl shadow-xl overflow-hidden mb-8">
          <div className="px-6 py-8 sm:px-8 sm:py-10">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div className="flex items-center space-x-4">
                <button onClick={() => navigate('/profile')} className="focus:outline-none">
                  {user?.avatarUrl ? (
                    <img src={user.avatarUrl} alt="Avatar" className="h-16 w-16 rounded-full object-cover ring-2 ring-white dark:ring-gray-300 shadow-md" />
                  ) : (
                    <div className="h-16 w-16 rounded-full bg-white dark:bg-gray-200 text-indigo-600 dark:text-indigo-800 flex items-center justify-center text-2xl font-bold shadow-md">
                      {initials}
                    </div>
                  )}
                </button>
                <div>
                  <h1 className="text-2xl sm:text-3xl font-bold text-white">Welcome back, {firstName}!</h1>
                  <p className="text-indigo-100 text-sm mt-1">{todayDate}</p>
                  <div className="mt-2">
                    <span className="inline-block bg-yellow-200 dark:bg-yellow-800 text-yellow-800 dark:text-yellow-200 text-xs px-2 py-1 rounded-full">
                      Free Beta
                    </span>
                  </div>
                </div>
              </div>
              <div className="flex space-x-3">
                <button onClick={refreshData} className="p-2 rounded-full bg-white/20 hover:bg-white/30 transition" title="Refresh data">
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
          <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-2xl p-4 text-center mb-6">
            <p className="text-yellow-800 dark:text-yellow-200">Loading active patrols...</p>
          </div>
        ) : allActivePatrols.length > 0 && (
          <div className="bg-yellow-50 dark:bg-gray-800 border border-yellow-300 dark:border-gray-600 rounded-2xl shadow-soft overflow-hidden mb-8">
            <div className="px-6 py-5 border-b border-yellow-200 dark:border-gray-700">
              <h2 className="text-xl font-semibold text-yellow-800 dark:text-white">🟡 Currently on Patrol</h2>
            </div>
            <div className="divide-y divide-yellow-200 dark:divide-gray-700">
              {allActivePatrols.map(p => {
                const started = new Date(p.start_time);
                const elapsedSec = Math.floor((new Date() - started) / 1000);
                const vehicleType = normalizeVehicleType(p.vehicle_type, p.car_type);
                const vehicleColor = p.vehicle_color || 'gray';
                const vehicleInfo = getVehicleDisplayInfo(
                  vehicleType, 
                  vehicleColor, 
                  p.vehicle_make_model, 
                  p.vehicle_reg
                );

                return (
                  <div key={p.user_id} className="px-6 py-4 flex justify-between items-center">
                    <div>
                      <p className="font-medium text-gray-900 dark:text-white">{p.user_name}</p>
                      <div className="text-sm text-gray-500 dark:text-gray-400 space-y-1 mt-1">
                        <div className="flex items-center gap-2">
                          <VehicleIcon 
                            type={vehicleType} 
                            color={vehicleColor} 
                            size="sm"
                          />
                          <span>{vehicleInfo.displayText}</span>
                        </div>
                        <div>Started: {started.toLocaleTimeString()}</div>
                        <div>Elapsed: {formatElapsed(elapsedSec)}</div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Patrol status card */}
        <div className="mb-8">
          <div className={`rounded-2xl p-6 ${activePatrol ? 'bg-gradient-to-r from-green-50 to-emerald-50 dark:from-green-900/20 dark:to-emerald-900/20 border border-green-200 dark:border-green-800' : 'bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 shadow-soft'}`}>
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <h2 className="text-xl font-semibold text-gray-800 dark:text-gray-200">
                  {activePatrol ? 'Your Patrol is Active' : 'Not on Patrol'}
                </h2>
                {activePatrol && (
                  <p className="text-4xl font-mono font-bold text-green-700 dark:text-green-400 mt-2">
                    {formatTime(elapsed)}
                  </p>
                )}
              </div>
              <div>
                {activePatrol ? (
                  <button
                    onClick={() => handleCheckOut(false)}
                    className="inline-flex items-center px-6 py-3 bg-red-500 hover:bg-red-600 text-white font-medium rounded-xl shadow-md transition-all transform hover:scale-105"
                  >
                    <FaStop className="mr-2" /> End Patrol
                  </button>
                ) : (
                  <button
                    onClick={handleCheckIn}
                    disabled={loadingPatrol}
                    className="inline-flex items-center px-6 py-3 bg-green-500 hover:bg-green-600 text-white font-medium rounded-xl shadow-md transition-all transform hover:scale-105 disabled:opacity-50"
                  >
                    <FaPlay className="mr-2" /> Start Patrol
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* GPS Tracking Status */}
        {activePatrol && (
          <div className="bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 border border-blue-200 dark:border-blue-800 rounded-2xl shadow-soft overflow-hidden mb-8">
            <div className="px-6 py-4 border-b border-blue-200 dark:border-blue-800">
              <h2 className="text-lg font-semibold text-blue-800 dark:text-blue-200">GPS Tracking</h2>
            </div>
            <div className="p-6 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <div className={`w-3 h-3 rounded-full ${isTracking ? 'bg-green-500 animate-pulse' : 'bg-gray-400'}`}></div>
                  <span className="font-medium text-gray-900 dark:text-white">
                    {isTracking ? 'GPS Active' : 'GPS Inactive'}
                  </span>
                </div>
                <div className="text-sm text-gray-600 dark:text-gray-300">
                  {currentLocation && (
                    <span>Accuracy: {Math.round(currentLocation.accuracy)}m</span>
                  )}
                </div>
              </div>
              {totalDistance > 0 && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-600 dark:text-gray-300">Distance covered:</span>
                  <span className="font-semibold text-gray-900 dark:text-white">{totalDistance.toFixed(2)} km</span>
                </div>
              )}
              {routePoints.length > 0 && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-600 dark:text-gray-300">Route points:</span>
                  <span className="font-semibold text-gray-900 dark:text-white">{routePoints.length}</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Profile Information Card */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-soft border border-gray-100 dark:border-gray-700 overflow-hidden mb-8">
          <div className="px-6 py-5 border-b border-gray-100 dark:border-gray-700">
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Your Profile</h2>
          </div>
          <div className="p-6 space-y-4">
            <div className="flex items-center space-x-3">
              <FaUser className="text-indigo-500 dark:text-indigo-400 w-5 h-5" />
              <span className="text-gray-700 dark:text-gray-300">
                <span className="font-medium">Name:</span> {user?.fullName || "Not provided"}
              </span>
            </div>
            <div className="flex items-center space-x-3">
              <FaMapMarkerAlt className="text-indigo-500 dark:text-indigo-400 w-5 h-5" />
              <span className="text-gray-700 dark:text-gray-300">
                <span className="font-medium">Address:</span> {user?.address || "Not provided"}
              </span>
            </div>
            {primaryVehicle ? (
              <div className="flex items-center space-x-3">
                <VehicleIcon 
                  type={normalizeVehicleType(primaryVehicle.vehicle_type, primaryVehicle.car_type || user.carType)} 
                  color={primaryVehicle.color || 'gray'} 
                  size="sm"
                />
                <span className="text-gray-700 dark:text-gray-300">
                  <span className="font-medium">Primary Vehicle:</span>{" "}
                  {normalizeVehicleType(primaryVehicle.vehicle_type, primaryVehicle.car_type || user.carType) === 'on_foot'
                    ? 'On foot'
                    : `${primaryVehicle.make_model}${primaryVehicle.registration ? ` (${primaryVehicle.registration})` : ''}`}
                </span>
              </div>
            ) : (user?.carType || user?.registrationNumber) && (
              <div className="flex items-center space-x-3">
                <VehicleIcon 
                  type={normalizeVehicleType(user.carType, user.registrationNumber ? 'car' : null)}
                  color={user.vehicleColor || 'gray'}
                  size="sm"
                />
                <span className="text-gray-700 dark:text-gray-300">
                  <span className="font-medium">Vehicle:</span>{" "}
                  {user.carType && user.registrationNumber
                    ? `${user.carType} (${user.registrationNumber})`
                    : user.carType || user.registrationNumber}
                </span>
              </div>
            )}
            <div className="flex items-center space-x-3">
              <FaEnvelope className="text-indigo-500 dark:text-indigo-400 w-5 h-5" />
              <span className="text-gray-700 dark:text-gray-300">
                <span className="font-medium">Email:</span> {user?.email}
              </span>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
          <button onClick={() => navigate("/guide")} className="px-4 py-2 bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded-xl hover:bg-gray-200 dark:hover:bg-gray-600 transition text-sm font-medium">Guide</button>
          <button onClick={() => navigate("/about")} className="px-4 py-2 bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded-xl hover:bg-gray-200 dark:hover:bg-gray-600 transition text-sm font-medium">About</button>
          <button onClick={() => navigate("/vehicles")} className="px-4 py-2 bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded-xl hover:bg-gray-200 dark:hover:bg-gray-600 transition text-sm font-medium">Vehicles</button>
          <button onClick={() => navigate("/leaderboard")} className="px-4 py-2 bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded-xl hover:bg-gray-200 dark:hover:bg-gray-600 transition text-sm font-medium flex items-center justify-center gap-1">
            <FaTrophy className="text-yellow-500" /> Leaderboard
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <button onClick={() => navigate("/schedule")} className="px-4 py-3 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 transition text-sm font-medium">Patrol Schedule</button>
          <button onClick={() => navigate("/incidents")} className="px-4 py-3 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 transition text-sm font-medium">View Incidents</button>
          <button onClick={() => navigate("/incident/new")} className="px-4 py-3 bg-green-600 text-white rounded-xl hover:bg-green-700 transition text-sm font-medium">Report Incident</button>
          
          {/* ✅ FIXED: Emergency Chat button now navigates to /chat */}
          <button 
            onClick={() => {
              localStorage.setItem('lastChatVisit', new Date().toISOString());
              navigate("/chat");
            }} 
            className="relative px-4 py-3 bg-purple-600 text-white rounded-xl hover:bg-purple-700 transition text-sm font-medium flex items-center justify-center gap-1"
            aria-label="Open Emergency Chat"
          >
            <FaComment />
            <span>Emergency Chat</span>
            {unreadCount > 0 && (
              <span className="absolute -top-2 -right-2 bg-red-500 text-white text-xs font-bold rounded-full h-5 w-5 flex items-center justify-center animate-pulse">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </button>
          
          {(user?.role === "admin" || user?.role === "committee") && (
            <button onClick={() => navigate("/admin")} className="px-4 py-3 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 transition text-sm font-medium">Admin Panel</button>
          )}
        </div>

        {/* Footer */}
        <div className="mt-8 text-center text-xs text-gray-500 dark:text-gray-400 flex justify-between items-center border-t border-gray-200 dark:border-gray-700 pt-4">
          <span>Neighbourhood Watch Platform • Member since {user?.createdAt ? new Date(user.createdAt).toLocaleDateString() : "recently"}</span>
          <button onClick={signOut} className="text-gray-500 dark:text-gray-400 hover:text-red-600 dark:hover:text-red-400 transition text-xs underline">Sign Out</button>
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
                onClick={() => { setShowWarning(false); setAutoCloseAt(null); warningTriggeredRef.current = false; }}
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
                const label = v.vehicle_type === 'on_foot'
                  ? 'On foot'
                  : reg
                    ? `${v.make_model}  (${reg})`
                    : v.make_model;

                const subtitle = v.vehicle_type === 'on_foot'
                  ? null
                  : v.vehicle_type === 'bicycle'
                    ? 'Bicycle'
                    : `Car · ${v.color || 'unknown color'}`;

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
    </div>
  );
}