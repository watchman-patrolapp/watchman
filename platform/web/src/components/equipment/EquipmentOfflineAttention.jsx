import Button from "../ui/Button";
import { EQUIPMENT_QUEUE_ACTIONS } from "../../utils/equipmentReportingMeta";
import { useEquipmentOfflineQueue } from "../../hooks/useEquipmentOfflineQueue";

/** Shows saved equipment actions and the ones that need a person to look again. */
export default function EquipmentOfflineAttention() {
  const { isOnline, attention, pending, dismiss } = useEquipmentOfflineQueue();
  if (isOnline && pending.length === 0 && attention.length === 0) return null;
  return (
    <div className="space-y-2">
      {!isOnline ? (
        <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-100" role="status">
          You're offline. Some actions will wait until you reconnect.
          {pending.length ? ` ${pending.length} waiting.` : ""}
        </p>
      ) : null}
      {isOnline && pending.length ? (
        <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-100" role="status">
          {pending.length} saved equipment {pending.length === 1 ? "action is" : "actions are"} sending.
        </p>
      ) : null}
      {attention.length ? (
        <section className="rounded-2xl border border-danger bg-danger-light p-3" aria-label="Needs attention">
          <h2 className="text-sm font-semibold text-danger-foreground">Needs attention</h2>
          <ul className="mt-2 space-y-2">
            {attention.map((item) => (
              <li key={item.client_event_id} className="flex flex-wrap items-start justify-between gap-2 text-sm text-danger-foreground">
                <span>
                  <span className="font-medium">{EQUIPMENT_QUEUE_ACTIONS[item.action] || "Saved action"}</span>
                  {item.last_error ? <span className="mt-0.5 block text-xs">{item.last_error}</span> : null}
                </span>
                <Button variant="ghost" className="min-h-11 px-3" onClick={() => dismiss(item.client_event_id)}>
                  Dismiss
                </Button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
