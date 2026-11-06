import { useCallback, useEffect, useState } from "react";
import { useNetworkStatus } from "../chat/hooks/useNetworkStatus";
import {
  attentionItems,
  dismissEquipmentAction,
  flushEquipmentQueue,
  loadEquipmentQueue,
  pendingItems,
} from "../utils/equipmentOfflineStore";

/** Loads the equipment offline queue and sends it when the phone is back online. */
export function useEquipmentOfflineQueue() {
  const { isOnline } = useNetworkStatus();
  const [queue, setQueue] = useState([]);

  const refresh = useCallback(async () => {
    const next = isOnline ? await flushEquipmentQueue() : await loadEquipmentQueue();
    setQueue(next);
    return next;
  }, [isOnline]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const dismiss = useCallback(async (clientEventId) => {
    setQueue(await dismissEquipmentAction(clientEventId));
  }, []);

  return {
    isOnline,
    queue,
    attention: attentionItems(queue),
    pending: pendingItems(queue),
    refresh,
    dismiss,
  };
}
