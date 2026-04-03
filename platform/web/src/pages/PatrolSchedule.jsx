import { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/useAuth";
import { supabase } from "../supabase/client";
import toast from "react-hot-toast";
import { FaChevronLeft, FaChevronRight, FaArrowLeft, FaUsers } from "react-icons/fa";
import { DEFAULT_PATROL_ZONE } from "../config/neighborhoodRegions";
import { isSlotEnded } from "../utils/patrolSlotWindows";
import ThemeToggle from "../components/ThemeToggle";
import BrandedLoader from "../components/layout/BrandedLoader";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TIME_SLOTS = [
  { label: "19:00–21:00", start: "19:00", end: "21:00" },
  { label: "21:00–23:00", start: "21:00", end: "23:00" },
  { label: "23:00–01:00", start: "23:00", end: "01:00" },
  { label: "01:00–03:00", start: "01:00", end: "03:00" },
  { label: "03:00–05:00", start: "03:00", end: "05:00" },
  { label: "05:00–07:00", start: "05:00", end: "07:00" },
  { label: "07:00–09:00", start: "07:00", end: "09:00" },
  { label: "09:00–11:00", start: "09:00", end: "11:00" },
  { label: "11:00–13:00", start: "11:00", end: "13:00" },
  { label: "13:00–15:00", start: "13:00", end: "15:00" },
  { label: "15:00–17:00", start: "15:00", end: "17:00" },
  { label: "17:00–19:00", start: "17:00", end: "19:00" },
];

const DAYS_TO_SHOW = 7;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const toDateStr = (date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

const getWindowDates = (startOffset = 0) => {
  const dates = [];
  const today = new Date();
  for (let i = 0; i < DAYS_TO_SHOW; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + startOffset + i);
    dates.push(toDateStr(d));
  }
  return dates;
};

const formatDateHeader = (dateStr) => {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-ZA", { weekday: "short", day: "numeric", month: "short" });
};

const isToday = (dateStr) => toDateStr(new Date()) === dateStr;

// First name only, truncated to keep cells compact
const shortName = (fullName) => {
  if (!fullName) return "?";
  const first = fullName.split(" ")[0];
  return first.length > 10 ? first.substring(0, 9) + "…" : first;
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function PatrolSchedule() {
  const navigate = useNavigate();
  const { user } = useAuth();

  const [slots, setSlots] = useState([]);
  const [loading, setLoading] = useState(true);
  const [windowOffset, setWindowOffset] = useState(0);
  const [pendingKeys, setPendingKeys] = useState(new Set());
  const [scheduleNowMs, setScheduleNowMs] = useState(() => Date.now());

  const displayName = user?.fullName || user?.user_metadata?.full_name || user?.email || "Unknown";
  const dates = useMemo(() => getWindowDates(windowOffset), [windowOffset]);

  // Re-evaluate "ended" slots without a full page reload (e.g. 21:00 passes while on this page)
  useEffect(() => {
    const bump = () => setScheduleNowMs(Date.now());
    const id = window.setInterval(bump, 30_000);
    const onVis = () => {
      if (document.visibilityState === "visible") bump();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  // Midnight refresh
  useEffect(() => {
    const now = new Date();
    const msUntilMidnight =
      new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 5) - now;
    const timer = setTimeout(() => setWindowOffset((p) => p), msUntilMidnight);
    return () => clearTimeout(timer);
  }, []);

  // ---------------------------------------------------------------------------
  // Fetch
  // ---------------------------------------------------------------------------
  const fetchSlots = useCallback(async (dateWindow) => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("patrol_slots")
        .select("*")
        .gte("date", dateWindow[0])
        .lte("date", dateWindow[dateWindow.length - 1])
        .order("date", { ascending: true })
        .order("start_time", { ascending: true });
      if (error) throw error;
      setSlots(data || []);
    } catch (err) {
      console.error("Error fetching slots:", err);
      toast.error("Failed to load schedule.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchSlots(dates); }, [fetchSlots, dates]);

  useEffect(() => {
    const from = dates[0];
    const to = dates[dates.length - 1];
    const ch = supabase
      .channel(`patrol-schedule-slots-${from}-${to}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "patrol_slots" },
        () => {
          void fetchSlots(dates);
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [fetchSlots, dates]);

  // ---------------------------------------------------------------------------
  // Slot lookup — returns ALL volunteers for a cell (team patrol support)
  // ---------------------------------------------------------------------------
  const findSlots = useCallback(
    (date, start, end) =>
      slots.filter(
        (s) => s.date === date && s.start_time === start && s.end_time === end
      ),
    [slots]
  );

  // ---------------------------------------------------------------------------
  // Sign up — optimistic UI
  // Key is per user+date+start so multiple users can sign up for the same slot
  // ---------------------------------------------------------------------------
  const handleSignup = async (date, start, end) => {
    if (isSlotEnded(date, start, end)) {
      toast.error("That patrol window has already ended.");
      return;
    }
    const key = `signup-${user.id}-${date}-${start}`;
    if (pendingKeys.has(key)) return;

    const tempId = `temp-${Date.now()}`;
    const optimistic = {
      id: tempId,
      date,
      start_time: start,
      end_time: end,
      zone: DEFAULT_PATROL_ZONE,
      volunteer_uid: user.id,
      volunteer_name: displayName,
    };

    setSlots((prev) => [...prev, optimistic]);
    setPendingKeys((prev) => new Set(prev).add(key));

    try {
      const { data, error } = await supabase
        .from("patrol_slots")
        .insert({
          date,
          start_time: start,
          end_time: end,
          zone: DEFAULT_PATROL_ZONE,
          volunteer_uid: user.id,
          volunteer_name: displayName,
          created_at: new Date().toISOString(),
        })
        .select()
        .single();
      if (error) throw error;
      setSlots((prev) => prev.map((s) => (s.id === tempId ? data : s)));
      toast.success("Signed up for patrol!");
    } catch (err) {
      console.error("Signup failed:", err);
      setSlots((prev) => prev.filter((s) => s.id !== tempId));
      toast.error("Failed to sign up. Please try again.");
    } finally {
      setPendingKeys((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  };

  // ---------------------------------------------------------------------------
  // Unassign — optimistic UI (operates on a specific slot record by id)
  // ---------------------------------------------------------------------------
  const handleUnassign = async (slot) => {
    const key = `unassign-${slot.id}`;
    if (pendingKeys.has(key)) return;

    setSlots((prev) => prev.filter((s) => s.id !== slot.id));
    setPendingKeys((prev) => new Set(prev).add(key));

    try {
      const { error } = await supabase.rpc("cancel_my_patrol_slot", {
        p_slot_id: slot.id,
      });
      if (error) throw error;
      toast.success("Unassigned from patrol.");
    } catch (err) {
      console.error("Unassign failed:", err);
      setSlots((prev) => [...prev, slot]);
      const msg = err?.message || err?.error_description || "";
      toast.error(
        msg && !/network|fetch/i.test(msg)
          ? msg
          : "Could not remove this sign-up. If it keeps happening, contact an admin."
      );
    } finally {
      setPendingKeys((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  };

  // ---------------------------------------------------------------------------
  // Navigation
  // ---------------------------------------------------------------------------
  const goBack = () => setWindowOffset((prev) => Math.max(0, prev - DAYS_TO_SHOW));
  const goForward = () => setWindowOffset((prev) => prev + DAYS_TO_SHOW);
  const canGoBack = windowOffset > 0;

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800 py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto">

        {/* ── Header ── */}
        <div className="flex flex-col gap-4 mb-6">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white text-center">
            Patrol Schedule
          </h1>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => navigate("/dashboard")}
              className="inline-flex items-center gap-2 px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded-xl hover:bg-gray-300 dark:hover:bg-gray-600 transition text-sm font-medium"
            >
              <FaArrowLeft className="w-3 h-3" />
              Dashboard
            </button>
            <div className="flex items-center gap-2 shrink-0">
              <ThemeToggle variant="toolbar" />
              <button
                type="button"
                onClick={goBack}
                disabled={!canGoBack}
                className="p-2 rounded-lg bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-30 disabled:cursor-not-allowed transition"
                title="Previous week"
              >
                <FaChevronLeft className="w-3 h-3" />
              </button>
              <span className="text-sm text-gray-600 dark:text-gray-400 min-w-[140px] text-center">
                {formatDateHeader(dates[0])} – {formatDateHeader(dates[dates.length - 1])}
              </span>
              <button
                type="button"
                onClick={goForward}
                className="p-2 rounded-lg bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600 transition"
                title="Next week"
              >
                <FaChevronRight className="w-3 h-3" />
              </button>
            </div>
          </div>
        </div>

        {/* ── Legend ── */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mb-4 text-xs text-gray-500 dark:text-gray-400">
          <span className="flex items-center gap-1">
            <span className="inline-block w-3 h-3 rounded-full bg-green-500" />
            You
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-3 h-3 rounded-full bg-gray-400" />
            Others
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-3 h-3 rounded-sm bg-teal-600" />
            Available
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-3 h-3 rounded-sm bg-indigo-600" />
            Join
          </span>
          <span className="flex items-center gap-1">
            <FaUsers className="w-3 h-3 text-teal-400" />
            Team slot
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-3 h-3 rounded-sm bg-gray-300 dark:bg-gray-600 border border-gray-400/30 dark:border-gray-500/40" />
            Ended
          </span>
        </div>

        {/* ── Table ── */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow border border-gray-100 dark:border-gray-700 overflow-hidden">
          {loading ? (
            <div className="flex justify-center py-16">
              <BrandedLoader message="Loading schedule…" size="md" />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700 text-sm">
                <thead className="bg-gray-50 dark:bg-gray-900">
                  <tr>
                    <th className="sticky left-0 z-10 bg-gray-50 dark:bg-gray-900 px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider whitespace-nowrap border-r border-gray-200 dark:border-gray-700">
                      Time
                    </th>
                    {dates.map((date) => (
                      <th
                        key={date}
                        className={`px-3 py-3 text-center text-xs font-semibold uppercase tracking-wider whitespace-nowrap ${
                          isToday(date)
                            ? "text-teal-600 dark:text-teal-400 bg-teal-50 dark:bg-teal-900/20"
                            : "text-gray-500 dark:text-gray-400"
                        }`}
                      >
                        {formatDateHeader(date)}
                        {isToday(date) && (
                          <span className="block text-[10px] normal-case font-normal text-teal-400">
                            today
                          </span>
                        )}
                      </th>
                    ))}
                  </tr>
                </thead>

                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {TIME_SLOTS.map(({ label, start, end }) => (
                    <tr key={label} className="hover:bg-gray-50 dark:hover:bg-gray-750 transition">
                      {/* Sticky time label */}
                      <td className="sticky left-0 z-10 bg-white dark:bg-gray-800 px-4 py-3 whitespace-nowrap font-medium text-gray-700 dark:text-gray-300 border-r border-gray-100 dark:border-gray-700">
                        {label}
                      </td>

                      {dates.map((date) => {
                        const cellSlots = findSlots(date, start, end);
                        const mySlot = cellSlots.find((s) => s.volunteer_uid === user.id);
                        const otherSlots = cellSlots.filter((s) => s.volunteer_uid !== user.id);
                        const signupKey = `signup-${user.id}-${date}-${start}`;
                        const isSigningUp = pendingKeys.has(signupKey);
                        const isTeam = cellSlots.length > 1;
                        const ended = isSlotEnded(date, start, end, scheduleNowMs);

                        return (
                          <td
                            key={date}
                            className={`px-2 py-2 text-center align-top transition-colors ${
                              ended
                                ? "bg-gray-100/90 dark:bg-gray-900/55 text-gray-500 dark:text-gray-500"
                                : isToday(date)
                                  ? "bg-teal-50/40 dark:bg-teal-900/10"
                                  : ""
                            }`}
                          >
                            <div className="flex flex-col items-center gap-1 min-w-[72px]">

                              {/* Team badge — only shows when 2+ volunteers in this slot */}
                              {isTeam && (
                                <span
                                  className={`flex items-center gap-1 text-[10px] font-medium ${
                                    ended
                                      ? "text-gray-400 dark:text-gray-500"
                                      : "text-teal-500 dark:text-teal-400"
                                  }`}
                                >
                                  <FaUsers className="w-2.5 h-2.5" />
                                  {cellSlots.length}
                                </span>
                              )}

                              {/* Other volunteers already in this slot */}
                              {otherSlots.map((s) => (
                                <span
                                  key={s.id}
                                  className={`text-[11px] leading-tight ${
                                    ended
                                      ? "text-gray-400 dark:text-gray-500"
                                      : "text-gray-500 dark:text-gray-400"
                                  }`}
                                  title={s.volunteer_name || "Volunteer"}
                                >
                                  {shortName(s.volunteer_name)}
                                </span>
                              ))}

                              {/* Current user's entry + leave button */}
                              {mySlot ? (
                                <div className="flex flex-col items-center gap-0.5">
                                  <span
                                    className={`text-[11px] font-semibold leading-tight ${
                                      ended
                                        ? "text-gray-500 dark:text-gray-400"
                                        : "text-green-600 dark:text-green-400"
                                    }`}
                                  >
                                    You
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => handleUnassign(mySlot)}
                                    disabled={pendingKeys.has(`unassign-${mySlot.id}`)}
                                    title={
                                      ended
                                        ? "Remove your name from this past slot"
                                        : "Leave this patrol slot"
                                    }
                                    className="px-2 py-0.5 bg-red-500 hover:bg-red-600 disabled:opacity-50 text-white text-[10px] rounded-md transition"
                                  >
                                    {pendingKeys.has(`unassign-${mySlot.id}`) ? "..." : "Leave"}
                                  </button>
                                </div>
                              ) : ended ? (
                                <span
                                  role="status"
                                  className="inline-flex items-center justify-center px-2 py-1 text-[10px] font-semibold rounded-md border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-800/90 text-gray-500 dark:text-gray-400 cursor-default whitespace-nowrap"
                                  title="This patrol window has ended — sign-up is closed"
                                >
                                  Ended
                                </span>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => handleSignup(date, start, end)}
                                  disabled={isSigningUp}
                                  className={`px-2 py-1 disabled:opacity-50 text-white text-[11px] rounded-lg transition shadow-sm whitespace-nowrap ${
                                    cellSlots.length > 0
                                      ? "bg-indigo-500 hover:bg-indigo-600 dark:bg-indigo-600 dark:hover:bg-indigo-500"
                                      : "bg-teal-600 hover:bg-teal-700"
                                  }`}
                                >
                                  {isSigningUp ? "..." : cellSlots.length > 0 ? "Join" : "Sign Up"}
                                </button>
                              )}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ── Footer note ── */}
        <p className="mt-4 text-xs text-center text-gray-400 dark:text-gray-500">
          Showing {formatDateHeader(dates[0])} – {formatDateHeader(dates[dates.length - 1])} • All times local
        </p>
      </div>
    </div>
  );
}