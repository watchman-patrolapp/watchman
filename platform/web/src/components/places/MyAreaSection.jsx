import { useCallback, useEffect, useState } from "react";
import { FaMapMarkerAlt } from "react-icons/fa";
import { useAuth } from "../../auth/useAuth";
import { useActiveOrganization } from "../../auth/useActiveOrganization";
import CityPicker from "./CityPicker";
import WatchListForCity from "./WatchListForCity";
import SuburbSuggest from "./SuburbSuggest";
import PlacesNotice from "./PlacesNotice";
import OrgRequestStatusBanner from "../resident/OrgRequestStatusBanner";
import { myHomeArea, mySuburbRequests, setMyHomeCity, switchMyWatch } from "../../utils/places";
import {
  cityChangeCopy,
  homeWatchLine,
  mySuburbRequestLabel,
  switchConfirmText,
  switchResultCopy,
  watchInOtherCity,
} from "../../utils/placesView";

/**
 * "Where you live" for Profile, Choose area and Find your watch (SA places P4):
 * your city, your watch (name and suburb only), watches you're waiting for, and your
 * suburb requests. Residents and patrollers can change city, join, move or ask for a suburb.
 */
export default function MyAreaSection({ startOpen = false, onWatchChanged, className = "" }) {
  const { user, refreshUser } = useAuth();
  const { refreshOrganizations } = useActiveOrganization();
  const [area, setArea] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [cityDraft, setCityDraft] = useState(null);
  const [editingCity, setEditingCity] = useState(false);
  const [savingCity, setSavingCity] = useState(false);
  const [open, setOpen] = useState(startOpen);
  const [notice, setNotice] = useState(null);
  const [moveBusyId, setMoveBusyId] = useState("");
  const [requests, setRequests] = useState([]);
  const [reloadKey, setReloadKey] = useState(0);

  const load = useCallback(async () => {
    try {
      const next = await myHomeArea();
      setArea(next);
      setError("");
    } catch (err) {
      setArea(null);
      setError(err?.friendly || "Couldn't load your area. Please try again.");
    } finally {
      setLoading(false);
    }
    setRequests(await mySuburbRequests());
  }, []);

  useEffect(() => {
    void load();
  }, [load, reloadKey]);

  const afterWatchChange = async (result) => {
    try {
      await refreshUser?.();
      await refreshOrganizations?.({ silent: true });
    } catch {
      /* the page still shows the new state after reload */
    }
    setReloadKey((k) => k + 1);
    onWatchChanged?.(result);
  };

  const saveCity = async (city) => {
    setCityDraft(city);
    if (!city?.id) return;
    setSavingCity(true);
    setNotice(null);
    try {
      const result = await setMyHomeCity(city.id);
      setNotice(cityChangeCopy(result, Boolean(area?.watch)));
      setEditingCity(false);
      setCityDraft(null);
      setOpen(true);
      setReloadKey((k) => k + 1);
    } catch (err) {
      setNotice({ tone: "info", title: err?.friendly || "Couldn't save your city. Please try again.", body: "" });
    } finally {
      setSavingCity(false);
    }
  };

  const move = async (watch) => {
    if (moveBusyId) return;
    if (area?.watch && !window.confirm(switchConfirmText(area.watch, watch))) return;
    setMoveBusyId(watch.id);
    setNotice(null);
    try {
      const result = await switchMyWatch(watch.id);
      setNotice(switchResultCopy(result));
      setOpen(false);
      await afterWatchChange(result);
    } catch (err) {
      setNotice({ tone: "info", title: err?.friendly || "Couldn't change your watch. Please try again.", body: "" });
    } finally {
      setMoveBusyId("");
    }
  };

  const city = area?.city || null;
  const watch = area?.watch || null;
  const canChange = Boolean(area?.canChangeWatch);
  const showPicker = editingCity || !city;

  return (
    <section
      id="my-area"
      aria-labelledby="my-area-title"
      className={`scroll-mt-4 rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800 ${className}`}
    >
      <h2 id="my-area-title" className="flex items-center gap-2 text-lg font-semibold text-gray-900 dark:text-white">
        <FaMapMarkerAlt className="h-4 w-4 text-teal-600 dark:text-teal-400" aria-hidden />
        Where you live
      </h2>

      {loading ? (
        <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">Loading your area…</p>
      ) : error ? (
        <p className="mt-2 rounded-lg bg-sky-50 px-3 py-2 text-sm text-sky-900 dark:bg-sky-900/30 dark:text-sky-100">{error}</p>
      ) : (
        <div className="mt-3 space-y-4">
          <PlacesNotice copy={notice} />

          {showPicker ? (
            <div>
              <CityPicker
                id="my-area-city"
                label="City or town"
                value={cityDraft}
                onChange={(c) => void saveCity(c)}
                hint={savingCity ? "Saving…" : undefined}
              />
              {city ? (
                <button
                  type="button"
                  className="mt-1 text-sm font-medium text-text-secondary hover:underline"
                  onClick={() => {
                    setEditingCity(false);
                    setCityDraft(null);
                  }}
                >
                  Keep {city.name}
                </button>
              ) : null}
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-gray-900 dark:text-white">
                <span className="text-text-tertiary">City or town: </span>
                <span className="font-medium">{[city.name, city.province].filter(Boolean).join(", ")}</span>
              </p>
              <button
                type="button"
                className="text-sm font-medium text-teal-700 dark:text-teal-400 hover:underline"
                onClick={() => setEditingCity(true)}
              >
                Change city
              </button>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-gray-900 dark:text-white">
              <span className="text-text-tertiary">Your watch: </span>
              {watch ? <span className="font-medium">{homeWatchLine(watch)}</span> : <span>not in a watch yet</span>}
            </p>
            {canChange && city ? (
              <button
                type="button"
                aria-expanded={open}
                className="text-sm font-medium text-teal-700 dark:text-teal-400 hover:underline"
                onClick={() => setOpen((v) => !v)}
              >
                {open ? "Close" : watch ? "Change watch" : "Find your watch"}
              </button>
            ) : null}
          </div>

          {watchInOtherCity(area) && canChange ? (
            <p className="text-sm text-text-tertiary">Your watch is in another city. Choose a watch in {city.name} to move.</p>
          ) : null}
          {!canChange && watch ? (
            <p className="text-sm text-text-tertiary">To move to another watch, please ask support.</p>
          ) : null}

          {area?.waiting?.length ? (
            <ul className="space-y-1 text-sm text-text-secondary" aria-label="Watches you're waiting to join">
              {area.waiting.map((w) => (
                <li key={w.id}>Waiting for {w.name} to approve you.</li>
              ))}
            </ul>
          ) : null}

          {open && canChange && city ? (
            <div className="space-y-4 border-t border-gray-100 pt-4 dark:border-gray-700">
              <WatchListForCity
                city={city}
                reloadKey={reloadKey}
                currentWatchId={watch?.id || ""}
                onMove={watch ? (w) => void move(w) : undefined}
                moveBusyId={moveBusyId}
                onJoined={(result) => void afterWatchChange(result)}
              />
              <SuburbSuggest
                key={city.id}
                city={city}
                currentWatchId={watch?.id || ""}
                onMove={watch ? (w) => void move(w) : undefined}
                onJoined={(result) => void afterWatchChange(result)}
                onRequested={() => setReloadKey((k) => k + 1)}
              />
            </div>
          ) : null}

          <OrgRequestStatusBanner userId={user?.uid || user?.id} />
          {requests.length ? (
            <div>
              <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">Your suburb requests</p>
              <ul className="mt-1 space-y-1 text-sm text-text-secondary">
                {requests.map((r) => (
                  <li key={r.id}>{mySuburbRequestLabel(r)}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}
