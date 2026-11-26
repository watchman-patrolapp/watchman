import { useEffect, useMemo, useState } from "react";
import Button from "../ui/Button";
import { joinWatch, listCityWatches } from "../../utils/places";
import { filterWatches, joinResultCopy } from "../../utils/placesView";
import PlacesNotice from "./PlacesNotice";

/**
 * Approved watches in one city: name and suburb only, each with Join. Signed-in only (D6).
 * With `onMove`, someone already in a watch (`currentWatchId`) gets "Move here" instead (P4).
 */
export default function WatchListForCity({ city, onJoined, reloadKey = 0, currentWatchId = "", onMove, moveBusyId = "" }) {
  const [watches, setWatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("");
  const [joiningId, setJoiningId] = useState("");
  const [notice, setNotice] = useState(null);

  useEffect(() => {
    if (!city?.id) return undefined;
    let ignore = false;
    setLoading(true);
    setError("");
    listCityWatches(city.id)
      .then((rows) => {
        if (!ignore) setWatches(rows);
      })
      .catch((err) => {
        if (!ignore) {
          setWatches([]);
          setError(err?.friendly || "Couldn't load the watches. Please try again.");
        }
      })
      .finally(() => {
        if (!ignore) setLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, [city?.id, reloadKey]);

  const shown = useMemo(() => filterWatches(watches, filter), [watches, filter]);
  const alreadyIn = watches.some((w) => w.myStatus === "active");
  const canMove = Boolean(onMove && currentWatchId);

  const handleJoin = async (watch) => {
    if (joiningId) return;
    setJoiningId(watch.id);
    setError("");
    setNotice(null);
    try {
      const result = await joinWatch(watch.id);
      setNotice(joinResultCopy(result));
      setWatches((rows) => rows.map((w) => (w.id === watch.id ? { ...w, myStatus: result?.status === "pending" ? "pending" : "active" } : w)));
      if (result?.status === "joined" || result?.status === "already_member") onJoined?.(result);
    } catch (err) {
      setError(err?.friendly || "Couldn't join the watch. Please try again.");
    } finally {
      setJoiningId("");
    }
  };

  if (!city?.id) return null;

  return (
    <section className="space-y-3" aria-labelledby="city-watches-title">
      <div>
        <h2 id="city-watches-title" className="text-base font-semibold text-gray-900 dark:text-white">
          Watches in {city.name}
        </h2>
        <p className="text-sm text-text-tertiary">Pick the watch for your suburb.</p>
      </div>
      {watches.length > 8 ? (
        <input
          type="search"
          aria-label="Filter watches by suburb or name"
          placeholder="Filter by suburb or name"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="input border w-full"
        />
      ) : null}
      <PlacesNotice copy={notice} />
      {error ? (
        <p className="text-sm text-danger" role="alert">
          {error}
        </p>
      ) : null}
      {loading ? (
        <p className="text-sm text-text-tertiary">Loading watches…</p>
      ) : !watches.length ? (
        <p className="text-sm text-text-tertiary">
          There are no watches in {city.name} yet. Ask for your suburb below and we'll set it up.
        </p>
      ) : !shown.length ? (
        <p className="text-sm text-text-tertiary">No watch matches that. Try another spelling, or ask for your suburb below.</p>
      ) : (
        <ul className="divide-y divide-gray-100 dark:divide-gray-700 rounded-xl border border-gray-200 dark:border-gray-700">
          {shown.map((w) => (
            <li key={w.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="truncate font-medium text-gray-900 dark:text-white">{w.name}</p>
                {w.suburb ? <p className="truncate text-sm text-text-tertiary">{w.suburb}</p> : null}
              </div>
              {w.myStatus === "active" || w.id === currentWatchId ? (
                <span className="text-sm font-medium text-emerald-700 dark:text-emerald-400">Your watch</span>
              ) : canMove ? (
                <Button
                  type="button"
                  variant="secondary"
                  loading={moveBusyId === w.id}
                  disabled={Boolean(moveBusyId)}
                  onClick={() => onMove(w)}
                >
                  Move here
                </Button>
              ) : w.myStatus === "pending" ? (
                <span className="text-sm font-medium text-amber-700 dark:text-amber-400">Requested</span>
              ) : alreadyIn ? null : (
                <Button
                  type="button"
                  variant="secondary"
                  loading={joiningId === w.id}
                  disabled={Boolean(joiningId)}
                  onClick={() => void handleJoin(w)}
                >
                  Join
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
