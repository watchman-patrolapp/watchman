import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FaWhatsapp, FaTimes, FaCar, FaPhone, FaMapMarkerAlt } from "react-icons/fa";
import toast from "react-hot-toast";
import PatrolShareCard, { SHARE_CARD_HEIGHT, SHARE_CARD_WIDTH } from "./PatrolShareCard";
import {
  DEFAULT_SHARE_PREFS,
  DEFAULT_SHARE_TIME_ZONE,
  SHARE_APP_NAME,
  SHARE_PREFS_KEY,
  buildShareCaption,
  buildShareCardModel,
  parseSharePrefs,
} from "../../../utils/patrolFormat";
import { markPatrolShared, renderShareCardBlob, sharePatrolToWhatsApp } from "../../../utils/sharePatrol";

const PREVIEW_WIDTH = 248;
const PREVIEW_SCALE = PREVIEW_WIDTH / SHARE_CARD_WIDTH;

function readPrefs() {
  try {
    return parseSharePrefs(window.localStorage.getItem(SHARE_PREFS_KEY));
  } catch {
    return { ...DEFAULT_SHARE_PREFS };
  }
}

function Toggle({ icon: Icon, label, hint, checked, onChange, disabled }) {
  return (
    <label className={`flex items-center justify-between gap-3 py-2 ${disabled ? "opacity-50" : ""}`}>
      <span className="flex items-center gap-2.5 min-w-0">
        <Icon className="w-4 h-4 shrink-0 text-gray-500 dark:text-gray-400" aria-hidden />
        <span className="min-w-0">
          <span className="block text-sm font-medium text-gray-900 dark:text-white">{label}</span>
          {hint ? <span className="block text-xs text-gray-500 dark:text-gray-400 truncate">{hint}</span> : null}
        </span>
      </span>
      <input
        type="checkbox"
        role="switch"
        className="h-5 w-9 shrink-0 accent-emerald-600"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  );
}

/**
 * Bottom sheet shown after sign-on / sign-off.
 * props: kind 'start'|'end', patrol (DB row incl. share_ref), organizationName,
 * timeZone, phone, location {lat,lng}|null, onClose(), onShared(sharedAt)
 */
export default function PatrolShareSheet({ kind, patrol, organizationName, timeZone, phone, location, onClose, onShared }) {
  const [prefs, setPrefs] = useState(readPrefs);
  const [busy, setBusy] = useState(false);
  const [blob, setBlob] = useState(null);
  const captureRef = useRef(null);
  const tz = timeZone || DEFAULT_SHARE_TIME_ZONE;

  const model = useMemo(
    () => buildShareCardModel({ kind, patrol, organizationName, timeZone: tz, appName: SHARE_APP_NAME, showVehicle: prefs.vehicle }),
    [kind, patrol, organizationName, tz, prefs.vehicle]
  );
  const caption = useMemo(
    () => buildShareCaption({ kind, patrol, organizationName, timeZone: tz, appName: SHARE_APP_NAME, options: prefs, phone, location }),
    [kind, patrol, organizationName, tz, prefs, phone, location]
  );

  const updatePref = useCallback((key, value) => {
    setPrefs((prev) => {
      const next = { ...prev, [key]: value };
      try {
        window.localStorage.setItem(SHARE_PREFS_KEY, JSON.stringify(next));
      } catch {
        /* private mode */
      }
      return next;
    });
  }, []);

  // Pre-render the PNG so the tap can call navigator.share immediately.
  useEffect(() => {
    let cancelled = false;
    setBlob(null);
    const t = setTimeout(() => {
      renderShareCardBlob(captureRef.current)
        .then((b) => !cancelled && setBlob(b))
        .catch((err) => console.warn("Share card pre-render failed", err));
    }, 50);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [model]);

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose?.();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const handleShare = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const fileName = `${model.shareRef || "patrol"}-${kind === "end" ? "sign-off" : "sign-on"}.png`;
      const res = await sharePatrolToWhatsApp({ node: captureRef.current, blob, caption, fileName });
      if (res.status === "cancelled") return; // AbortError: not shared, keep sheet open
      if (res.status === "error") {
        toast.error("Could not open WhatsApp.");
        return;
      }
      if (model.shareRef) {
        try {
          const sharedAt = await markPatrolShared(model.shareRef, kind);
          onShared?.(sharedAt);
        } catch (err) {
          console.warn("mark_patrol_shared failed", err);
        }
      }
      onClose?.();
    } finally {
      setBusy(false);
    }
  };

  const hasPhone = Boolean(phone);
  const hasLocation = Boolean(location && Number.isFinite(Number(location.lat)));
  const title = kind === "end" ? "Share sign-off" : "Share sign-on";

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center sm:items-center p-0 sm:p-4 bg-black/50"
      role="dialog"
      aria-modal="true"
      aria-labelledby="patrol-share-title"
      onClick={(e) => e.target === e.currentTarget && onClose?.()}
    >
      <div className="w-full max-w-md rounded-t-2xl sm:rounded-2xl bg-white dark:bg-gray-800 shadow-xl border border-gray-200 dark:border-gray-600 max-h-[92vh] flex flex-col">
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-gray-200 dark:border-gray-600">
          <div className="min-w-0">
            <h2 id="patrol-share-title" className="text-lg font-semibold text-gray-900 dark:text-white">{title}</h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 truncate">Post it to your watch WhatsApp group</p>
          </div>
          <button type="button" onClick={onClose} className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700" aria-label="Close">
            <FaTimes className="w-4 h-4" />
          </button>
        </div>

        <div className="px-4 py-3 overflow-y-auto flex-1 min-h-0">
          <div className="flex justify-center">
            <div
              className="rounded-xl overflow-hidden shadow-md"
              style={{ width: PREVIEW_WIDTH, height: SHARE_CARD_HEIGHT * PREVIEW_SCALE }}
              aria-label="Card preview"
            >
              <PatrolShareCard model={model} style={{ transform: `scale(${PREVIEW_SCALE})`, transformOrigin: "top left" }} />
            </div>
          </div>

          <div className="mt-3 divide-y divide-gray-100 dark:divide-gray-700">
            <Toggle icon={FaCar} label="Vehicle" hint="Make, model and plate" checked={prefs.vehicle} onChange={(v) => updatePref("vehicle", v)} />
            <Toggle
              icon={FaPhone}
              label="Phone"
              hint={hasPhone ? "Masked, in the message only" : "No phone on your profile"}
              checked={prefs.phone && hasPhone}
              disabled={!hasPhone}
              onChange={(v) => updatePref("phone", v)}
            />
            <Toggle
              icon={FaMapMarkerAlt}
              label="Location"
              hint={hasLocation ? "Maps link in the message" : "Location not available"}
              checked={prefs.location && hasLocation}
              disabled={!hasLocation}
              onChange={(v) => updatePref("location", v)}
            />
          </div>
        </div>

        <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-600 flex gap-2 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 px-4 py-2.5 rounded-xl text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600"
          >
            Later
          </button>
          <button
            type="button"
            onClick={handleShare}
            disabled={busy}
            className="flex-[2] inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold bg-[#25D366] text-white hover:bg-[#1EBE5A] disabled:opacity-60"
          >
            <FaWhatsapp className="w-5 h-5" aria-hidden />
            {busy ? "Opening…" : "Share to WhatsApp"}
          </button>
        </div>
      </div>

      {/* Full-size capture node, off-screen (not display:none so it lays out). */}
      <div aria-hidden style={{ position: "fixed", left: -10000, top: 0, pointerEvents: "none" }}>
        <PatrolShareCard ref={captureRef} model={model} />
      </div>
    </div>
  );
}
