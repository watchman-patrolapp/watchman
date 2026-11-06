import { FaPlus, FaTimes } from 'react-icons/fa';
import { formatWatchDate } from '../../utils/watchTime';
import { DETAIL_INPUT, DETAIL_INPUT_FLEX_SM, DETAIL_INPUT_NAME, DETAIL_SECTION } from './profileDetailClasses';

export default function ProfileBasicInfoSection({
  isEditing,
  editForm,
  displayData,
  onUpdateField,
  onUpdateArrayField,
  onAddArrayItem,
  onRemoveArrayItem,
}) {
  return (
    <section className={DETAIL_SECTION}>
      <h2 className="mb-4 border-b border-gray-200 pb-2 text-xl font-semibold text-blue-600 dark:border-gray-700 dark:text-sky-400">
        Basic Information
      </h2>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="md:col-span-2">
          <label className="text-sm text-gray-600 dark:text-gray-400">Primary Name</label>
          {isEditing ? (
            <input
              type="text"
              value={editForm.primary_name || ''}
              onChange={(e) => onUpdateField('primary_name', e.target.value)}
              className={DETAIL_INPUT_NAME}
            />
          ) : (
            <p className="text-lg font-semibold text-gray-800 dark:text-white">{displayData.primary_name}</p>
          )}
        </div>

        <div>
          <label className="text-sm text-gray-600 dark:text-gray-400">Date of Birth</label>
          {isEditing ? (
            <input
              type="date"
              value={editForm.date_of_birth || ''}
              onChange={(e) => onUpdateField('date_of_birth', e.target.value || null)}
              className={DETAIL_INPUT}
            />
          ) : (
            <p className="font-medium dark:text-gray-100">
              {displayData.date_of_birth
                ? formatWatchDate(displayData.date_of_birth) || String(displayData.date_of_birth).slice(0, 10)
                : '-'}
            </p>
          )}
        </div>

        <div>
          <label className="text-sm text-gray-600 dark:text-gray-400">Place of Birth</label>
          {isEditing ? (
            <input
              type="text"
              value={editForm.place_of_birth || ''}
              onChange={(e) => onUpdateField('place_of_birth', e.target.value || null)}
              className={DETAIL_INPUT}
            />
          ) : (
            <p className="font-medium dark:text-gray-100">{displayData.place_of_birth || '-'}</p>
          )}
        </div>

        <div>
          <label className="text-sm text-gray-600 dark:text-gray-400">Gender</label>
          {isEditing ? (
            <select
              value={editForm.gender || ''}
              onChange={(e) => onUpdateField('gender', e.target.value || null)}
              className={DETAIL_INPUT}
            >
              <option value="">Select</option>
              <option value="male">Male</option>
              <option value="female">Female</option>
              <option value="other">Other</option>
              <option value="unknown">Unknown</option>
            </select>
          ) : (
            <p className="font-medium capitalize dark:text-gray-100">{displayData.gender || '-'}</p>
          )}
        </div>

        <div>
          <label className="text-sm text-gray-600 dark:text-gray-400">Nationality</label>
          {isEditing ? (
            <div className="space-y-2 mt-1">
              {(editForm.nationality || []).map((nat, index) => (
                <div key={index} className="flex gap-2">
                  <input
                    type="text"
                    value={nat}
                    onChange={(e) => onUpdateArrayField('nationality', index, e.target.value)}
                    className={DETAIL_INPUT_FLEX_SM}
                  />
                  <button
                    onClick={() => onRemoveArrayItem('nationality', index)}
                    className="text-red-500 px-2"
                  >
                    <FaTimes />
                  </button>
                </div>
              ))}
              <button
                onClick={() => onAddArrayItem('nationality')}
                className="flex items-center gap-1 text-sm text-blue-600 dark:text-sky-400"
              >
                <FaPlus size={12} /> Add
              </button>
            </div>
          ) : (
            <p className="font-medium dark:text-gray-100">
              {displayData.nationality?.length > 0
                ? displayData.nationality.join(', ')
                : '-'}
            </p>
          )}
        </div>
      </div>

      <div className="mt-4">
        <label className="text-sm text-gray-600 dark:text-gray-400">Known Aliases</label>
        {isEditing ? (
          <div className="flex flex-wrap gap-2 mt-1">
            {(editForm.known_aliases || []).map((alias, index) => (
              <div key={index} className="flex items-center gap-1 rounded bg-gray-100 px-2 py-1 dark:bg-gray-700/70">
                <input
                  type="text"
                  value={alias}
                  onChange={(e) => onUpdateArrayField('known_aliases', index, e.target.value)}
                  className="border-none bg-transparent text-sm dark:text-white"
                />
                <button
                  onClick={() => onRemoveArrayItem('known_aliases', index)}
                  className="text-red-500"
                >
                  <FaTimes size={12} />
                </button>
              </div>
            ))}
            <button
              onClick={() => onAddArrayItem('known_aliases')}
              className="flex items-center gap-1 rounded border border-dashed border-blue-300 px-2 py-1 text-sm text-blue-600 dark:border-sky-600 dark:text-sky-400"
            >
              <FaPlus size={12} /> Add
            </button>
          </div>
        ) : (
          displayData.known_aliases?.length > 0 ? (
            <div className="flex flex-wrap gap-2 mt-1">
              {displayData.known_aliases.map((alias, index) => (
                <span key={index} className="rounded-full bg-gray-100 px-3 py-1 text-sm dark:bg-gray-700/80 dark:text-gray-100">
                  {alias}
                </span>
              ))}
            </div>
          ) : (
            <p className="text-gray-400 dark:text-gray-500">No aliases recorded</p>
          )
        )}
      </div>
    </section>
  );
}
