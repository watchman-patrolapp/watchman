import { isFogCode, isRainCode, isStormCode, toJohannesburgHourKey } from "./areaWeather";

/** Coastal Gqeberha: 28°C is properly hot; berg winds can run higher. */
export const HEAT_C = 28;
export const COLD_NIGHT_C = 10;

function isNightHours(hour) {
  return hour >= 18 || hour <= 5;
}

function isMorningHours(hour) {
  return hour >= 6 && hour <= 11;
}

export function emptyPatrolWeather() {
  return {
    matched: 0,
    rainyNight: 0,
    foggyNight: 0,
    foggyMorning: 0,
    storm: 0,
    hot: 0,
    hotNight: 0,
    coldNight: 0,
    drizzleMorning: 0,
    wetWeekend: 0,
    hottestC: null,
    coldestC: null,
  };
}

export function patrolDateSpan(logs, { maxDays = 400, now = new Date() } = {}) {
  let min = null;
  let max = null;
  for (const log of logs || []) {
    const t = new Date(log?.start_time);
    if (Number.isNaN(t.getTime())) continue;
    if (!min || t < min) min = t;
    if (!max || t > max) max = t;
  }
  if (!min || !max) return null;
  const latest = max > now ? now : max;
  const cap = new Date(latest);
  cap.setDate(cap.getDate() - maxDays);
  const start = min < cap ? cap : min;
  const startKey = toJohannesburgHourKey(start);
  const endKey = toJohannesburgHourKey(latest);
  if (!startKey || !endKey) return null;
  return { start: startKey.slice(0, 10), end: endKey.slice(0, 10) };
}

export function summarizePatrolWeather(patrols, hourlyLookup) {
  const summary = emptyPatrolWeather();
  if (!hourlyLookup?.at) return summary;

  for (const log of patrols || []) {
    const snap = hourlyLookup.at(log?.start_time);
    if (!snap) continue;
    summary.matched += 1;
    const hour = snap.hour;
    const night = isNightHours(hour);
    const morning = isMorningHours(hour);
    const rain = isRainCode(snap.code);
    const fog = isFogCode(snap.code);
    const storm = isStormCode(snap.code);
    const temp = snap.temperatureC;
    const start = new Date(log.start_time);
    const weekend = !Number.isNaN(start.getTime()) && (start.getDay() === 0 || start.getDay() === 6);

    if (night && rain) summary.rainyNight += 1;
    if (night && fog) summary.foggyNight += 1;
    if (morning && fog) summary.foggyMorning += 1;
    if (storm) summary.storm += 1;
    if (temp >= HEAT_C) summary.hot += 1;
    if (night && temp >= HEAT_C - 4) summary.hotNight += 1;
    if (night && temp <= COLD_NIGHT_C) summary.coldNight += 1;
    if (morning && rain) summary.drizzleMorning += 1;
    if (weekend && rain) summary.wetWeekend += 1;
    if (summary.hottestC == null || temp > summary.hottestC) summary.hottestC = Math.round(temp);
    if (summary.coldestC == null || temp < summary.coldestC) summary.coldestC = Math.round(temp);
  }

  return summary;
}

export function describeCurrentPatrolWeather(current) {
  if (!current || !Number.isFinite(Number(current.temperatureC))) {
    return {
      rainyNightNow: false,
      foggyNightNow: false,
      foggyMorningNow: false,
      heatNow: false,
      stormNow: false,
      temperatureC: null,
      label: "",
    };
  }
  const night = current.isDay === false;
  const morning = current.isDay === true && new Date().getHours() < 12;
  const rain = isRainCode(current.code);
  const fog = isFogCode(current.code);
  const temp = Math.round(Number(current.temperatureC));
  return {
    rainyNightNow: night && rain,
    foggyNightNow: night && fog,
    foggyMorningNow: Boolean(morning && fog),
    heatNow: temp >= HEAT_C,
    stormNow: isStormCode(current.code),
    temperatureC: temp,
    label: current.label || "",
  };
}
