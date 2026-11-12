import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import toast from "../../utils/notify";
import PageHeader from "../../components/layout/PageHeader";
import {
  confirmServiceListingCurrent,
  listMyServiceListings,
  setServiceListingStatus,
} from "../../utils/localServicesApi";
import { LOAD_FALLBACK, SAVE_FALLBACK, STATUS_LABELS, friendlyServiceError } from "../../utils/localServices";

const BACK = "/resident/contacts?tab=services";
const btn = "rounded-lg px-2.5 py-1 text-xs font-semibold bg-gray-100 text-gray-800 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-100";

export default function MyServiceListings() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    try {
      setRows(await listMyServiceListings());
      setError("");
    } catch (err) {
      setError(friendlyServiceError(err, LOAD_FALLBACK));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (row, fn, okMessage) => {
    if (busyId) return;
    setBusyId(row.id);
    try {
      await fn();
      toast.success(okMessage);
      await load();
    } catch (err) {
      toast.error(friendlyServiceError(err, SAVE_FALLBACK));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="min-h-screen bg-gray-100 p-4 dark:bg-gray-950 sm:p-6">
      <div className="mx-auto max-w-2xl space-y-6">
        <PageHeader
          title="My listings"
          backTo={BACK}
          backLabel="Back to services"
          rightSlot={
            <Link to="/resident/services/new" className="rounded-lg bg-teal-600 px-3 py-2 text-sm font-semibold text-white hover:bg-teal-700">
              Add your service
            </Link>
          }
        />
        {loading ? (
          <p className="text-sm text-gray-500">Loading…</p>
        ) : error ? (
          <p className="text-sm text-red-600" role="alert">
            {error}
          </p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-gray-500">You have no listings yet.</p>
        ) : (
          <ul className="space-y-3">
            {rows.map((row) => (
              <li key={row.id} className="space-y-2 rounded-xl bg-white p-4 shadow dark:bg-gray-800">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Link to={`/resident/services/${row.id}`} className="text-sm font-semibold text-gray-900 hover:underline dark:text-white">
                    {row.title}
                  </Link>
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-semibold text-gray-700 dark:bg-gray-700 dark:text-gray-200">
                    {STATUS_LABELS[row.status] || row.status}
                  </span>
                </div>
                {row.status === "hidden" ? (
                  <p className="text-xs text-gray-500">A moderator hid this listing. Only a moderator can restore it.</p>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  <Link to={`/resident/services/${row.id}/edit`} className={btn}>
                    Edit
                  </Link>
                  {row.status === "published" ? (
                    <button type="button" disabled={busyId === row.id} className={btn} onClick={() => act(row, () => setServiceListingStatus(row.id, "paused"), "Listing paused.")}>
                      Pause
                    </button>
                  ) : null}
                  {row.status === "paused" ? (
                    <button type="button" disabled={busyId === row.id} className={btn} onClick={() => act(row, () => setServiceListingStatus(row.id, "published"), "Listing is live again.")}>
                      Resume
                    </button>
                  ) : null}
                  {["published", "paused", "pending"].includes(row.status) ? (
                    <>
                      <button type="button" disabled={busyId === row.id} className={btn} onClick={() => act(row, () => confirmServiceListingCurrent(row.id), "Thanks for confirming.")}>
                        Still current?
                      </button>
                      <button type="button" disabled={busyId === row.id} className={btn} onClick={() => act(row, () => setServiceListingStatus(row.id, "removed"), "Listing removed.")}>
                        Remove
                      </button>
                    </>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
