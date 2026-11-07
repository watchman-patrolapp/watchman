import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../../supabase/client';
import toast from '../../utils/notify';
import { normalizeVehicleType } from '../../components/VehicleIcon';
import {
  playPatrolStart,
  playPatrolEnd,
  playPatrolWarning,
  playPatrolAutoEnd,
  playPatrolSigninNotification,
} from '../../utils/sound';
import { useGPSTracking } from '../../hooks/useGPSTracking';
import { enrichPatrolRowsWithAvatars } from '../../utils/enrichPatrolAvatars';
import { syncActivePatrolVehicleFromVehicleList } from '../../utils/syncActivePatrolVehicle';
import { DEFAULT_PATROL_ZONE } from '../../config/neighborhoodRegions';
import { adaptivePollIntervalMs, subscribeDataBudgetHints } from '../../utils/dataSaverProfile';
import { belongsToActiveOrganization } from '../../utils/organizationScope';
import { parsePatrolTime } from '../../utils/watchTime';
import { fetchPatrolShare } from '../../utils/sharePatrol';
import {
  PATROL_MAX_ELAPSED_MS,
  PATROL_WARNING_SECONDS,
  playThrottled,
  unlockAudio,
} from './patrolTiming';
import { OFFLINE_SCREENS, userFacingReadError, userFacingWriteError } from '../../offline/policy';
import { patchScreenSnapshot, readScreenSnapshot } from '../../offline/snapshots';

const FETCH_ALL_TIMEOUT_MS = 15000;
const CACHE_READ_TIMEOUT_MS = 4000;

function withTimeout(promise, ms, message) {
  let timer = 0;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([Promise.resolve(promise), timeout]).finally(() => clearTimeout(timer));
}

export function usePatrolLifecycle({
  user,
  scope,
  activeOrganization,
  activeOrganizationId,
  includeUnscoped,
  canDoPatrolOps,
  refetchUnread,
}) {
  const [activePatrol, setActivePatrol] = useState(null);
  const [shareTarget, setShareTarget] = useState(null);
  const [shareRefreshKey, setShareRefreshKey] = useState(0);
  const [startTime, setStartTime] = useState(null);
  const [loadingPatrol, setLoadingPatrol] = useState(true);
  const [allActivePatrols, setAllActivePatrols] = useState([]);
  const [fetchError, setFetchError] = useState(null);
  const [fetchAllError, setFetchAllError] = useState(null);
  const [mineFromCache, setMineFromCache] = useState(false);
  const [mineSavedAt, setMineSavedAt] = useState(null);
  const [allFromCache, setAllFromCache] = useState(false);
  const [allSavedAt, setAllSavedAt] = useState(null);
  const [fetchAllLoading, setFetchAllLoading] = useState(false);

  const [showWarning, setShowWarning] = useState(false);
  const [autoCloseAt, setAutoCloseAt] = useState(null);
  const [showVehiclePicker, setShowVehiclePicker] = useState(false);
  const [vehiclesList, setVehiclesList] = useState([]);
  const [patrolPhotoPreview, setPatrolPhotoPreview] = useState(null);

  const warningTriggeredRef = useRef(false);
  const isEndingRef = useRef(false);
  const isStartingRef = useRef(false);
  const fetchAllGenRef = useRef(0);
  const [, setTick] = useState(0);
  const prevPatrolsRef = useRef(null);
  const patrolAvatarUrlByUserIdRef = useRef({});
  const [upcomingScheduleRefresh, setUpcomingScheduleRefresh] = useState(0);

  const nowMs = Date.now();
  const elapsed = startTime ? Math.floor((nowMs - startTime.getTime()) / 1000) : 0;

  const fetchAll = useCallback(async () => {
    const runId = ++fetchAllGenRef.current;
    if (prevPatrolsRef.current === null) setFetchAllLoading(true);
    try {
      const incoming = await withTimeout(
        (async () => {
          const { data, error } = await scope(supabase.from('active_patrols').select('*'));
          if (error) throw error;
          return enrichPatrolRowsWithAvatars(supabase, data || []);
        })(),
        FETCH_ALL_TIMEOUT_MS,
        'Loading active patrols timed out.'
      );
      if (runId !== fetchAllGenRef.current) return;
      incoming.forEach((p) => {
        patrolAvatarUrlByUserIdRef.current[p.user_id] = p.patrol_avatar_url;
      });
      setAllActivePatrols(incoming);
      prevPatrolsRef.current = incoming;
      setFetchAllError(null);
      setAllFromCache(false);
      // Data is live: drop the loading state now. Persisting the offline copy must never hold it up.
      setFetchAllLoading(false);
      if (user?.id) {
        void patchScreenSnapshot(
          { userId: user.id, organizationId: activeOrganizationId, screen: OFFLINE_SCREENS.patrolStatus },
          (current) => ({
            ...(current || {}),
            all: incoming,
            allKnown: true,
            allSavedAt: new Date().toISOString(),
          })
        )
          .then((saved) => {
            if (runId !== fetchAllGenRef.current) return;
            setAllSavedAt(saved?.data?.allSavedAt || saved?.savedAt || null);
          })
          .catch(() => {});
      }
    } catch (err) {
      if (runId !== fetchAllGenRef.current) return;
      const cached = user?.id
        ? await withTimeout(
          readScreenSnapshot({
            userId: user.id,
            organizationId: activeOrganizationId,
            screen: OFFLINE_SCREENS.patrolStatus,
          }),
          CACHE_READ_TIMEOUT_MS,
          'Offline cache read timed out.'
        ).catch(() => null)
        : null;
      if (runId !== fetchAllGenRef.current) return;
      if (cached?.data?.allKnown && Array.isArray(cached.data.all)) {
        setAllActivePatrols(cached.data.all);
        prevPatrolsRef.current = cached.data.all;
        setFetchAllError(null);
        setAllFromCache(true);
        setAllSavedAt(cached.data.allSavedAt || cached.savedAt);
      } else {
        setAllFromCache(false);
        setFetchAllError(userFacingReadError(err, "Could not load active patrols."));
      }
    } finally {
      if (runId === fetchAllGenRef.current) setFetchAllLoading(false);
    }
  }, [scope, user?.id, activeOrganizationId]);

  const refreshData = useCallback(() => {
    fetchAll();
    refetchUnread();
    setUpcomingScheduleRefresh((n) => n + 1);
  }, [fetchAll, refetchUnread]);

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

  useEffect(() => {
    if (!user) return;
    const subscription = supabase
      .channel('patrol-starts')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'active_patrols' }, (payload) => {
        if (!belongsToActiveOrganization(payload.new, activeOrganizationId, includeUnscoped)) return;
        if (payload.new.user_id !== user.id) playThrottled('patrol-start', playPatrolSigninNotification);
      })
      .subscribe();
    return () => supabase.removeChannel(subscription);
  }, [user, activeOrganizationId, includeUnscoped]);

  useEffect(() => {
    const subscription = supabase
      .channel('all-active-patrols')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'active_patrols' }, async (payload) => {
        const row = payload.new;
        if (!row?.user_id) return;
        if (!belongsToActiveOrganization(row, activeOrganizationId, includeUnscoped)) return;
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
        if (!belongsToActiveOrganization(payload.new, activeOrganizationId, includeUnscoped)) {
          setAllActivePatrols((prev) => prev.filter((p) => p.user_id !== payload.new.user_id));
          return;
        }
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
  }, [user?.id, user?.avatarUrl, activeOrganizationId, includeUnscoped]);

  const {
    isTracking,
    totalDistance,
    routePoints,
    startTracking,
    stopTracking,
  } = useGPSTracking({
    patrolId: activePatrol?.user_id,
    userId: user?.id
  });

  useEffect(() => {
    if (activePatrol?.user_id && user?.id && !isTracking) {
      startTracking();
    }
  }, [activePatrol?.user_id, user?.id, isTracking, startTracking]);

  const patrolSyncUserId = activePatrol?.user_id;
  const patrolSyncVehicleId = activePatrol?.vehicle_id;
  const patrolSyncVehicleColor = activePatrol?.vehicle_color;
  const patrolSyncMakeModel = activePatrol?.vehicle_make_model;
  const patrolSyncVehicleReg = activePatrol?.vehicle_reg;
  const patrolSyncVehicleType = activePatrol?.vehicle_type;

  useEffect(() => {
    if (!user?.id || !patrolSyncUserId || patrolSyncUserId !== user.id) return;
    if (!user.vehicles?.length) return;
    const patrolSnapshot = {
      user_id: patrolSyncUserId,
      vehicle_id: patrolSyncVehicleId,
      vehicle_color: patrolSyncVehicleColor,
      vehicle_make_model: patrolSyncMakeModel,
      vehicle_reg: patrolSyncVehicleReg,
      vehicle_type: patrolSyncVehicleType,
    };
    let cancelled = false;
    (async () => {
      const { updated, data } = await syncActivePatrolVehicleFromVehicleList(
        supabase,
        user.id,
        user.vehicles,
        patrolSnapshot
      );
      if (cancelled || !updated || !data) return;
      setActivePatrol(data);
      setAllActivePatrols((prev) => prev.map((p) => (p.user_id === user.id ? { ...p, ...data } : p)));
    })();
    return () => { cancelled = true; };
  }, [
    user?.id,
    user?.vehicles,
    patrolSyncUserId,
    patrolSyncVehicleId,
    patrolSyncVehicleColor,
    patrolSyncMakeModel,
    patrolSyncVehicleReg,
    patrolSyncVehicleType,
  ]);

  const startPatrolWithVehicle = useCallback(async (vehicleId) => {
    if (isStartingRef.current || isEndingRef.current) return;
    isStartingRef.current = true;
    const vehicle = user.vehicles.find(v => v.id === vehicleId);
    try {
      const { data: existing, error: existingErr } = await scope(
        supabase.from('active_patrols').select('user_id, start_time')
      ).eq('user_id', user.id).maybeSingle();
      if (existingErr) throw existingErr;
      if (existing) {
        toast.error("You already have an active patrol.");
        const started = parsePatrolTime(existing.start_time);
        setActivePatrol((prev) => prev || { ...existing, user_id: user.id });
        if (started) setStartTime(started);
        return;
      }

      const { data, error } = await supabase
        .from('active_patrols')
        .insert({
          user_id: user.id,
          user_name: user.fullName || user.email,
          vehicle_id: vehicleId,
          vehicle_type: normalizeVehicleType(vehicle.vehicle_type, vehicle.make_model) || 'car',
          vehicle_make_model: vehicle.make_model,
          vehicle_reg: vehicle.registration,
          vehicle_color: vehicle.color,
          start_time: new Date().toISOString(),
          zone: activeOrganization?.name || DEFAULT_PATROL_ZONE,
          organization_id: activeOrganization?.id || user.organizationId || null,
        })
        .select();
      if (error) throw error;
      if (data && data.length > 0) {
        const newPatrol = data[0];
        setActivePatrol(newPatrol);
        setStartTime(parsePatrolTime(newPatrol.start_time) || new Date());
        toast.success("Patrol started!");
        playPatrolStart();
        startTracking();
        if (newPatrol.share_ref) setShareTarget({ kind: 'start', patrol: newPatrol });
        setShareRefreshKey((k) => k + 1);
      }
    } catch (err) {
      console.error("Check-in failed:", err);
      toast.error(userFacingWriteError(err, "Check-in didn’t go through. Try again."));
    } finally {
      isStartingRef.current = false;
    }
  }, [user, startTracking, activeOrganization, scope]);

  const startPatrolWithLegacy = useCallback(async () => {
    if (isStartingRef.current || isEndingRef.current) return;
    isStartingRef.current = true;
    try {
      const { data: existing, error: existingErr } = await scope(
        supabase.from('active_patrols').select('user_id, start_time')
      ).eq('user_id', user.id).maybeSingle();
      if (existingErr) throw existingErr;
      if (existing) {
        toast.error("You already have an active patrol.");
        const started = parsePatrolTime(existing.start_time);
        setActivePatrol((prev) => prev || { ...existing, user_id: user.id });
        if (started) setStartTime(started);
        return;
      }

      const { data, error } = await supabase
        .from('active_patrols')
        .insert({
          user_id: user.id,
          user_name: user.fullName || user.email,
          vehicle_type: normalizeVehicleType(user.carType, null),
          car_type: user.carType || "—",
          reg_number: user.registrationNumber || "—",
          vehicle_color: user.vehicleColor || "gray",
          start_time: new Date().toISOString(),
          zone: activeOrganization?.name || DEFAULT_PATROL_ZONE,
          organization_id: activeOrganization?.id || user.organizationId || null,
        })
        .select();
      if (error) throw error;
      if (data && data.length > 0) {
        const newPatrol = data[0];
        setActivePatrol(newPatrol);
        setStartTime(parsePatrolTime(newPatrol.start_time) || new Date());
        toast.success("Patrol started!");
        playPatrolStart();
        startTracking();
        if (newPatrol.share_ref) setShareTarget({ kind: 'start', patrol: newPatrol });
        setShareRefreshKey((k) => k + 1);
      }
    } catch (err) {
      console.error("Check-in failed:", err);
      toast.error(userFacingWriteError(err, "Check-in didn’t go through. Try again."));
    } finally {
      isStartingRef.current = false;
    }
  }, [user, startTracking, activeOrganization, scope]);

  const handleCheckIn = useCallback(async () => {
    if (!user) return;
    if (!canDoPatrolOps) {
      toast.error("Your role does not allow starting patrols.");
      return;
    }
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
  }, [user, startPatrolWithVehicle, startPatrolWithLegacy, canDoPatrolOps]);

  const handleCheckOut = useCallback(async (autoClosed = false) => {
    if (!activePatrol || isEndingRef.current) return;
    isEndingRef.current = true;
    const endedShareRef = activePatrol.share_ref || null;
    try {
      await stopTracking();

      let { error: rpcError } = await supabase.rpc('end_patrol', {
        p_user_id: user.id,
        p_auto_closed: Boolean(autoClosed),
      });
      if (
        rpcError &&
        /p_auto_closed|could not find the function|function public\.end_patrol/i.test(
          String(rpcError.message || rpcError)
        )
      ) {
        ({ error: rpcError } = await supabase.rpc('end_patrol', { p_user_id: user.id }));
      }
      const alreadyEnded = rpcError && /no active patrol/i.test(String(rpcError.message || rpcError));
      if (rpcError && !alreadyEnded) throw rpcError;
      setAllActivePatrols(prev => prev.filter(p => p.user_id !== user.id));
      setActivePatrol(null);
      setStartTime(null);
      setShowWarning(false);
      setAutoCloseAt(null);
      warningTriggeredRef.current = false;
      if (alreadyEnded) {
        toast.success("Patrol already ended.");
      } else {
        toast.success(autoClosed ? "Patrol auto-ended (time limit reached)." : "Patrol ended. Log saved.");
        if (autoClosed) playPatrolAutoEnd();
        else playPatrolEnd();
      }
      if (endedShareRef && !autoClosed) {
        fetchPatrolShare(endedShareRef)
          .then((row) => {
            if (row?.end_time) setShareTarget({ kind: 'end', patrol: row });
          })
          .catch((err) => console.warn('get_patrol_share failed', err))
          .finally(() => setShareRefreshKey((k) => k + 1));
      } else {
        setShareRefreshKey((k) => k + 1);
      }
    } catch (err) {
      console.error("Check-out failed:", err);
      toast.error(userFacingWriteError(err, "Check-out didn’t go through. Try again."));
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

  const patrolOrgRef = useRef(activeOrganizationId);
  useEffect(() => {
    if (patrolOrgRef.current === activeOrganizationId) return;
    patrolOrgRef.current = activeOrganizationId;
    setAllActivePatrols([]);
    setActivePatrol(null);
    setMineFromCache(false);
    setAllFromCache(false);
    setMineSavedAt(null);
    setAllSavedAt(null);
    setFetchError(null);
    setFetchAllError(null);
    prevPatrolsRef.current = null;
  }, [activeOrganizationId]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const fetchInitial = async () => {
      try {
        const { data, error } = await withTimeout(
          scope(supabase.from('active_patrols').select('*')).eq('user_id', user.id).maybeSingle(),
          FETCH_ALL_TIMEOUT_MS,
          'Loading your patrol timed out.'
        );
        if (cancelled) return;
        if (error) throw error;
        if (data) {
          setActivePatrol(data);
          setStartTime(parsePatrolTime(data.start_time));
        }
        else setActivePatrol(null);
        setFetchError(null);
        setMineFromCache(false);
        // Live data is in: release the loading state before touching the offline cache.
        setLoadingPatrol(false);
        if (user?.id) {
          void patchScreenSnapshot(
            { userId: user.id, organizationId: activeOrganizationId, screen: OFFLINE_SCREENS.patrolStatus },
            (current) => ({
              ...(current || {}),
              mine: data || null,
              mineKnown: true,
              mineSavedAt: new Date().toISOString(),
            })
          )
            .then((saved) => {
              if (cancelled) return;
              setMineSavedAt(saved?.data?.mineSavedAt || saved?.savedAt || null);
            })
            .catch(() => {});
        }
      } catch (err) {
        if (cancelled) return;
        const cached = user?.id
          ? await withTimeout(
            readScreenSnapshot({
              userId: user.id,
              organizationId: activeOrganizationId,
              screen: OFFLINE_SCREENS.patrolStatus,
            }),
            CACHE_READ_TIMEOUT_MS,
            'Offline cache read timed out.'
          ).catch(() => null)
          : null;
        if (cancelled) return;
        if (cached?.data?.mineKnown) {
          setActivePatrol(cached.data.mine || null);
          setStartTime(cached.data.mine ? parsePatrolTime(cached.data.mine.start_time) : null);
          setFetchError(null);
          setMineFromCache(true);
          setMineSavedAt(cached.data.mineSavedAt || cached.savedAt);
        } else {
          setMineFromCache(false);
          setFetchError(userFacingReadError(err, "Could not load your patrol."));
        }
      } finally {
        if (!cancelled) setLoadingPatrol(false);
      }
    };
    fetchInitial();
    fetchAll();
    return () => { cancelled = true; };
  }, [user, fetchAll, scope, activeOrganizationId]);

  useEffect(() => {
    const clickHandler = () => unlockAudio();
    document.addEventListener('click', clickHandler, { once: true });
    return () => document.removeEventListener('click', clickHandler);
  }, []);

  return {
    activePatrol,
    setActivePatrol,
    shareTarget,
    setShareTarget,
    shareRefreshKey,
    setShareRefreshKey,
    startTime,
    loadingPatrol,
    allActivePatrols,
    fetchError,
    fetchAllError,
    mineFromCache,
    mineSavedAt,
    allFromCache,
    allSavedAt,
    fetchAllLoading,
    showWarning,
    setShowWarning,
    autoCloseAt,
    setAutoCloseAt,
    showVehiclePicker,
    setShowVehiclePicker,
    vehiclesList,
    patrolPhotoPreview,
    setPatrolPhotoPreview,
    upcomingScheduleRefresh,
    refreshData,
    isTracking,
    totalDistance,
    routePoints,
    elapsed,
    nowMs,
    handleCheckIn,
    handleCheckOut,
    startPatrolWithVehicle,
    warningTriggeredRef,
  };
}
