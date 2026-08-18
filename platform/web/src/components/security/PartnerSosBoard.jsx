import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import { FaBell, FaEnvelope, FaMapMarkerAlt, FaPhone, FaUser } from "react-icons/fa";
import { supabase } from "../../supabase/client";
import { markChatVisited } from "../../chat/utils/markChatVisited";
import { formatRelativeTime } from "../../utils/formatRelativeTime";
import {
  formatSosPlace,
  isActiveSos,
  listSecurityPartnerSosAlerts,
  updateSecurityPartnerSos,
} from "../../utils/residentSos";

export function partnerAreaKey(area) {
  return area?.organization_id || area?.suburb_id || "";
}

export function uniquePartnerAreas(rows) {
  const map = new Map();
  for (const row of rows || []) {
    const key = partnerAreaKey(row);
    if (!key || map.has(key)) continue;
    map.set(key, row);
  }
  return [...map.values()].sort((a, b) =>
    String(a.organization_name || a.suburb_name || "").localeCompare(
      String(b.organization_name || b.suburb_name || "")
    )
  );
}

export function alertMatchesPartnerArea(alert, area) {
  if (!area) return false;
  if (area.organization_id && alert.organizationId === area.organization_id) return true;
  if (area.suburb_id && alert.suburbId === area.suburb_id) return true;
  const org = String(area.organization_name || "").trim().toLowerCase();
  const name = String(alert.organizationName || "").trim().toLowerCase();
  return Boolean(org && name && org === name);
}

export function groupPartnerSos(alerts, areas) {
  const listed = (areas || []).map((area) => ({
    id: partnerAreaKey(area),
    label: area.organization_name || area.suburb_name || "Area",
    area,
    active: [],
    earlier: [],
  }));
  const leftover = { id: "other", label: "Other area", area: null, active: [], earlier: [] };

  for (const alert of alerts || []) {
    const bucket = isActiveSos(alert) ? "active" : "earlier";
    const match = (areas || []).find((area) => alertMatchesPartnerArea(alert, area));
    if (match) {
      const group = listed.find((row) => row.id === partnerAreaKey(match));
      if (group) group[bucket].push(alert);
      else leftover[bucket].push(alert);
    } else {
      leftover[bucket].push(alert);
    }
  }

  const named = leftover.active.length + leftover.earlier.length > 0 ? [...listed, leftover] : listed;
  return named.filter((group) => group.id);
}

function initialsFrom(name, email) {
  const raw = String(name || "").trim();
  if (raw) {
    return raw
      .split(/\s+/)
      .map((part) => part[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  }
  return String(email || "?").charAt(0).toUpperCase();
}

export function usePartnerSosAlerts() {
  const navigate = useNavigate();
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const warnedRef = useRef(false);

  const load = useCallback(async () => {
    try {
      const rows = await listSecurityPartnerSosAlerts();
      setAlerts(rows);
    } catch (err) {
      console.error(err);
      if (!warnedRef.current) {
        warnedRef.current = true;
        toast.error(err.message || "Could not load the command SOS board.");
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const channel = supabase
      .channel("security-partner-sos-board")
      .on("postgres_changes", { event: "*", schema: "public", table: "sos_alerts" }, () => {
        void load();
      })
      .subscribe();
    const tick = window.setInterval(() => {
      void load();
    }, 15000);
    return () => {
      window.clearInterval(tick);
      supabase.removeChannel(channel);
    };
  }, [load]);

  const respond = async (alert) => {
    setBusyId(alert.id);
    try {
      await updateSecurityPartnerSos(alert.id, "respond");
      toast.success("You are marked as responding.");
      await load();
    } catch (err) {
      toast.error(err.message || "Could not acknowledge SOS.");
    } finally {
      setBusyId(null);
    }
  };

  const resolveAlert = async (alert) => {
    setBusyId(alert.id);
    try {
      await updateSecurityPartnerSos(alert.id, "resolve");
      toast.success("SOS marked resolved.");
      await load();
    } catch (err) {
      toast.error(err.message || "Could not resolve SOS.");
    } finally {
      setBusyId(null);
    }
  };

  const openChat = () => {
    void markChatVisited(null);
    navigate("/chat");
  };

  return { alerts, loading, busyId, respond, resolveAlert, openChat, reload: load };
}

function SosCard({ alert, busy, onRespond, onResolve, onChat }) {
  const open = isActiveSos(alert);
  return (
    <article className="rounded-xl border border-red-200 bg-white p-2.5 dark:border-red-900/70 dark:bg-gray-950/40">
      <div className="flex items-start gap-2">
        {alert.avatarUrl ? (
          <img src={alert.avatarUrl} alt="" className="h-8 w-8 shrink-0 rounded-full object-cover" />
        ) : (
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-red-100 text-[10px] font-bold text-red-800 dark:bg-red-950/60 dark:text-red-200">
            {initialsFrom(alert.fullName, alert.email)}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-gray-900 dark:text-white">
            <FaUser className="mb-0.5 mr-1 inline h-3 w-3 text-red-600" aria-hidden />
            {alert.fullName}
          </p>
          <p className="mt-0.5 text-[11px] leading-snug text-gray-600 dark:text-gray-300">
            <FaMapMarkerAlt className="mb-0.5 mr-1 inline h-3 w-3 text-red-500" aria-hidden />
            {formatSosPlace(alert)}
          </p>
          <p className="mt-0.5 font-mono text-[10px] text-gray-400">{formatRelativeTime(alert.createdAt)}</p>
        </div>
        <span
          className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
            open
              ? alert.acknowledgedAt
                ? "bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200"
                : "bg-red-100 text-red-800 dark:bg-red-950/50 dark:text-red-200"
              : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300"
          }`}
        >
          {open ? (alert.acknowledgedAt ? "Responding" : "Active") : "Resolved"}
        </span>
      </div>
      {alert.phone ? (
        <a href={`tel:${alert.phone}`} className="mt-2 flex items-center gap-1.5 text-xs text-teal-700 dark:text-teal-300">
          <FaPhone className="h-3 w-3 shrink-0" aria-hidden />
          {alert.phone}
        </a>
      ) : null}
      {open ? (
        <div className="mt-2 flex flex-col gap-1.5">
          {!alert.acknowledgedAt ? (
            <button
              type="button"
              onClick={() => onRespond(alert)}
              disabled={busy === alert.id}
              className="rounded-lg bg-emerald-600 px-2 py-1 text-xs font-semibold text-white disabled:opacity-50"
            >
              {busy === alert.id ? "Saving…" : "I'm responding"}
            </button>
          ) : null}
          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              onClick={onChat}
              className="rounded-lg bg-violet-700 px-2 py-1 text-xs font-semibold text-white"
            >
              Chat
            </button>
            <button
              type="button"
              onClick={() => onResolve(alert)}
              disabled={busy === alert.id}
              className="rounded-lg bg-gray-700 px-2 py-1 text-xs font-semibold text-white disabled:opacity-50"
            >
              Resolve
            </button>
          </div>
        </div>
      ) : null}
    </article>
  );
}

export function PartnerSosDetailCard({ alert, busy, onRespond, onResolve, onChat }) {
  const open = isActiveSos(alert);
  return (
    <article
      id={`sos-${alert.id}`}
      className={`rounded-2xl border p-4 ${
        open
          ? "border-red-300 bg-white dark:border-red-800 dark:bg-gray-900"
          : "border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900/50"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          {alert.avatarUrl ? (
            <img src={alert.avatarUrl} alt="" className="h-12 w-12 shrink-0 rounded-full object-cover" />
          ) : (
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-red-100 text-sm font-bold text-red-800 dark:bg-red-950/60 dark:text-red-200">
              {initialsFrom(alert.fullName, alert.email)}
            </div>
          )}
          <div className="min-w-0">
            <p className="text-base font-semibold text-gray-900 dark:text-white">{alert.fullName}</p>
            <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
              {alert.createdAt ? new Date(alert.createdAt).toLocaleString() : ""}
              {alert.organizationName ? ` · ${alert.organizationName}` : ""}
            </p>
          </div>
        </div>
        <span
          className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${
            open
              ? alert.acknowledgedAt
                ? "bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200"
                : "bg-red-100 text-red-800 dark:bg-red-950/50 dark:text-red-200"
              : "bg-gray-200 text-gray-700 dark:bg-gray-800 dark:text-gray-300"
          }`}
        >
          {open ? (alert.acknowledgedAt ? "Responding" : "Active") : "Resolved"}
        </span>
      </div>

      <div className="mt-3 space-y-1.5 text-sm text-gray-700 dark:text-gray-300">
        <p className="flex items-start gap-2">
          <FaMapMarkerAlt className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-600" aria-hidden />
          <span>{formatSosPlace(alert)}</span>
        </p>
        {alert.phone ? (
          <a href={`tel:${alert.phone}`} className="flex items-center gap-2 text-teal-700 dark:text-teal-300">
            <FaPhone className="h-3.5 w-3.5 shrink-0" aria-hidden />
            {alert.phone}
          </a>
        ) : (
          <p className="flex items-center gap-2 text-gray-500">
            <FaPhone className="h-3.5 w-3.5 shrink-0" aria-hidden />
            No phone on profile
          </p>
        )}
        {alert.email ? (
          <p className="flex items-center gap-2 break-all">
            <FaEnvelope className="h-3.5 w-3.5 shrink-0 text-teal-600" aria-hidden />
            {alert.email}
          </p>
        ) : null}
      </div>

      {alert.description ? (
        <div className="mt-3 rounded-xl border border-amber-400 bg-amber-200 px-3 py-2 dark:border-amber-800 dark:bg-amber-950/40">
          <p className="mb-0.5 font-mono text-[10px] uppercase tracking-wide text-amber-950 dark:text-amber-200">
            Report text
          </p>
          <p className="text-sm text-amber-950 dark:text-amber-50">{alert.description}</p>
        </div>
      ) : null}

      {alert.acknowledgedAt ? (
        <p className="mt-2 text-xs text-emerald-700 dark:text-emerald-300">
          Acknowledged
          {alert.acknowledgedByName ? ` by ${alert.acknowledgedByName}` : ""} ·{" "}
          {new Date(alert.acknowledgedAt).toLocaleString()}
        </p>
      ) : null}
      {alert.resolvedAt ? (
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
          Resolved
          {alert.resolvedByName ? ` by ${alert.resolvedByName}` : ""} · {new Date(alert.resolvedAt).toLocaleString()}
        </p>
      ) : null}

      {open ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {!alert.acknowledgedAt ? (
            <button
              type="button"
              onClick={() => onRespond(alert)}
              disabled={busy === alert.id}
              className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
            >
              {busy === alert.id ? "Saving…" : "I'm responding"}
            </button>
          ) : null}
          <button
            type="button"
            onClick={onChat}
            className="rounded-lg bg-violet-700 px-3 py-1.5 text-sm font-semibold text-white"
          >
            Open chat
          </button>
          <button
            type="button"
            onClick={() => onResolve(alert)}
            disabled={busy === alert.id}
            className="rounded-lg bg-gray-700 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            Mark resolved
          </button>
        </div>
      ) : null}
    </article>
  );
}

export default function PartnerSosBoard({ areas = [] }) {
  const navigate = useNavigate();
  const { alerts, loading, busyId, respond, resolveAlert, openChat } = usePartnerSosAlerts();
  const groups = useMemo(() => groupPartnerSos(alerts, areas), [alerts, areas]);
  const activeCount = alerts.filter(isActiveSos).length;

  return (
    <section
      className={`mt-3 overflow-hidden rounded-xl border ${
        activeCount > 0
          ? "border-red-300 bg-red-50 dark:border-red-800 dark:bg-red-950/40"
          : "border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800"
      }`}
    >
      <div
        className={`flex items-center gap-2 px-3 py-2 ${
          activeCount > 0 ? "bg-red-600 text-white" : "text-gray-900 dark:text-white"
        }`}
      >
        <FaBell className={`h-3.5 w-3.5 shrink-0 ${activeCount > 0 ? "" : "text-red-600"}`} aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold">SOS board</p>
          <p className={`font-mono text-[10px] uppercase tracking-wide ${activeCount > 0 ? "text-red-100" : "text-gray-400"}`}>
            {areas.length} assigned area{areas.length === 1 ? "" : "s"}
          </p>
        </div>
        <span
          className={`rounded-md px-1.5 font-mono text-[10px] font-semibold ${
            activeCount > 0 ? "bg-white/20 text-white" : "bg-gray-100 text-gray-500 dark:bg-gray-900 dark:text-gray-400"
          }`}
        >
          {activeCount}
        </span>
      </div>

      <div className="max-h-[22rem] space-y-3 overflow-y-auto p-2.5">
        {loading ? (
          <p className="px-1 py-2 text-xs text-gray-500">Loading SOS…</p>
        ) : groups.length === 0 ? (
          <p className="px-1 py-2 text-xs text-gray-500">No assigned neighborhoods yet.</p>
        ) : activeCount === 0 ? (
          <div className="space-y-2 px-1 py-1">
            <p className="text-xs text-gray-600 dark:text-gray-300">No active SOS across assigned areas.</p>
            <ul className="space-y-0.5">
              {groups.map((group) => (
                <li key={group.id} className="truncate font-mono text-[10px] uppercase tracking-wide text-gray-400">
                  {group.label}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          groups.map((group) => {
            if (group.active.length === 0) {
              return (
                <div key={group.id}>
                  <p className="px-1 font-mono text-[10px] uppercase tracking-wide text-gray-400">{group.label}</p>
                  <p className="px-1 text-[11px] text-gray-500">No active SOS</p>
                </div>
              );
            }
            return (
              <div key={group.id} className="space-y-1.5">
                <div className="flex items-center justify-between gap-2 px-1">
                  <p className="truncate font-mono text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                    {group.label}
                  </p>
                  <span className="font-mono text-[10px] text-gray-400">{group.active.length} active</span>
                </div>
                {group.active.map((alert) => (
                  <SosCard
                    key={alert.id}
                    alert={alert}
                    busy={busyId}
                    onRespond={respond}
                    onResolve={resolveAlert}
                    onChat={openChat}
                  />
                ))}
              </div>
            );
          })
        )}
      </div>

      <button
        type="button"
        onClick={() => navigate("/security/sos")}
        className="w-full border-t border-gray-200 px-3 py-2 text-center text-[11px] font-semibold text-teal-700 dark:border-gray-700 dark:text-teal-300"
      >
        Focus
      </button>
    </section>
  );
}
