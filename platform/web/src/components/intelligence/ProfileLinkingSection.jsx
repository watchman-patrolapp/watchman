import React, { useState, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '../../supabase/client';
import QuickCreateProfileDrawer from './QuickCreateProfileDrawer';
import { FaSearch, FaUserSecret, FaEye, FaTimes, FaExternalLinkAlt } from 'react-icons/fa';
import toast from 'react-hot-toast';
import {
  INCIDENT_REPORT_CONNECTION_TYPE_OPTIONS,
  PROFILE_INCIDENT_CONFIDENCE_EXPLAINER,
} from '../../data/profileIncidentLinkTaxonomy';
import BrandedLoader from '../layout/BrandedLoader';

const ProfileLinkingSection = ({ entry, onUpdateEntry }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const reportReturnPath = `${location.pathname}${location.search}`;
  const [quickCreateOpen, setQuickCreateOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  /** Profiles loaded for the picker (ordered A–Z); filtered locally by searchQuery */
  const [profileCatalog, setProfileCatalog] = useState([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [linkedProfile, setLinkedProfile] = useState(entry.linked_profile_id ? {
    id: entry.linked_profile_id,
    name: entry.linked_profile_name,
    riskLevel: entry.linked_profile_risk
  } : null);

  const fetchProfileCatalog = async () => {
    setCatalogLoading(true);
    try {
      const { data: profiles, error } = await supabase
        .from('criminal_profiles')
        .select('id, primary_name, photo_urls, risk_level, status, known_aliases')
        .order('primary_name', { ascending: true, nullsFirst: false })
        .limit(1000);

      if (error) throw error;
      setProfileCatalog(profiles || []);
    } catch (err) {
      console.error('Profile catalog load:', err);
      toast.error('Failed to load profiles');
      setProfileCatalog([]);
    } finally {
      setCatalogLoading(false);
    }
  };

  const filteredProfiles = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return profileCatalog;
    return profileCatalog.filter((p) => {
      const name = (p.primary_name || '').toLowerCase();
      if (name.includes(q)) return true;
      const aliases = p.known_aliases || [];
      return aliases.some((a) => (a || '').toLowerCase().includes(q));
    });
  }, [profileCatalog, searchQuery]);

  const handleSelectProfile = (profile) => {
    setLinkedProfile({
      id: profile.id,
      name: profile.primary_name,
      riskLevel: profile.risk_level,
    });
    onUpdateEntry('linked_profile_id', profile.id);
    onUpdateEntry('linked_profile_name', profile.primary_name);
    onUpdateEntry('linked_profile_risk', profile.risk_level);
    onUpdateEntry('linked_connection_type', 'probable_suspect');
    onUpdateEntry('linked_confidence_score', null);
    setShowResults(false);
    setSearchQuery('');
    toast.success(`Linked to ${profile.primary_name}`);
  };

  const handleQuickCreated = (row) => {
    handleSelectProfile({
      id: row.id,
      primary_name: row.primary_name,
      risk_level: row.risk_level,
    });
    setProfileCatalog((prev) => {
      if (prev.some((p) => p.id === row.id)) return prev;
      const next = [
        ...prev,
        {
          id: row.id,
          primary_name: row.primary_name,
          photo_urls: row.photo_urls || [],
          risk_level: row.risk_level,
          status: row.status || 'active',
          known_aliases: row.known_aliases || [],
        },
      ];
      next.sort((a, b) =>
        (a.primary_name || '').localeCompare(b.primary_name || '', undefined, { sensitivity: 'base' })
      );
      return next;
    });
  };

  const handleRemoveLink = () => {
    setLinkedProfile(null);
    onUpdateEntry('linked_profile_id', null);
    onUpdateEntry('linked_profile_name', null);
    onUpdateEntry('linked_profile_risk', null);
    onUpdateEntry('linked_connection_type', null);
    onUpdateEntry('linked_confidence_score', null);
    toast.success('Profile link removed');
  };

  const getRiskBadgeClass = (riskLevel) => {
    switch (riskLevel) {
      case 'critical': return 'bg-red-600 text-white';
      case 'high': return 'bg-orange-600 text-white';
      case 'medium': return 'bg-yellow-600 text-gray-900';
      case 'low': return 'bg-green-600 text-white';
      default: return 'bg-gray-600 text-white';
    }
  };

  return (
    <div className="bg-white dark:bg-gray-700 rounded-xl p-4 border border-gray-200 dark:border-gray-600">
      <div className="flex items-center justify-between mb-3">
        <h5 className="font-medium text-gray-900 dark:text-white text-sm">
          Suspect {entry.metadata?.suspectNumber || ''}
        </h5>
        {linkedProfile && (
          <span className={`px-2 py-1 rounded-full text-xs font-bold ${getRiskBadgeClass(linkedProfile.riskLevel)}`}>
            {linkedProfile.riskLevel?.toUpperCase()} RISK
          </span>
        )}
      </div>

      {/* Current Description */}
      {entry.description && (
        <div className="mb-3 p-3 bg-gray-50 dark:bg-gray-600/50 rounded-lg">
          <p className="text-xs text-gray-600 dark:text-gray-400 mb-1">Current Description:</p>
          <p className="text-sm text-gray-800 dark:text-white">{entry.description}</p>
        </div>
      )}

      {/* Linked Profile Display */}
      {linkedProfile ? (
        <div className="mb-3 p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-gray-200 dark:bg-gray-600 rounded-full flex-shrink-0 overflow-hidden">
                <FaUserSecret className="w-full h-full p-1 text-gray-500" />
              </div>
              <div>
                <p className="font-medium text-gray-900 dark:text-white">{linkedProfile.name}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">Profile ID: {linkedProfile.id}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={handleRemoveLink}
              className="p-1 rounded-full hover:bg-red-100 dark:hover:bg-red-900/40 text-red-600 dark:text-red-400"
              title="Remove link"
            >
              <FaTimes className="w-4 h-4" />
            </button>
          </div>
          <div className="mt-3 space-y-2 border-t border-green-200/80 pt-3 dark:border-green-800/60">
            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300">
              How they relate to this incident
            </label>
            <select
              value={entry.linked_connection_type || 'probable_suspect'}
              onChange={(e) => onUpdateEntry('linked_connection_type', e.target.value)}
              className="w-full rounded-lg border border-gray-200 bg-white px-2 py-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-white"
            >
              {INCIDENT_REPORT_CONNECTION_TYPE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value} className="dark:bg-gray-800">
                  {opt.label}
                </option>
              ))}
            </select>
            <p className="text-[11px] text-gray-500 dark:text-gray-400">
              {
                INCIDENT_REPORT_CONNECTION_TYPE_OPTIONS.find(
                  (o) => o.value === (entry.linked_connection_type || 'probable_suspect')
                )?.hint
              }
            </p>
            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mt-2">
              Link confidence (optional)
            </label>
            <input
              type="number"
              min={1}
              max={100}
              inputMode="numeric"
              placeholder="1–100, leave blank if unsure"
              value={
                entry.linked_confidence_score === null || entry.linked_confidence_score === undefined
                  ? ''
                  : String(entry.linked_confidence_score)
              }
              onChange={(e) => {
                const v = e.target.value.trim();
                if (v === '') {
                  onUpdateEntry('linked_confidence_score', null);
                  return;
                }
                const n = Number(v);
                if (!Number.isFinite(n)) return;
                onUpdateEntry('linked_confidence_score', Math.max(1, Math.min(100, Math.round(n))));
              }}
              className="w-full rounded-lg border border-gray-200 bg-white px-2 py-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-white"
            />
            <p className="text-[10px] leading-snug text-gray-500 dark:text-gray-400">
              {PROFILE_INCIDENT_CONFIDENCE_EXPLAINER}
            </p>
          </div>
        </div>
      ) : (
        <div className="mb-3 p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg">
          <p className="text-xs text-yellow-700 dark:text-yellow-300">
            No profile linked yet. Open the search field below to browse or filter profiles.
          </p>
        </div>
      )}

      {/* Search / browse profiles */}
      <div className="relative">
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-1.5">Search existing profiles</p>
        <div className="flex items-center bg-gray-100 dark:bg-gray-600 rounded-lg px-3 py-2">
          <FaSearch className="text-gray-400 mr-2 shrink-0" />
          <input
            type="text"
            placeholder="Tap to browse — type to filter by name or alias"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onFocus={() => {
              setShowResults(true);
              void fetchProfileCatalog();
            }}
            onBlur={() => setTimeout(() => setShowResults(false), 200)}
            className="bg-transparent outline-none text-sm w-full min-w-0"
          />
        </div>

        {showResults && (
          <div
            className="absolute top-full left-0 right-0 z-50 mt-2 flex max-h-[min(22rem,calc(100vh-12rem))] flex-col overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-800"
            onMouseDown={(e) => e.preventDefault()}
            role="listbox"
            aria-label="Existing profiles"
          >
            {catalogLoading ? (
              <div className="flex justify-center p-4">
                <BrandedLoader message="Loading profiles…" size="sm" />
              </div>
            ) : (
              <>
                <div className="border-b border-gray-100 px-3 py-2 text-xs text-gray-500 dark:border-gray-700 dark:text-gray-400">
                  {searchQuery.trim()
                    ? `${filteredProfiles.length} match${filteredProfiles.length === 1 ? '' : 'es'}`
                    : `${profileCatalog.length} profile${profileCatalog.length === 1 ? '' : 's'} (A–Z)`}
                  {profileCatalog.length >= 1000 && (
                    <span className="ml-1 opacity-80">— showing first 1000</span>
                  )}
                </div>
                <ul className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
                  {filteredProfiles.length === 0 ? (
                    <li className="px-3 py-4 text-center text-sm text-gray-500 dark:text-gray-400">
                      {profileCatalog.length === 0
                        ? 'No profiles yet. Create one with New profile.'
                        : 'No names or aliases match your filter.'}
                    </li>
                  ) : (
                    filteredProfiles.map((profile) => (
                      <li key={profile.id} className="border-b border-gray-50 last:border-b-0 dark:border-gray-700/50">
                        <button
                          type="button"
                          onClick={() => handleSelectProfile(profile)}
                          className="flex w-full gap-3 p-3 text-left transition hover:bg-gray-50 dark:hover:bg-gray-700/50"
                        >
                          <div className="h-10 w-10 shrink-0 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-600">
                            {profile.photo_urls?.[0] ? (
                              <img
                                src={profile.photo_urls[0]}
                                alt=""
                                className="h-full w-full object-cover"
                              />
                            ) : (
                              <div className="flex h-full w-full items-center justify-center text-gray-500">
                                <FaUserSecret className="h-4 w-4" />
                              </div>
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-medium text-gray-900 dark:text-white text-sm">
                                {profile.primary_name}
                              </span>
                              <span
                                className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-bold ${getRiskBadgeClass(profile.risk_level)}`}
                              >
                                {(profile.risk_level || '').toUpperCase()}
                              </span>
                            </div>
                            {profile.known_aliases && profile.known_aliases.length > 0 && (
                              <p className="mt-0.5 truncate text-xs text-gray-500 dark:text-gray-400">
                                AKA: {profile.known_aliases.join(', ')}
                              </p>
                            )}
                            <p className="mt-0.5 text-xs text-gray-400 dark:text-gray-500">
                              Status: {profile.status}
                            </p>
                          </div>
                        </button>
                      </li>
                    ))
                  )}
                </ul>
              </>
            )}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="mt-3 flex flex-col gap-2">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setQuickCreateOpen(true)}
            className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-teal-600 text-white text-sm rounded-lg hover:bg-teal-700 transition"
          >
            <FaUserSecret className="w-4 h-4 shrink-0" />
            New profile
          </button>
          {linkedProfile && (
            <button
              type="button"
              onClick={() => {
                const params = new URLSearchParams();
                params.set('returnTo', reportReturnPath);
                navigate(`/intelligence/profiles/${linkedProfile.id}?${params.toString()}`);
              }}
              className="px-3 py-2 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700 transition flex items-center gap-2 shrink-0"
            >
              <FaEye className="w-4 h-4" />
              View
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={() => {
            const params = new URLSearchParams();
            params.set('returnTo', reportReturnPath);
            if (entry.description) params.set('description', entry.description);
            navigate(`/intelligence/profiles/new?${params.toString()}`);
          }}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 text-xs rounded-lg hover:bg-gray-50 dark:hover:bg-gray-600/50 transition"
        >
          <FaExternalLinkAlt className="w-3 h-3" />
          Open full profile editor
        </button>
      </div>

      <QuickCreateProfileDrawer
        open={quickCreateOpen}
        onClose={() => setQuickCreateOpen(false)}
        suspectDescription={entry.description || ''}
        onCreated={handleQuickCreated}
        returnToPath={reportReturnPath}
      />
    </div>
  );
};

export default ProfileLinkingSection;