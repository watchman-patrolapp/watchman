/**
 * Grid line positions for Recharts <CartesianGrid>.
 *
 * Recharts 3.x default generators call its internal getTicks() without fontSize /
 * letterSpacing, so for axes with a non-numeric `interval` it measures tick text with
 * `{ fontSize: undefined, letterSpacing: undefined }`. Firefox then logs
 * "Error in parsing value for 'font-size: undefined'" (and letter-spacing) per measurement.
 * These generators place grid lines at the axis tick coordinates (same positions Recharts
 * uses for grid lines) without measuring text, so nothing undefined reaches the DOM.
 */
function tickCoordinates(axis) {
  const scale = axis?.scale;
  if (!scale) return [];

  const bandwidth = typeof scale.bandwidth === "function" ? scale.bandwidth() : 0;
  const offsetForBand = axis.realScaleType === "scaleBand" && bandwidth ? bandwidth / 2 : 2;
  const offset = axis.type === "category" && bandwidth ? bandwidth / offsetForBand : 0;

  const values = axis.ticks || axis.niceTicks;
  const entries = values
    ? values.map((entry) => (axis.duplicateDomain ? axis.duplicateDomain.indexOf(entry) : entry))
    : axis.isCategorical && axis.categoricalDomain
      ? axis.categoricalDomain
      : scale.ticks && axis.tickCount != null
        ? scale.ticks(axis.tickCount)
        : [];

  return entries.map((entry) => scale.map(entry) + offset).filter((c) => Number.isFinite(c));
}

function withEdges(values, min, max, syncWithTicks) {
  if (syncWithTicks) return values;
  const out = [...values];
  if (!out.includes(min)) out.push(min);
  if (!out.includes(max)) out.push(max);
  return out;
}

export function horizontalGridCoordinates({ yAxis, offset }, syncWithTicks) {
  return withEdges(tickCoordinates(yAxis), offset.top, offset.top + offset.height, syncWithTicks);
}

export function verticalGridCoordinates({ xAxis, offset }, syncWithTicks) {
  return withEdges(tickCoordinates(xAxis), offset.left, offset.left + offset.width, syncWithTicks);
}
