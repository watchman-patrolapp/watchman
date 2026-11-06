import { Link } from "react-router-dom";
import ThemeToggle from "../ThemeToggle";
import appMark from "../../assets/app-mark.png";

/**
 * Shared auth layout: brand mark, value line, labelled theme control, and trust footer.
 */
export default function AuthShell({ children, wide = false }) {
  const width = wide ? "max-w-2xl" : "max-w-lg";
  return (
    <div className="flex min-h-dvh flex-col bg-surface-page text-text-primary">
      <header className="shrink-0 border-b border-subtle bg-surface-card backdrop-blur-md">
        <div className={`${width} mx-auto flex items-center justify-between gap-3 px-4 py-3`}>
          <div className="flex min-w-0 items-center gap-3">
            <img
              src={appMark}
              alt=""
              width={40}
              height={40}
              decoding="async"
              className="h-10 w-10 shrink-0 rounded-xl object-contain"
            />
            <div className="min-w-0">
              <h1 className="truncate text-base font-semibold tracking-tight text-text-primary">
                Watchman
              </h1>
              <p className="text-sm leading-snug text-text-secondary">
                Keep your neighbourhood safe together
              </p>
            </div>
          </div>
          <ThemeToggle variant="surface" labelled />
        </div>
      </header>
      <main className="flex flex-1 flex-col items-center justify-center px-4 py-8">
        {children}
      </main>
      <footer className={`safe-area-bottom ${width} mx-auto w-full px-4 pb-6 text-center text-sm text-text-secondary`}>
        <p>Reports stay with your neighbourhood watch.</p>
        <p className="mt-2">
          <Link to="/privacy" className="font-medium text-text-link underline">
            Privacy policy
          </Link>
          <span aria-hidden="true"> · </span>
          <Link to="/terms" className="font-medium text-text-link underline">
            Terms
          </Link>
        </p>
      </footer>
    </div>
  );
}
