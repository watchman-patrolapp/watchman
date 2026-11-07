import { FaEnvelope, FaPhone, FaSms } from "react-icons/fa";
import { formatWatchDate } from "../../../utils/watchTime";

export function InlineConfirm({ label, onConfirm, onCancel, disabled }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-gray-500 dark:text-gray-400">{label}</span>
      <button
        type="button"
        onClick={onConfirm}
        disabled={disabled}
        className="px-2 py-1 text-white text-xs rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-50"
      >
        Yes
      </button>
      <button
        type="button"
        onClick={onCancel}
        disabled={disabled}
        className="px-2 py-1 bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-200 text-xs rounded-lg"
      >
        No
      </button>
    </div>
  );
}

export function KinBlock({ title, kin }) {
  if (!kin?.label) return null;
  return (
    <span className="block">
      <span className="block text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
        {title}
      </span>
      <span className="block font-medium text-gray-900 dark:text-white">{kin.name || "—"}</span>
      {kin.relationshipLabel ? (
        <span className="mt-0.5 block text-xs text-gray-600 dark:text-gray-300">{kin.relationshipLabel}</span>
      ) : null}
      {kin.phone ? (
        <a
          href={`tel:${kin.phone.replace(/\s+/g, "")}`}
          className="mt-0.5 block text-xs text-teal-700 hover:underline dark:text-teal-300"
        >
          {kin.phone}
        </a>
      ) : (
        <span className="mt-0.5 block text-xs text-gray-500 dark:text-gray-400">No phone</span>
      )}
    </span>
  );
}

export function formatJoined(iso) {
  if (!iso) return "—";
  return formatWatchDate(iso) || "—";
}

export function telHref(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (digits.length < 10) return "";
  if (digits.startsWith("0") && digits.length === 10) return `tel:+27${digits.slice(1)}`;
  if (digits.startsWith("27") && digits.length >= 11) return `tel:+${digits}`;
  return `tel:${digits}`;
}

export function smsHref(phone) {
  const href = telHref(phone);
  return href ? href.replace(/^tel:/, "sms:") : "";
}

export function StaffContactLinks({ email, phone }) {
  const mail = String(email || "").trim();
  const call = telHref(phone);
  const sms = smsHref(phone);
  const phoneLabel = String(phone || "").trim();
  if (!mail && !call) {
    return <span className="text-xs text-gray-500 dark:text-gray-400">No contact details on file</span>;
  }
  return (
    <div className="space-y-1.5">
      {mail ? (
        <a
          href={`mailto:${mail}`}
          className="flex items-center gap-1.5 text-sm text-teal-700 hover:underline dark:text-teal-300"
        >
          <FaEnvelope className="h-3 w-3 shrink-0" aria-hidden />
          {mail}
        </a>
      ) : (
        <p className="text-xs text-gray-500 dark:text-gray-400">No email</p>
      )}
      {call ? (
        <div className="flex flex-wrap items-center gap-2">
          <a
            href={call}
            className="inline-flex items-center gap-1.5 text-sm text-teal-700 hover:underline dark:text-teal-300"
          >
            <FaPhone className="h-3 w-3 shrink-0" aria-hidden />
            {phoneLabel}
          </a>
          {sms ? (
            <a
              href={sms}
              className="inline-flex items-center gap-1 text-xs font-medium text-teal-800 hover:underline dark:text-teal-200"
            >
              <FaSms className="h-3 w-3 shrink-0" aria-hidden />
              SMS
            </a>
          ) : null}
        </div>
      ) : (
        <p className="text-xs text-gray-500 dark:text-gray-400">No phone</p>
      )}
    </div>
  );
}
