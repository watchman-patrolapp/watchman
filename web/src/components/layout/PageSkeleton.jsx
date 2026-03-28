/**
 * Full-viewport loading skeleton — bento-ish blocks to reduce perceived CLS vs plain text.
 */
export default function PageSkeleton({ message = 'Loading…' }) {
  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center px-6 py-12 bg-gray-50 dark:bg-gray-900"
      role="status"
      aria-busy="true"
      aria-live="polite"
    >
      <span className="sr-only">{message}</span>
      <div className="w-full max-w-md space-y-4">
        <div className="skeleton h-8 w-48 rounded-xl mx-auto" />
        <div className="bento-tile p-6 space-y-3">
          <div className="skeleton h-4 w-full rounded-lg" />
          <div className="skeleton h-4 w-5/6 rounded-lg" />
          <div className="skeleton h-4 w-4/5 rounded-lg" />
          <div className="skeleton h-24 w-full rounded-xl mt-4" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="bento-tile h-20 skeleton" />
          <div className="bento-tile h-20 skeleton" />
        </div>
      </div>
      <p className="mt-8 text-sm text-gray-500 dark:text-gray-400">{message}</p>
    </div>
  );
}
