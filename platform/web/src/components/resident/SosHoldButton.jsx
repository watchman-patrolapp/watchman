import { useCallback, useEffect, useRef, useState } from "react";

/** Hold duration shared with the native SosHoldActivity. Release cancels; nothing is sent early. */
export const HOLD_MS = 10_000;
const HOLD_SECONDS = HOLD_MS / 1000;

/**
 * Hold-to-activate SOS control. A tap is ignored; the user must hold for the full 10 seconds.
 * Keyboard users hold Space or Enter. There is no separate confirm window.
 */
export default function SosHoldButton({ onTrigger, busy = false, disabled = false }) {
  const [holding, setHolding] = useState(false);
  const [progress, setProgress] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState(HOLD_SECONDS);
  const startRef = useRef(0);
  const frameRef = useRef(0);
  const firedRef = useRef(false);
  const tickRef = useRef(() => {});

  const stopHold = useCallback((fired) => {
    cancelAnimationFrame(frameRef.current);
    setHolding(false);
    setProgress(fired ? 100 : 0);
    setSecondsLeft(HOLD_SECONDS);
    startRef.current = 0;
  }, []);

  useEffect(() => {
    tickRef.current = () => {
      const elapsed = Date.now() - startRef.current;
      const next = Math.min(100, (elapsed / HOLD_MS) * 100);
      setProgress(next);
      const left = Math.max(1, Math.ceil(HOLD_SECONDS * (1 - elapsed / HOLD_MS)));
      setSecondsLeft(left);
      if (elapsed >= HOLD_MS) {
        if (!firedRef.current) {
          firedRef.current = true;
          stopHold(true);
          void onTrigger?.();
        }
        return;
      }
      frameRef.current = requestAnimationFrame(() => {
        tickRef.current();
      });
    };
  }, [onTrigger, stopHold]);

  const beginHold = useCallback(
    (event) => {
      if (disabled || busy) return;
      if (firedRef.current) return;
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
      setSecondsLeft(HOLD_SECONDS);
      frameRef.current = requestAnimationFrame(() => {
        tickRef.current();
      });
    },
    [busy, disabled]
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
      setSecondsLeft(HOLD_SECONDS);
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

  const circumference = 2 * Math.PI * 54;
  const dashOffset = circumference * (1 - progress / 100);
  const label = busy ? "SENDING" : holding ? String(secondsLeft) : "SOS";
  const hint = busy
    ? "Sending your location to patrol…"
    : holding
      ? `Keep holding… ${secondsLeft}`
      : "Press and hold 10 seconds to alert patrol";

  return (
    <div className="flex flex-col items-center">
      <div className="resident-sos-beacon relative flex h-44 w-44 items-center justify-center">
        <span className="resident-sos-ring resident-sos-ring-1" aria-hidden />
        <span className="resident-sos-ring resident-sos-ring-2" aria-hidden />
        <span className="resident-sos-ring resident-sos-ring-3" aria-hidden />
        <svg
          className="pointer-events-none absolute inset-0 z-[1] h-full w-full -rotate-90"
          viewBox="0 0 128 128"
          aria-hidden
        >
          <circle
            cx="64"
            cy="64"
            r="54"
            fill="none"
            stroke="rgba(248,113,113,0.22)"
            strokeWidth="6"
          />
          <circle
            cx="64"
            cy="64"
            r="54"
            fill="none"
            stroke={holding || busy ? "#f87171" : "transparent"}
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
            style={{ transition: holding ? "none" : "stroke-dashoffset 160ms ease-out" }}
          />
        </svg>
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
          aria-label="Hold ten seconds to send SOS"
          aria-valuemin={0}
          aria-valuemax={HOLD_SECONDS}
          aria-valuenow={holding ? HOLD_SECONDS - secondsLeft : 0}
          aria-describedby="resident-sos-hint"
          className="relative z-[2] flex h-[7.25rem] w-[7.25rem] select-none touch-none flex-col items-center justify-center rounded-full bg-gradient-to-br from-red-500 to-red-700 text-white shadow-[0_0_0_6px_rgba(239,68,68,0.18),0_14px_34px_-10px_rgba(185,28,28,0.55)] motion-safe:transition-transform motion-safe:active:scale-95 disabled:opacity-60"
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
        aria-live="polite"
        className="mt-3 max-w-xs text-center text-xs text-gray-500 dark:text-gray-400"
      >
        {hint}
      </p>
    </div>
  );
}
