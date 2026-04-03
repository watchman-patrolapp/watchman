import React, { useState, useCallback, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  FaUserSecret,
  FaExclamationTriangle,
  FaNetworkWired,
  FaMapMarkerAlt,
  FaFingerprint,
  FaHistory,
  FaChartLine,
  FaCalendarAlt,
  FaIdCard,
  FaFlag,
  FaTimes,
  FaExternalLinkAlt,
  FaExpand,
} from 'react-icons/fa';
import { supabase } from '../../supabase/client';
import { fetchAssociatesBidirectional } from '../../utils/profileAssociates';
import { formatMoMatchConfidence, moMatchCardTitle } from '../../utils/moMatchDisplay';
import { mergedSightingsForDisplay } from '../../utils/criminalProfileSightings';
import PatrollerPhotoPreview from '../patrol/PatrollerPhotoPreview';
import BrandedLoader from '../layout/BrandedLoader';

const RiskBadge = ({ level }) => {
  const styles = {
    low:
      'bg-green-100 text-green-800 border-green-300 dark:bg-green-950/55 dark:text-green-300 dark:border-green-700/80',
    medium:
      'bg-yellow-100 text-yellow-800 border-yellow-300 dark:bg-amber-950/50 dark:text-amber-200 dark:border-amber-700/70',
    high:
      'bg-orange-100 text-orange-800 border-orange-300 dark:bg-orange-950/50 dark:text-orange-300 dark:border-orange-700/80',
    critical:
      'bg-red-100 text-red-800 border-red-300 animate-pulse dark:bg-red-950/55 dark:text-red-300 dark:border-red-600/90',
  };

  return (
    <span className={`px-3 py-1 rounded-full text-xs font-bold border-2 ${styles[level] || styles.medium}`}>
      {level?.toUpperCase()} RISK
    </span>
  );
};

const STAT_ICON_CLASS = {
  blue: 'text-blue-600 dark:text-blue-400',
  purple: 'text-purple-600 dark:text-purple-400',
  green: 'text-green-600 dark:text-green-400',
  orange: 'text-orange-600 dark:text-orange-400',
};

const StatBox = ({
  icon: Icon,
  label,
  value,
  color,
  title,
  valueClassName = '',
  onActivate,
  interactiveHint,
}) => {
  const interactive = typeof onActivate === 'function';
  const base =
    'min-w-0 rounded-xl border border-gray-200 bg-gray-50 px-1 py-2.5 text-center dark:border-gray-600 dark:bg-gray-900/50 sm:px-3 sm:py-3';
  const interactiveCls = interactive
    ? 'cursor-pointer transition hover:border-purple-400 hover:bg-purple-50/80 dark:hover:border-purple-600 dark:hover:bg-purple-950/35 focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-500'
    : '';
  const tip = interactive
    ? [interactiveHint || 'Click to view linked profiles', title].filter(Boolean).join(' · ')
    : title;
  return (
    <div
      className={`${base} ${interactiveCls}`}
      title={tip}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      onClick={(e) => {
        if (interactive) {
          e.stopPropagation();
          onActivate(e);
        }
      }}
      onKeyDown={(e) => {
        if (interactive && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          e.stopPropagation();
          onActivate(e);
        }
      }}
    >
      <Icon
        className={`mx-auto mb-1 h-5 w-5 shrink-0 sm:h-6 sm:w-6 ${STAT_ICON_CLASS[color] || 'text-gray-600 dark:text-gray-400'}`}
      />
      <div className={`text-xl font-bold tabular-nums text-gray-900 dark:text-white sm:text-2xl ${valueClassName}`}>
        {value}
      </div>
      <div className="mt-0.5 break-words text-[10px] font-medium leading-tight text-gray-500 dark:text-gray-400 sm:text-xs">
        {label}
      </div>
    </div>
  );
};

function AssociateMiniRow({ a, onNavigate }) {
  return (
    <div className="flex gap-3 rounded-xl border border-gray-200 bg-white p-3 dark:border-gray-600 dark:bg-gray-800/80">
      <div className="h-14 w-14 shrink-0 overflow-hidden rounded-lg border border-gray-200 bg-gray-100 dark:border-gray-600 dark:bg-gray-700">
        {a.photo_urls?.[0] ? (
          <img src={a.photo_urls[0]} alt="" className="h-full w-full object-cover object-top" />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <FaUserSecret className="h-6 w-6 text-gray-400" />
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="font-semibold text-gray-900 dark:text-white truncate">
          {a.primary_name || 'Unknown name'}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
          {a.risk_level && (
            <span className="rounded-full bg-gray-100 px-2 py-0.5 font-medium uppercase text-gray-700 dark:bg-gray-700 dark:text-gray-200">
              {a.risk_level} risk
            </span>
          )}
          {a.status && <span className="capitalize">{a.status}</span>}
          {a.relationship_type && (
            <span className="text-gray-400 dark:text-gray-500">
              ({String(a.relationship_type).replace(/_/g, ' ')})
            </span>
          )}
        </div>
        <div className="mt-2">
          <Link
            to={`/intelligence/profiles/${a.id}`}
            onClick={(e) => {
              e.stopPropagation();
              onNavigate?.();
            }}
            className="inline-flex items-center gap-1 rounded-lg bg-teal-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-teal-700"
          >
            <FaExternalLinkAlt className="h-3 w-3" />
            Full profile
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function CriminalProfileCard({ profile, stats = {}, associatesPreview = null }) {
  const mo = formatMoMatchConfidence(stats.moConfidence);
  const [associatesPeekOpen, setAssociatesPeekOpen] = useState(false);
  const [associatesPeekLoading, setAssociatesPeekLoading] = useState(false);
  const [associatesPeekList, setAssociatesPeekList] = useState([]);
  const [associatesPeekError, setAssociatesPeekError] = useState(null);
  const [photoLightbox, setPhotoLightbox] = useState(null);

  const associateCount = stats.associateCount || 0;

  const loadAssociatesForPeek = useCallback(async () => {
    if (associatesPreview?.length) {
      setAssociatesPeekList(associatesPreview);
      setAssociatesPeekError(null);
      return;
    }
    setAssociatesPeekLoading(true);
    setAssociatesPeekError(null);
    try {
      const rows = await fetchAssociatesBidirectional(supabase, profile.id);
      setAssociatesPeekList(
        (rows || []).map((r) => ({
          id: r.other_profile_id,
          primary_name: r.profile?.primary_name,
          risk_level: r.profile?.risk_level,
          status: r.profile?.status,
          photo_urls: r.profile?.photo_urls,
          relationship_type: r.relationship_type || 'associate',
        }))
      );
    } catch (err) {
      console.error('Associates peek:', err);
      setAssociatesPeekError(err?.message || 'Failed to load associates');
      setAssociatesPeekList([]);
    } finally {
      setAssociatesPeekLoading(false);
    }
  }, [profile.id, associatesPreview]);

  const openAssociatesPeek = useCallback(
    async (e) => {
      e?.stopPropagation?.();
      if (associateCount <= 0) return;
      setAssociatesPeekOpen(true);
      await loadAssociatesForPeek();
    },
    [associateCount, loadAssociatesForPeek]
  );

  const closeAssociatesPeek = useCallback((e) => {
    e?.stopPropagation?.();
    setAssociatesPeekOpen(false);
  }, []);

  useEffect(() => {
    if (!associatesPeekOpen) return;
    const onKey = (ev) => {
      if (ev.key === 'Escape') closeAssociatesPeek();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [associatesPeekOpen, closeAssociatesPeek]);

  return (
    <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-xl dark:border-gray-700 dark:bg-gray-800 dark:shadow-lg">
      {/* Header — light: slate hero; dark: matches app gray + subtle teal (dashboard-adjacent) */}
      <div className="relative h-32 bg-gradient-to-r from-slate-800 to-slate-900 dark:from-gray-900 dark:via-teal-950/35 dark:to-gray-900">
        <div className="absolute top-4 right-4 flex gap-2">
          <RiskBadge level={profile.risk_level} />
          {profile.priority === 'urgent' && (
            <span className="rounded-full bg-red-600 px-3 py-1 text-xs font-bold text-white animate-pulse dark:bg-red-700">
              PRIORITY
            </span>
          )}
        </div>

        <div className="absolute -bottom-12 left-6">
          <div className="h-24 w-24 overflow-hidden rounded-2xl border-4 border-white bg-gray-200 shadow-lg dark:border-gray-800 dark:bg-gray-700 dark:ring-1 dark:ring-gray-600">
            {profile.photo_urls?.[0] ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  const urls = (profile.photo_urls || []).filter(Boolean);
                  setPhotoLightbox({ urls, index: 0 });
                }}
                className="group relative h-full w-full border-0 bg-transparent p-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-gray-800"
                aria-label="View subject photographs"
              >
                <img
                  src={profile.photo_urls[0]}
                  alt=""
                  className="h-full w-full object-cover object-top transition group-hover:opacity-90"
                />
                <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition group-hover:bg-black/25 group-hover:opacity-100">
                  <FaExpand className="h-5 w-5 text-white drop-shadow-md" aria-hidden />
                </span>
              </button>
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-gray-300 dark:bg-gray-600">
                <FaUserSecret className="h-10 w-10 text-gray-500 dark:text-gray-400" />
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="pt-16 px-6 pb-6">
        {/* Identity */}
        <div className="mb-6">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-1">
            {profile.primary_name}
          </h2>
          
          <div className="mb-2 flex flex-wrap gap-2 text-sm text-gray-600 dark:text-gray-400">
            {profile.date_of_birth && (
              <span className="flex items-center gap-1">
                <FaCalendarAlt className="h-3 w-3" />
                DOB: {new Date(profile.date_of_birth).toLocaleDateString()}
              </span>
            )}
            {profile.nationality?.length > 0 && (
              <span>• {profile.nationality.join(', ')}</span>
            )}
            <span>
              • Status:{' '}
              <span className="font-medium capitalize text-teal-600 dark:text-teal-400">{profile.status}</span>
            </span>
          </div>

          {/* Aliases */}
          {profile.known_aliases?.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium uppercase text-gray-500 dark:text-gray-400">AKA:</span>
              {profile.known_aliases.map((alias, i) => (
                <span
                  key={i}
                  className="rounded-lg border border-gray-200 bg-gray-100 px-2 py-1 text-xs text-gray-700 dark:border-gray-600 dark:bg-gray-900/60 dark:text-gray-300"
                >
                  {alias}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Stats Grid */}
        <div className="mb-6 grid grid-cols-4 gap-1.5 sm:gap-3">
          <StatBox icon={FaHistory} label="Incidents" value={stats.incidentCount || 0} color="blue" />
          <StatBox
            icon={FaNetworkWired}
            label="Links"
            title="Associates"
            value={associateCount}
            color="purple"
            onActivate={associateCount > 0 ? openAssociatesPeek : undefined}
            interactiveHint="View associate mini-cards and open full profiles"
          />
          <StatBox icon={FaMapMarkerAlt} label="Locations" value={stats.locationCount || 0} color="green" />
          <StatBox
            icon={FaFingerprint}
            label="MO Match"
            value={mo.display}
            color="orange"
            title={moMatchCardTitle(mo.assessed)}
            valueClassName={mo.assessed ? '' : 'font-normal text-gray-400 dark:text-gray-500'}
          />
        </div>

        {/* Watchlist Flags */}
        {profile.watchlist_flags?.length > 0 && (
          <div className="mb-6 rounded-xl border border-red-200 bg-red-50 p-4 dark:border-red-800/90 dark:bg-red-950/25">
            <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-red-800 dark:text-red-300">
              <FaExclamationTriangle />
              <span>WATCHLIST ALERTS</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {profile.watchlist_flags.map((flag, i) => (
                <span
                  key={i}
                  className="flex items-center gap-1 rounded-full border border-red-200/80 bg-red-100 px-3 py-1 text-xs font-medium text-red-900 dark:border-red-800/60 dark:bg-red-950/50 dark:text-red-200"
                >
                  <FaFlag className="h-3 w-3" />
                  {flag.replace(/_/g, ' ').toUpperCase()}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Physical Description */}
        {(profile.height_cm || profile.build_type || profile.eye_color) && (
          <div className="mb-6 rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-600 dark:bg-gray-900/40">
            <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
              <FaIdCard className="text-teal-600" />
              Physical Description
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              {profile.height_cm && (
                <div>
                  <span className="text-gray-500 dark:text-gray-400">Height:</span>
                  <span className="ml-2 text-gray-900 dark:text-white font-medium">{profile.height_cm}cm</span>
                </div>
              )}
              {profile.build_type && (
                <div>
                  <span className="text-gray-500 dark:text-gray-400">Build:</span>
                  <span className="ml-2 text-gray-900 dark:text-white font-medium capitalize">{profile.build_type}</span>
                </div>
              )}
              {profile.eye_color && (
                <div>
                  <span className="text-gray-500 dark:text-gray-400">Eyes:</span>
                  <span className="ml-2 text-gray-900 dark:text-white font-medium">{profile.eye_color}</span>
                </div>
              )}
              {profile.hair_color && (
                <div>
                  <span className="text-gray-500 dark:text-gray-400">Hair:</span>
                  <span className="ml-2 text-gray-900 dark:text-white font-medium">{profile.hair_color}</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Location Data */}
        {(() => {
          const common = profile.common_presence?.trim();
          const residence = profile.residence_last_known?.trim();
          const sightings = mergedSightingsForDisplay(profile);
          const formatSightingLine = (s) => {
            const bits = [];
            if (s.seen_at) bits.push(new Date(s.seen_at).toLocaleString());
            if ((s.location || '').trim()) bits.push((s.location || '').trim());
            const who = (
              s.seen_by_other_name ||
              (s.seen_by_user_id ? s.seen_by_name : '') ||
              ''
            ).trim();
            if (who) bits.push(`Seen by: ${who}`);
            return bits.join(' · ');
          };
          const sightingLines = sightings.map(formatSightingLine).filter(Boolean);
          const hasLocationBlock = Boolean(common || residence || sightingLines.length > 0);
          if (!hasLocationBlock) return null;
          return (
            <div className="mb-6 rounded-xl border border-orange-200/80 bg-orange-50/60 p-4 dark:border-orange-800/50 dark:bg-orange-950/20">
              <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
                <FaMapMarkerAlt className="text-orange-600 dark:text-orange-400" />
                Location Data
              </h3>
              <div className="space-y-3 text-sm">
                {common && (
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-orange-800 dark:text-orange-300/90">
                      Common presence
                    </div>
                    <p className="mt-1 whitespace-pre-wrap text-gray-900 dark:text-gray-100">{common}</p>
                  </div>
                )}
                {residence && (
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-orange-800 dark:text-orange-300/90">
                      Residence (last known)
                    </div>
                    <p className="mt-1 text-gray-900 dark:text-gray-100">{residence}</p>
                  </div>
                )}
                {sightingLines.length > 0 && (
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-orange-800 dark:text-orange-300/90">
                      Last known sightings
                    </div>
                    <ul className="mt-1 list-inside list-disc space-y-1 text-gray-900 dark:text-gray-100">
                      {sightingLines.map((line, i) => (
                        <li key={i} className="text-sm">
                          {line}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          );
        })()}

        {/* MO Signature */}
        {profile.mo_signature && (
          <div className="border-t border-gray-200 pt-6 dark:border-gray-700">
            <h3 className="mb-3 flex items-center gap-2 text-lg font-semibold text-gray-900 dark:text-white">
              <FaChartLine className="text-teal-600" />
              Modus Operandi Signature
            </h3>
            <div className="space-y-3">
              {profile.mo_signature.target_types?.length > 0 && (
                <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 dark:border-blue-800/50 dark:bg-gray-900/45">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <span className="w-24 shrink-0 text-xs font-semibold uppercase tracking-wide text-blue-600 dark:text-blue-400">
                      Targets
                    </span>
                    <span className="break-words text-sm text-gray-900 dark:text-gray-100">
                      {profile.mo_signature.target_types.join(', ')}
                    </span>
                  </div>
                </div>
              )}
              {profile.mo_signature.time_patterns?.length > 0 && (
                <div className="rounded-xl border border-purple-200 bg-purple-50 p-4 dark:border-purple-800/50 dark:bg-gray-900/45">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <span className="w-24 shrink-0 text-xs font-semibold uppercase tracking-wide text-purple-600 dark:text-purple-400">
                      Time Pattern
                    </span>
                    <span className="break-words text-sm text-gray-900 dark:text-gray-100">
                      {profile.mo_signature.time_patterns.join(', ')}
                    </span>
                  </div>
                </div>
              )}
              {profile.mo_signature.entry_methods?.length > 0 && (
                <div className="rounded-xl border border-orange-200 bg-orange-50 p-4 dark:border-orange-800/50 dark:bg-gray-900/45">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <span className="w-24 shrink-0 text-xs font-semibold uppercase tracking-wide text-orange-600 dark:text-orange-400">
                      Entry
                    </span>
                    <span className="break-words text-sm text-gray-900 dark:text-gray-100">
                      {profile.mo_signature.entry_methods.join(', ')}
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Weapons (if present) */}
            {profile.mo_signature?.weapons_preferred?.length > 0 && (
              <div className="mt-3 rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-600 dark:bg-gray-900/50">
                <span className="text-xs font-medium uppercase text-red-600 dark:text-red-400">Preferred Weapons</span>
                <div className="mt-1 text-sm text-gray-900 dark:text-gray-100">
                  {profile.mo_signature.weapons_preferred.join(', ')}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {associatesPeekOpen && (
        <>
          <button
            type="button"
            className="fixed inset-0 z-[200] bg-black/50 backdrop-blur-[1px]"
            aria-label="Close associates list"
            onClick={closeAssociatesPeek}
          />
          <div
            className="fixed left-1/2 top-1/2 z-[201] w-[calc(100%-1.5rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-gray-200 bg-white p-4 shadow-2xl dark:border-gray-600 dark:bg-gray-800"
            role="dialog"
            aria-modal="true"
            aria-labelledby="associates-peek-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-start justify-between gap-2">
              <div>
                <h3 id="associates-peek-title" className="text-lg font-bold text-gray-900 dark:text-white">
                  Linked associates
                </h3>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {profile.primary_name} — open a full dossier from each row.
                </p>
              </div>
              <button
                type="button"
                onClick={closeAssociatesPeek}
                className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700"
                aria-label="Close"
              >
                <FaTimes className="h-4 w-4" />
              </button>
            </div>

            {associatesPeekLoading && (
              <div className="flex justify-center py-8">
                <BrandedLoader message="Loading…" size="sm" />
              </div>
            )}
            {!associatesPeekLoading && associatesPeekError && (
              <p className="rounded-lg bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950/40 dark:text-red-200">
                {associatesPeekError}
              </p>
            )}
            {!associatesPeekLoading && !associatesPeekError && associatesPeekList.length === 0 && (
              <p className="text-sm text-gray-500 dark:text-gray-400">
                No associate records returned. Try opening the full profile to refresh links.
              </p>
            )}
            {!associatesPeekLoading && !associatesPeekError && associatesPeekList.length > 0 && (
              <ul className="max-h-[min(60vh,24rem)] space-y-3 overflow-y-auto pr-1">
                {associatesPeekList.map((a) => (
                  <li key={a.id}>
                    <AssociateMiniRow a={a} onNavigate={closeAssociatesPeek} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}

      <PatrollerPhotoPreview
        key={photoLightbox ? `card-ph-${photoLightbox.index}` : 'card-ph-closed'}
        open={!!photoLightbox}
        onClose={() => setPhotoLightbox(null)}
        name={profile.primary_name?.trim() || 'Subject'}
        imageUrls={photoLightbox?.urls}
        initialIndex={photoLightbox?.index ?? 0}
      />
    </div>
  );
}
