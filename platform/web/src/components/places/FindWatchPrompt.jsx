import { Link } from "react-router-dom";
import { FaUsers } from "react-icons/fa";

/** Shown to a resident or patroller who is not in a watch yet. */
export default function FindWatchPrompt() {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-teal-200 bg-teal-50 px-4 py-3 text-sm text-teal-900 dark:border-teal-800 dark:bg-teal-900/30 dark:text-teal-100">
      <p className="flex items-start gap-3">
        <FaUsers className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <span>
          <span className="font-semibold">You're not in a watch yet.</span> Find the watch for your suburb, or ask for yours.
        </span>
      </p>
      <Link to="/find-watch" className="btn-primary min-h-11 px-4 inline-flex items-center">
        Find your watch
      </Link>
    </div>
  );
}
