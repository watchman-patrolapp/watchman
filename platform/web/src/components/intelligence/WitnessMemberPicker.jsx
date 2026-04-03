import React, { useState, useEffect, useMemo, useRef } from 'react';
import { FaSearch, FaTimes, FaUser } from 'react-icons/fa';
import { loadPatrollerDirectoryMembers } from '../../utils/patrollerDirectory';
import BrandedLoader from '../layout/BrandedLoader';

function initials(name) {
  const s = (name || '').trim();
  if (!s) return '?';
  const p = s.split(/\s+/).filter(Boolean);
  if (p.length >= 2) return (p[0][0] + p[p.length - 1][0]).toUpperCase();
  return s.slice(0, 2).toUpperCase();
}

const DEFAULT_TEXT_INPUT_CLASS =
  'w-full rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-4 py-2.5 text-sm text-gray-900 dark:text-white placeholder-gray-400 focus:ring-2 focus:ring-teal-500 focus:border-transparent transition';

/**
 * Patroller/staff directory first, or free-text witness name (same pattern as criminal profile “Seen by”).
 * @param {(patch: { witnessUserId: string | null, witnessName: string, witnessAvatarUrl: string | null }) => void} onChange
 */
export default function WitnessMemberPicker({
  disabled = false,
  witnessUserId,
  witnessName,
  witnessAvatarUrl,
  onChange,
  textInputClass = DEFAULT_TEXT_INPUT_CLASS,
}) {
  const [directory, setDirectory] = useState([]);
  const [dirLoading, setDirLoading] = useState(false);
  const [directoryError, setDirectoryError] = useState(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState('');
  const pickerWrapRef = useRef(null);

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
    if (!pickerOpen) return;
    const onPointerDown = (e) => {
      const el = pickerWrapRef.current;
      if (el && !el.contains(e.target)) {
        setPickerOpen(false);
        setPickerQuery('');
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [pickerOpen]);

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

  const pickMember = (m) => {
    onChange({
      witnessUserId: m.id,
      witnessName: (m.full_name || m.email || 'Member').trim(),
      witnessAvatarUrl: m.avatar_url || null,
    });
    setPickerOpen(false);
    setPickerQuery('');
  };

  const clearMember = () => {
    onChange({ witnessUserId: null, witnessName: '', witnessAvatarUrl: null });
  };

  const nameTrim = (witnessName || '').trim();
  const hasMember = Boolean(witnessUserId);
  const hasOtherName = !hasMember && Boolean(nameTrim);

  return (
    <div className="space-y-2">
      <p className="text-xs text-gray-500 dark:text-gray-400">
        Choose a patroller, investigator, committee member, or admin from the directory, or enter someone else as plain
        text.
      </p>

      {!disabled && hasMember ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-2 rounded-full border border-teal-200 bg-teal-50 py-1 pl-1 pr-3 text-xs font-medium text-teal-900 dark:border-teal-800 dark:bg-teal-950/40 dark:text-teal-100">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full bg-teal-200 text-[10px] font-bold text-teal-900 dark:bg-teal-800 dark:text-teal-100">
              {witnessAvatarUrl ? (
                <img src={witnessAvatarUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                initials(nameTrim)
              )}
            </span>
            {nameTrim || 'Member'}
          </span>
          <button
            type="button"
            onClick={clearMember}
            className="text-xs text-red-600 hover:underline dark:text-red-400"
          >
            Clear
          </button>
        </div>
      ) : null}

      {!disabled && hasOtherName ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white px-3 py-1 text-xs dark:border-gray-600 dark:bg-gray-800">
            <FaUser className="h-3 w-3 text-gray-400" />
            {nameTrim}
          </span>
          <button
            type="button"
            onClick={() => onChange({ witnessUserId: null, witnessName: '', witnessAvatarUrl: null })}
            className="text-xs text-red-600 hover:underline dark:text-red-400"
          >
            Clear
          </button>
        </div>
      ) : null}

      {disabled ? (
        <p className="text-sm text-gray-600 dark:text-gray-300">
          {hasMember || hasOtherName ? nameTrim || 'Member witness' : <span className="italic text-gray-500">Not recorded</span>}
        </p>
      ) : (
        <>
          <div ref={pickerWrapRef} className="relative">
            <button
              type="button"
              onClick={() => {
                if (pickerOpen) {
                  setPickerOpen(false);
                  setPickerQuery('');
                } else {
                  setPickerOpen(true);
                  setPickerQuery('');
                }
              }}
              className="flex w-full items-center gap-2 rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-left text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white"
            >
              <FaSearch className="h-3 w-3 shrink-0 text-gray-400" />
              <span className="text-gray-600 dark:text-gray-300">
                {pickerOpen
                  ? 'Open — search and tap a row below'
                  : 'Choose patroller, investigator, committee, or admin…'}
              </span>
            </button>
            {pickerOpen && (
              <div
                className="absolute left-0 right-0 top-full z-50 mt-1 rounded-xl border border-gray-200 bg-white shadow-xl dark:border-gray-600 dark:bg-gray-800"
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
                      setPickerOpen(false);
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
                    No directory entries yet. Add members with patroller / staff roles, or use “someone else” below.
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
                          onClick={() => pickMember(m)}
                          className="flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm hover:bg-teal-50 dark:hover:bg-teal-950/40"
                        >
                          <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-gray-100 text-xs font-bold text-gray-700 ring-1 ring-gray-200 dark:bg-gray-700 dark:text-gray-100 dark:ring-gray-600">
                            {m.avatar_url ? (
                              <img src={m.avatar_url} alt="" className="h-full w-full object-cover" />
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
          <p className="text-[11px] text-gray-500 dark:text-gray-400">
            Not a platform member? Enter their name as text.
          </p>
          <input
            type="text"
            className={`${textInputClass} mt-0.5`}
            placeholder="e.g. Ms Dlamini (shop owner)"
            value={hasMember ? '' : witnessName || ''}
            onChange={(e) => {
              const v = e.target.value;
              onChange({ witnessUserId: null, witnessAvatarUrl: null, witnessName: v });
            }}
            disabled={disabled || hasMember}
          />
        </>
      )}
    </div>
  );
}
