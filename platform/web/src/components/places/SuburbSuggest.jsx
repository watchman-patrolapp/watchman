import { useEffect, useState } from "react";
import Button from "../ui/Button";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";
import { joinWatch, requestSuburbOrWatch, suggestSuburbs } from "../../utils/places";
import {
  joinResultCopy,
  PLACES_DEBOUNCE_MS,
  requestResultCopy,
  shouldSearchPlaces,
  suburbRequestState,
} from "../../utils/placesView";
import PlacesNotice from "./PlacesNotice";

/**
 * "My suburb isn't listed": live suggestions while typing (Join an existing suburb's watch),
 * and a new-suburb request only after "It's not one of these". Requests go for approval.
 */
export default function SuburbSuggest({ city, onJoined, onRequested, currentWatchId = "", onMove }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [suggestions, setSuggestions] = useState([]);
  const [checking, setChecking] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [startWatch, setStartWatch] = useState(false);
  const [sending, setSending] = useState(false);
  const [joiningId, setJoiningId] = useState("");
  const [notice, setNotice] = useState(null);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const query = useDebouncedValue(name, PLACES_DEBOUNCE_MS);

  useEffect(() => {
    if (!open || !city?.id || !shouldSearchPlaces(query)) {
      setSuggestions([]);
      setChecking(false);
      return undefined;
    }
    let ignore = false;
    setChecking(true);
    suggestSuburbs(city.id, query)
      .then((rows) => {
        if (!ignore) setSuggestions(rows);
      })
      .catch(() => {
        if (!ignore) setSuggestions([]);
      })
      .finally(() => {
        if (!ignore) setChecking(false);
      });
    return () => {
      ignore = true;
    };
  }, [open, city?.id, query]);

  const waiting = checking || name !== query;
  // Someone already in a watch can move to a listed suburb's watch, but a brand-new suburb
  // needs support to move them (the server refuses new requests from watch members).
  const inWatch = Boolean(currentWatchId);
  const state = suburbRequestState({ name, suggestions, confirmed, loading: waiting });

  const handleJoin = async (watch) => {
    if (joiningId) return;
    setJoiningId(watch.id);
    setError("");
    try {
      const result = await joinWatch(watch.id);
      setNotice(joinResultCopy(result));
      if (result?.status === "joined" || result?.status === "already_member") onJoined?.(result);
    } catch (err) {
      setError(err?.friendly || "Couldn't join the watch. Please try again.");
    } finally {
      setJoiningId("");
    }
  };

  const handleSubmit = async () => {
    if (!state.canSubmit || sending) return;
    setSending(true);
    setError("");
    setNotice(null);
    try {
      const result = await requestSuburbOrWatch({
        cityId: city.id,
        suburbName: state.clean,
        confirmNotListed: confirmed,
        startWatch,
      });
      if (result?.status === "confirm_needed") {
        setSuggestions(result.suggestions || []);
        setConfirmed(false);
      } else if (result?.status === "exists") {
        setSuggestions([{ id: result.suburb_id, name: result.name, match: "exact", beingSetUp: result.state === "being_set_up", watches: result.watches || [] }]);
      } else if (result?.status === "requested") {
        setSent(true);
        onRequested?.(result);
      }
      setNotice(requestResultCopy(result));
    } catch (err) {
      setError(err?.friendly || "Couldn't send your request. Please try again.");
    } finally {
      setSending(false);
    }
  };

  if (!city?.id) return null;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-sm font-semibold text-teal-700 dark:text-teal-400 hover:underline"
      >
        My suburb isn't listed
      </button>
    );
  }

  return (
    <section className="space-y-3 rounded-xl border border-gray-200 dark:border-gray-700 p-4" aria-labelledby="suburb-request-title">
      <h2 id="suburb-request-title" className="text-base font-semibold text-gray-900 dark:text-white">
        Find or ask for your suburb in {city.name}
      </h2>
      <PlacesNotice copy={notice} />
      {sent ? null : (
        <>
          <div>
            <label htmlFor="suburb-request-name" className="mb-1 block text-sm font-medium text-text-primary">
              Suburb name
            </label>
            <input
              id="suburb-request-name"
              type="text"
              autoComplete="off"
              maxLength={80}
              placeholder="e.g. Theescombe"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setConfirmed(false);
                setNotice(null);
              }}
              className="input border w-full"
            />
            <p className="mt-1 text-sm text-text-tertiary" aria-live="polite">
              {state.hint}
            </p>
          </div>

          {suggestions.length ? (
            <ul className="space-y-2" aria-label="Suburbs with a similar name">
              {suggestions.map((s) => (
                <li key={s.id} className="rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-2">
                  <p className="font-medium text-gray-900 dark:text-white">
                    {s.name}
                    {s.beingSetUp ? <span className="ml-2 text-sm font-normal text-amber-700 dark:text-amber-400">being set up</span> : null}
                  </p>
                  {s.watches.length ? (
                    <ul className="mt-1 space-y-1">
                      {s.watches.map((w) => (
                        <li key={w.id} className="flex items-center justify-between gap-3 text-sm">
                          <span className="text-text-secondary">{w.name}</span>
                          {w.myStatus === "active" || w.id === currentWatchId ? (
                            <span className="font-medium text-emerald-700 dark:text-emerald-400">Your watch</span>
                          ) : inWatch && onMove ? (
                            <Button type="button" variant="secondary" onClick={() => onMove(w)}>
                              Move here
                            </Button>
                          ) : (
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
                  ) : (
                    <p className="text-sm text-text-tertiary">
                      {s.beingSetUp ? "Someone has asked for this suburb. You can join once it's approved." : "No watch here yet."}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          ) : null}

          {inWatch && !state.exact && !state.tooShort && !waiting ? (
            <p className="rounded-lg bg-sky-50 px-3 py-2 text-sm text-sky-900 dark:bg-sky-900/30 dark:text-sky-100">
              You're in a watch now. If your new suburb isn't listed, please ask support to set it up and move you.
            </p>
          ) : null}

          {!inWatch && state.needsConfirm ? (
            <label className="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
                className="mt-0.5 w-4 h-4"
              />
              <span>It's not one of these. My suburb is "{state.clean}".</span>
            </label>
          ) : null}

          {!inWatch && !state.exact && !state.tooShort ? (
            <label className="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
              <input
                type="checkbox"
                checked={startWatch}
                onChange={(e) => setStartWatch(e.target.checked)}
                className="mt-0.5 w-4 h-4"
              />
              <span>I'd like to help run this suburb's watch (watch admin, after approval).</span>
            </label>
          ) : null}

          {error ? (
            <p className="text-sm text-danger" role="alert">
              {error}
            </p>
          ) : null}

          <div className="flex flex-wrap items-center gap-3">
            {inWatch ? null : (
              <Button type="button" loading={sending} disabled={!state.canSubmit} onClick={() => void handleSubmit()}>
                Ask for this suburb
              </Button>
            )}
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setName("");
                setSuggestions([]);
                setConfirmed(false);
                setNotice(null);
                setError("");
              }}
              className="text-sm font-medium text-text-secondary hover:underline"
            >
              Cancel
            </button>
          </div>
          <p className="text-xs text-text-tertiary">New suburbs are checked by our team before they appear for others.</p>
        </>
      )}
    </section>
  );
}
