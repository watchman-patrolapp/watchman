import { FaCheckCircle, FaInfoCircle } from "react-icons/fa";

/** Small friendly note used by the places components ({ tone, title, body }). */
export default function PlacesNotice({ copy }) {
  if (!copy) return null;
  const success = copy.tone === "success";
  return (
    <div
      role="status"
      className={`flex gap-3 rounded-xl border px-4 py-3 text-sm ${
        success
          ? "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-100"
          : "border-sky-200 bg-sky-50 text-sky-900 dark:border-sky-800 dark:bg-sky-900/30 dark:text-sky-100"
      }`}
    >
      {success ? <FaCheckCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> : <FaInfoCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />}
      <div>
        <p className="font-semibold">{copy.title}</p>
        {copy.body ? <p className="mt-0.5">{copy.body}</p> : null}
      </div>
    </div>
  );
}
