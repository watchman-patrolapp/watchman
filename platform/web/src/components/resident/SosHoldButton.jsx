import { useCallback, useEffect, useRef, useState } from "react";

const HOLD_MS = 2000;

/**
 * Hold-to-activate SOS control. A tap is ignored; keyboard users can hold Space or Enter.
 */
export default function SosHoldButton({
  onTrigger,
  busy = false,
  disabled = false,
}) {
  const [holding, setHolding] = useState(false);
  const [progress, setProgress] = useState(0);
  const startRef = useRef(0);
  const frameRef = useRef(0);
  const firedRef = useRef(false);

  const stopHold = useCallback((fired) => {
    cancelAnimationFrame(frameRef.current);
    setHolding(false);
    setProgress(fired ? 100 : 0);
    startRef.current = 0;
  }, []);

  const tick = useCallback(() => {
    const elapsed = Date.now() - startRef.current;
    const next = Math.min(100, (elapsed / HOLD_MS) * 100);
    setProgress(next);
    if (elapsed >= HOLD_MS) {
      if (!firedRef.current) {
        firedRef.current = true;
        stopHold(true);
        void onTrigger?.();
      }
      return;
    }
    frameRef.current = requestAnimationFrame(tick);
  }, [onTrigger, stopHold]);

  const beginHold = useCallback(
    (event) => {
      if (disabled || busy || firedRef.current) return;
      if (event?.pointerType === "mouse" && event.button !== 0) return;
      event?.preventDefault?.();
      try {
        event?.currentTarget?.setPointerCapture?.(event.pointerId);
      } catch {
        // Capture is optional (some browsers reject it on non-pointer targets).
      }
      firedRef.current = false;
      startRef.current = Date.now();
      setHolding(true);
      setProgress(0);
      frameRef.current = requestAnimationFrame(tick);
    },
    [busy, disabled, tick]
  );

  const cancelHold = useCallback(() => {
    if (firedRef.current) return;
    stopHold(false);
  }, [stopHold]);

  useEffect(() => () => cancelAnimationFrame(frameRef.current), []);

  useEffect(() => {
    if (!busy) {
      firedRef.current = false;
      setProgress(0);
    }
  }, [busy]);

  const handleKeyDown = (event) => {
    if (event.repeat) return;
    if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      beginHold(event);
    }
  };

  const handleKeyUp = (event) => {
    if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      cancelHold();
    }
  };

  const label = busy ? "SENDING" : holding ? "HOLD…" : "SOS";
  const hint = busy
    ? "Sending your location to patrol…"
    : holding
      ? "Keep holding…"
      : "Press and hold 2s to alert patrol";

  return (
    <div className="flex flex-col items-center">
      <div className="resident-sos-beacon relative flex h-40 w-40 items-center justify-center">
        <span className="resident-sos-ring resident-sos-ring-1" aria-hidden />
        <span className="resident-sos-ring resident-sos-ring-2" aria-hidden />
        <span className="resident-sos-ring resident-sos-ring-3" aria-hidden />
        <button
          type="button"
          disabled={disabled || busy}
          onPointerDown={beginHold}
          onPointerUp={cancelHold}
          onPointerLeave={cancelHold}
          onPointerCancel={cancelHold}
          onContextMenu={(event) => event.preventDefault()}
          onKeyDown={handleKeyDown}
          onKeyUp={handleKeyUp}
          aria-label="Hold two seconds to send SOS"
          aria-describedby="resident-sos-hint"
          className="relative z-[2] flex h-[7.25rem] w-[7.25rem] select-none touch-none flex-col items-center justify-center rounded-full bg-gradient-to-br from-red-500 to-red-700 text-white shadow-[0_0_0_6px_rgba(239,68,68,0.18),0_14px_34px_-10px_rgba(185,28,28,0.55)] transition-transform active:scale-95 disabled:opacity-60"
          style={{
            boxShadow: holding
              ? `0 0 0 6px rgba(239,68,68,0.22), 0 14px 34px -10px rgba(185,28,28,0.55), inset 0 0 0 3px rgba(255,255,255,${0.15 + progress / 400})`
              : undefined,
          }}
        >
          <svg
            className="mb-1 h-7 w-7"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth="2"
            stroke="currentColor"
            aria-hidden
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 9v4m0 4h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"
            />
          </svg>
          <span className="text-base font-bold tracking-wide">{label}</span>
        </button>
      </div>
      <p
        id="resident-sos-hint"
        className="mt-3 max-w-xs text-center text-xs text-gray-500 dark:text-gray-400"
      >
        {hint}
      </p>
    </div>
  );
}
