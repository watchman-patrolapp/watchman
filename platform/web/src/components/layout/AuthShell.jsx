import ThemeToggle from '../ThemeToggle';

/**
 * Shared auth layout: system-aware background + compact theme control in the header bar.
 */
export default function AuthShell({ children, title = 'Neighbourhood Watch' }) {
  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-b from-gray-50 via-teal-50/40 to-gray-100 dark:from-gray-950 dark:via-teal-950/25 dark:to-gray-900">
      <header className="shrink-0 border-b border-gray-200/90 dark:border-gray-800 bg-white/85 dark:bg-gray-900/85 backdrop-blur-md">
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <h1 className="text-sm font-semibold text-gray-900 dark:text-white tracking-tight truncate min-w-0 pr-2">
            {title}
          </h1>
          <ThemeToggle variant="toolbar" />
        </div>
      </header>
      <main className="flex-1 flex flex-col items-center justify-center px-4 py-8">
        {children}
      </main>
    </div>
  );
}
