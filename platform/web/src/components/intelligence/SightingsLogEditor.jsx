import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { FaPlus, FaSearch, FaTimes, FaUser } from 'react-icons/fa';
import { useAuth } from '../../auth/useAuth';
import {
  emptySightingTemplate,
  normalizeSightingsLog,
} from '../../utils/criminalProfileSightings';
import { loadPatrollerDirectoryMembers } from '../../utils/patrollerDirectory';
import BrandedLoader from '../layout/BrandedLoader';

const STAFF_ROLES = new Set(['admin', 'committee', 'technical_support']);

function initials(name) {
  const s = (name || '').trim();
  if (!s) return '?';
  const p = s.split(/\s+/).filter(Boolean);
  if (p.length >= 2) return (p[0][0] + p[p.length - 1][0]).toUpperCase();
  return s.slice(0, 2).toUpperCase();
}

function SeenByChip({ entry, viewerId, viewerRole }) {
  const uid = entry.seen_by_user_id;
  const label =
    (entry.seen_by_name || '').trim() ||
    (entry.seen_by_other_name || '').trim() ||
    '';
  if (!label && !uid) return null;

  const isSelf = uid && viewerId && uid === viewerId;
  const staff = STAFF_ROLES.has(String(viewerRole || '').toLowerCase());
  const avatarUrl = entry.seen_by_avatar_url || null;

  const inner = (
    <span className="inline-flex items-center gap-2 rounded-full border border-teal-200 bg-teal-50 py-1 pl-1 pr-3 text-xs font-medium text-teal-900 dark:border-teal-800 dark:bg-teal-950/40 dark:text-teal-100">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full bg-teal-200 text-[10px] font-bold text-teal-900 dark:bg-teal-800 dark:text-teal-100">
        {avatarUrl ? (
          <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          initials(label)
        )}
      </span>
      {label}
    </span>
  );

  if (uid && isSelf) {
    return (
      <Link to="/profile" className="inline-flex hover:opacity-90">
        {inner}
      </Link>
    );
  }
  if (uid && staff) {
    return (
      <Link to="/admin/members" className="inline-flex hover:opacity-90" title="Member directory">
        {inner}
      </Link>
    );
  }
  return <span className="inline-flex">{inner}</span>;
}

export default function SightingsLogEditor({
  value,
  onChange,
  disabled = false,
  dateInputClass = '',
  textInputClass = '',
  sectionHintClass = 'text-xs text-gray-500 dark:text-gray-400',
}) {
  const { user } = useAuth();
  const viewerId = user?.id;
  const viewerRole = user?.role;
  const [directory, setDirectory] = useState([]);
  const [dirLoading, setDirLoading] = useState(false);
  const [directoryError, setDirectoryError] = useState(null);
  const [openPickerIndex, setOpenPickerIndex] = useState(null);
  const [pickerQuery, setPickerQuery] = useState('');
  const pickerWrapRef = useRef(null);

  const entries = useMemo(() => normalizeSightingsLog(value), [value]);

  const setEntries = useCallback(
    (next) => {
      const list = typeof next === 'function' ? next(entries) : next;
      onChange(list);
    },
    [entries, onChange]
  );

  useEffect(() => {
    let cancelled = false;
    setDirLoading(true);
    setDirectoryError(null);
    loadPatrollerDirectoryMembers().then(({ members, errorHint }) => {
      if (cancelled) return;
      setDirectory(members);
      setDirectoryError(errorHint);
      setDirLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (openPickerIndex == null) return;
    const onPointerDown = (e) => {
      const el = pickerWrapRef.current;
      if (el && !el.contains(e.target)) {
        setOpenPickerIndex(null);
        setPickerQuery('');
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [openPickerIndex]);

  const filteredDirectory = useMemo(() => {
    const q = pickerQuery.trim().toLowerCase();
    const list = [...directory];
    list.sort((a, b) =>
      (a.full_name || a.email || '').localeCompare(b.full_name || b.email || '', undefined, {
        sensitivity: 'base',
      })
    );
    if (!q) return list;
    return list.filter((m) => {
      const name = (m.full_name || '').toLowerCase();
      const email = (m.email || '').toLowerCase();
      return name.includes(q) || email.includes(q);
    });
  }, [directory, pickerQuery]);

  const updateEntry = (index, patch) => {
    setEntries((prev) => {
      const list = normalizeSightingsLog(prev);
      const next = [...list];
      next[index] = { ...next[index], ...patch };
      return next;
    });
  };

  const removeEntry = (index) => {
    setEntries((prev) => {
      const list = normalizeSightingsLog(prev);
      return list.filter((_, i) => i !== index);
    });
  };

  const addEntry = () => {
    setEntries((prev) => [...normalizeSightingsLog(prev), emptySightingTemplate()]);
  };

  const pickPatroller = (index, m) => {
    updateEntry(index, {
      seen_by_user_id: m.id,
      seen_by_name: (m.full_name || m.email || 'Member').trim(),
      seen_by_avatar_url: m.avatar_url || null,
      seen_by_other_name: null,
    });
    setOpenPickerIndex(null);
    setPickerQuery('');
  };

  const clearSeenBy = (index) => {
    updateEntry(index, {
      seen_by_user_id: null,
      seen_by_name: null,
      seen_by_avatar_url: null,
      seen_by_other_name: null,
    });
  };

  return (
    <div className="space-y-4">
      <p className={sectionHintClass}>
        Add one row per reported sighting. Seen by: choose a patroller, committee, or admin from the directory,
        or enter someone else as plain text (e.g. shopkeeper).
      </p>

      {entries.length === 0 && !disabled && (
        <button
          type="button"
          onClick={addEntry}
          className="inline-flex items-center gap-2 rounded-lg border border-dashed border-orange-300 px-3 py-2 text-sm font-medium text-orange-800 hover:bg-orange-50 dark:border-orange-700 dark:text-orange-200 dark:hover:bg-orange-950/30"
        >
          <FaPlus className="h-3 w-3" /> Add sighting
        </button>
      )}

      {entries.map((entry, index) => (
        <div
          key={entry.id || index}
          className="rounded-xl border border-orange-200/90 bg-orange-50/40 p-4 dark:border-orange-800/60 dark:bg-orange-950/20"
        >
          <div className="mb-3 flex items-center justify-between gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-orange-800 dark:text-orange-300/90">
              Sighting {index + 1}
            </span>
            {!disabled && entries.length >= 1 && (
              <button
                type="button"
                onClick={() => removeEntry(index)}
                className="rounded p-1 text-red-600 hover:bg-red-100 dark:hover:bg-red-950/50"
                aria-label="Remove sighting"
              >
                <FaTimes className="h-4 w-4" />
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div>
              <label className="text-xs font-medium text-gray-600 dark:text-gray-400">Date</label>
              <input
                type="date"
                disabled={disabled}
                className={dateInputClass}
                value={
                  entry.seen_at
                    ? new Date(entry.seen_at).toISOString().split('T')[0]
                    : ''
                }
                onChange={(e) => {
                  const d = e.target.value;
                  if (!d) {
                    updateEntry(index, { seen_at: null });
                    return;
                  }
                  const t = entry.seen_at
                    ? new Date(entry.seen_at).toTimeString().slice(0, 5)
                    : '00:00';
                  updateEntry(index, { seen_at: new Date(`${d}T${t}`).toISOString() });
                }}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 dark:text-gray-400">Time</label>
              <input
                type="time"
                disabled={disabled}
                className={dateInputClass}
                value={
                  entry.seen_at ? new Date(entry.seen_at).toTimeString().slice(0, 5) : ''
                }
                onChange={(e) => {
                  const date = entry.seen_at
                    ? new Date(entry.seen_at).toISOString().split('T')[0]
                    : new Date().toISOString().split('T')[0];
                  updateEntry(index, {
                    seen_at: new Date(`${date}T${e.target.value || '00:00'}`).toISOString(),
                  });
                }}
              />
            </div>
            <div className="md:col-span-2">
              <label className="text-xs font-medium text-gray-600 dark:text-gray-400">
                Location description
              </label>
              <input
                type="text"
                disabled={disabled}
                className={textInputClass}
                placeholder="Where the subject was seen"
                value={entry.location || ''}
                onChange={(e) => updateEntry(index, { location: e.target.value })}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 dark:text-gray-400">Latitude</label>
              <input
                type="number"
                step="any"
                disabled={disabled}
                className={textInputClass}
                value={entry.lat != null && Number.isFinite(entry.lat) ? String(entry.lat) : ''}
                onChange={(e) => {
                  const v = e.target.value.trim();
                  updateEntry(index, { lat: v === '' ? null : Number(v) });
                }}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 dark:text-gray-400">Longitude</label>
              <input
                type="number"
                step="any"
                disabled={disabled}
                className={textInputClass}
                value={entry.lng != null && Number.isFinite(entry.lng) ? String(entry.lng) : ''}
                onChange={(e) => {
                  const v = e.target.value.trim();
                  updateEntry(index, { lng: v === '' ? null : Number(v) });
                }}
              />
            </div>
          </div>

          <div className="mt-4 border-t border-orange-200/80 pt-3 dark:border-orange-800/50">
            <p className="mb-2 text-xs font-semibold text-gray-700 dark:text-gray-300">Seen by</p>
            {!disabled && (entry.seen_by_user_id || (entry.seen_by_name && !entry.seen_by_other_name)) ? (
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <SeenByChip entry={entry} viewerId={viewerId} viewerRole={viewerRole} />
                <button
                  type="button"
                  onClick={() => clearSeenBy(index)}
                  className="text-xs text-red-600 hover:underline dark:text-red-400"
                >
                  Clear
                </button>
              </div>
            ) : null}
            {!disabled && entry.seen_by_other_name && !entry.seen_by_user_id ? (
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white px-3 py-1 text-xs dark:border-gray-600 dark:bg-gray-800">
                  <FaUser className="h-3 w-3 text-gray-400" />
                  {entry.seen_by_other_name}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    updateEntry(index, {
                      seen_by_other_name: null,
                      seen_by_name: null,
                    })
                  }
                  className="text-xs text-red-600 hover:underline dark:text-red-400"
                >
                  Clear
                </button>
              </div>
            ) : null}

            {disabled ? (
              <div className="flex flex-wrap gap-2">
                {(entry.seen_by_user_id || entry.seen_by_other_name || entry.seen_by_name) && (
                  <SeenByChip entry={entry} viewerId={viewerId} viewerRole={viewerRole} />
                )}
                {!entry.seen_by_user_id &&
                  !entry.seen_by_other_name &&
                  !entry.seen_by_name && (
                    <span className="text-sm italic text-gray-500 dark:text-gray-400">Not recorded</span>
                  )}
              </div>
            ) : (
              <>
                <div
                  ref={openPickerIndex === index ? pickerWrapRef : undefined}
                  className="relative"
                >
                  <button
                    type="button"
                    onClick={() => {
                      if (openPickerIndex === index) {
                        setOpenPickerIndex(null);
                        setPickerQuery('');
                      } else {
                        setOpenPickerIndex(index);
                        setPickerQuery('');
                      }
                    }}
                    className="flex w-full items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-left text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-white"
                  >
                    <FaSearch className="h-3 w-3 shrink-0 text-gray-400" />
                    <span className="text-gray-600 dark:text-gray-300">
                      {openPickerIndex === index
                        ? 'Open — search and tap a row below'
                        : 'Choose patroller, investigator, committee, or admin…'}
                    </span>
                  </button>
                  {openPickerIndex === index && (
                    <div
                      className="absolute left-0 right-0 top-full z-50 mt-1 rounded-lg border border-gray-200 bg-white shadow-xl dark:border-gray-600 dark:bg-gray-800"
                      onMouseDown={(e) => e.preventDefault()}
                    >
                      <div className="flex items-center gap-2 border-b border-gray-100 p-2 dark:border-gray-700">
                        <FaSearch className="h-3.5 w-3.5 shrink-0 text-gray-400" />
                        <input
                          type="text"
                          autoFocus
                          value={pickerQuery}
                          onChange={(e) => setPickerQuery(e.target.value)}
                          placeholder={dirLoading ? 'Loading directory…' : 'Search name or email…'}
                          className="min-w-0 flex-1 border-0 bg-transparent py-1 text-sm outline-none ring-0 placeholder:text-gray-400 dark:text-white dark:placeholder:text-gray-500"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            setOpenPickerIndex(null);
                            setPickerQuery('');
                          }}
                          className="rounded p-1 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700"
                          aria-label="Close directory"
                        >
                          <FaTimes className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      {directoryError ? (
                        <p className="p-3 text-sm text-amber-800 dark:text-amber-200/90">{directoryError}</p>
                      ) : null}
                      {dirLoading ? (
                        <div className="flex justify-center p-4">
                          <BrandedLoader message="Loading directory…" size="sm" />
                        </div>
                      ) : directory.length === 0 && !directoryError ? (
                        <p className="p-3 text-sm text-gray-500 dark:text-gray-400">
                          No directory entries yet. Add members with patroller / staff roles, or use “someone else”
                          below.
                        </p>
                      ) : filteredDirectory.length === 0 ? (
                        <p className="p-3 text-sm text-gray-500 dark:text-gray-400">
                          {pickerQuery.trim()
                            ? 'No names match your search. Try another spelling or use “someone else” below.'
                            : 'No entries to show.'}
                        </p>
                      ) : (
                        <ul className="max-h-72 overflow-y-auto py-1" role="listbox" aria-label="Patrollers and staff">
                          {filteredDirectory.map((m) => (
                            <li
                              key={String(m.id)}
                              className="border-b border-gray-50 last:border-0 dark:border-gray-700/50"
                            >
                              <button
                                type="button"
                                onClick={() => pickPatroller(index, m)}
                                className="flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm hover:bg-teal-50 dark:hover:bg-teal-950/40"
                              >
                                <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-gray-100 text-xs font-bold text-gray-700 ring-1 ring-gray-200 dark:bg-gray-700 dark:text-gray-100 dark:ring-gray-600">
                                  {m.avatar_url ? (
                                    <img
                                      src={m.avatar_url}
                                      alt=""
                                      className="h-full w-full object-cover"
                                    />
                                  ) : (
                                    initials(m.full_name || m.email)
                                  )}
                                </span>
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate font-medium text-gray-900 dark:text-white">
                                    {(m.full_name || '').trim() || m.email || 'Member'}
                                  </span>
                                  <span className="text-xs capitalize text-gray-500 dark:text-gray-400">
                                    {(m.role || 'member').replace(/_/g, ' ')}
                                  </span>
                                </span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </div>
                <p className="mt-2 text-[11px] text-gray-500 dark:text-gray-400">
                  Not a platform member? Enter their name as text (saved as witness / other).
                </p>
                <input
                  type="text"
                  className={`${textInputClass} mt-1`}
                  placeholder="e.g. Ms Dlamini (shop owner)"
                  value={entry.seen_by_other_name || ''}
                  onChange={(e) => {
                    const t = e.target.value.trim();
                    if (t) {
                      updateEntry(index, {
                        seen_by_user_id: null,
                        seen_by_avatar_url: null,
                        seen_by_other_name: e.target.value,
                        seen_by_name: e.target.value.trim(),
                      });
                    } else {
                      updateEntry(index, {
                        seen_by_other_name: null,
                        seen_by_name: null,
                      });
                    }
                  }}
                  disabled={disabled || Boolean(entry.seen_by_user_id)}
                />
              </>
            )}
          </div>
        </div>
      ))}

      {!disabled && entries.length > 0 && (
        <button
          type="button"
          onClick={addEntry}
          className="inline-flex items-center gap-2 rounded-lg border border-orange-300 bg-white px-3 py-2 text-sm font-medium text-orange-800 hover:bg-orange-50 dark:border-orange-700 dark:bg-gray-800 dark:text-orange-200 dark:hover:bg-orange-950/30"
        >
          <FaPlus className="h-3 w-3" /> Add another sighting
        </button>
      )}
    </div>
  );
}

export { SeenByChip };
