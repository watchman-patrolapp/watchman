import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import toast from "react-hot-toast";
import PageHeader from "../components/layout/PageHeader";
import ThemeToggle from "../components/ThemeToggle";
import {
  alertMatchesPartnerArea,
  PartnerSosDetailCard,
  partnerAreaKey,
  uniquePartnerAreas,
  usePartnerSosAlerts,
} from "../components/security/PartnerSosBoard";
import { useAuth } from "../auth/useAuth";
import { supabase } from "../supabase/client";
import { isRpcNotFoundError } from "../utils/isRpcNotFound";
import { isActiveSos } from "../utils/residentSos";
import { parsePatrolTime } from "../utils/watchTime";

const PAST_WINDOW_MS = 24 * 60 * 60 * 1000;

function chipClass(on, tone = "slate") {
  if (!on) {
    return "bg-white text-gray-700 ring-gray-200 dark:bg-gray-800 dark:text-gray-200 dark:ring-gray-600";
  }
  if (tone === "teal") return "bg-teal-600 text-white ring-teal-600";
  return "bg-slate-800 text-white ring-slate-800 dark:bg-slate-200 dark:text-slate-900 dark:ring-slate-200";
}

function msAgo(iso, now) {
  const t = parsePatrolTime(iso)?.getTime();
  if (!Number.isFinite(t)) return Number.POSITIVE_INFINITY;
  return now - t;
}

function inPastWindow(alert, now, { allHistory } = {}) {
  if (isActiveSos(alert)) return false;
  if (allHistory) return true;
  return msAgo(alert.resolvedAt || alert.createdAt, now) <= PAST_WINDOW_MS;
}

function SosListCard({ title, subtitle, count, empty, accent, alerts, busyId, onRespond, onResolve, onChat }) {
  return (
    <section className={`overflow-hidden rounded-2xl border bg-white shadow-sm dark:bg-gray-900 ${accent.border}`}>
      <div className={`flex items-center gap-3 border-b px-4 py-3 ${accent.border} ${accent.header}`}>
        <span className={`h-11 w-1.5 shrink-0 rounded-full ${accent.bar}`} aria-hidden />
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold text-gray-900 dark:text-white">{title}</h2>
          <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-gray-500 dark:text-gray-400">
            {subtitle}
          </p>
        </div>
        <span className={`rounded-full px-2.5 py-0.5 font-mono text-[11px] font-semibold ${accent.count}`}>{count}</span>
      </div>
      {count === 0 ? (
        <p className="px-4 py-5 text-sm text-gray-500">{empty}</p>
      ) : (
        <div className="space-y-3 p-4">
          {alerts.map((alert) => (
            <PartnerSosDetailCard
              key={alert.id}
              alert={alert}
              busy={busyId}
              onRespond={onRespond}
              onResolve={onResolve}
              onChat={onChat}
            />
          ))}
        </div>
      )}
    </section>
  );
}

const ACTIVE_ACCENT = {
  border: "border-red-300 dark:border-red-800",
  header: "bg-red-50 dark:bg-red-950/40",
  bar: "bg-red-500",
  count: "bg-red-600 text-white",
};

const PAST_ACCENT = {
  border: "border-gray-300 dark:border-gray-700",
  header: "bg-gray-50 dark:bg-gray-800/80",
  bar: "bg-gray-400",
  count: "bg-gray-700 text-white dark:bg-gray-600",
};

export default function SecuritySosBoard() {
  const { signOut } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const areaFilter = searchParams.get("area") || "";
  const view = areaFilter ? "area" : "summary";
  const [areas, setAreas] = useState([]);
  const [now, setNow] = useState(() => Date.now());
  const { alerts, loading, busyId, respond, resolveAlert, openChat } = usePartnerSosAlerts();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase.rpc("security_partner_areas");
      if (cancelled) return;
      if (error && !isRpcNotFoundError(error)) {
        toast.error(error.message || "Could not load assigned areas.");
        return;
      }
      setAreas(uniquePartnerAreas(data || []));
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const tick = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(tick);
  }, []);

  const selectedArea = areas.find((area) => partnerAreaKey(area) === areaFilter) || null;
  const showAllHistory = Boolean(selectedArea);
  const visibleAlerts = useMemo(() => {
    if (!selectedArea) return alerts;
    return alerts.filter((alert) => alertMatchesPartnerArea(alert, selectedArea));
  }, [alerts, selectedArea]);

  const activeAlerts = useMemo(
    () =>
      visibleAlerts
        .filter((alert) => isActiveSos(alert))
        .sort((a, b) => msAgo(a.createdAt, now) - msAgo(b.createdAt, now)),
    [visibleAlerts, now]
  );
  const pastAlerts = useMemo(
    () =>
      visibleAlerts
        .filter((alert) => inPastWindow(alert, now, { allHistory: showAllHistory }))
        .sort(
          (a, b) =>
            msAgo(a.resolvedAt || a.createdAt, now) - msAgo(b.resolvedAt || b.createdAt, now)
        ),
    [visibleAlerts, now, showAllHistory]
  );

  const showSummary = () => {
    setSearchParams({});
  };

  const setArea = (id) => {
    if (!id) {
      setSearchParams({});
      return;
    }
    setSearchParams({ area: id });
  };

  return (
    <div className="min-h-screen bg-gray-100 p-4 dark:bg-gray-950 sm:p-6">
      <div className="mx-auto max-w-5xl space-y-5">
        <PageHeader
          title="SOS board"
          subtitle="Summary is the last 24 hours across assigned areas. Pick a neighborhood for the full history."
          backTo="/security"
          backLabel="Back to command"
          rightSlot={
            <div className="flex items-center gap-3">
              <ThemeToggle variant="toolbar" />
              <button
                type="button"
                onClick={signOut}
                className="text-xs text-gray-500 underline transition hover:text-red-600 dark:text-gray-400 dark:hover:text-red-400"
              >
                Sign Out
              </button>
            </div>
          }
        />

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={showSummary}
            className={`rounded-full px-3 py-1.5 text-sm font-medium ring-1 ${chipClass(view === "summary")}`}
          >
            Summary
          </button>
          {areas.map((area) => {
            const id = partnerAreaKey(area);
            const selected = areaFilter === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setArea(selected ? "" : id)}
                className={`rounded-full px-3 py-1.5 text-sm font-medium ring-1 ${chipClass(selected, "teal")}`}
              >
                {area.organization_name || area.suburb_name}
              </button>
            );
          })}
        </div>

        {loading ? (
          <p className="text-sm text-gray-500">Loading SOS across assigned areas…</p>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            <SosListCard
              title="Active"
              subtitle={showAllHistory ? "All still-open alerts in this neighborhood" : "Still open · last 24 hours"}
              count={activeAlerts.length}
              empty={
                selectedArea
                  ? "No active SOS in this neighborhood."
                  : "No active SOS in the last 24 hours."
              }
              accent={ACTIVE_ACCENT}
              alerts={activeAlerts}
              busyId={busyId}
              onRespond={respond}
              onResolve={resolveAlert}
              onChat={openChat}
            />
            <SosListCard
              title="Past"
              subtitle={showAllHistory ? "Full history for this neighborhood" : "Last 24 hours"}
              count={pastAlerts.length}
              empty={
                selectedArea
                  ? "No SOS history in this neighborhood yet."
                  : "No SOS in the past 24 hours."
              }
              accent={PAST_ACCENT}
              alerts={pastAlerts}
              busyId={busyId}
              onRespond={respond}
              onResolve={resolveAlert}
              onChat={openChat}
            />
          </div>
        )}
      </div>
    </div>
  );
}
