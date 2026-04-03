import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FaCalendarAlt, FaClock, FaMapMarkerAlt } from "react-icons/fa";
import { supabase } from "../../supabase/client";
import { displayPatrolZone } from "../../config/neighborhoodRegions";
import BrandedLoader from "../layout/BrandedLoader";
import {
  formatPatrolSlotTimeRange,
  isSlotEnded,
} from "../../utils/patrolSlotWindows";

function todayLocalStr() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Leaderboard (and similar): upcoming patrol_slots for the signed-in volunteer.
 */
export default function MyUpcomingPatrolSignups({ userId }) {
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const minDate = useMemo(() => todayLocalStr(), [nowMs]);

  const load = useCallback(async () => {
    if (!userId) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setErr(null);
    try {
      const { data, error } = await supabase
        .from("patrol_slots")
        .select("id, date, start_time, end_time, zone")
        .eq("volunteer_uid", userId)
        .gte("date", minDate)
        .order("date", { ascending: true })
        .order("start_time", { ascending: true });
      if (error) throw error;
      setRows(Array.isArray(data) ? data : []);
    } catch (e) {
      setErr(e?.message || "Could not load sign-ups");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [userId, minDate]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!userId) return undefined;
    const ch = supabase
      .channel(`leaderboard-my-slots-${userId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "patrol_slots" },
        () => {
          void load();
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [userId, load]);

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  const upcoming = useMemo(() => {
    return rows.filter(
      (s) => !isSlotEnded(s.date, s.start_time, s.end_time, nowMs)
    );
  }, [rows, nowMs]);

  if (!userId) return null;

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl border border-teal-200/80 dark:border-teal-800/60 shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-700 flex flex-wrap items-center justify-between gap-3 bg-gradient-to-r from-teal-50/90 to-cyan-50/70 dark:from-teal-950/30 dark:to-gray-800/95">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
            <FaCalendarAlt className="text-teal-600 dark:text-teal-400" />
            Your upcoming patrol sign-ups
          </h2>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            Scheduled slots from today onward · change them on Patrol Schedule
          </p>
        </div>
        <button
          type="button"
          onClick={() => navigate("/schedule")}
          className="shrink-0 inline-flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium bg-teal-600 hover:bg-teal-700 text-white transition"
        >
          <FaCalendarAlt className="w-3.5 h-3.5 opacity-90" aria-hidden />
          Open schedule
        </button>
      </div>
      <div className="px-5 py-4">
        {err && (
          <p className="text-sm text-red-600 dark:text-red-400">{err}</p>
        )}
        {!err && loading && (
          <div className="flex justify-center py-6">
            <BrandedLoader message="Loading your sign-ups…" size="sm" />
          </div>
        )}
        {!err && !loading && upcoming.length === 0 && (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            You have no upcoming patrol slots booked.{" "}
            <button
              type="button"
              onClick={() => navigate("/schedule")}
              className="text-teal-600 dark:text-teal-400 font-medium underline underline-offset-2"
            >
              Sign up on the schedule
            </button>
            .
          </p>
        )}
        {!err && !loading && upcoming.length > 0 && (
          <ul className="space-y-2.5">
            {upcoming.map((slot) => {
              const zoneLabel = displayPatrolZone(slot.zone);
              const d = new Date(slot.date + "T12:00:00");
              const dateLabel = d.toLocaleDateString("en-ZA", {
                weekday: "short",
                day: "numeric",
                month: "short",
              });
              return (
                <li
                  key={slot.id}
                  className="flex flex-wrap items-baseline justify-between gap-2 rounded-xl border border-gray-200/90 dark:border-gray-600/80 bg-gray-50/80 dark:bg-gray-900/40 px-3 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900 dark:text-white">
                      {dateLabel}
                    </p>
                    <p className="text-xs text-gray-600 dark:text-gray-400 mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <span className="inline-flex items-center gap-1">
                        <FaClock className="w-3 h-3 opacity-70" aria-hidden />
                        {formatPatrolSlotTimeRange(
                          slot.start_time,
                          slot.end_time
                        )}
                      </span>
                      {zoneLabel ? (
                        <span className="inline-flex items-center gap-1">
                          <FaMapMarkerAlt
                            className="w-3 h-3 opacity-70"
                            aria-hidden
                          />
                          {zoneLabel}
                        </span>
                      ) : null}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
