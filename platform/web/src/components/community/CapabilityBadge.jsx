import { CAPABILITIES, capabilityLabel, normalizeCapability } from "../../auth/capabilities";

const TONES = {
  [CAPABILITIES.RESIDENT_BROADCASTER]:
    "bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-200",
  [CAPABILITIES.RESIDENT_MODERATOR]:
    "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
  [CAPABILITIES.EQUIPMENT_CUSTODIAN]:
    "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
};

/** Small chip such as "Street rep", "Moderator" or "Custodian". Renders nothing for unknown caps. */
export default function CapabilityBadge({ capability, title, className = "" }) {
  const cap = normalizeCapability(capability);
  const label = capabilityLabel(cap);
  if (!label) return null;
  return (
    <span
      title={title || label}
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${TONES[cap]} ${className}`}
    >
      {label}
    </span>
  );
}
