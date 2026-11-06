import { FaPlus, FaTimes } from 'react-icons/fa';
import { DETAIL_INPUT_FLEX_SM, DETAIL_INPUT_SM, DETAIL_SECTION } from './profileDetailClasses';

export default function ProfilePhysicalSection({
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
      <h2 className="mb-4 text-lg font-semibold text-gray-700 dark:text-gray-200">Physical Description</h2>
      <div className="space-y-3 text-sm">
        <div className="grid grid-cols-2 gap-2">
          <span className="text-gray-600 dark:text-gray-400">Height:</span>
          {isEditing ? (
            <input
              type="number"
              value={editForm.height_cm || ''}
              onChange={(e) => onUpdateField('height_cm', e.target.value ? parseInt(e.target.value) : null)}
              className={DETAIL_INPUT_SM}
              placeholder="cm"
            />
          ) : (
            <span className="font-medium dark:text-gray-100">{displayData.height_cm ? `${displayData.height_cm} cm` : '-'}</span>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2">
          <span className="text-gray-600 dark:text-gray-400">Weight:</span>
          {isEditing ? (
            <input
              type="number"
              value={editForm.weight_kg || ''}
              onChange={(e) => onUpdateField('weight_kg', e.target.value ? parseInt(e.target.value) : null)}
              className={DETAIL_INPUT_SM}
              placeholder="kg"
            />
          ) : (
            <span className="font-medium dark:text-gray-100">{displayData.weight_kg ? `${displayData.weight_kg} kg` : '-'}</span>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2">
          <span className="text-gray-600 dark:text-gray-400">Build:</span>
          {isEditing ? (
            <select
              value={editForm.build_type || ''}
              onChange={(e) => onUpdateField('build_type', e.target.value || null)}
              className={DETAIL_INPUT_SM}
            >
              <option value="">Select</option>
              <option value="slim">Slim</option>
              <option value="medium">Medium</option>
              <option value="athletic">Athletic</option>
              <option value="heavy">Heavy</option>
              <option value="muscular">Muscular</option>
            </select>
          ) : (
            <span className="font-medium capitalize dark:text-gray-100">{displayData.build_type || '-'}</span>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2">
          <span className="text-gray-600 dark:text-gray-400">Eye Color:</span>
          {isEditing ? (
            <input
              type="text"
              value={editForm.eye_color || ''}
              onChange={(e) => onUpdateField('eye_color', e.target.value || null)}
              className={DETAIL_INPUT_SM}
            />
          ) : (
            <span className="font-medium capitalize dark:text-gray-100">{displayData.eye_color || '-'}</span>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2">
          <span className="text-gray-600 dark:text-gray-400">Hair Color:</span>
          {isEditing ? (
            <input
              type="text"
              value={editForm.hair_color || ''}
              onChange={(e) => onUpdateField('hair_color', e.target.value || null)}
              className={DETAIL_INPUT_SM}
            />
          ) : (
            <span className="font-medium capitalize dark:text-gray-100">{displayData.hair_color || '-'}</span>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2">
          <span className="text-gray-600 dark:text-gray-400">Complexion:</span>
          {isEditing ? (
            <input
              type="text"
              value={editForm.complexion || ''}
              onChange={(e) => onUpdateField('complexion', e.target.value || null)}
              className={DETAIL_INPUT_SM}
            />
          ) : (
            <span className="font-medium capitalize dark:text-gray-100">{displayData.complexion || '-'}</span>
          )}
        </div>
      </div>

      <div className="mt-4">
        <h3 className="mb-2 font-medium text-gray-700 dark:text-gray-200">Distinguishing Marks:</h3>
        {isEditing ? (
          <div className="space-y-2">
            {(editForm.distinguishing_marks || []).map((mark, index) => (
              <div key={index} className="flex gap-2">
                <input
                  type="text"
                  value={mark}
                  onChange={(e) => onUpdateArrayField('distinguishing_marks', index, e.target.value)}
                  className={DETAIL_INPUT_FLEX_SM}
                />
                <button
                  onClick={() => onRemoveArrayItem('distinguishing_marks', index)}
                  className="text-red-500 px-2"
                >
                  <FaTimes />
                </button>
              </div>
            ))}
            <button
              onClick={() => onAddArrayItem('distinguishing_marks')}
              className="flex items-center gap-1 text-sm text-blue-600 dark:text-sky-400"
            >
              <FaPlus size={12} /> Add Mark
            </button>
          </div>
        ) : (
          displayData.distinguishing_marks?.length > 0 ? (
            <ul className="list-inside list-disc text-sm text-gray-600 dark:text-gray-300">
              {displayData.distinguishing_marks.map((mark, index) => (
                <li key={index}>{mark}</li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-gray-400 dark:text-gray-500">None recorded</p>
          )
        )}
      </div>
    </section>
  );
}
