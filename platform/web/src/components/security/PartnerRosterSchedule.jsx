import { useCallback, useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { FaChevronLeft, FaChevronRight, FaPhone, FaUsers } from "react-icons/fa";
import { supabase } from "../../supabase/client";
import BrandedLoader from "../layout/BrandedLoader";
import { isRpcNotFoundError } from "../../utils/isRpcNotFound";
import { isSlotEnded } from "../../utils/patrolSlotWindows";
import {
  PATROL_SCHEDULE_DAYS,
  PATROL_TIME_SLOTS,
  formatScheduleDateHeader,
  getScheduleWindowDates,
  isLocalDateToday,
  normalizeSlotClock,
  shortVolunteerName,
  slotDateValue,
} from "../../utils/patrolScheduleSlots";

function areaTitle(area) {
  return area?.organization_name || area?.suburb_name || "Area";
}

function slotMatchesArea(slot, area) {
  if (!area || !slot) return false;
  if (area.organization_id && slot.organization_id) {
    return slot.organization_id === area.organization_id;
  }
  const zone = String(slot.zone || slot.organization_name || "").trim().toLowerCase();
  const org = String(area.organization_name || "").trim().toLowerCase();
  const suburb = String(area.suburb_name || "").trim().toLowerCase();
  if (org && (String(slot.organization_name || "").trim().toLowerCase() === org || zone === org)) {
    return true;
  }
  return Boolean(suburb && zone === suburb);
}

function findLivePatrol(patrols, slot) {
  if (!slot) return null;
  if (slot.volunteer_uid) {
    const byId = patrols.find((patrol) => patrol.user_id === slot.volunteer_uid);
    if (byId) return byId;
  }
  const name = String(slot.volunteer_name || "").trim().toLowerCase();
  if (!name) return null;
  return patrols.find((patrol) => String(patrol.full_name || "").trim().toLowerCase() === name) || null;
}

export default function PartnerRosterSchedule({ areas, areaFilter, patrols, onOpenPatrol }) {
  const [slots, setSlots] = useState([]);
  const [loading, setLoading] = useState(true);
  const [windowOffset, setWindowOffset] = useState(0);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const dates = useMemo(() => getScheduleWindowDates(windowOffset), [windowOffset]);

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const fetchSlots = useCallback(async (dateWindow, opts = {}) => {
    const silent = opts.silent === true;
    if (!silent) setLoading(true);
    try {
      const from = dateWindow[0];
      const to = dateWindow[dateWindow.length - 1];
      let result = await supabase.rpc("security_partner_scheduled_patrols", {
        p_suburb_id: null,
        p_from: from,
        p_to: to,
      });
      if (result.error && /p_from|p_to|could not find/i.test(result.error.message || "")) {
        result = await supabase.rpc("security_partner_scheduled_patrols", { p_suburb_id: null });
      }
      if (result.error && !isRpcNotFoundError(result.error)) throw result.error;
      if (result.error && isRpcNotFoundError(result.error)) {
        if (!silent) toast.error("Run the partner roster SQL in Supabase to load live schedules.");
        setSlots([]);
        return;
      }
      setSlots(result.data || []);
    } catch (err) {
      console.error(err);
      if (!silent) toast.error(err.message || "Could not load the roster.");
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchSlots(dates);
    const channel = supabase
      .channel("security-partner-roster-slots")
      .on("postgres_changes", { event: "*", schema: "public", table: "patrol_slots" }, () => {
        void fetchSlots(dates, { silent: true });
      })
      .subscribe();
    const onVisible = () => {
      if (document.visibilityState === "visible") void fetchSlots(dates, { silent: true });
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      supabase.removeChannel(channel);
    };
  }, [fetchSlots, dates]);

  const visibleAreas = useMemo(() => {
    if (!areaFilter) return areas;
    return areas.filter((area) => (area.organization_id || area.suburb_id) === areaFilter);
  }, [areas, areaFilter]);

  const slotsForArea = useCallback(
    (area) => slots.filter((slot) => slotMatchesArea(slot, area)),
    [slots]
  );

  const openSlot = (area, slot) => {
    const live = findLivePatrol(patrols, slot);
    onOpenPatrol({
      user_id: slot.volunteer_uid || live?.user_id,
      full_name: slot.volunteer_name || live?.full_name || "Patroller",
      phone: slot.volunteer_phone || live?.phone || "",
      organization_name: slot.organization_name || areaTitle(area),
      zone: slot.zone || area.suburb_name,
      start_time: live?.start_time || null,
      slot_date: slotDateValue(slot),
      slot_start: normalizeSlotClock(slot.start_time),
      slot_end: normalizeSlotClock(slot.end_time),
      status: live ? "live" : "scheduled",
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Patrol roster by area</h2>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            View-only. Neighborhood watches book their own slots; partners can see who is covering each window.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setWindowOffset((prev) => Math.max(0, prev - PATROL_SCHEDULE_DAYS))}
            disabled={windowOffset === 0}
            className="rounded-lg border border-gray-200 p-2 text-gray-700 disabled:opacity-30 dark:border-gray-700 dark:text-gray-200"
            title="Previous week"
          >
            <FaChevronLeft className="h-3 w-3" />
          </button>
          <span className="min-w-[148px] text-center text-xs text-gray-600 dark:text-gray-400">
            {formatScheduleDateHeader(dates[0])} – {formatScheduleDateHeader(dates[dates.length - 1])}
          </span>
          <button
            type="button"
            onClick={() => setWindowOffset((prev) => prev + PATROL_SCHEDULE_DAYS)}
            className="rounded-lg border border-gray-200 p-2 text-gray-700 dark:border-gray-700 dark:text-gray-200"
            title="Next week"
          >
            <FaChevronRight className="h-3 w-3" />
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center rounded-2xl border border-gray-200 bg-white py-16 dark:border-gray-700 dark:bg-gray-800">
          <BrandedLoader message="Loading roster…" size="md" />
        </div>
      ) : visibleAreas.length === 0 ? (
        <p className="rounded-2xl border border-gray-200 bg-white px-4 py-6 text-sm text-gray-500 dark:border-gray-700 dark:bg-gray-800">
          {areaFilter === "hot-zones"
            ? "Hot zones are city-wide pins, not a patrol roster. Pick a neighborhood area."
            : "No neighborhood areas to show a roster for."}
        </p>
      ) : (
        visibleAreas.map((area) => {
          const areaSlots = slotsForArea(area);
          return (
            <section
              key={area.organization_id || area.suburb_id}
              className="overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800"
            >
              <div className="border-b border-gray-100 px-4 py-3 dark:border-gray-700">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white">{areaTitle(area)}</h3>
                <p className="font-mono text-[11px] uppercase text-gray-400">
                  {area.suburb_name && area.suburb_name !== areaTitle(area) ? `${area.suburb_name} · ` : ""}
                  {areaSlots.length} booked slot{areaSlots.length === 1 ? "" : "s"} this week
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-100 text-sm dark:divide-gray-700">
                  <thead className="bg-gray-50 dark:bg-gray-900">
                    <tr>
                      <th className="sticky left-0 z-10 bg-gray-50 px-3 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:bg-gray-900 dark:text-gray-400">
                        Time
                      </th>
                      {dates.map((date) => (
                        <th
                          key={date}
                          className={`px-2 py-3 text-center text-[11px] font-semibold uppercase tracking-wide ${
                            isLocalDateToday(date)
                              ? "bg-teal-50 text-teal-700 dark:bg-teal-950/40 dark:text-teal-300"
                              : "text-gray-500 dark:text-gray-400"
                          }`}
                        >
                          {formatScheduleDateHeader(date)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                    {PATROL_TIME_SLOTS.map(({ label, start, end }) => (
                      <tr key={`${area.organization_id}-${label}`}>
                        <td className="sticky left-0 z-10 whitespace-nowrap bg-white px-3 py-2 text-xs font-medium text-gray-700 dark:bg-gray-800 dark:text-gray-300">
                          {label}
                        </td>
                        {dates.map((date) => {
                          const cellSlots = areaSlots.filter(
                            (slot) =>
                              slotDateValue(slot) === date &&
                              normalizeSlotClock(slot.start_time) === start &&
                              normalizeSlotClock(slot.end_time) === end
                          );
                          const ended = isSlotEnded(date, start, end, nowMs);
                          return (
                            <td
                              key={date}
                              className={`px-1.5 py-2 text-center align-top ${
                                ended
                                  ? "bg-gray-50 dark:bg-gray-900/40"
                                  : isLocalDateToday(date)
                                    ? "bg-teal-50/40 dark:bg-teal-950/10"
                                    : ""
                              }`}
                            >
                              <div className="flex min-w-[76px] flex-col items-center gap-1">
                                {cellSlots.length === 0 ? (
                                  <span className="text-[11px] text-gray-300 dark:text-gray-600">—</span>
                                ) : (
                                  <>
                                    {cellSlots.length > 1 ? (
                                      <span className="inline-flex items-center gap-1 text-[10px] text-teal-600 dark:text-teal-400">
                                        <FaUsers className="h-2.5 w-2.5" />
                                        {cellSlots.length}
                                      </span>
                                    ) : null}
                                    {cellSlots.map((slot) => (
                                      <button
                                        key={slot.id}
                                        type="button"
                                        onClick={() => openSlot(area, slot)}
                                        className="text-[11px] leading-tight text-gray-700 hover:text-teal-700 dark:text-gray-200"
                                        title={slot.volunteer_name || "Patroller"}
                                      >
                                        {shortVolunteerName(slot.volunteer_name)}
                                      </button>
                                    ))}
                                  </>
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
            </section>
          );
        })
      )}

      {visibleAreas.length > 0 ? (
        <p className="text-center text-[11px] text-gray-400">
          Booked names open contact details. Partners cannot change a neighborhood’s roster.
          <FaPhone className="ml-1 inline h-2.5 w-2.5" />
        </p>
      ) : null}
    </div>
  );
}
