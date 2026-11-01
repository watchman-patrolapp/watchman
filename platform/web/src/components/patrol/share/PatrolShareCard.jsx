import { forwardRef } from "react";
import { SHARE_APP_NAME, SHARE_HEADER_TITLE } from "../../../utils/patrolFormat";

/**
 * E1 share card (4:5). Inline styles + inline SVG only so html-to-image
 * captures it identically on web and in the Android WebView.
 * Rendered at 400 x 500 CSS px; exported at pixelRatio 3 (1200 x 1500).
 */
export const SHARE_CARD_WIDTH = 400;
export const SHARE_CARD_HEIGHT = 500;

const FONT = "Inter, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";
const NUM = { fontVariantNumeric: "tabular-nums", fontFeatureSettings: "'tnum' 1" };
const MONO = "'JetBrains Mono', 'DejaVu Sans Mono', ui-monospace, SFMono-Regular, Menlo, monospace";

// react-icons/fa FaCar (same glyph as components/VehicleIcon.jsx), inlined for capture.
const FA_CAR_PATH =
  "M499.99 176h-59.87l-16.64-41.6C406.38 91.63 365.57 64 319.5 64h-127c-46.06 0-86.88 27.63-103.99 70.4L71.87 176H12.01C4.2 176-1.53 183.34.37 190.91l6 24C7.7 220.25 12.5 224 18.01 224h20.07C24.65 235.73 16 252.78 16 272v48c0 16.12 6.16 30.67 16 41.93V416c0 17.67 14.33 32 32 32h32c17.67 0 32-14.33 32-32v-32h256v32c0 17.67 14.33 32 32 32h32c17.67 0 32-14.33 32-32v-54.07c9.84-11.25 16-25.8 16-41.93v-48c0-19.22-8.65-36.27-22.07-48H494c5.51 0 10.31-3.75 11.64-9.09l6-24c1.89-7.57-3.84-14.91-11.65-14.91zm-352.06-17.83c7.29-18.22 24.94-30.17 44.57-30.17h127c19.63 0 37.28 11.95 44.57 30.17L384 208H128l19.93-49.83zM96 319.8c-19.2 0-32-12.76-32-31.9S76.8 256 96 256s48 28.71 48 47.85-28.8 15.95-48 15.95zm320 0c-19.2 0-48 3.19-48-15.95S396.8 256 416 256s32 12.76 32 31.9-12.8 31.9-32 31.9z";

// Decorative dot-code glyph (7 x 7 grid, not a scannable code).
const DOT_CELLS = [
  [0, 0], [1, 0], [2, 0], [3, 0], [5, 0], [6, 0],
  [0, 1], [1, 1], [2, 1], [4, 1], [5, 1], [6, 1],
  [0, 2], [2, 2], [3, 2], [4, 2], [5, 2], [6, 2],
  [1, 3], [2, 3], [6, 3],
  [1, 4], [3, 4], [4, 4], [5, 4], [6, 4],
  [0, 5], [1, 5], [3, 5], [6, 5],
  [0, 6], [1, 6], [3, 6], [4, 6], [5, 6],
];

function palette(kind, theme) {
  const start = kind !== "end";
  const dark = theme === "dark";
  const ac = start ? "#059669" : "#EA580C";
  if (!dark) {
    return {
      ac,
      acSoft: start ? "#D1FAE5" : "#FFEDD5",
      pillText: start ? "#065F46" : "#9A3412",
      bg: start
        ? "linear-gradient(155deg,#0E7A55 0%,#065F46 55%,#04402F 100%)"
        : "linear-gradient(155deg,#F08A3E 0%,#D9622B 55%,#A8431B 100%)",
      fg: "#111827",
      muted: "#6B7280",
      cell: "#F3F4F6",
      card: "#FFFFFF",
      plateBorder: "#1F2937",
      tear: "#E5E7EB",
      durationOn: ac,
      durationOff: ac,
      ref: ac,
    };
  }
  const pillText = start ? "#6EE7B7" : "#FCD34D";
  return {
    ac,
    acSoft: start ? "rgba(16,185,129,.20)" : "rgba(245,158,11,.20)",
    pillText,
    bg: start
      ? "linear-gradient(155deg,#0A6447 0%,#044634 55%,#022A1F 100%)"
      : "linear-gradient(155deg,#D9702A 0%,#B04A1C 55%,#7A2F10 100%)",
    fg: "#F3F4F6",
    muted: "#9CA3AF",
    cell: "#273244",
    card: "#141B2D",
    plateBorder: "#FFD200",
    tear: "#374151",
    durationOn: pillText,
    durationOff: "#FDBA74",
    ref: pillText,
  };
}

function Shield({ size, color, strokeWidth }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round" strokeLinecap="round" aria-hidden="true">
      <path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z" />
      <path d="M9 12l2 2 4-4" />
    </svg>
  );
}

function Label({ children, color }) {
  return <div style={{ fontSize: 10.5, color, fontWeight: 500, letterSpacing: "0.08em", textTransform: "uppercase" }}>{children}</div>;
}

/**
 * Step the font down for long values so typical names fit without ellipsis.
 * Budget is tuned for a half-width box (~150px of text at weight 800).
 */
export function fitFontSize(value, base) {
  const len = String(value ?? "").length;
  if (len <= 11) return base;
  if (len <= 14) return Math.min(base, 18);
  if (len <= 18) return Math.min(base, 16);
  if (len <= 22) return Math.min(base, 15);
  return Math.min(base, 12);
}

function Cell({ label, value, color, size = 20, p, wrap = false }) {
  const valueStyle = wrap
    ? {
        fontSize: fitFontSize(value, size),
        lineHeight: 1.15,
        display: "-webkit-box",
        WebkitLineClamp: 2,
        WebkitBoxOrient: "vertical",
        overflow: "hidden",
        overflowWrap: "anywhere",
        wordBreak: "break-word",
      }
    : { fontSize: size, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" };
  return (
    <div style={{ background: p.cell, borderRadius: 12, padding: "12px 14px", minWidth: 0 }}>
      <Label color={p.muted}>{label}</Label>
      <div style={{ fontWeight: 600, color, marginTop: 3, letterSpacing: "-0.01em", ...NUM, ...valueStyle }}>{value}</div>
    </div>
  );
}

/**
 * @param {{ model: ReturnType<import('../../../utils/patrolFormat').buildShareCardModel> }} props
 */
const PatrolShareCard = forwardRef(function PatrolShareCard({ model, style }, ref) {
  const start = model.kind !== "end";
  const p = palette(model.kind, model.theme);
  const vehicle = model.vehicle;
  // Avoid "… Neighbourhood Watch Watch" when the area name already says Watch.
  const dateMatch = /^(.*\S)\s+(\d{4})$/.exec(model.dateLabel || "");
  const dateMain = dateMatch ? dateMatch[1] : model.dateLabel;
  const dateYear = dateMatch ? dateMatch[2] : "";

  return (
    <div
      ref={ref}
      style={{
        width: SHARE_CARD_WIDTH,
        height: SHARE_CARD_HEIGHT,
        background: p.bg,
        position: "relative",
        overflow: "hidden",
        padding: "0 18px",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        boxSizing: "border-box",
        fontFamily: FONT,
        WebkitFontSmoothing: "antialiased",
        ...style,
      }}
    >
      <div style={{ position: "absolute", right: -80, top: 40, opacity: 0.1 }}>
        <Shield size={360} color="#fff" strokeWidth={1.4} />
      </div>

      <div
        style={{
          position: "relative",
          background: p.card,
          color: p.fg,
          borderRadius: 22,
          border: "1px solid rgba(255,255,255,.06)",
          boxShadow: "0 14px 34px rgba(0,0,0,.28)",
          padding: "16px 18px",
          boxSizing: "border-box",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
            <span style={{ flex: "none", display: "flex" }}>
              <Shield size={30} color={p.ac} strokeWidth={1.8} />
            </span>
            <div style={{ minWidth: 0, lineHeight: 1.15 }}>
              <div style={{ fontSize: 17.5, fontWeight: 650, color: p.fg, letterSpacing: "-0.01em" }}>{model.appName || SHARE_APP_NAME}</div>
              <div style={{ fontSize: 10.5, fontWeight: 500, color: p.muted, letterSpacing: "0.09em", textTransform: "uppercase", marginTop: 3, whiteSpace: "nowrap" }}>{SHARE_HEADER_TITLE}</div>
            </div>
          </div>
          <div style={{ flex: "none", textAlign: "right", lineHeight: 1.2, ...NUM }}>
            <div style={{ fontSize: 13, fontWeight: 500, color: p.fg }}>{dateMain}</div>
            {dateYear ? <div style={{ fontSize: 12, fontWeight: 500, color: p.muted, marginTop: 2 }}>{dateYear}</div> : null}
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 16 }}>
          <div style={{ width: 46, height: 46, borderRadius: "50%", background: p.ac, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 17, fontWeight: 600, letterSpacing: "0.02em", flex: "none" }}>
            {model.initials}
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: model.name.length > 26 ? 15.5 : model.name.length > 20 ? 17 : 19, fontWeight: 600, lineHeight: 1.2, letterSpacing: "-0.015em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{model.name}</div>
            <div style={{ fontSize: 12.5, color: p.muted, fontWeight: 400, marginTop: 1 }}>Patroller</div>
          </div>
        </div>

        <div style={{ marginTop: 15, display: "inline-flex", alignItems: "center", gap: 8, background: p.acSoft, color: p.pillText, padding: "6px 14px 6px 11px", borderRadius: 99, fontSize: 15, fontWeight: 600, letterSpacing: "-0.005em" }}>
          <span style={{ width: 9, height: 9, borderRadius: "50%", background: p.ac, boxShadow: `0 0 0 3px ${p.ac}33`, flex: "none" }} />
          {start ? "Signed on" : "Signed off"}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 9, marginTop: 15 }}>
          <Cell p={p} label="Time on" value={model.timeOn} color={p.fg} />
          <Cell p={p} label="Time off" value={model.timeOff} color={start ? p.muted : p.fg} />
          {start ? (
            <Cell p={p} label="Duration" value={model.duration} color={p.durationOn} size={16.5} />
          ) : (
            <Cell p={p} label="Duration" value={model.duration} color={p.durationOff} />
          )}
          <Cell p={p} label="Area" value={model.area} color={p.fg} size={16.5} wrap />

          {vehicle ? (
            <div style={{ gridColumn: "1 / 3", background: p.cell, borderRadius: 12, padding: "12px 14px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                <span style={{ width: 34, height: 34, borderRadius: 10, background: p.acSoft, display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
                  <svg width="18" height="18" viewBox="0 0 512 512" fill={p.pillText} aria-hidden="true">
                    <path d={FA_CAR_PATH} />
                  </svg>
                </span>
                {vehicle.name ? (
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: vehicle.name.length > 28 ? 12 : 14, fontWeight: 600, lineHeight: 1.25, display: "-webkit-box", WebkitLineClamp: vehicle.name.length > 28 ? 3 : 2, WebkitBoxOrient: "vertical", overflow: "hidden", wordBreak: "break-word" }}>
                      {vehicle.name}
                    </div>
                  </div>
                ) : null}
              </div>
              {vehicle.plate ? (
                <span style={{ background: "#FFD200", color: "#111", border: `2px solid ${p.plateBorder}`, outline: "1.5px solid #111", borderRadius: 6, padding: "3px 8px 3px 4px", display: "flex", alignItems: "center", gap: 6, fontFamily: MONO, fontWeight: 700, fontSize: 13, whiteSpace: "nowrap", flex: "none" }}>
                  <span style={{ background: "#1F2937", color: "#FFD200", fontSize: 9, padding: "2px 3px", borderRadius: 3, fontFamily: FONT }}>ZA</span>
                  {vehicle.plate}
                </span>
              ) : null}
            </div>
          ) : null}
        </div>

        <div style={{ margin: "16px -18px -16px", padding: "12px 18px 13px", borderTop: `1.5px dashed ${p.tear}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <Label color={p.muted}>Ref</Label>
            <div style={{ fontFamily: MONO, fontWeight: 500, fontSize: 16, letterSpacing: "0.08em", marginTop: 2, color: p.ref }}>{model.shareRef || "—"}</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 11.5, color: p.muted, fontWeight: 400, textAlign: "right", lineHeight: 1.35 }}>
            <span>
              Server-stamped
              <br />
              by {model.appName}
            </span>
            <svg width="30" height="30" viewBox="0 0 28 28" aria-hidden="true" style={{ opacity: 0.85 }}>
              {DOT_CELLS.map(([x, y]) => (
                <rect key={`${x}-${y}`} x={x * 4} y={y * 4} width="3.4" height="3.4" rx="0.8" fill={p.fg} />
              ))}
            </svg>
          </div>
        </div>
      </div>
    </div>
  );
});

export default PatrolShareCard;
