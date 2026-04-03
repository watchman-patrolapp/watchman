import { format } from 'date-fns';
import { formatSectionRoleLabel } from '../../constants/incidentSectionUpdates';

/** Amber “official update” card — distinct from primary UI teal (section panel + evidence). */
export default function IncidentUpdateCard({ row, sectionLabel }) {
  const when = row.created_at ? new Date(row.created_at) : null;
  const name = row.author_name || 'Member';
  const role = formatSectionRoleLabel(row.author_role);

  return (
    <div className="rounded-xl border-l-4 border-amber-500 dark:border-amber-400 bg-amber-50/95 dark:bg-amber-950/45 border border-amber-200/90 dark:border-amber-800/70 shadow-sm overflow-hidden">
      <div className="px-3 py-2 bg-amber-100/90 dark:bg-amber-900/55 border-b border-amber-200/70 dark:border-amber-800/55 flex flex-wrap items-center gap-2 text-xs">
        <span className="font-semibold text-amber-950 dark:text-amber-100">
          Official update
        </span>
        {sectionLabel ? (
          <>
            <span className="text-amber-950 dark:text-amber-100">·</span>
            <span className="font-medium text-amber-900 dark:text-amber-200">{sectionLabel}</span>
          </>
        ) : null}
        {when && (
          <span className="text-amber-900/85 dark:text-amber-200/90">
            {format(when, 'dd MMM yyyy HH:mm')}
          </span>
        )}
        <span className="text-amber-950 dark:text-amber-100">·</span>
        <span className="font-medium text-amber-950 dark:text-amber-100">{name}</span>
        <span className="inline-flex items-center rounded-full bg-amber-200/90 dark:bg-amber-800/70 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-950 dark:text-amber-100">
          {role}
        </span>
      </div>
      <p className="px-3 py-3 text-sm text-gray-900 dark:text-gray-100 whitespace-pre-wrap leading-relaxed">
        {row.body}
      </p>
    </div>
  );
}
