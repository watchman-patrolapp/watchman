import { useEffect, useState } from "react";
import { FaHourglassHalf, FaInfoCircle } from "react-icons/fa";
import { myOrganizationRequests } from "../../utils/organizationRequests";
import { requestBannerCopy } from "../../utils/organizationRequestsView";

/** Friendly "being reviewed" note for people who asked to run a watch or security company. */
export default function OrgRequestStatusBanner({ userId }) {
  const [requests, setRequests] = useState([]);

  useEffect(() => {
    if (!userId) return undefined;
    let ignore = false;
    void myOrganizationRequests().then((rows) => {
      if (!ignore) setRequests(rows);
    });
    return () => {
      ignore = true;
    };
  }, [userId]);

  const copies = requests.map(requestBannerCopy).filter(Boolean);
  if (!copies.length) return null;

  return (
    <div className="space-y-2">
      {copies.map((c) => (
        <div
          key={c.title + c.body}
          role="status"
          className={`flex gap-3 rounded-xl border px-4 py-3 text-sm ${
            c.tone === "warn"
              ? "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-100"
              : "border-sky-200 bg-sky-50 text-sky-900 dark:border-sky-800 dark:bg-sky-900/30 dark:text-sky-100"
          }`}
        >
          {c.tone === "warn" ? (
            <FaInfoCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          ) : (
            <FaHourglassHalf className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          )}
          <div>
            <p className="font-semibold">{c.title}</p>
            <p className="mt-0.5">{c.body}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
