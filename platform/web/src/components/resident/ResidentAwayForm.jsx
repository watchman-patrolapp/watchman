import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { FaCalendarAlt } from "react-icons/fa";
import { useAuth } from "../../auth/useAuth";
import { isRpcNotFoundError } from "../../utils/isRpcNotFound";
import {
  clearResidentAway,
  formatAwayRange,
  getMyAway,
  isAwayNow,
  setResidentAway,
} from "../../utils/residentAway";
import { watchDayStamp } from "../../utils/watchTime";

export default function ResidentAwayForm() {
  const { user } = useAuth();
  const [row, setRow] = useState(null);
  const [startsOn, setStartsOn] = useState(() => watchDayStamp());
  const [endsOn, setEndsOn] = useState(() => watchDayStamp());
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const { data, error } = await getMyAway(user?.id);
    if (error && !isRpcNotFoundError(error) && !/schema cache|does not exist/i.test(error.message || "")) {
      console.warn("resident away:", error.message);
      return;
    }
    setRow(data || null);
    if (data) {
      setStartsOn(String(data.starts_on).slice(0, 10));
      setEndsOn(String(data.ends_on).slice(0, 10));
      setNote(data.note || "");
    }
  };

  useEffect(() => {
    if (!user?.id) return;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const save = async (event) => {
    event.preventDefault();
    setBusy(true);
    try {
      const { error } = await setResidentAway({ startsOn, endsOn, note });
      if (error) throw error;
      toast.success("Patrol can see you are away.");
      await load();
    } catch (err) {
      toast.error(err.message || "Could not save away dates.");
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    setBusy(true);
    try {
      const { error } = await clearResidentAway();
      if (error) throw error;
      toast.success("Away notice cleared.");
      setRow(null);
      setNote("");
    } catch (err) {
      toast.error(err.message || "Could not clear away notice.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mb-6 rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
      <p className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
        <FaCalendarAlt className="h-4 w-4 text-teal-600" aria-hidden />
        We are away
      </p>
      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
        Patrol can see this while you are gone. Other households cannot.
      </p>
      {row && isAwayNow(row) ? (
        <p className="mt-2 text-sm font-medium text-teal-800 dark:text-teal-200">
          Patrol is looking after your house {formatAwayRange(row)}.
        </p>
      ) : null}
      <form onSubmit={save} className="mt-3 space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <label className="text-xs font-medium text-gray-600 dark:text-gray-400">
            From
            <input
              type="date"
              value={startsOn}
              onChange={(e) => setStartsOn(e.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-900 dark:text-white"
              required
            />
          </label>
          <label className="text-xs font-medium text-gray-600 dark:text-gray-400">
            Until
            <input
              type="date"
              value={endsOn}
              onChange={(e) => setEndsOn(e.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-900 dark:text-white"
              required
            />
          </label>
        </div>
        <label className="block text-xs font-medium text-gray-600 dark:text-gray-400">
          Optional note for patrol
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={200}
            placeholder="Lights on timer, bins on Thursday…"
            className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-900 dark:text-white"
          />
        </label>
        <div className="flex flex-wrap gap-2">
          <button
            type="submit"
            disabled={busy}
            className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-50"
          >
            {busy ? "Saving…" : "Save for patrol"}
          </button>
          {row ? (
            <button
              type="button"
              onClick={clear}
              disabled={busy}
              className="rounded-lg bg-gray-200 px-4 py-2 text-sm font-medium text-gray-800 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-100"
            >
              We are back
            </button>
          ) : null}
        </div>
      </form>
    </div>
  );
}
