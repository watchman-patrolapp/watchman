import { FaArrowLeft, FaEdit, FaSave, FaTimes, FaTrash } from 'react-icons/fa';
import ThemeToggle from '../../components/ThemeToggle';

export default function ProfileDetailHeader({
  isEditing,
  displayName,
  backLabel,
  onBack,
  onEdit,
  onDelete,
  onCancel,
  onSave,
  saving,
  photoUploadsPending,
}) {
  return (
    <div className="mb-6 flex flex-col items-start justify-between gap-4 md:flex-row md:items-center">
      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-2 rounded-xl bg-gray-200 px-4 py-2 text-sm font-medium text-gray-800 transition hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
        >
          <FaArrowLeft /> {backLabel}
        </button>

        <h1 className="text-2xl font-bold text-gray-800 md:text-3xl dark:text-white">
          {isEditing ? 'Edit Profile' : displayName}
        </h1>
      </div>

      <div className="flex flex-wrap gap-2 sm:gap-3 items-center">
        <ThemeToggle variant="toolbar" />
        {!isEditing ? (
          <>
            <button
              type="button"
              onClick={onEdit}
              className="flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-white transition hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600"
            >
              <FaEdit /> Edit Profile
            </button>

            <button
              type="button"
              onClick={onDelete}
              className="flex items-center gap-2 rounded-xl bg-red-600 px-4 py-2 text-white transition hover:bg-red-700 dark:bg-red-600 dark:hover:bg-red-500"
            >
              <FaTrash /> Delete
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={onCancel}
              className="flex items-center gap-2 rounded-xl border border-gray-300 bg-gray-100 px-4 py-2 font-medium text-gray-800 transition hover:bg-gray-200 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
            >
              <FaTimes /> Cancel
            </button>

            <button
              type="button"
              onClick={onSave}
              disabled={saving || photoUploadsPending > 0}
              className="flex items-center gap-2 rounded-xl bg-teal-600 px-4 py-2 text-white shadow-sm transition hover:bg-teal-700 disabled:opacity-50 dark:bg-teal-600 dark:hover:bg-teal-500"
            >
              <FaSave /> {saving ? 'Saving...' : photoUploadsPending > 0 ? 'Uploading photos...' : 'Save Changes'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
