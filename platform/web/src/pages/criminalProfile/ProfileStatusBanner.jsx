import { FieldGuideExplainerLink } from '../../components/intelligence/IntelligenceFieldGuide';
import { BANNER_SELECT } from './profileDetailClasses';
import { getPriorityColor, getRiskColor, getStatusColor } from './profileDetailModel';

export default function ProfileStatusBanner({
  isEditing,
  editForm,
  displayData,
  onUpdateField,
  onOpenFieldGuide,
}) {
  return (
    <div className="mb-6 space-y-2">
      <div className="flex flex-wrap gap-2">
        {isEditing ? (
          <>
            <select
              value={editForm.risk_level || 'medium'}
              onChange={(e) => onUpdateField('risk_level', e.target.value)}
              className={BANNER_SELECT}
            >
              <option value="low">Risk: LOW</option>
              <option value="medium">Risk: MEDIUM</option>
              <option value="high">Risk: HIGH</option>
              <option value="critical">Risk: CRITICAL</option>
            </select>

            <select
              value={editForm.priority || 'routine'}
              onChange={(e) => onUpdateField('priority', e.target.value)}
              className={BANNER_SELECT}
            >
              <option value="routine">Priority: ROUTINE</option>
              <option value="priority">Priority: PRIORITY</option>
              <option value="urgent">Priority: URGENT</option>
              <option value="immediate">Priority: IMMEDIATE</option>
            </select>

            <select
              value={editForm.status || 'active'}
              onChange={(e) => onUpdateField('status', e.target.value)}
              className={BANNER_SELECT}
            >
              <option value="active">Status: ACTIVE</option>
              <option value="cleared">Status: INACTIVE (CLEARED)</option>
              <option value="wanted">Status: WANTED</option>
              <option value="incarcerated">Status: INCARCERATED</option>
              <option value="deceased">Status: DECEASED</option>
            </select>
          </>
        ) : (
          <>
            <span className={`rounded-full px-4 py-2 text-sm font-semibold ${getRiskColor(displayData.risk_level)}`}>
              Risk: {displayData.risk_level?.toUpperCase()}
            </span>
            <span className={`rounded-full px-4 py-2 text-sm font-semibold ${getPriorityColor(displayData.priority)}`}>
              Priority: {displayData.priority?.toUpperCase()}
            </span>
            <span className={`rounded-full px-4 py-2 text-sm font-semibold ${getStatusColor(displayData.status)}`}>
              Status: {displayData.status?.toUpperCase()}
            </span>
          </>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-600 dark:text-gray-400">
        <span className="font-medium text-gray-700 dark:text-gray-300">Field guide:</span>
        <FieldGuideExplainerLink topic="risk" onOpen={onOpenFieldGuide}>
          Risk levels
        </FieldGuideExplainerLink>
        <span className="text-gray-300 dark:text-gray-600" aria-hidden>
          ·
        </span>
        <FieldGuideExplainerLink topic="priority" onOpen={onOpenFieldGuide}>
          Priority
        </FieldGuideExplainerLink>
        <span className="text-gray-300 dark:text-gray-600" aria-hidden>
          ·
        </span>
        <FieldGuideExplainerLink topic="status" onOpen={onOpenFieldGuide}>
          Status
        </FieldGuideExplainerLink>
        <span className="text-gray-300 dark:text-gray-600" aria-hidden>
          ·
        </span>
        <FieldGuideExplainerLink topic="watchlist" onOpen={onOpenFieldGuide}>
          Watchlist flags
        </FieldGuideExplainerLink>
      </div>
    </div>
  );
}
