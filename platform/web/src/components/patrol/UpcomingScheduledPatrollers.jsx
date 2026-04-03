import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FaCalendarAlt, FaClock, FaUsers } from "react-icons/fa";
import { supabase } from "../../supabase/client";
import { displayPatrolZone } from "../../config/neighborhoodRegions";
import BrandedLoader from "../layout/BrandedLoader";

const WINDOW_MS = 6 * 60 * 60 * 1000;

function toLocalDateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseSlotStartMs(dateStr, startTime) {
  if (!dateStr || !startTime) return NaN;
  const [y, mo, da] = dateStr.split("-").map(Number);
  const parts = String(startTime).trim().split(":");
  const h = Number(parts[0]) || 0;
  const mi = Number(parts[1]) || 0;
  const s = Number(parts[2]) || 0;
  if (!y || !mo || !da) return NaN;
  return new Date(y, mo - 1, da, h, mi, s).getTime();
}

function formatTimeRange(startTime, endTime) {
  const fmt = (t) => {
    if (!t) return "";
    const [h, m] = String(t).slice(0, 5).split(":");
    return `${h}:${m}`;
  };
  return `${fmt(startTime)}–${fmt(endTime)}`;
}

function useAutoVerticalScroll(scrollRef, active) {
  useEffect(() => {
    if (!active) return undefined;
    const el = scrollRef.current;
    if (!el) return undefined;

    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) return undefined;

    let raf = 0;
    let stopped = false;
    let paused = false;
    let idleUntil = 0;
    const pxPerFrame = 0.28;
    const pauseMs = 1800;

    const loop = () => {
      if (stopped) return;
      raf = requestAnimationFrame(loop);
      if (paused) return;
      const now = performance.now();
      if (now < idleUntil) return;

      if (el.scrollHeight <= el.clientHeight + 2) return;

      const maxScroll = el.scrollHeight - el.clientHeight;
      el.scrollTop += pxPerFrame;

      if (el.scrollTop >= maxScroll - 0.5) {
        idleUntil = now + pauseMs;
        el.scrollTop = 0;
      }
    };

    raf = requestAnimationFrame(loop);
    const pause = () => {
      paused = true;
    };
    const resume = () => {
      paused = false;
    };

    el.addEventListener("mouseenter", pause);
    el.addEventListener("mouseleave", resume);
    el.addEventListener("focusin", pause);
    el.addEventListener("focusout", resume);
    el.addEventListener("touchstart", pause, { passive: true });
    el.addEventListener("touchend", resume, { passive: true });

    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      el.removeEventListener("mouseenter", pause);
      el.removeEventListener("mouseleave", resume);
      el.removeEventListener("focusin", pause);
      el.removeEventListener("focusout", resume);
      el.removeEventListener("touchstart", pause);
      el.removeEventListener("touchend", resume);
    };
  }, [active, scrollRef]);
}

/**
 * Dashboard tile: patrol_slots starting within the next 6 hours (local time).
 */
export default function UpcomingScheduledPatrollers({ className = "", refreshNonce = 0 }) {
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(null);
  const [nowTick, setNowTick] = useState(0);
  const scrollRef = useRef(null);
  const [overflow, setOverflow] = useState(false);

  // Recompute when the clock ticks so a long-lived tab crosses midnight correctly
  const fetchRange = useMemo(() => {
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    return { start: toLocalDateStr(today), end: toLocalDateStr(tomorrow) };
  }, [nowTick]);

  const load = useCallback(async () => {
    setLoading(true);
    setFetchError(null);
    try {
      const { data, error } = await supabase
        .from("patrol_slots")
        .select("id, date, start_time, end_time, volunteer_name, volunteer_uid, zone")
        .gte("date", fetchRange.start)
        .lte("date", fetchRange.end)
        .order("date", { ascending: true })
        .order("start_time", { ascending: true });
      if (error) throw error;
      setRows(Array.isArray(data) ? data : []);
    } catch (e) {
      setFetchError(e?.message || "Could not load schedule");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [fetchRange.start, fetchRange.end]);

  useEffect(() => {
    void load();
  }, [load, refreshNonce]);

  useEffect(() => {
    const ch = supabase
      .channel("dashboard-upcoming-patrol-slots")
      .on("postgres_changes", { event: "*", schema: "public", table: "patrol_slots" }, () => {
        void load();
      })
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [load]);

  useEffect(() => {
    const id = window.setInterval(() => setNowTick((t) => t + 1), 60_000);
    return () => window.clearInterval(id);
  }, []);

  const upcoming = useMemo(() => {
    const now = Date.now();
    const horizon = now + WINDOW_MS;
    const list = [];

    for (const slot of rows) {
      const startMs = parseSlotStartMs(slot.date, slot.start_time);
      if (Number.isNaN(startMs)) continue;
      if (startMs <= now || startMs > horizon) continue;
      list.push({ ...slot, _startMs: startMs });
    }

    list.sort((a, b) => a._startMs - b._startMs);

    // One row per person per slot window — duplicate inserts (double signup) would otherwise list the same name twice
    const seen = new Set();
    const deduped = [];
    for (const slot of list) {
      const uid = slot.volunteer_uid?.trim();
      const nameKey = (slot.volunteer_name || "").trim().toLowerCase();
      const dedupeKey = uid
        ? `${slot.date}|${slot.start_time}|${slot.end_time}|uid:${uid}`
        : `${slot.date}|${slot.start_time}|${slot.end_time}|name:${nameKey}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      deduped.push(slot);
    }
    return deduped;
  }, [rows, nowTick]);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return undefined;
    const measure = () => {
      setOverflow(el.scrollHeight > el.clientHeight + 2);
    };
    measure();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, [upcoming, loading]);

  const reducedMotion =
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  useAutoVerticalScroll(scrollRef, overflow && upcoming.length > 0 && !reducedMotion);

  const startsInLabel = (startMs) => {
    const m = Math.max(0, Math.round((startMs - Date.now()) / 60000));
    if (m < 1) return "soon";
    if (m < 60) return `in ${m}m`;
    const h = Math.floor(m / 60);
    const r = m % 60;
    return r ? `in ${h}h ${r}m` : `in ${h}h`;
  };

  return (
    <div
      className={`bento-tile overflow-hidden flex flex-col min-h-[10.5rem] max-h-[22rem] lg:max-h-none lg:flex-1 lg:min-h-0 shadow-card ${className}`}
    >
      <div className="px-4 py-3 sm:px-5 sm:py-3.5 border-b border-gray-100 dark:border-gray-700 shrink-0 flex items-start justify-between gap-3 bg-gradient-to-r from-indigo-50/90 via-white to-teal-50/70 dark:from-gray-800 dark:via-gray-800/95 dark:to-teal-950/20">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-indigo-100 text-indigo-700 dark:bg-indigo-900/45 dark:text-indigo-200 shadow-sm">
            <FaUsers className="w-4 h-4" aria-hidden />
          </div>
          <div className="min-w-0">
            <h2 className="text-sm sm:text-base font-semibold text-gray-900 dark:text-white leading-tight">
              Upcoming patrols
            </h2>
            <p className="text-[11px] sm:text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              Next 6 hours · scheduled volunteers
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => navigate("/schedule")}
          className="shrink-0 inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] sm:text-xs font-medium text-indigo-700 dark:text-indigo-300 bg-indigo-100/80 hover:bg-indigo-200/90 dark:bg-indigo-950/50 dark:hover:bg-indigo-900/55 transition"
        >
          <FaCalendarAlt className="w-3 h-3 opacity-90" aria-hidden />
          Schedule
        </button>
      </div>

      <div className="relative flex-1 min-h-0 flex flex-col">
        {overflow && !reducedMotion && upcoming.length > 0 && (
          <div
            className="pointer-events-none absolute inset-x-0 bottom-0 h-10 z-[1] bg-gradient-to-t from-white dark:from-gray-800 to-transparent dark:to-transparent"
            aria-hidden
          />
        )}

        <div
          ref={scrollRef}
          tabIndex={0}
          className="flex-1 min-h-0 overflow-y-auto overscroll-y-contain px-4 py-3 sm:px-5 sm:py-3.5 scroll-smooth focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-teal-500/60 rounded-b-2xl"
          aria-label="Upcoming scheduled patrollers, scrollable list"
        >
          {fetchError && (
            <p className="text-xs text-red-600 dark:text-red-400">{fetchError}</p>
          )}
          {!fetchError && loading && (
            <div className="flex justify-center py-6">
              <BrandedLoader message="Loading schedule…" size="sm" />
            </div>
          )}
          {!fetchError && !loading && upcoming.length === 0 && (
            <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
              No one is scheduled to start a patrol in the next 6 hours.
            </p>
          )}
          {!fetchError && !loading && upcoming.length > 0 && (
            <ul className="space-y-2.5">
              {upcoming.map((slot) => {
                const zoneLabel = displayPatrolZone(slot.zone);
                return (
                <li
                  key={slot.id}
                  className="rounded-xl border border-gray-200/90 dark:border-gray-600/80 bg-gray-50/80 dark:bg-gray-900/40 px-3 py-2.5"
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-sm font-medium text-gray-900 dark:text-white truncate">
                      {slot.volunteer_name?.trim() || "Volunteer"}
                    </span>
                    <span className="text-[10px] sm:text-xs font-medium tabular-nums text-teal-700 dark:text-teal-300 shrink-0">
                      {startsInLabel(slot._startMs)}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center gap-1.5 text-[11px] sm:text-xs text-gray-600 dark:text-gray-400">
                    <FaClock className="w-3 h-3 shrink-0 text-gray-400 dark:text-gray-500" aria-hidden />
                    <span className="tabular-nums">{formatTimeRange(slot.start_time, slot.end_time)}</span>
                    {zoneLabel ? (
                      <>
                        <span className="text-gray-300 dark:text-gray-600" aria-hidden>
                          ·
                        </span>
                        <span className="truncate">{zoneLabel}</span>
                      </>
                    ) : null}
                  </div>
                </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
