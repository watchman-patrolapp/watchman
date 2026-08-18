import { useEffect, useMemo, useState } from "react";
import { FaGasPump, FaInfoCircle, FaPen, FaUndo } from "react-icons/fa";
import {
  estimateManualFuel,
  estimatePatrolFuel,
  fuelDistanceNote,
  formatApproxRand,
  formatLitres,
  PETROL_PRICE_MAX,
  PETROL_PRICE_MIN,
  summarizeGpsMileage,
} from "../../utils/patrolFuelEstimate";

const FUEL_PERIODS = [
  { id: "week", label: "This week" },
  { id: "month", label: "This month" },
  { id: "all", label: "All time" },
];

function fuelPeriodStart(periodId) {
  const now = new Date();
  if (periodId === "week") {
    const d = new Date(now);
    const day = d.getDay();
    d.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
    d.setHours(0, 0, 0, 0);
    return d;
  }
  if (periodId === "month") {
    return new Date(now.getFullYear(), now.getMonth(), 1);
  }
  return null;
}

function manualStorageKey(userId) {
  return `watchman_fuel_manual_v1:${userId || "local"}`;
}

function loadManual(userId) {
  try {
    const raw = localStorage.getItem(manualStorageKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const km = Number(parsed.km);
    const lPer100 = Number(parsed.lPer100);
    const price = Number(parsed.price);
    if (![km, lPer100, price].every((n) => Number.isFinite(n))) return null;
    return { km, lPer100, price, enabled: Boolean(parsed.enabled) };
  } catch {
    return null;
  }
}

function saveManual(userId, values) {
  try {
    localStorage.setItem(manualStorageKey(userId), JSON.stringify(values));
  } catch {
    /* ignore quota / private mode */
  }
}

function VehicleLine({ estimate }) {
  if (estimate.kind === "none") {
    return (
      <p className="text-sm text-stone-600 dark:text-stone-300">
        {estimate.displayName} — no petrol on this watch.
      </p>
    );
  }
  if (estimate.kind === "unsupported") {
    return (
      <p className="text-sm text-stone-600 dark:text-stone-300">
        Boat fuel is not estimated here.
      </p>
    );
  }
  return (
    <div>
      <p className="font-medium text-stone-900 dark:text-white truncate">
        {estimate.displayName}
      </p>
      <p className="text-sm text-stone-500 dark:text-stone-400">
        {estimate.profile.label}
        {" · "}
        ~{estimate.profile.lPer100Patrol} L/100 km on patrol
      </p>
    </div>
  );
}

function NumberField({ id, label, suffix, value, onChange, min, max, step }) {
  return (
    <label htmlFor={id} className="block min-w-0">
      <span className="text-xs font-medium text-stone-700 dark:text-stone-300">{label}</span>
      <div className="mt-1 flex items-center gap-2">
        <input
          id={id}
          type="number"
          inputMode="decimal"
          min={min}
          max={max}
          step={step}
          value={Number.isFinite(value) ? value : ""}
          onChange={(event) => onChange(event.target.value === "" ? "" : Number(event.target.value))}
          className="w-full rounded-lg border border-amber-200 dark:border-amber-900/50 bg-white dark:bg-stone-900 px-3 py-2 text-sm tabular-nums text-stone-900 dark:text-white"
        />
        <span className="shrink-0 text-xs text-stone-500 dark:text-stone-400">{suffix}</span>
      </div>
    </label>
  );
}

export default function PatrolFuelCard({
  vehicle,
  stats,
  logs = [],
  routeRows = [],
  locationPoints = [],
  priceZarPerLitre,
  onPriceChange,
  onSaveArea,
  canSaveArea = false,
  saving = false,
  isSelf = true,
  name,
  userId = null,
}) {
  const [period, setPeriod] = useState("all");
  const [mode, setMode] = useState("auto");
  const [manualKm, setManualKm] = useState("");
  const [manualLPer100, setManualLPer100] = useState("");
  const [manualPrice, setManualPrice] = useState("");
  const since = useMemo(() => fuelPeriodStart(period), [period]);
  const when = FUEL_PERIODS.find((p) => p.id === period)?.label || "All time";

  const mileage = useMemo(
    () => summarizeGpsMileage(logs, routeRows, since, locationPoints),
    [logs, routeRows, since, locationPoints]
  );

  const estimate = estimatePatrolFuel({
    vehicleType: vehicle?.vehicleType,
    makeModel: vehicle?.makeModel,
    carType: vehicle?.carType,
    gpsKm: mileage.km,
    totalMinutes: mileage.minutes,
    totalPatrols: mileage.patrols,
    routeCount: mileage.tracks,
    priceZarPerLitre,
  });

  useEffect(() => {
    const saved = loadManual(userId);
    if (!saved) return;
    setManualKm(saved.km);
    setManualLPer100(saved.lPer100);
    setManualPrice(saved.price);
    if (isSelf && saved.enabled) setMode("manual");
  }, [userId, isSelf]);

  useEffect(() => {
    if (!isSelf || !userId || mode !== "manual") return;
    saveManual(userId, {
      enabled: true,
      km: Number(manualKm) || 0,
      lPer100: Number(manualLPer100) || 0,
      price: Number(manualPrice) || 0,
    });
  }, [isSelf, userId, mode, manualKm, manualLPer100, manualPrice]);

  const hasEverPatrolled = (stats?.totalPatrols || 0) > 0 || (logs?.length || 0) > 0;
  if (!hasEverPatrolled && !isSelf) return null;

  const who = isSelf ? "Your petrol on the watch" : `${name ? `${name}'s` : "Their"} petrol on the watch`;
  const note = fuelDistanceNote(estimate, when);
  const priceLabel = `R${Number(priceZarPerLitre).toFixed(1)}/L`;
  const autoBurn = estimate.profile?.lPer100Patrol || 8.3;

  const enterManual = () => {
    setManualKm((prev) => (prev === "" || prev == null ? (mileage.km > 0 ? Math.round(mileage.km * 10) / 10 : 0) : prev));
    setManualLPer100((prev) => (prev === "" || prev == null ? autoBurn : prev));
    setManualPrice((prev) => (prev === "" || prev == null ? Number(priceZarPerLitre) || 22.5 : prev));
    setMode("manual");
  };

  const fillFromGps = () => {
    setManualKm(mileage.km > 0 ? Math.round(mileage.km * 10) / 10 : 0);
    setManualLPer100(autoBurn);
    setManualPrice(Number(priceZarPerLitre) || 22.5);
  };

  const backToAuto = () => {
    setMode("auto");
    if (userId) {
      const saved = loadManual(userId) || {};
      saveManual(userId, {
        enabled: false,
        km: Number(manualKm) || saved.km || 0,
        lPer100: Number(manualLPer100) || saved.lPer100 || 0,
        price: Number(manualPrice) || saved.price || 0,
      });
    }
  };

  const manual = estimateManualFuel({
    km: manualKm,
    lPer100: manualLPer100,
    priceZarPerLitre: manualPrice,
  });

  return (
    <section className="relative overflow-hidden rounded-2xl border border-amber-200/70 dark:border-amber-900/50 bg-gradient-to-br from-stone-50 via-amber-50/90 to-orange-50 dark:from-stone-900 dark:via-amber-950/30 dark:to-stone-950 shadow-sm">
      <div className="pointer-events-none absolute -right-10 -top-16 h-44 w-44 rounded-full bg-amber-400/10 blur-2xl" />
      <div className="relative p-6 sm:p-7">
        <div className="flex flex-col gap-4 mb-5 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-amber-800/80 dark:text-amber-300/90">
              Fuel calculator
            </p>
            <h3 className="mt-1 text-lg font-semibold text-stone-900 dark:text-white flex items-center gap-2">
              <FaGasPump className="text-amber-600 dark:text-amber-400" />
              {who}
            </h3>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {isSelf && (
              mode === "manual" ? (
                <button
                  type="button"
                  onClick={backToAuto}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-stone-700 dark:text-stone-200 bg-white/80 dark:bg-stone-900/50 border border-amber-100 dark:border-amber-900/40"
                >
                  <FaUndo className="w-3 h-3" />
                  Use GPS estimate
                </button>
              ) : (
                <button
                  type="button"
                  onClick={enterManual}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-amber-900 dark:text-amber-200 bg-white/80 dark:bg-stone-900/50 border border-amber-200 dark:border-amber-900/40"
                >
                  <FaPen className="w-3 h-3" />
                  Edit manually
                </button>
              )
            )}
            {mode === "auto" && (
              <div
                className="flex shrink-0 rounded-xl bg-white/80 dark:bg-stone-900/50 border border-amber-100 dark:border-amber-900/40 p-1"
                role="tablist"
                aria-label="Fuel calculator period"
              >
                {FUEL_PERIODS.map((p) => {
                  const active = period === p.id;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      onClick={() => setPeriod(p.id)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                        active
                          ? "bg-amber-600 text-white shadow-sm"
                          : "text-stone-600 dark:text-stone-300 hover:text-stone-900 dark:hover:text-white"
                      }`}
                    >
                      {p.label}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {mode === "manual" ? (
          <div className="mb-5">
            <p className="text-xs uppercase tracking-wide text-stone-500 dark:text-stone-400">
              Your figures
            </p>
            <p className="mt-1 text-4xl sm:text-5xl font-semibold tracking-tight text-stone-900 dark:text-white tabular-nums">
              R{Math.round(manual.rand).toLocaleString("en-ZA")}
            </p>
            <p className="mt-1 text-sm text-stone-600 dark:text-stone-300">
              {formatLitres(manual.litres).replace(/^~/, "")} · {manual.km.toLocaleString("en-ZA")} km
              {" · "}
              {manual.lPer100 || 0} L/100 km
              {" · "}
              R{Number(manual.priceZarPerLitre).toFixed(1)}/L
            </p>

            <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
              <NumberField
                id="fuel-manual-km"
                label="Distance"
                suffix="km"
                value={manualKm}
                onChange={setManualKm}
                min={0}
                max={50000}
                step={0.1}
              />
              <NumberField
                id="fuel-manual-burn"
                label="Fuel consumption"
                suffix="L/100 km"
                value={manualLPer100}
                onChange={setManualLPer100}
                min={1}
                max={30}
                step={0.1}
              />
              <NumberField
                id="fuel-manual-price"
                label="Petrol price"
                suffix="R/L"
                value={manualPrice}
                onChange={setManualPrice}
                min={10}
                max={40}
                step={0.1}
              />
            </div>
            <button
              type="button"
              onClick={fillFromGps}
              className="mt-3 text-xs font-semibold text-amber-800 dark:text-amber-300 hover:underline"
            >
              Prefill from GPS {when.toLowerCase()} (~{Math.round(mileage.km).toLocaleString("en-ZA")} km, ~{autoBurn} L/100 km)
            </button>
          </div>
        ) : estimate.kind !== "fuel" ? (
          <VehicleLine estimate={estimate} />
        ) : mileage.patrols === 0 ? (
          <p className="text-sm text-stone-600 dark:text-stone-300">
            No patrols {when.toLowerCase() === "all time" ? "yet" : when.toLowerCase()} — estimated petrol is R0 for this window.
            {isSelf ? " Use Edit manually to type your own kilometres." : ""}
          </p>
        ) : estimate.kmSource !== "gps" ? (
          <div className="mb-5">
            <VehicleLine estimate={estimate} />
            <p className="mt-3 text-sm text-stone-600 dark:text-stone-300 leading-relaxed">
              No GPS track {when.toLowerCase() === "all time" ? "yet" : `for ${when.toLowerCase()}`}.
              Petrol is only estimated from Patrol routes GPS — we don’t guess kilometres from time.
              {isSelf ? " Edit manually if you want to type distance, burn, and price." : ""}
            </p>
          </div>
        ) : (
          <>
            <div className="mb-5">
              <p className="text-xs uppercase tracking-wide text-stone-500 dark:text-stone-400">
                Estimated petrol
              </p>
              <p className="mt-1 text-4xl sm:text-5xl font-semibold tracking-tight text-stone-900 dark:text-white tabular-nums">
                {formatApproxRand(estimate.rand)}
              </p>
              <p className="mt-1 text-sm text-stone-600 dark:text-stone-300">
                about {formatLitres(estimate.litres).replace(/^~/, "")} at {priceLabel}
              </p>
              <p className="mt-2 text-sm font-medium text-stone-800 dark:text-stone-200">
                {estimate.km < 10
                  ? `${estimate.km.toFixed(1)} km GPS around the neighbourhood`
                  : `${Math.round(estimate.km).toLocaleString("en-ZA")} km GPS around the neighbourhood`}
              </p>
              <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">
                {mileage.tracks} GPS track{mileage.tracks === 1 ? "" : "s"} · {mileage.patrols} patrol{mileage.patrols === 1 ? "" : "s"} {when.toLowerCase()}
              </p>
            </div>

            <div className="mb-5">
              <VehicleLine estimate={estimate} />
              {note && (
                <p className="mt-2 text-xs text-stone-500 dark:text-stone-400 leading-relaxed">
                  {note}
                </p>
              )}
              <p className="mt-2 inline-flex items-center rounded-full bg-teal-50 dark:bg-teal-950/40 border border-teal-200/70 dark:border-teal-800 px-2.5 py-1 text-[11px] font-medium text-teal-800 dark:text-teal-300">
                Derived from GPS data
              </p>
            </div>
          </>
        )}

        {mode === "auto" && typeof onPriceChange === "function" && (
          <div className="rounded-xl bg-white/80 dark:bg-stone-900/50 border border-amber-100 dark:border-amber-900/40 p-4">
            <div className="flex items-center justify-between gap-3 mb-2">
              <label htmlFor="petrol-price-bar" className="text-sm font-medium text-stone-800 dark:text-stone-200">
                Petrol price
              </label>
              <p className="text-sm font-semibold tabular-nums text-amber-800 dark:text-amber-300">
                R{Number(priceZarPerLitre).toFixed(1)} / L
              </p>
            </div>
            <input
              id="petrol-price-bar"
              type="range"
              min={PETROL_PRICE_MIN}
              max={PETROL_PRICE_MAX}
              step={0.1}
              value={priceZarPerLitre}
              onChange={(event) => onPriceChange(Number(event.target.value))}
              className="w-full accent-amber-600 cursor-pointer"
              aria-valuemin={PETROL_PRICE_MIN}
              aria-valuemax={PETROL_PRICE_MAX}
              aria-valuenow={priceZarPerLitre}
              aria-label="Petrol price in rand per litre"
            />
            <div className="mt-1 flex justify-between text-[11px] text-stone-400">
              <span>R{PETROL_PRICE_MIN}</span>
              <span>Slide to today’s pump price</span>
              <span>R{PETROL_PRICE_MAX}</span>
            </div>
            {canSaveArea && (
              <button
                type="button"
                onClick={onSaveArea}
                disabled={saving}
                className="mt-3 text-xs font-semibold text-amber-800 dark:text-amber-300 hover:underline disabled:opacity-60"
              >
                {saving ? "Saving…" : "Save this price for the neighbourhood"}
              </button>
            )}
          </div>
        )}

        <p className="mt-4 flex items-start gap-2 text-xs leading-relaxed text-stone-500 dark:text-stone-400">
          <FaInfoCircle className="mt-0.5 shrink-0 text-amber-600/80" aria-hidden />
          {mode === "manual" ? (
            <>
              Manual mode uses only the three numbers you type: kilometres × litres per 100 km × rand
              per litre. It is not saved to the neighbourhood — only on this device.
            </>
          ) : (
            <>
              Auto mode reads the car from signup or Vehicles (make and model). A keyword list picks a
              typical class — Baleno is a small hatch, Hilux a bakkie — then applies a patrol burn.
              An unknown car uses an average passenger-car figure. GPS kilometres × that burn × the
              pump price. Not an invoice. Edit manually to type your own distance, consumption, and price.
            </>
          )}
        </p>
      </div>
    </section>
  );
}
