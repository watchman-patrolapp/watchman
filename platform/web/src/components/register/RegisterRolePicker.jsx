import { FaHome, FaShieldAlt, FaBuilding, FaUsers } from "react-icons/fa";
import { REGISTER_TRACKS } from "../../auth/registerTracks";

const TRACK_ICONS = {
  resident: FaHome,
  patroller: FaShieldAlt,
  security_company: FaBuilding,
  neighborhood_watch: FaUsers,
};

export default function RegisterRolePicker({ onSelect, onSignIn }) {
  return (
    <div className="card w-full max-w-2xl p-6 sm:p-8 space-y-6">
      <div className="text-center space-y-2">
        <p className="text-xs uppercase tracking-wide text-teal-700 dark:text-teal-400 font-semibold">
          Step 1 of 2
        </p>
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Join as</h2>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Choose how you will use the platform. The next screen only asks for details that role needs.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {REGISTER_TRACKS.map((track) => {
          const Icon = TRACK_ICONS[track.id] || FaHome;
          return (
            <button
              key={track.id}
              type="button"
              onClick={() => onSelect(track.id)}
              className="text-left rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/80 p-4 hover:border-teal-500 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-teal-500 transition"
            >
              <div className="flex items-start gap-3">
                <span className="mt-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-teal-50 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300">
                  <Icon className="h-5 w-5" aria-hidden />
                </span>
                <span className="min-w-0">
                  <span className="block font-semibold text-gray-900 dark:text-white">{track.label}</span>
                  <span className="mt-1 block text-xs text-gray-500 dark:text-gray-400">{track.tagline}</span>
                </span>
              </div>
              <p className="mt-3 text-sm text-gray-600 dark:text-gray-300">{track.description}</p>
            </button>
          );
        })}
      </div>

      <p className="text-center text-sm text-gray-600 dark:text-gray-400">
        Already registered?{" "}
        <button
          type="button"
          onClick={onSignIn}
          className="text-teal-600 dark:text-teal-400 font-semibold hover:underline focus:outline-none"
        >
          Sign in
        </button>
      </p>
    </div>
  );
}
