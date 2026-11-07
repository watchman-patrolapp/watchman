import CriminalProfileCard from '../../intelligence/CriminalProfileCard';
import { totalProfileLocationCardCount } from '../../../utils/profileLocationCount';
import {
  connectionTypeBadgeClasses,
  connectionTypeLabel,
  PROFILE_INCIDENT_CONFIDENCE_NOT_SET_HINT,
} from '../../../data/profileIncidentLinkTaxonomy';
import { parseStoredLinkConfidence } from './incidentDetailHelpers';

export default function LinkedProfileLinkCard({ link, navigate, userLabelById = {} }) {
  const fromProfileRow = parseStoredLinkConfidence(link.confidence_score);
  const displayConfidence =
    fromProfileRow != null
      ? fromProfileRow
      : link._effective_confidence_score != null
        ? link._effective_confidence_score
        : null;
  const confidenceFromEvidenceOnly =
    displayConfidence != null && fromProfileRow == null;

  return (
    <div className="rounded-xl border-2 border-gray-300 bg-white p-6 shadow-sm dark:border-gray-600 dark:bg-gray-800">
      <div className="flex justify-between items-start mb-4">
        <div>
          <span
            className={`inline-block px-2 py-1 rounded text-xs font-bold mb-2 ${connectionTypeBadgeClasses(
              link.connection_type
            )}`}
          >
            {connectionTypeLabel(link.connection_type)}
          </span>
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm text-gray-500 dark:text-gray-400">Link confidence:</span>
              {displayConfidence != null ? (
                <>
                  <div className="w-24 bg-gray-200 dark:bg-gray-600 rounded-full h-2">
                    <div
                      className={`h-2 rounded-full ${
                        displayConfidence > 80
                          ? 'bg-green-500'
                          : displayConfidence > 50
                            ? 'bg-yellow-500'
                            : 'bg-red-500'
                      }`}
                      style={{
                        width: `${Math.min(100, Math.max(0, displayConfidence))}%`,
                      }}
                    />
                  </div>
                  <span className="text-sm font-medium text-gray-900 dark:text-white">
                    {displayConfidence}%
                  </span>
                  {confidenceFromEvidenceOnly && (
                    <span
                      className="text-[10px] text-gray-500 dark:text-gray-400"
                      title="From suspect evidence (latest row). Re-save the report to copy this into the profile–incident link row."
                    >
                      (from evidence)
                    </span>
                  )}
                </>
              ) : (
                <span className="text-sm text-gray-500 dark:text-gray-400">Not set</span>
              )}
            </div>
            {displayConfidence == null && (
              <p className="text-xs text-gray-500 dark:text-gray-400 max-w-xl">
                {PROFILE_INCIDENT_CONFIDENCE_NOT_SET_HINT}
              </p>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={() => navigate(`/intelligence/profiles/${link.profile_id}`)}
          className="px-4 py-2 bg-teal-100 dark:bg-teal-900/50 text-teal-700 dark:text-teal-300 rounded-lg text-sm font-medium hover:bg-teal-200 transition"
        >
          View Full Profile
        </button>
      </div>

      {link.profile && (
        <CriminalProfileCard
          profile={link.profile}
          userLabelById={userLabelById}
          stats={{
            incidentCount:
              link.profile.profile_incidents?.[0]?.count ??
              link.profile.incident_count ??
              0,
            associateCount: (() => {
              const p = link.profile;
              const o = p?.associate_out?.[0]?.count;
              const i = p?.associate_in?.[0]?.count;
              const no = typeof o === 'number' ? o : Number(o) || 0;
              const ni = typeof i === 'number' ? i : Number(i) || 0;
              if (no || ni) return no + ni;
              return p?.associate_count ?? 0;
            })(),
            locationCount: totalProfileLocationCardCount(link.profile, link.profile.profile_geography),
          }}
        />
      )}

      {link.verification_notes && (
        <div className="mt-4 p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg text-sm text-gray-600 dark:text-gray-400">
          <strong>Analyst Notes:</strong> {link.verification_notes}
        </div>
      )}
    </div>
  );
}
