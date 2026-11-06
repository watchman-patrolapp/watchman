import { FaMapMarkerAlt } from 'react-icons/fa';
import SightingsLogEditor from '../../components/intelligence/SightingsLogEditor';
import { mergedSightingsForDisplay } from '../../utils/criminalProfileSightings';
import { DETAIL_INPUT, DETAIL_SECTION } from './profileDetailClasses';

export default function ProfileLocationSection({
  isEditing,
  editForm,
  displayData,
  onUpdateField,
}) {
  return (
    <section className={DETAIL_SECTION}>
      <h2 className="mb-4 flex items-center gap-2 border-b border-gray-200 pb-2 text-xl font-semibold text-orange-600 dark:border-gray-700 dark:text-orange-400">
        <FaMapMarkerAlt /> Location Data
      </h2>

      <div className="mb-6 space-y-4">
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-orange-800 dark:text-orange-300/90">
            Common presence
          </h3>
          <p className="mb-2 text-xs text-gray-500 dark:text-gray-400">
            Areas, routes, or venues where this subject is most often observed.
          </p>
          {isEditing ? (
            <textarea
              value={editForm.common_presence || ''}
              onChange={(e) => onUpdateField('common_presence', e.target.value || null)}
              rows={3}
              className={`${DETAIL_INPUT} resize-y min-h-[4.5rem]`}
              placeholder="e.g. Theescombe retail strip, evenings near park entrance"
            />
          ) : (
            <p className="font-medium dark:text-gray-100 whitespace-pre-wrap">
              {displayData.common_presence?.trim() || '—'}
            </p>
          )}
        </div>

        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-orange-800 dark:text-orange-300/90">
            Residence (last known)
          </h3>
          <p className="mb-2 text-xs text-gray-500 dark:text-gray-400">
            Last known home or residential area on file (verified or alleged).
          </p>
          {isEditing ? (
            <input
              type="text"
              value={editForm.residence_last_known || ''}
              onChange={(e) => onUpdateField('residence_last_known', e.target.value || null)}
              className={DETAIL_INPUT}
              placeholder="Street, suburb, or general area"
            />
          ) : (
            <p className="font-medium dark:text-gray-100">{displayData.residence_last_known?.trim() || '—'}</p>
          )}
        </div>
      </div>

      <div className="border-t border-orange-100 pt-5 dark:border-orange-900/40">
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-orange-800 dark:text-orange-300/90">
          Last known sightings
        </h3>
        <p className="mb-4 text-xs text-gray-500 dark:text-gray-400">
          Add each reported sighting (time, place, optional coordinates, who saw them). The most recent row is
          also mirrored to legacy “last seen” fields for older screens.
        </p>
      </div>

      <SightingsLogEditor
        value={
          isEditing
            ? editForm.sightings_log ?? []
            : mergedSightingsForDisplay(displayData)
        }
        onChange={isEditing ? (list) => onUpdateField('sightings_log', list) : () => {}}
        disabled={!isEditing}
        dateInputClass={DETAIL_INPUT}
        textInputClass={DETAIL_INPUT}
      />
    </section>
  );
}
