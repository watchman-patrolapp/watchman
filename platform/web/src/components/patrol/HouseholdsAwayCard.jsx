import { useEffect, useState } from "react";
import { FaHome } from "react-icons/fa";
import { isRpcNotFoundError } from "../../utils/isRpcNotFound";
import { formatAwayRange, listHouseholdsAway } from "../../utils/residentAway";

export default function HouseholdsAwayCard({ className = "" }) {
  const [rows, setRows] = useState([]);

  useEffect(() => {
    let ignore = false;
    const load = async () => {
      const { data, error } = await listHouseholdsAway();
      if (ignore) return;
      if (error) {
        if (!isRpcNotFoundError(error) && !/forbidden|schema cache|does not exist/i.test(error.message || "")) {
          console.warn("households away:", error.message);
        }
        return;
      }
      setRows(data || []);
    };
    void load();
    return () => {
      ignore = true;
    };
  }, []);

  if (!rows.length) return null;

  return (
    <section
      className={`rounded-2xl border border-amber-200/80 bg-white p-4 shadow-sm dark:border-amber-900/50 dark:bg-gray-800 ${className}`}
    >
      <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
        <FaHome className="h-4 w-4 text-amber-600" aria-hidden />
        Households away
      </h3>
      <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
        Only patrol can see this. Extra eyes on these houses.
      </p>
      <ul className="mt-3 space-y-2">
        {rows.map((row) => (
          <li
            key={row.user_id}
            className="rounded-lg border border-gray-100 bg-amber-50/70 px-3 py-2 text-sm dark:border-gray-700 dark:bg-amber-950/20"
          >
            <p className="font-medium text-gray-900 dark:text-white">
              {row.full_name || "Household"}
              {row.street_label ? ` · ${row.street_label}` : ""}
            </p>
            <p className="text-xs text-gray-600 dark:text-gray-400">{formatAwayRange(row)}</p>
            {row.note ? <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{row.note}</p> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
