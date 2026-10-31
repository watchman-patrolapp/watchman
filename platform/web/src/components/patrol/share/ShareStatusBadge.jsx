import { FaWhatsapp } from "react-icons/fa";

/** "Sign-on shared" / "Sign-off not shared" pill for control-room views. */
export default function ShareStatusBadge({ label, sharedAt }) {
  const shared = Boolean(sharedAt);
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap ${
        shared
          ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200"
          : "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200"
      }`}
      title={shared ? `Shared ${new Date(sharedAt).toLocaleString("en-ZA")}` : "Not shared to WhatsApp yet"}
    >
      <FaWhatsapp className="w-3 h-3" aria-hidden />
      {label} {shared ? "shared" : "not shared"}
    </span>
  );
}
