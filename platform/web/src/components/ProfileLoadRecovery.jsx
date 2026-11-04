/**
 * Shown when public.users never hydrates. Matches the full-page error cards
 * used by ErrorBoundary (gray canvas, white rounded card, teal primary).
 */
export default function ProfileLoadRecovery({ variant = "error", onRetry, onSignOut }) {
  const offline = variant === "offline";
  const title = offline ? "You are offline" : "We couldn't check your access";
  const body = offline
    ? "Reconnect to load your profile. We'll try again when you're back online."
    : "Your session is still valid, but your profile didn't load. Try again, or sign out and sign back in.";

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gray-50 px-6 py-12 dark:bg-gray-900">
      <div
        className="w-full max-w-md rounded-2xl border border-gray-100 bg-white p-8 text-center shadow dark:border-gray-700 dark:bg-gray-800"
        role="alert"
      >
        <h1 className="mb-2 text-xl font-bold text-gray-900 dark:text-white">{title}</h1>
        <p className="mb-6 text-sm text-gray-500 dark:text-gray-400">{body}</p>
        <div className="flex flex-wrap justify-center gap-3">
          <button
            type="button"
            onClick={onRetry}
            className="rounded-xl bg-teal-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-teal-700"
          >
            Try again
          </button>
          <button
            type="button"
            onClick={onSignOut}
            className="rounded-xl bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
          >
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
