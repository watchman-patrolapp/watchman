import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../supabase/client';
import { FaSearch, FaUserSecret, FaExclamationTriangle, FaEye } from 'react-icons/fa';

const GlobalSearch = () => {
  const [searchQuery, setSearchQuery] = useState('');
  const [showResults, setShowResults] = useState(false);
  const [searchResults, setSearchResults] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const navigate = useNavigate();
  const searchRef = useRef(null);

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchQuery.length > 2) {
        performSearch(searchQuery);
      } else {
        setSearchResults([]);
        setError(null);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [searchQuery]);

  const performSearch = async (query) => {
    setIsLoading(true);
    setError(null);
    
    try {
      // Search criminal profiles
      const { data: profiles, error: profileError } = await supabase
        .from('criminal_profiles')
        .select('id, primary_name, photo_urls, risk_level, status, known_aliases')
        .or(`primary_name.ilike.%${query}%,known_aliases.cs.{${query}}`)
        .limit(5);

      if (profileError) throw profileError;

      // Format results
      const formattedResults = (profiles || []).map(profile => ({
        type: 'profile',
        id: profile.id,
        name: profile.primary_name,
        photo: profile.photo_urls?.[0],
        riskLevel: profile.risk_level,
        status: profile.status,
        aliases: profile.known_aliases
      }));

      setSearchResults(formattedResults);
    } catch (err) {
      console.error('Search error:', err);
      setError('Failed to search profiles');
      setSearchResults([]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSelectResult = (result) => {
    if (result.type === 'profile') {
      navigate(`/intelligence/profiles/${result.id}`);
      setShowResults(false);
      setSearchQuery('');
    }
  };

  const getRiskBadgeColor = (riskLevel) => {
    switch (riskLevel) {
      case 'critical': return 'bg-red-600 text-white';
      case 'high': return 'bg-orange-600 text-white';
      case 'medium': return 'bg-yellow-600 text-gray-900';
      case 'low': return 'bg-green-600 text-white';
      default: return 'bg-gray-600 text-white';
    }
  };

  const getRiskIcon = (riskLevel) => {
    switch (riskLevel) {
      case 'critical': return <FaExclamationTriangle className="w-3 h-3" />;
      case 'high': return <FaExclamationTriangle className="w-3 h-3" />;
      case 'medium': return <FaEye className="w-3 h-3" />;
      case 'low': return <FaEye className="w-3 h-3" />;
      default: return <FaUserSecret className="w-3 h-3" />;
    }
  };

  return (
    <div className="relative" ref={searchRef}>
      <div className="flex items-center bg-gray-100 dark:bg-gray-700 rounded-full px-4 py-2 w-64">
        <FaSearch className="text-gray-400 mr-2" />
        <input
          type="text"
          placeholder="Search suspects, incidents..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onFocus={() => setShowResults(true)}
          onBlur={() => setTimeout(() => setShowResults(false), 200)}
          className="bg-transparent outline-none text-sm w-full"
        />
      </div>

      {/* Search Results Dropdown */}
      {showResults && searchResults.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-2 bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 z-50 max-h-80 overflow-y-auto">
          <div className="p-2 text-xs text-gray-500 dark:text-gray-400 border-b border-gray-100 dark:border-gray-700">
            Criminal Profiles
          </div>
          {searchResults.map((result) => (
            <button
              key={result.id}
              onClick={() => handleSelectResult(result)}
              className="w-full text-left p-3 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition border-b border-gray-50 dark:border-gray-700/50 last:border-b-0"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-gray-200 dark:bg-gray-600 rounded-full flex-shrink-0 overflow-hidden">
                  {result.photo ? (
                    <img src={result.photo} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-gray-500">
                      <FaUserSecret className="w-5 h-5" />
                    </div>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-gray-900 dark:text-white truncate">
                      {result.name}
                    </span>
                    <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-bold ${getRiskBadgeColor(result.riskLevel)}`}>
                      {getRiskIcon(result.riskLevel)}
                      {result.riskLevel?.toUpperCase()}
                    </span>
                  </div>
                  {result.aliases && result.aliases.length > 0 && (
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                      AKA: {result.aliases.join(', ')}
                    </p>
                  )}
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                    Status: {result.status}
                  </p>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Loading State */}
      {showResults && isLoading && (
        <div className="absolute top-full left-0 right-0 mt-2 bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 z-50 p-4">
          <div className="flex items-center justify-center space-x-2">
            <div className="w-4 h-4 border-2 border-indigo-200 border-t-indigo-600 rounded-full animate-spin" />
            <span className="text-sm text-gray-600 dark:text-gray-400">Searching...</span>
          </div>
        </div>
      )}

      {/* Error State */}
      {showResults && error && (
        <div className="absolute top-full left-0 right-0 mt-2 bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 z-50 p-4">
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        </div>
      )}

      {/* Empty State */}
      {showResults && searchQuery.length > 2 && !isLoading && searchResults.length === 0 && !error && (
        <div className="absolute top-full left-0 right-0 mt-2 bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 z-50 p-4">
          <p className="text-sm text-gray-500 dark:text-gray-400">No profiles found</p>
        </div>
      )}
    </div>
  );
};

export default GlobalSearch;