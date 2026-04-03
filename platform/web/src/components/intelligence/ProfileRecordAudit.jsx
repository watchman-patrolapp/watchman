import { FaUserEdit, FaUserPlus } from 'react-icons/fa';
import {
  formatAuditDateTime,
  profileHasDistinctUpdate,
  resolveUserLabel,
} from '../../utils/profileUserLabels';

/**
 * Created / last-updated metadata for criminal profile cards and detail header.
 */
export default function ProfileRecordAudit({ profile, userLabelById = {} }) {
  if (!profile) return null;

  const createdAt = formatAuditDateTime(profile.created_at);
  const creator = resolveUserLabel(profile.created_by, userLabelById);
  const showUpdate = profileHasDistinctUpdate(profile);
  const updatedAt = formatAuditDateTime(profile.updated_at);
  const hasUpdaterId = profile.updated_by != null && String(profile.updated_by).trim() !== '';
  const updater = hasUpdaterId
    ? resolveUserLabel(profile.updated_by, userLabelById)
    : 'Not recorded';

  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50/90 px-4 py-3 text-xs text-gray-600 dark:border-gray-600 dark:bg-gray-900/50 dark:text-gray-400">
      <p className="flex flex-wrap items-center gap-2">
        <FaUserPlus className="h-3.5 w-3.5 shrink-0 text-teal-600 dark:text-teal-400" aria-hidden />
        <span className="font-medium text-gray-700 dark:text-gray-300">Created</span>
        <span>{createdAt}</span>
        <span className="text-gray-400 dark:text-gray-500">·</span>
        <span className="font-medium text-gray-700 dark:text-gray-300">by</span>
        <span className="text-gray-800 dark:text-gray-200">{creator}</span>
      </p>
      {showUpdate && (
        <p className="mt-2 flex flex-wrap items-center gap-2 border-t border-gray-200 pt-2 dark:border-gray-600">
          <FaUserEdit className="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
          <span className="font-medium text-gray-700 dark:text-gray-300">Updated</span>
          <span>{updatedAt}</span>
          <span className="text-gray-400 dark:text-gray-500">·</span>
          <span className="font-medium text-gray-700 dark:text-gray-300">by</span>
          <span className="text-gray-800 dark:text-gray-200">{updater}</span>
        </p>
      )}
    </div>
  );
}
