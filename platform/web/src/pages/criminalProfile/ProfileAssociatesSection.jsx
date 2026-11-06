import { FaSearch, FaTrash, FaUserSecret } from 'react-icons/fa';
import { DETAIL_INPUT_SM, DETAIL_SECTION } from './profileDetailClasses';
import { ASSOCIATE_RELATIONSHIP_OPTIONS } from './profileDetailModel';
import AssociateFaceThumb from './AssociateFaceThumb';

export default function ProfileAssociatesSection({
  isEditing,
  associates,
  associatesDraft,
  associateSearchQuery,
  onAssociateSearchQuery,
  associateSearchLoading,
  associateSearchResults,
  onAddAssociate,
  onUpdateAssociate,
  onRemoveAssociate,
  onOpenProfile,
}) {
  if (!(isEditing || associates.length > 0)) return null;

  return (
    <section className={DETAIL_SECTION}>
      <h2 className="mb-4 flex items-center gap-2 border-b border-gray-200 pb-2 text-xl font-semibold text-blue-600 dark:border-gray-700 dark:text-sky-400">
        <FaUserSecret /> Known Associates (
        {isEditing ? (associatesDraft || []).length : associates.length})
      </h2>

      {isEditing ? (
        <div className="space-y-4">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Search other criminal profiles and link them as associates. Links are saved when you save the profile.
          </p>
          <div className="relative">
            <FaSearch className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
            <input
              type="search"
              value={associateSearchQuery}
              onChange={(e) => onAssociateSearchQuery(e.target.value)}
              placeholder="Search by name (min. 2 characters)…"
              className="mt-0 w-full rounded-md border border-gray-300 bg-white py-2 pl-9 pr-3 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
              autoComplete="off"
            />
            {associateSearchLoading && (
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-500">Searching…</span>
            )}
            {associateSearchResults.length > 0 && (
              <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-600 dark:bg-gray-800">
                {associateSearchResults.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-gray-50 dark:hover:bg-gray-700/80"
                      onClick={() => onAddAssociate(p)}
                    >
                      <span className="flex min-w-0 items-center gap-3">
                        <AssociateFaceThumb profile={p} />
                        <span className="min-w-0 font-medium text-gray-900 dark:text-gray-100">
                          {p.primary_name}
                        </span>
                      </span>
                      <span className="shrink-0 text-xs capitalize text-gray-500 dark:text-gray-400">
                        {p.risk_level || '—'} · {p.status || '—'}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {(associatesDraft || []).length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-gray-500">No associates linked yet.</p>
          ) : (
            <div className="space-y-3">
              {(associatesDraft || []).map((row) => {
                const otherId = row.other_profile_id || row.associate_profile_id;
                const name = row.profile?.primary_name || 'Unknown profile';
                const rowKey = row.id || row._clientKey;
                return (
                  <div
                    key={rowKey}
                    className="flex flex-col gap-2 rounded-lg border border-gray-200 p-3 dark:border-gray-600 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0 flex-1">
                      <button
                        type="button"
                        className="flex w-full items-start gap-3 text-left font-semibold text-blue-600 hover:underline dark:text-sky-400"
                        onClick={() => onOpenProfile(otherId)}
                      >
                        <AssociateFaceThumb profile={row.profile} />
                        <span className="min-w-0 pt-0.5">{name}</span>
                      </button>
                      <p className="text-xs text-gray-500 dark:text-gray-400">Profile ID · {otherId}</p>
                      {row._linkerProfile?.primary_name && (
                        <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-500">
                          Link recorded from {row._linkerProfile.primary_name}&apos;s profile
                        </p>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <select
                        value={row.relationship_type || 'associate'}
                        onChange={(e) => onUpdateAssociate(row, 'relationship_type', e.target.value)}
                        className={DETAIL_INPUT_SM}
                      >
                        {ASSOCIATE_RELATIONSHIP_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => onRemoveAssociate(row)}
                        className="rounded-lg px-2 py-1 text-sm text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
                      >
                        <FaTrash className="inline h-3 w-3" /> Remove
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {associates.map((assoc) => {
            const targetId = assoc.other_profile_id || assoc.profile?.id || assoc.associate_profile_id;
            return (
              <div
                key={assoc.id}
                role="button"
                tabIndex={0}
                className="flex cursor-pointer gap-3 rounded-lg border border-gray-200 p-3 hover:bg-gray-50 dark:border-gray-600 dark:hover:bg-gray-700/50"
                onClick={() => onOpenProfile(targetId)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onOpenProfile(targetId);
                  }
                }}
              >
                <AssociateFaceThumb profile={assoc.profile} className="h-12 w-12" />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold dark:text-gray-100">{assoc.profile?.primary_name ?? 'Unknown'}</p>
                  <p className="text-sm capitalize text-gray-600 dark:text-gray-400">{assoc.relationship_type}</p>
                  {assoc._linkerProfile?.primary_name && (
                    <p className="mt-1 text-xs text-gray-500 dark:text-gray-500">
                      Link from {assoc._linkerProfile.primary_name}&apos;s profile
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
