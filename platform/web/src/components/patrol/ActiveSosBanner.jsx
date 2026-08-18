import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FaBell, FaMapMarkerAlt } from "react-icons/fa";
import { useAuth } from "../../auth/useAuth";
import { supabase } from "../../supabase/client";
import { useScopedOrganization } from "../../utils/organizationScope";
import { listSosBoardAlerts, isActiveSos, formatSosPlace } from "../../utils/residentSos";

/**
 * Live SOS strip on each role home — does not require admin panel.
 */
export default function ActiveSosBanner() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { activeOrganizationId, includeUnscoped } = useScopedOrganization();
  const [alerts, setAlerts] = useState([]);

  const load = useCallback(async () => {
    try {
      const rows = await listSosBoardAlerts({
        organizationId: activeOrganizationId || user?.organizationId,
        includeUnscoped,
        selfUserId: user?.id,
      });
      setAlerts(rows.filter(isActiveSos));
    } catch {
      setAlerts([]);
    }
  }, [activeOrganizationId, includeUnscoped, user?.organizationId]);

  useEffect(() => {
    void load();
    const channel = supabase
      .channel("active-sos-banner")
      .on("postgres_changes", { event: "*", schema: "public", table: "sos_alerts" }, () => {
        void load();
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [load]);

  if (alerts.length === 0) return null;

  const latest = alerts[0];
  const name = latest.fullName || "A resident";
  const place = formatSosPlace(latest);

  return (
    <button
      type="button"
      onClick={() => navigate("/sos")}
      className="block w-full border-b border-red-700 bg-red-600 px-4 py-3 text-left text-white shadow-md motion-safe:animate-pulse"
    >
      <div className="mx-auto flex max-w-6xl items-center gap-3">
        <FaBell className="h-5 w-5 shrink-0" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold">
            {alerts.length === 1 ? "Active SOS" : `${alerts.length} active SOS alerts`}
          </p>
          <p className="truncate text-xs text-red-100">
            {name} · <FaMapMarkerAlt className="mb-0.5 inline h-3 w-3" aria-hidden /> {place}
          </p>
        </div>
        <span className="shrink-0 text-xs font-semibold underline">Open board</span>
      </div>
    </button>
  );
}
