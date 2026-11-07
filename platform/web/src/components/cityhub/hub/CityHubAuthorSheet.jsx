import { FaEnvelope, FaPhone, FaTimes } from "react-icons/fa";
import {
  cityHubAuthorDisplayName,
  cityHubAuthorInitials,
  cityHubAuthorRoleLabel,
  cityHubTelHref,
} from "../../../utils/cityHubAuthors";

export default function CityHubAuthorSheet({ profile, organizationName, onClose }) {
  const name = cityHubAuthorDisplayName(profile);
  const phone = String(profile?.phone || "").trim();
  const email = String(profile?.email || "").trim();
  const telHref = cityHubTelHref(phone);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center sm:items-center p-0 sm:p-4 bg-black/50"
      role="dialog"
      aria-modal="true"
      aria-labelledby="city-hub-author-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-t-2xl sm:rounded-2xl bg-white dark:bg-gray-800 shadow-xl border border-gray-200 dark:border-gray-600">
        <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-gray-200 dark:border-gray-600">
          <div className="flex min-w-0 items-center gap-3">
            {profile?.avatar_url ? (
              <img
                src={profile.avatar_url}
                alt=""
                className="h-12 w-12 rounded-full object-cover ring-2 ring-teal-200 dark:ring-teal-800"
              />
            ) : (
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-teal-100 text-sm font-bold text-teal-700 dark:bg-teal-900/50 dark:text-teal-200">
                {cityHubAuthorInitials(profile)}
              </div>
            )}
            <div className="min-w-0">
              <h2 id="city-hub-author-title" className="text-lg font-semibold text-gray-900 dark:text-white truncate">
                {name}
              </h2>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {cityHubAuthorRoleLabel(profile?.role)}
                {organizationName ? ` · ${organizationName}` : ""}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700"
            aria-label="Close"
          >
            <FaTimes />
          </button>
        </div>
        <div className="space-y-3 p-4">
          <p className="text-sm text-gray-600 dark:text-gray-300">
            Use these details to get hold of the person who published this City Hub post.
          </p>
          <div className="flex items-start gap-3">
            <FaEnvelope className="mt-0.5 shrink-0 text-teal-500 dark:text-teal-400" />
            {email ? (
              <a
                href={`mailto:${email}`}
                className="text-sm font-medium text-teal-700 underline-offset-2 hover:underline dark:text-teal-300 break-all"
              >
                {email}
              </a>
            ) : (
              <span className="text-sm text-gray-500 dark:text-gray-400">Email not provided</span>
            )}
          </div>
          <div className="flex items-start gap-3">
            <FaPhone className="mt-0.5 shrink-0 text-teal-500 dark:text-teal-400" />
            {telHref ? (
              <a
                href={telHref}
                className="text-sm font-medium text-teal-700 underline-offset-2 hover:underline dark:text-teal-300"
              >
                {phone}
              </a>
            ) : (
              <span className="text-sm text-gray-500 dark:text-gray-400">Phone not provided</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
