import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import toast from "../../utils/notify";
import { listCommunityReports } from "../../utils/communityReports";
import {
  featureServiceListing,
  listListingsForModeration,
  setServiceListingStatus,
} from "../../utils/localServicesApi";
import {
  LOAD_FALLBACK,
  SERVICE_MODERATION_FILTERS,
  STATUS_LABELS,
  friendlyServiceError,
} from "../../utils/localServices";

const BTN =
  "rounded-lg border border-gray-300 px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:text-gray-200";

/** Staff moderation of local service listings: Pending / Published / Hidden / Reported. */
export default function ServiceModerationPanel({ orgId, isStaff }) {
  const [filter, setFilter] = useState("pending");
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    try {
      if (filter === "reported") {
        const { data, error: err } = await listCommunityReports("open");
        if (err) throw err;
        setRows(
          data
            .filter((r) => r.content_type === "service_listing" || r.content_type === "service_review")
            .map((r) => ({ ...r, reported: true })),
        );
      } else {
        setRows(await listListingsForModeration(orgId, filter));
      }
      setError("");
    } catch (err) {
      setRows([]);
      setError(friendlyServiceError(err, LOAD_FALLBACK));
    } finally {
      setLoading(false);
    }
  }, [orgId, filter]);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(row, fn, okMessage) {
    if (busyId) return;
    setBusyId(row.id);
    try {
      await fn();
      toast.success(okMessage);
      await load();
    } catch (err) {
      toast.error(friendlyServiceError(err));
    } finally {
      setBusyId(null);
    }
  }

  function hide(row) {
    const reason = window.prompt("Reason for hiding this listing (shown to the owner):", "");
    if (reason === null) return;
    if (!reason.trim()) {
      toast.error("Please give a reason.");
      return;
    }
    void act(row, () => setServiceListingStatus(row.id, "hidden", reason.trim()), "Listing hidden.");
  }

  return (
    <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800" aria-label="Moderate services">
      <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Moderate local services</h2>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Moderation filter">
        {SERVICE_MODERATION_FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            aria-pressed={filter === f.key}
            onClick={() => setFilter(f.key)}
            className={`rounded-full px-3 py-1 text-xs font-semibold ring-1 ${
              filter === f.key ? "bg-teal-600 text-white ring-teal-600" : "bg-white text-gray-700 ring-gray-200 dark:bg-gray-900 dark:text-gray-200 dark:ring-gray-700"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {loading ? <p className="text-sm text-gray-500">Loading…</p> : null}
      {!loading && error ? (
        <p className="text-sm text-red-600" role="alert">
          {error}
        </p>
      ) : null}
      {!loading && !error && rows.length === 0 ? <p className="text-sm text-gray-500">Nothing here.</p> : null}

      {!loading && !error && filter === "reported" ? (
        <>
          {rows.length > 0 ? (
            <p className="text-xs text-gray-500">
              Hide or dismiss reports on the{" "}
              <Link to="/resident/moderate" className="font-medium text-teal-700 underline dark:text-teal-300">
                moderator page
              </Link>
              .
            </p>
          ) : null}
          <ul className="space-y-2">
            {rows.map((r) => (
              <li key={`${r.content_type}:${r.content_id}`} className="text-sm text-gray-800 dark:text-gray-100">
                <span className="font-medium">{r.headline || "Reported item"}</span>
                <span className="text-xs text-gray-500">
                  {" "}
                  - {r.content_type === "service_review" ? "review" : "listing"}, {r.report_count} report
                  {r.report_count === 1 ? "" : "s"}
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {!loading && !error && filter !== "reported" ? (
        <ul className="space-y-2">
          {rows.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 text-sm text-gray-800 dark:text-gray-100">
              <div className="min-w-0">
                <span className="font-medium">{row.title}</span>
                <span className="ml-2 text-xs text-gray-500">{STATUS_LABELS[row.status] || row.status}</span>
                {row.is_featured ? <span className="ml-2 text-xs text-amber-600">Pinned</span> : null}
              </div>
              <div className="flex gap-2">
                {row.status === "pending" || row.status === "hidden" ? (
                  <button
                    type="button"
                    disabled={busyId === row.id}
                    onClick={() => act(row, () => setServiceListingStatus(row.id, "published"), "Listing published.")}
                    className={BTN}
                  >
                    {row.status === "pending" ? "Approve" : "Restore"}
                  </button>
                ) : null}
                {row.status === "published" || row.status === "pending" ? (
                  <button type="button" disabled={busyId === row.id} onClick={() => hide(row)} className={BTN}>
                    Hide
                  </button>
                ) : null}
                {isStaff && row.status === "published" ? (
                  <button
                    type="button"
                    disabled={busyId === row.id}
                    onClick={() =>
                      act(row, () => featureServiceListing(row.id, !row.is_featured), row.is_featured ? "Unpinned." : "Pinned.")
                    }
                    className={BTN}
                  >
                    {row.is_featured ? "Unpin" : "Pin"}
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
