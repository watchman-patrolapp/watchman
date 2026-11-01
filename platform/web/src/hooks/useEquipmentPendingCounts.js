import { useEffect, useState } from "react";
import { getEquipmentPendingCounts } from "../utils/equipment";

/**
 * Equipment badge counts for the active neighbourhood (P3b equipment_pending_counts).
 * Returns null until loaded, on error, or on databases without P3b, so badges stay hidden.
 * Change refreshKey to refetch (e.g. after a desk action).
 */
export function useEquipmentPendingCounts(enabled, organizationId, refreshKey = 0) {
  const [counts, setCounts] = useState(null);
  useEffect(() => {
    if (!enabled || !organizationId) {
      setCounts(null);
      return undefined;
    }
    let alive = true;
    getEquipmentPendingCounts().then(({ data }) => {
      if (alive) setCounts(data || null);
    });
    return () => {
      alive = false;
    };
  }, [enabled, organizationId, refreshKey]);
  return counts;
}
