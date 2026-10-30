import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { FaBell, FaLock } from "react-icons/fa";
import { supabase } from "../../supabase/client";
import { isRpcNotFoundError } from "../../utils/isRpcNotFound";
import { NOTIFICATION_KINDS, isMandatoryNotificationKind } from "../../utils/notificationKinds";

const DEFAULT_PREF = { push_enabled: true, in_app_enabled: true, quiet_hours_start: null, quiet_hours_end: null };

function isMissingTableError(error) {
  if (!error) return false;
  if (isRpcNotFoundError(error)) return true;
  const msg = String(error.message || "").toLowerCase();
  return (
    error.code === "42P01" ||
    error.code === "PGRST205" ||
    (msg.includes("user_notification_prefs") && (msg.includes("does not exist") || msg.includes("could not find")))
  );
}

function toTimeInput(value) {
  return value ? String(value).slice(0, 5) : "";
}

function Toggle({ checked, disabled, onChange, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 rounded-full transition-colors ${
        checked ? "bg-teal-600" : "bg-gray-300 dark:bg-gray-600"
      } ${disabled ? "opacity-60 cursor-not-allowed" : ""}`}
    >
      <span
        className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform mt-0.5 ${
          checked ? "translate-x-5" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}

export default function NotificationPrefs({ user }) {
  const userId = user?.id || null;
  const [prefs, setPrefs] = useState({});
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const [savingKind, setSavingKind] = useState("");
  const [quietStart, setQuietStart] = useState("");
  const [quietEnd, setQuietEnd] = useState("");
  const [savingQuiet, setSavingQuiet] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!userId) return;
      setLoading(true);
      const { data, error } = await supabase
        .from("user_notification_prefs")
        .select("kind, push_enabled, in_app_enabled, quiet_hours_start, quiet_hours_end")
        .eq("user_id", userId);
      if (cancelled) return;
      if (error) {
        if (isMissingTableError(error)) setUnavailable(true);
        else console.warn("notification prefs:", error.message);
        setLoading(false);
        return;
      }
      const map = {};
      for (const row of data || []) map[row.kind] = row;
      setPrefs(map);
      const withQuiet = (data || []).find((row) => row.quiet_hours_start && row.quiet_hours_end);
      setQuietStart(toTimeInput(withQuiet?.quiet_hours_start));
      setQuietEnd(toTimeInput(withQuiet?.quiet_hours_end));
      setLoading(false);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const mutableKinds = useMemo(
    () => NOTIFICATION_KINDS.filter((row) => !isMandatoryNotificationKind(row.kind)).map((row) => row.kind),
    []
  );

  async function savePref(kind, patch) {
    if (!userId || isMandatoryNotificationKind(kind)) return;
    const current = { ...DEFAULT_PREF, ...(prefs[kind] || {}) };
    const next = {
      user_id: userId,
      kind,
      push_enabled: patch.push_enabled ?? current.push_enabled,
      in_app_enabled: patch.in_app_enabled ?? current.in_app_enabled,
      quiet_hours_start: current.quiet_hours_start || null,
      quiet_hours_end: current.quiet_hours_end || null,
      updated_at: new Date().toISOString(),
    };
    setSavingKind(kind);
    const { error } = await supabase.from("user_notification_prefs").upsert(next, { onConflict: "user_id,kind" });
    setSavingKind("");
    if (error) {
      if (isMissingTableError(error)) {
        setUnavailable(true);
        return;
      }
      toast.error(error.message || "Could not save notification setting");
      return;
    }
    setPrefs((prev) => ({ ...prev, [kind]: next }));
  }

  async function saveQuietHours() {
    if (!userId) return;
    if ((quietStart && !quietEnd) || (!quietStart && quietEnd)) {
      toast.error("Set both a start and end time, or clear both.");
      return;
    }
    setSavingQuiet(true);
    const rows = mutableKinds.map((kind) => {
      const current = { ...DEFAULT_PREF, ...(prefs[kind] || {}) };
      return {
        user_id: userId,
        kind,
        push_enabled: current.push_enabled,
        in_app_enabled: current.in_app_enabled,
        quiet_hours_start: quietStart || null,
        quiet_hours_end: quietEnd || null,
        updated_at: new Date().toISOString(),
      };
    });
    const { error } = await supabase.from("user_notification_prefs").upsert(rows, { onConflict: "user_id,kind" });
    setSavingQuiet(false);
    if (error) {
      if (isMissingTableError(error)) {
        setUnavailable(true);
        return;
      }
      toast.error(error.message || "Could not save quiet hours");
      return;
    }
    setPrefs((prev) => {
      const next = { ...prev };
      for (const row of rows) next[row.kind] = row;
      return next;
    });
    toast.success(quietStart ? "Quiet hours saved" : "Quiet hours cleared");
  }

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
      <div className="flex items-center gap-2">
        <FaBell className="text-teal-600 dark:text-teal-400" aria-hidden />
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Notifications</h2>
      </div>
      <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
        Choose which alerts reach your phone (push) and your bell (in-app). Everything is on by default.
      </p>

      {unavailable ? (
        <p className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-200">
          Notification settings aren&apos;t available yet. Run the notification_prefs SQL in Supabase first.
        </p>
      ) : loading ? (
        <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">Loading...</p>
      ) : (
        <>
          <div className="mt-3 grid grid-cols-[1fr_auto_auto] items-center gap-x-4 gap-y-3">
            <span className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Type</span>
            <span className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Push</span>
            <span className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">In-app</span>
            {NOTIFICATION_KINDS.map(({ kind, label, description }) => {
              const locked = isMandatoryNotificationKind(kind);
              const pref = { ...DEFAULT_PREF, ...(prefs[kind] || {}) };
              const busy = savingKind === kind;
              return (
                <div key={kind} className="contents">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 text-sm font-medium dark:text-white">
                      {locked ? <FaLock className="text-gray-400 shrink-0" aria-hidden /> : null}
                      <span>{label}</span>
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {locked ? "Safety alerts can't be turned off." : description}
                    </p>
                  </div>
                  <Toggle
                    label={`${label} push`}
                    checked={locked ? true : pref.push_enabled}
                    disabled={locked || busy}
                    onChange={(value) => void savePref(kind, { push_enabled: value })}
                  />
                  <Toggle
                    label={`${label} in-app`}
                    checked={locked ? true : pref.in_app_enabled}
                    disabled={locked || busy}
                    onChange={(value) => void savePref(kind, { in_app_enabled: value })}
                  />
                </div>
              );
            })}
          </div>

          <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-600 dark:bg-gray-900/40">
            <p className="text-sm font-medium dark:text-white">Quiet hours (SAST)</p>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              No push between these times. In-app notices still arrive, and SOS / safety alerts always come through.
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <input
                type="time"
                value={quietStart}
                onChange={(e) => setQuietStart(e.target.value)}
                className="rounded border px-2 py-1 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-white"
                aria-label="Quiet hours start"
              />
              <span className="text-sm text-gray-500 dark:text-gray-400">to</span>
              <input
                type="time"
                value={quietEnd}
                onChange={(e) => setQuietEnd(e.target.value)}
                className="rounded border px-2 py-1 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-white"
                aria-label="Quiet hours end"
              />
              <button
                type="button"
                disabled={savingQuiet}
                onClick={() => void saveQuietHours()}
                className="rounded bg-teal-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-60"
              >
                {savingQuiet ? "Saving..." : "Save"}
              </button>
              {quietStart || quietEnd ? (
                <button
                  type="button"
                  onClick={() => {
                    setQuietStart("");
                    setQuietEnd("");
                  }}
                  className="text-sm text-gray-600 underline dark:text-gray-300"
                >
                  Clear
                </button>
              ) : null}
            </div>
          </div>
        </>
      )}
    </section>
  );
}
