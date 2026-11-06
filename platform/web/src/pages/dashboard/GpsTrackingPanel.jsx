import { Capacitor } from '@capacitor/core';
import { FaMapMarkerAlt, FaRoad, FaRoute } from 'react-icons/fa';

export default function GpsTrackingPanel({ isTracking, totalDistance, routePoints }) {
  const routeHint = Capacitor.getPlatform() === 'android'
    ? 'Recorded only during this signed-on patrol, including with the screen off.'
    : 'Recorded only while this patrol is signed on and the page is open.';
  return (
    <div className="lg:col-span-5 mb-0 overflow-hidden rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-card min-h-0 flex flex-col">
      <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-4 sm:px-6 sm:py-5 bg-gradient-to-r from-slate-50 via-teal-50/60 to-teal-50/80 dark:from-gray-800 dark:via-teal-950/25 dark:to-teal-950/35 border-b border-gray-200/90 dark:border-gray-700/90">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-teal-100 text-teal-700 shadow-sm dark:bg-teal-900/50 dark:text-teal-200">
            <FaMapMarkerAlt className="w-5 h-5" aria-hidden />
          </div>
          <div className="min-w-0">
            <h3 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-white tracking-tight">
              GPS tracking
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 hidden sm:block">
              {routeHint}
            </p>
          </div>
        </div>
        <div
          className={`inline-flex items-center gap-2 rounded-full px-3.5 py-2 text-sm font-semibold tabular-nums shadow-sm border ${
            isTracking
              ? 'bg-green-100 text-green-900 border-green-200/80 dark:bg-green-900/35 dark:text-green-100 dark:border-green-700/50'
              : 'bg-gray-100 text-gray-700 border-gray-200 dark:bg-gray-700/80 dark:text-gray-200 dark:border-gray-600'
          }`}
          role="status"
          aria-live="polite"
        >
          <span
            className={`h-2 w-2 shrink-0 rounded-full motion-safe:transition-colors ${
              isTracking ? 'bg-green-500 motion-safe:animate-pulse' : 'bg-gray-400 dark:bg-gray-500'
            }`}
            aria-hidden
          />
          {isTracking ? 'Live · Active' : 'Inactive'}
        </div>
      </div>

      {(totalDistance > 0 || routePoints.length > 0) && (
        <div className="px-5 py-4 sm:px-6 flex flex-wrap gap-3 bg-gray-50/70 dark:bg-gray-900/30">
          {totalDistance > 0 && (
            <div className="flex flex-1 min-w-[10rem] items-center gap-3 rounded-xl border border-gray-200/80 dark:border-gray-600/80 bg-white dark:bg-gray-800/80 px-4 py-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300">
                <FaRoad className="w-4 h-4" aria-hidden />
              </div>
              <div>
                <p className="text-[10px] font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                  Distance
                </p>
                <p className="text-sm font-semibold text-gray-900 dark:text-white">
                  {totalDistance.toFixed(2)} km
                </p>
              </div>
            </div>
          )}
          {routePoints.length > 0 && (
            <div className="flex flex-1 min-w-[10rem] items-center gap-3 rounded-xl border border-gray-200/80 dark:border-gray-600/80 bg-white dark:bg-gray-800/80 px-4 py-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
                <FaRoute className="w-4 h-4" aria-hidden />
              </div>
              <div>
                <p className="text-[10px] font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                  Route points
                </p>
                <p className="text-sm font-semibold text-gray-900 dark:text-white">
                  {routePoints.length}
                </p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
