import { connectionTypeLabel } from '../../data/profileIncidentLinkTaxonomy';
import { formatWatchDate } from '../../utils/watchTime';
import { DETAIL_SECTION } from './profileDetailClasses';
import { linkedIncidentHeading } from './profileDetailModel';

export default function ProfileLinkedIncidentsSection({ incidents, onOpenIncident }) {
  if (!incidents.length) return null;

  return (
    <section className={DETAIL_SECTION}>
      <h2 className="mb-4 border-b border-gray-200 pb-2 text-xl font-semibold text-purple-600 dark:border-gray-700 dark:text-violet-400">
        Linked Incidents ({incidents.length})
      </h2>
      <div className="space-y-3">
        {incidents.map((link) => (
          <div
            key={link.id}
            className="cursor-pointer rounded-lg border border-gray-200 p-4 hover:bg-gray-50 dark:border-gray-600 dark:hover:bg-gray-700/50"
            onClick={() => onOpenIncident(link.incidents.id)}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h3 className="font-semibold text-gray-800 dark:text-gray-100">
                  {linkedIncidentHeading(link.incidents)}
                </h3>
                {link.incidents?.location?.trim() && (
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 truncate">
                    {link.incidents.location.trim()}
                  </p>
                )}
                <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">
                  <span className="font-medium text-gray-700 dark:text-gray-300">Link:</span>{' '}
                  {connectionTypeLabel(link.connection_type)}
                  {link.confidence_score != null && Number.isFinite(Number(link.confidence_score))
                    ? ` · ${link.confidence_score}% confidence`
                    : ''}
                </p>
              </div>
              <span
                className={`shrink-0 rounded px-2 py-1 text-xs font-medium ${
                  link.incidents?.priority === 'high'
                    ? 'bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300'
                    : link.incidents?.priority === 'medium'
                      ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-950/40 dark:text-yellow-200'
                      : 'bg-green-100 text-green-800 dark:bg-green-950/40 dark:text-green-300'
                }`}
              >
                {link.incidents?.status ?? '—'}
              </span>
            </div>
            <p className="mt-2 text-xs text-gray-400 dark:text-gray-500">
              Linked: {formatWatchDate(link.linked_at) || '—'}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}
