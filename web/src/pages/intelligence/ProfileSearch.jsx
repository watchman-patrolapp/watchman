import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../supabase/client';
import { FaSearch, FaFilter, FaUserSecret, FaMapMarkerAlt, FaExclamationTriangle, FaArrowLeft } from 'react-icons/fa';
import CriminalProfileCard from '../../components/intelligence/CriminalProfileCard';
import IntelligenceFieldGuide from '../../components/intelligence/IntelligenceFieldGuide';

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

  const searchProfiles = useCallback(async () => {
    setLoading(true);
    try {
      let query = supabase
        .from('criminal_profiles')
        .select('*');

      if (searchQuery.length > 2) {
        query = query.or(`primary_name.ilike.%${searchQuery}%,known_aliases.cs.{${searchQuery}}`);
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
      setResults(data || []);
    } catch (error) {
      console.error('Search error:', error);
    } finally {
      setLoading(false);
    }
  }, [searchQuery, filters]);

  useEffect(() => {
    searchProfiles();
  }, [searchProfiles]);

  const handleSearch = (e) => {
    e.preventDefault();
    searchProfiles();
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
                <FaArrowLeft /> Intelligence home
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
            <button 
              onClick={() => navigate('/intelligence/profiles/new')}
              className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition flex items-center gap-2"
            >
              + Create New Profile
            </button>
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
          <div className="text-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-teal-600 mx-auto"></div>
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
                    stats={{
                      incidentCount: profile.incident_count || 0,
                      associateCount: profile.associate_count || 0
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