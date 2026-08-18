import { useNavigate } from "react-router-dom";

/**
 * Standard page header with optional back button and right-side actions.
 */
export default function PageHeader({
  title,
  subtitle,
  backTo,
  backLabel = "Back",
  rightSlot = null,
  className = "",
}) {
  const navigate = useNavigate();

  return (
    <div className={`bg-white dark:bg-gray-800 rounded-xl p-5 shadow ${className}`}>
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{title}</h1>
        <div className="flex items-center gap-3">
          {rightSlot}
          {backTo ? (
            <button
              type="button"
              onClick={() => navigate(backTo)}
              className="text-sm text-teal-600 dark:text-teal-400 hover:underline"
            >
              {backLabel}
            </button>
          ) : null}
        </div>
      </div>
      {subtitle ? (
        <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">{subtitle}</p>
      ) : null}
    </div>
  );
}
