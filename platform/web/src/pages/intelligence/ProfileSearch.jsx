import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../supabase/client';
import { FaSearch, FaFilter, FaUserSecret, FaMapMarkerAlt, FaExclamationTriangle, FaArrowLeft } from 'react-icons/fa';
import CriminalProfileCard from '../../components/intelligence/CriminalProfileCard';
import IntelligenceFieldGuide from '../../components/intelligence/IntelligenceFieldGuide';
import ThemeToggle from '../../components/ThemeToggle';
import BrandedLoader from '../../components/layout/BrandedLoader';
import { totalProfileLocationCardCount } from '../../utils/profileLocationCount';
import { buildAssociatesPreviewList } from '../../utils/profileAssociates';
import { collectUserIdsFromProfiles, fetchUserLabelMap } from '../../utils/profileUserLabels';

/** PostgREST returns `{ count: n }[]` for `table(count)` embeds — flatten for cards. */
function normalizeProfileSearchRow(row) {
  const n = (embed) => {
    const c = embed?.[0]?.count;
    return typeof c === 'number' ? c : Number(c) || 0;
  };
  const {
    profile_incidents,
    associate_out,
    associate_in,
    profile_geography,
    associate_preview_out,
    associate_preview_in,
    ...rest
  } = row;
  // Links are stored one-way (owner profile_id → associate_profile_id). Count both directions
  // so the linked subject also shows a non-zero associate count.
  const associate_count = n(associate_out) + n(associate_in);
  return {
    ...rest,
    incident_count: n(profile_incidents),
    associate_count,
    location_count: totalProfileLocationCardCount(rest, profile_geography),
    associates_preview: buildAssociatesPreviewList(
      rest.id,
      associate_preview_out,
      associate_preview_in
    ),
  };
}

export default function ProfileSearch() {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');
  const [filters, setFilters] = useState({
    risk_level: '',
    status: '',
    watchlist_only: false
  });
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [userLabelById, setUserLabelById] = useState({});
  /** Avoid text filter firing on every keystroke (heavy embed query + label RPC). */
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const searchGenerationRef = useRef(0);

  useEffect(() => {
    const q = searchQuery.trim();
    if (q.length <= 2) {
      setDebouncedSearch(q);
      return undefined;
    }
    const t = setTimeout(() => setDebouncedSearch(q), 380);
    return () => clearTimeout(t);
  }, [searchQuery]);

  const runSearch = useCallback(
    async (nameFilterOverride) => {
      const q =
        nameFilterOverride !== undefined && nameFilterOverride !== null
          ? String(nameFilterOverride).trim()
          : debouncedSearch.trim();
      const gen = ++searchGenerationRef.current;
      setLoading(true);
      try {
        let query = supabase.from('criminal_profiles').select(`
          *,
          profile_incidents(count),
          associate_out:profile_associates!profile_id(count),
          associate_in:profile_associates!associate_profile_id(count),
          associate_preview_out:profile_associates!profile_id(
            id,
            relationship_type,
            associate_profile:associate_profile_id(id, primary_name, risk_level, status, photo_urls)
          ),
          associate_preview_in:profile_associates!associate_profile_id(
            id,
            relationship_type,
            subject_profile:profile_id(id, primary_name, risk_level, status, photo_urls)
          ),
          profile_geography!profile_id(count)
        `);

        if (q.length > 2) {
          query = query.or(`primary_name.ilike.%${q}%,known_aliases.cs.{${q}}`);
        }

        if (filters.risk_level) {
          query = query.eq('risk_level', filters.risk_level);
        }

        if (filters.status) {
          query = query.eq('status', filters.status);
        }

        if (filters.watchlist_only) {
          query = query.not('watchlist_flags', 'is', null);
        }

        query = query.order('risk_level', { ascending: false }).limit(20);

        const { data, error } = await query;
        if (error) throw error;
        if (gen !== searchGenerationRef.current) return;
        const rows = (data || []).map(normalizeProfileSearchRow);
        setResults(rows);
        const auditIds = collectUserIdsFromProfiles(rows);
        const labels = await fetchUserLabelMap(supabase, auditIds);
        if (gen !== searchGenerationRef.current) return;
        setUserLabelById(labels);
      } catch (error) {
        console.error('Search error:', error);
        if (gen === searchGenerationRef.current) {
          setUserLabelById({});
        }
      } finally {
        if (gen === searchGenerationRef.current) {
          setLoading(false);
        }
      }
    },
    [debouncedSearch, filters]
  );

  useEffect(() => {
    void runSearch();
  }, [runSearch]);

  const handleSearch = (e) => {
    e.preventDefault();
    void runSearch(searchQuery);
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 pb-20">
      {/* Header */}
      <header className="bg-white dark:bg-gray-800 shadow-sm border-b border-gray-200 dark:border-gray-700 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <button 
                type="button"
                onClick={() => navigate('/intelligence')}
                className="flex items-center gap-2 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition"
              >
                <FaArrowLeft /> Intelligence hub
              </button>
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
                <FaUserSecret className="text-teal-600" />
                Criminal Intelligence Database
              </h1>
            </div>
            <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
              <FaExclamationTriangle className="text-red-500" />
              <span>{results.filter(r => r.risk_level === 'critical').length} critical threats</span>
            </div>
            <div className="flex flex-wrap items-center gap-2 justify-end w-full md:w-auto">
              <ThemeToggle variant="toolbar" />
              <button
                type="button"
                onClick={() => navigate('/intelligence/profiles/new')}
                className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition flex items-center gap-2"
              >
                + Create New Profile
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="mb-6">
          <IntelligenceFieldGuide />
        </div>

      {/* Search and Filters */}
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-4 mb-6">
          <form onSubmit={handleSearch} className="flex gap-4 mb-4">
            <div className="flex-1 relative">
              <FaSearch className="absolute left-3 top-3 text-gray-400" />
              <input
                type="text"
                placeholder="Search by name or alias..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              />
            </div>
            <button 
              type="submit"
              className="px-6 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition"
            >
              Search
            </button>
          </form>

          <div className="flex flex-wrap gap-4 items-center">
            <div className="flex items-center gap-2">
              <FaFilter className="text-gray-400" />
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Filters:</span>
            </div>
            
            <select 
              value={filters.risk_level}
              onChange={(e) => setFilters({...filters, risk_level: e.target.value})}
              className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1.5 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            >
              <option value="">All Risk Levels</option>
              <option value="critical">Critical</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>

            <select 
              value={filters.status}
              onChange={(e) => setFilters({...filters, status: e.target.value})}
              className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1.5 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            >
              <option value="">All Statuses</option>
              <option value="wanted">Wanted</option>
              <option value="active">Active</option>
              <option value="incarcerated">Incarcerated</option>
            </select>

            <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
              <input 
                type="checkbox"
                checked={filters.watchlist_only}
                onChange={(e) => setFilters({...filters, watchlist_only: e.target.checked})}
                className="rounded border-gray-300 text-teal-600 focus:ring-teal-500"
              />
              Watchlist only
            </label>
          </div>
        </div>

        {/* Results */}
        {loading ? (
          <div className="flex justify-center py-12">
            <BrandedLoader message="Searching profiles…" size="md" />
          </div>
        ) : results.length === 0 ? (
          <div className="text-center py-12 text-gray-500 dark:text-gray-400">
            <FaUserSecret className="w-16 h-16 mx-auto mb-4 opacity-30" />
            <p>No profiles found matching your criteria.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {results.map(profile => (
                <div 
                  key={profile.id} 
                  onClick={() => navigate(`/intelligence/profiles/${profile.id}`)}
                  className="cursor-pointer hover:shadow-lg transition"
                >
                  <CriminalProfileCard 
                    profile={profile}
                    userLabelById={userLabelById}
                    associatesPreview={profile.associates_preview}
                    stats={{
                      incidentCount: profile.incident_count || 0,
                      associateCount: profile.associate_count || 0,
                      locationCount: profile.location_count || 0,
                    }}
                  />
                </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}