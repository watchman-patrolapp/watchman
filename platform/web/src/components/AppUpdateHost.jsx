import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../supabase/client";
import toast from "../utils/notify";
import {
  FLEXIBLE_LAST_CHECK_KEY,
  FORCED_CHECK_INTERVAL_MS,
  INSTALL_STATUS_CANCELED,
  INSTALL_STATUS_DOWNLOADED,
  INSTALL_STATUS_FAILED,
  canPerformImmediateUpdate,
  flexibleUpdateOffer,
  forcedUpdateDecision,
  shouldRunCheck,
} from "../utils/appUpdate";
import {
  completeFlexibleUpdate,
  currentAppUpdateMode,
  getInstalledVersionCode,
  getPlayUpdateInfo,
  onAppResume,
  onFlexibleUpdateState,
  openPlayStoreListing,
  performImmediateUpdate,
  startFlexibleUpdate,
} from "../utils/appUpdateNative";

const MODE = currentAppUpdateMode();

function readLastCheck() {
  try {
    return Number(window.localStorage.getItem(FLEXIBLE_LAST_CHECK_KEY)) || 0;
  } catch {
    return 0;
  }
}

function writeLastCheck(ms) {
  try {
    window.localStorage.setItem(FLEXIBLE_LAST_CHECK_KEY, String(ms));
  } catch {
    /* storage full or blocked: the check just runs again next time */
  }
}

async function loadMinVersionConfig() {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return null;
  try {
    const { data, error } = await supabase
      .from("app_config")
      .select("min_supported_version_code, update_message")
      .eq("platform", "android")
      .maybeSingle();
    if (error) return null; // table missing (SQL not run) or offline: fail open
    return data;
  } catch {
    return null;
  }
}

async function updateNow() {
  const info = await getPlayUpdateInfo();
  if (canPerformImmediateUpdate(info)) {
    const code = await performImmediateUpdate();
    if (code === 0) return;
  }
  const opened = await openPlayStoreListing();
  if (!opened) toast.error("Couldn't open the Play Store. Open Google Play and search for Watchman.");
}

function ForcedUpdateScreen({ message }) {
  const [busy, setBusy] = useState(false);
  return (
    <div
      className="fixed inset-0 z-[1000] flex flex-col items-center justify-center overflow-y-auto bg-surface-page px-6 py-10 text-text-primary"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="forced-update-title"
    >
      <div className="w-full max-w-md space-y-5 text-center">
        <h1 id="forced-update-title" className="text-2xl font-bold">
          Please update Watchman to continue
        </h1>
        <p className="text-sm leading-relaxed text-text-secondary">
          {message || "This version of Watchman is no longer supported. Update to the latest version to keep using the app."}
        </p>
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await updateNow();
            } finally {
              setBusy(false);
            }
          }}
          className="min-h-12 w-full rounded-xl bg-teal-600 px-5 py-3 text-base font-semibold text-white transition hover:bg-teal-700 disabled:opacity-60"
        >
          {busy ? "Opening Google Play…" : "Update"}
        </button>
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-left text-sm text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-100">
          <p className="font-semibold">In an emergency, don&apos;t wait for the update.</p>
          <p className="mt-1">
            Call SAPS on{" "}
            <a href="tel:10111" className="font-bold underline">
              10111
            </a>{" "}
            or the emergency line on{" "}
            <a href="tel:112" className="font-bold underline">
              112
            </a>{" "}
            from a cellphone.
          </p>
        </div>
      </div>
    </div>
  );
}

function FlexibleUpdateBanner({ state, onUpdate, onRestart, onDismiss }) {
  const downloaded = state === "restart";
  const downloading = state === "downloading";
  return (
    <div
      className="fixed inset-x-3 z-[900] mx-auto max-w-md rounded-xl border border-subtle bg-surface-card p-3 shadow-lg"
      style={{ top: "calc(env(safe-area-inset-top, 0px) + 0.5rem)" }}
      role="status"
    >
      <div className="flex items-center gap-3">
        <p className="min-w-0 flex-1 text-sm text-text-primary">
          {downloaded
            ? "The update is ready."
            : downloading
              ? "Downloading the update…"
              : "A new version of Watchman is available"}
        </p>
        {downloaded ? (
          <button
            type="button"
            onClick={onRestart}
            className="min-h-10 shrink-0 rounded-lg bg-teal-600 px-3 text-sm font-semibold text-white hover:bg-teal-700"
          >
            Restart to update
          </button>
        ) : downloading ? null : (
          <button
            type="button"
            onClick={onUpdate}
            className="min-h-10 shrink-0 rounded-lg bg-teal-600 px-3 text-sm font-semibold text-white hover:bg-teal-700"
          >
            Update
          </button>
        )}
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="min-h-10 min-w-10 shrink-0 rounded-lg text-lg text-text-secondary hover:bg-black/5 dark:hover:bg-white/10"
        >
          ×
        </button>
      </div>
    </div>
  );
}

function AndroidAppUpdate() {
  const [forced, setForced] = useState(null);
  const [offer, setOffer] = useState("none"); // none | available | downloading | restart
  const [dismissed, setDismissed] = useState(false);
  const lastForcedCheck = useRef(0);
  const running = useRef(false);

  const runChecks = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    try {
      const now = Date.now();
      if (shouldRunCheck(lastForcedCheck.current, now, FORCED_CHECK_INTERVAL_MS)) {
        lastForcedCheck.current = now;
        const [installed, config] = await Promise.all([getInstalledVersionCode(), loadMinVersionConfig()]);
        if (config) setForced(forcedUpdateDecision({ installedVersionCode: installed, config }));
      }
      if (shouldRunCheck(readLastCheck(), now)) {
        writeLastCheck(now);
        const next = flexibleUpdateOffer(await getPlayUpdateInfo());
        setOffer((prev) => (prev === "downloading" || prev === "restart" ? prev : next));
        if (next !== "none") setDismissed(false);
      }
    } finally {
      running.current = false;
    }
  }, []);

  useEffect(() => {
    let stopResume = () => {};
    let stopState = () => {};
    let cancelled = false;
    void runChecks();
    void onAppResume(() => void runChecks()).then((stop) => {
      if (cancelled) stop();
      else stopResume = stop;
    });
    void onFlexibleUpdateState((status) => {
      if (status === INSTALL_STATUS_DOWNLOADED) {
        setOffer("restart");
        setDismissed(false);
      } else if (status === INSTALL_STATUS_FAILED || status === INSTALL_STATUS_CANCELED) {
        setOffer("none");
      }
    }).then((stop) => {
      if (cancelled) stop();
      else stopState = stop;
    });
    return () => {
      cancelled = true;
      stopResume();
      stopState();
    };
  }, [runChecks]);

  if (forced?.blocked) return <ForcedUpdateScreen message={forced.message} />;
  if (offer === "none" || dismissed) return null;

  return (
    <FlexibleUpdateBanner
      state={offer}
      onDismiss={() => setDismissed(true)}
      onUpdate={async () => {
        setOffer("downloading");
        const code = await startFlexibleUpdate();
        if (code !== 0) setOffer("none"); // declined, not allowed or failed: try again tomorrow
      }}
      onRestart={async () => {
        const ok = await completeFlexibleUpdate();
        if (!ok) toast.error("Couldn't restart to update. Close and reopen Watchman to finish.");
      }}
    />
  );
}

/** In-app updates for the installed Android app. Renders nothing on web/PWA and dev builds. */
export default function AppUpdateHost() {
  if (MODE !== "android") return null;
  return <AndroidAppUpdate />;
}
