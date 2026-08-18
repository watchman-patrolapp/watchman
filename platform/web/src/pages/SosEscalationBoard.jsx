import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import { FaEnvelope, FaMapMarkerAlt, FaPhone, FaUser } from "react-icons/fa";
import { useAuth } from "../auth/useAuth";
import { canAccessAdminPanel } from "../auth/staffRoles";
import {
  canAccessPatrolSchedule,
  canDeleteSosHistory,
  homePathForRole,
  isResidentAppRole,
  normalizeAppRole,
} from "../auth/roleMatrix";
import { supabase } from "../supabase/client";
import PageHeader from "../components/layout/PageHeader";
import { useScopedOrganization } from "../utils/organizationScope";
import { markChatVisited } from "../chat/utils/markChatVisited";
import { listSosBoardAlerts, isActiveSos, formatSosPlace, deleteSosBoardAlert } from "../utils/residentSos";

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

function SosProfileCard({ alert }) {
  return (
    <div className="mt-3 rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900/60">
      <div className="flex items-start gap-3">
        {alert.avatarUrl ? (
          <img src={alert.avatarUrl} alt="" className="h-12 w-12 rounded-full object-cover" />
        ) : (
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-100 text-sm font-bold text-red-800 dark:bg-red-950/50 dark:text-red-200">
            {initialsFrom(alert.fullName, alert.email)}
          </div>
        )}
        <div className="min-w-0 flex-1 space-y-1.5 text-sm text-gray-700 dark:text-gray-300">
          <p className="flex items-center gap-2 font-semibold text-gray-900 dark:text-white">
            <FaUser className="h-3.5 w-3.5 shrink-0 text-teal-600" aria-hidden />
            {alert.fullName}
          </p>
          <p className="flex items-start gap-2">
            <FaMapMarkerAlt className="mt-0.5 h-3.5 w-3.5 shrink-0 text-teal-600" aria-hidden />
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
      </div>
    </div>
  );
}

export default function SosEscalationBoard() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { activeOrganizationId, includeUnscoped } = useScopedOrganization();
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const isAdmin = canAccessAdminPanel(user?.role);
  const role = normalizeAppRole(user?.role);
  const homePath = homePathForRole(user?.role, user?.platformRole);
  const canRespond =
    canAccessPatrolSchedule(user?.role) ||
    isAdmin ||
    role === "security_admin" ||
    role === "city_admin";
  const householdView = isResidentAppRole(user?.role);
  const canDeleteHistory = canDeleteSosHistory(user?.role);

  const loadGen = useRef(0);

  const loadAlerts = useCallback(async ({ silent = false } = {}) => {
    const gen = ++loadGen.current;
    if (!silent) setLoading(true);
    try {
      const rows = await listSosBoardAlerts({
        organizationId: activeOrganizationId,
        includeUnscoped,
        selfUserId: user?.id,
      });
      if (gen !== loadGen.current) return;
      setAlerts(rows);
    } catch (err) {
      if (gen !== loadGen.current) return;
      console.error(err);
      toast.error(err.message || "Could not load SOS board.");
      setAlerts([]);
    } finally {
      if (gen === loadGen.current) setLoading(false);
    }
  }, [activeOrganizationId, includeUnscoped, user?.id]);

  useEffect(() => {
    void loadAlerts();
    const channel = supabase
      .channel("sos-board-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "sos_alerts" }, () => {
        void loadAlerts({ silent: true });
      })
      .subscribe();
    const tick = window.setInterval(() => {
      void loadAlerts({ silent: true });
    }, 15000);
    return () => {
      window.clearInterval(tick);
      supabase.removeChannel(channel);
    };
  }, [loadAlerts]);

  const openAlerts = useMemo(() => alerts.filter(isActiveSos), [alerts]);
  const closedAlerts = useMemo(() => alerts.filter((row) => !isActiveSos(row)), [alerts]);

  const acknowledge = async (alert) => {
    setBusyId(alert.id);
    try {
      const { error } = await supabase
        .from("sos_alerts")
        .update({
          acknowledged_by_user_id: user.id,
          acknowledged_at: new Date().toISOString(),
        })
        .eq("id", alert.id);
      if (error) throw error;
      toast.success("You are marked as responding. Open chat to coordinate.");
      await loadAlerts({ silent: true });
    } catch (err) {
      console.error(err);
      toast.error(
        err.message || "Could not acknowledge. Apply the SOS patrol SQL if this persists."
      );
    } finally {
      setBusyId(null);
    }
  };

  const resolveAlert = async (alert) => {
    setBusyId(alert.id);
    try {
      const { error } = await supabase
        .from("sos_alerts")
        .update({
          resolved_at: new Date().toISOString(),
          resolved_by_user_id: user.id,
        })
        .eq("id", alert.id);
      if (error) throw error;
      toast.success("SOS marked resolved.");
      await loadAlerts({ silent: true });
    } catch (err) {
      console.error(err);
      toast.error(err.message || "Could not resolve SOS. Apply the latest SOS SQL if this persists.");
    } finally {
      setBusyId(null);
    }
  };

  const escalate = async (alert) => {
    const nextLevel = Math.min(3, Number(alert.escalationLevel || 0) + 1);
    setBusyId(alert.id);
    try {
      const { error } = await supabase
        .from("sos_alerts")
        .update({
          escalation_level: nextLevel,
          resolved_by_organization_id: activeOrganizationId || user.organizationId || null,
        })
        .eq("id", alert.id);
      if (error) throw error;
      toast.success(`Escalated to level ${nextLevel}.`);
      await loadAlerts({ silent: true });
    } catch (err) {
      console.error(err);
      toast.error(err.message || "Escalation update failed.");
    } finally {
      setBusyId(null);
    }
  };

  const deleteAlert = async (alert) => {
    const who = alert.fullName || "this resident";
    if (
      !window.confirm(
        `Remove this SOS for ${who}? Use this for accidental alerts. It cannot be undone.`
      )
    ) {
      return;
    }
    setBusyId(alert.id);
    try {
      await deleteSosBoardAlert(alert.id);
      toast.success("SOS removed from the board.");
      await loadAlerts({ silent: true });
    } catch (err) {
      console.error(err);
      toast.error(
        err.message || "Could not delete SOS. Apply the SOS history delete SQL if this persists."
      );
    } finally {
      setBusyId(null);
    }
  };

  const openChat = () => {
    void markChatVisited(null);
    navigate("/chat");
  };

  const renderAlert = (alert) => {
    const open = isActiveSos(alert);
    return (
      <div key={alert.id} className="rounded-lg border border-red-200 p-4 dark:border-red-900/60">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="font-medium text-gray-900 dark:text-white">SOS · {alert.fullName}</p>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {new Date(alert.createdAt).toLocaleString()}
            </p>
          </div>
          <span className="rounded-full bg-red-100 px-2 py-1 text-xs font-semibold text-red-700 dark:bg-red-950/50 dark:text-red-200">
            {open ? (alert.acknowledgedAt ? "Responding" : "Active") : "Resolved"}
          </span>
        </div>
        <SosProfileCard alert={alert} />
        {alert.description ? (
          <p className="mt-2 text-sm text-gray-700 dark:text-gray-300">{alert.description}</p>
        ) : null}
        {alert.acknowledgedAt ? (
          <p className="mt-1 text-xs text-emerald-700 dark:text-emerald-300">
            Acknowledged
            {alert.acknowledgedByName ? ` by ${alert.acknowledgedByName}` : ""} ·{" "}
            {new Date(alert.acknowledgedAt).toLocaleString()}
          </p>
        ) : null}
        {alert.resolvedAt ? (
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            Resolved
            {alert.resolvedByName ? ` by ${alert.resolvedByName}` : ""} ·{" "}
            {new Date(alert.resolvedAt).toLocaleString()}
          </p>
        ) : null}
        <div className="mt-3 flex flex-wrap gap-2">
          {open && !alert.acknowledgedAt && canRespond ? (
            <button
              type="button"
              onClick={() => acknowledge(alert)}
              disabled={busyId === alert.id}
              className="rounded bg-emerald-600 px-3 py-1 text-sm text-white disabled:opacity-50"
            >
              {busyId === alert.id ? "Saving…" : "I'm responding"}
            </button>
          ) : null}
          <button
            type="button"
            onClick={openChat}
            className="rounded bg-violet-700 px-3 py-1 text-sm text-white"
          >
            Open chat
          </button>
          {open && canRespond ? (
            <button
              type="button"
              onClick={() => resolveAlert(alert)}
              disabled={busyId === alert.id}
              className="rounded bg-gray-700 px-3 py-1 text-sm text-white disabled:opacity-50"
            >
              Mark resolved
            </button>
          ) : null}
          {isAdmin && open ? (
            <button
              type="button"
              onClick={() => escalate(alert)}
              disabled={busyId === alert.id || Number(alert.escalationLevel) >= 3}
              className="rounded bg-orange-600 px-3 py-1 text-sm text-white disabled:opacity-50"
            >
              Escalate level
            </button>
          ) : null}
          {canDeleteHistory ? (
            <button
              type="button"
              onClick={() => deleteAlert(alert)}
              disabled={busyId === alert.id}
              className="rounded border border-red-300 bg-white px-3 py-1 text-sm text-red-700 disabled:opacity-50 dark:border-red-800 dark:bg-transparent dark:text-red-300"
            >
              Delete
            </button>
          ) : null}
        </div>
      </div>
    );
  };

  if (role === "security_admin") {
    return <Navigate to="/security/sos" replace />;
  }

  return (
    <div className="min-h-screen bg-gray-100 p-6 dark:bg-gray-900">
      <div className="mx-auto max-w-5xl rounded-xl bg-white p-5 shadow dark:bg-gray-800">
        <PageHeader
          title="SOS board"
          subtitle={
            householdView
              ? "Active means the emergency is still open. Patrol and your security company also see these. Earlier means a responder marked it resolved."
              : "Alerts for the selected neighborhood only (Theescombe while that is the working area). Active = still open until Mark resolved. Admin, tech, and neighborhood admin can delete accidental alerts."
          }
          backTo={homePath}
          backLabel="Back to home"
          className="bg-transparent p-0 shadow-none dark:bg-transparent"
        />

        {loading ? (
          <p className="mt-4 text-sm text-gray-500 dark:text-gray-400">Loading alerts...</p>
        ) : alerts.length === 0 ? (
          <p className="mt-4 text-sm text-gray-500 dark:text-gray-400">No SOS alerts yet.</p>
        ) : (
          <div className="mt-4 space-y-6">
            <section className="space-y-3">
              <h2 className="text-sm font-semibold text-red-700 dark:text-red-300">
                Active ({openAlerts.length})
              </h2>
              {openAlerts.length === 0 ? (
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  No active SOS. An alert stays Active until a responder marks it resolved.
                </p>
              ) : (
                openAlerts.map(renderAlert)
              )}
            </section>
            {closedAlerts.length > 0 ? (
              <section className="space-y-3">
                <h2 className="text-sm font-semibold text-gray-600 dark:text-gray-400">
                  Earlier ({closedAlerts.length})
                </h2>
                {closedAlerts.map(renderAlert)}
              </section>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
