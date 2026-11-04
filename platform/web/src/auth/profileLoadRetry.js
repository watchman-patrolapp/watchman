/**
 * Role hydration retries for public.users.
 * Three attempts share one ~10s budget. Hung reads hit the per-attempt deadline
 * instead of the 45s profile timeout, so a failed load cannot spin forever.
 * Fast failures still wait out the backoff, then stop.
 */

export const PROFILE_LOAD_MAX_ATTEMPTS = 3

/** Guards swap the skeleton for the recovery screen once this elapses. */
export const PROFILE_LOAD_SKELETON_CAP_MS = 10_000

/**
 * Worst case (every attempt uses its full timeout) is exactly the skeleton cap:
 *   0 + 2500 + 1000 + 2500 + 1500 + 2500 = 10000
 */
export const PROFILE_LOAD_SCHEDULE = [
  { delayMs: 0, timeoutMs: 2500 },
  { delayMs: 1000, timeoutMs: 2500 },
  { delayMs: 1500, timeoutMs: 2500 },
]

export function profileLoadBudgetMs(schedule = PROFILE_LOAD_SCHEDULE) {
  return schedule.reduce((sum, step) => sum + step.delayMs + step.timeoutMs, 0)
}

/** @param {number} attemptIndex 0-based */
export function profileLoadAttemptPlan(attemptIndex, schedule = PROFILE_LOAD_SCHEDULE) {
  if (!Number.isInteger(attemptIndex) || attemptIndex < 0 || attemptIndex >= schedule.length) {
    return null
  }
  return schedule[attemptIndex]
}

/**
 * After attempt `failedAttemptIndex` fails, wait and try again, or stop.
 * Offline stops immediately so the UI can show the offline recovery screen.
 * @param {number} failedAttemptIndex
 * @param {boolean} online
 */
export function nextProfileLoadStep(failedAttemptIndex, online, schedule = PROFILE_LOAD_SCHEDULE) {
  if (online === false) return { action: 'fail', code: 'offline' }
  const nextIndex = failedAttemptIndex + 1
  const next = profileLoadAttemptPlan(nextIndex, schedule)
  if (!next) return { action: 'fail', code: 'exhausted' }
  return {
    action: 'retry',
    attemptIndex: nextIndex,
    delayMs: next.delayMs,
    timeoutMs: next.timeoutMs,
  }
}

/**
 * What an access guard should render while the app role is unknown.
 * @returns {'ready' | 'pending' | 'offline' | 'error'}
 */
export function profileAccessView({
  hydrated = false,
  bypass = false,
  profileError = null,
  online = true,
  elapsedMs = 0,
  capMs = PROFILE_LOAD_SKELETON_CAP_MS,
} = {}) {
  if (hydrated || bypass) return 'ready'
  const failed = profileError != null || elapsedMs >= capMs
  if (!failed) return 'pending'
  if (online === false || profileError?.code === 'offline') return 'offline'
  return 'error'
}
