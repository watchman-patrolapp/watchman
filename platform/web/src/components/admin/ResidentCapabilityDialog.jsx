import { useState } from "react";
import toast from "react-hot-toast";
import { CAPABILITIES } from "../../auth/capabilities";
import { capabilityErrorMessage, grantCapability } from "../../utils/orgCapabilities";

const OPTIONS = [
  { value: CAPABILITIES.RESIDENT_BROADCASTER, label: "Street rep", hint: "Can post up to 3 neighbourhood notices a day." },
  { value: CAPABILITIES.RESIDENT_MODERATOR, label: "Moderator", hint: "Street rep, plus hides resident notices and handles reports." },
  { value: CAPABILITIES.EQUIPMENT_CUSTODIAN, label: "Equipment custodian", hint: "Watch members only. Looks after shared equipment." },
];

/** Modal: assign a resident responsibility in the working neighbourhood (grant_org_capability). */
export default function ResidentCapabilityDialog({ target, onClose, onGranted }) {
  const [capability, setCapability] = useState(CAPABILITIES.RESIDENT_BROADCASTER);
  const [title, setTitle] = useState("");
  const [expires, setExpires] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  if (!target) return null;

  const submit = async (event) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      // Date input is local (SAST); expire at the end of that day.
      const expiresAt = expires ? new Date(`${expires}T23:59:59+02:00`).toISOString() : null;
      const { error } = await grantCapability({ userId: target.uid, capability, title, note, expiresAt });
      if (error) throw error;
      toast.success("Responsibility assigned. They have been notified.");
      onGranted?.();
      onClose?.();
    } catch (err) {
      toast.error(capabilityErrorMessage(err, "Could not assign."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/50 p-4 sm:items-center" role="presentation">
      <form
        onSubmit={submit}
        role="dialog"
        aria-modal="true"
        aria-labelledby="resident-cap-title"
        className="w-full max-w-md space-y-3 rounded-2xl border border-gray-200 bg-white p-4 shadow-lg dark:border-gray-700 dark:bg-gray-800"
      >
        <h3 id="resident-cap-title" className="text-sm font-semibold text-gray-900 dark:text-white">
          Resident roles - {target.fullName || "resident"}
        </h3>
        <fieldset className="space-y-2">
          {OPTIONS.map((o) => (
            <label key={o.value} className="flex items-start gap-2 text-sm text-gray-800 dark:text-gray-100">
              <input
                type="radio"
                name="resident-cap"
                value={o.value}
                checked={capability === o.value}
                onChange={() => setCapability(o.value)}
                className="mt-1"
              />
              <span>
                <span className="font-medium">{o.label}</span>
                <span className="block text-xs text-gray-500 dark:text-gray-400">{o.hint}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <label className="block text-sm font-medium text-gray-800 dark:text-gray-100">
          Title (optional)
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value.slice(0, 60))}
            placeholder="Street rep - Theescombe Ave"
            className="mt-1 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-900 dark:text-white"
          />
        </label>
        <label className="block text-sm font-medium text-gray-800 dark:text-gray-100">
          Ends on (optional)
          <input
            type="date"
            value={expires}
            onChange={(e) => setExpires(e.target.value)}
            className="mt-1 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-900 dark:text-white"
          />
        </label>
        <label className="block text-sm font-medium text-gray-800 dark:text-gray-100">
          Note for admins (optional)
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value.slice(0, 500))}
            rows={2}
            className="mt-1 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-900 dark:text-white"
          />
        </label>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-lg px-3 py-1.5 text-sm font-medium text-gray-600 hover:underline dark:text-gray-300"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy}
            className="rounded-lg bg-teal-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-50"
          >
            {busy ? "Assigning." : "Assign"}
          </button>
        </div>
      </form>
    </div>
  );
}