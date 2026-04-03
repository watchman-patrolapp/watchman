import BrandedLoader from './BrandedLoader';

/**
 * Full-viewport loading state with app mark + message (replaces bento skeletons).
 */
export default function PageSkeleton({ message = 'Loading…' }) {
  return (
    <div
      className="flex min-h-screen flex-col items-center justify-center bg-gray-50 px-6 py-12 dark:bg-gray-900"
      role="status"
      aria-busy="true"
      aria-live="polite"
    >
      <span className="sr-only">{message}</span>
      <BrandedLoader message={message} size="lg" />
    </div>
  );
}
