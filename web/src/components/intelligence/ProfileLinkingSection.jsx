import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../supabase/client';
import QuickCreateProfileDrawer from './QuickCreateProfileDrawer';
import { FaSearch, FaUserSecret, FaEye, FaTimes, FaExternalLinkAlt } from 'react-icons/fa';
import toast from 'react-hot-toast';

const ProfileLinkingSection = ({ entry, onUpdateEntry }) => {
  const navigate = useNavigate();
  const [quickCreateOpen, setQuickCreateOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [linkedProfile, setLinkedProfile] = useState(entry.linked_profile_id ? {
    id: entry.linked_profile_id,
    name: entry.linked_profile_name,
    riskLevel: entry.linked_profile_risk
  } : null);

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchQuery.length > 2) {
        performSearch(searchQuery);
      } else {
        setSearchResults([]);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [searchQuery]);

  const performSearch = async (query) => {
    setIsLoading(true);
    try {
      const { data: profiles, error } = await supabase
        .from('criminal_profiles')
        .select('id, primary_name, photo_urls, risk_level, status, known_aliases')
        .or(`primary_name.ilike.%${query}%,known_aliases.cs.{${query}}`)
        .limit(5);

      if (error) throw error;
      setSearchResults(profiles || []);
    } catch (err) {
      console.error('Search error:', err);
      toast.error('Failed to search profiles');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSelectProfile = (profile) => {
    setLinkedProfile({
      id: profile.id,
      name: profile.primary_name,
      riskLevel: profile.risk_level,
    });
    onUpdateEntry('linked_profile_id', profile.id);
    onUpdateEntry('linked_profile_name', profile.primary_name);
    onUpdateEntry('linked_profile_risk', profile.risk_level);
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
  };

  const handleRemoveLink = () => {
    setLinkedProfile(null);
    onUpdateEntry('linked_profile_id', null);
    onUpdateEntry('linked_profile_name', null);
    onUpdateEntry('linked_profile_risk', null);
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
        </div>
      ) : (
        <div className="mb-3 p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg">
          <p className="text-xs text-yellow-700 dark:text-yellow-300">
            No profile linked yet. Search for existing profiles to link this suspect.
          </p>
        </div>
      )}

      {/* Search Input */}
      <div className="relative">
        <div className="flex items-center bg-gray-100 dark:bg-gray-600 rounded-lg px-3 py-2">
          <FaSearch className="text-gray-400 mr-2" />
          <input
            type="text"
            placeholder="Search profiles by name or alias..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onFocus={() => setShowResults(true)}
            onBlur={() => setTimeout(() => setShowResults(false), 200)}
            className="bg-transparent outline-none text-sm w-full"
          />
        </div>

        {/* Search Results */}
        {showResults && searchResults.length > 0 && (
          <div className="absolute top-full left-0 right-0 mt-2 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 z-50 max-h-60 overflow-y-auto">
            {searchResults.map((profile) => (
              <button
                type="button"
                key={profile.id}
                onClick={() => handleSelectProfile(profile)}
                className="w-full text-left p-3 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition border-b border-gray-50 dark:border-gray-700/50 last:border-b-0"
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 bg-gray-200 dark:bg-gray-600 rounded-full flex-shrink-0 overflow-hidden">
                    {profile.photo_urls?.[0] ? (
                      <img src={profile.photo_urls[0]} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-gray-500">
                        <FaUserSecret className="w-4 h-4" />
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-gray-900 dark:text-white text-sm">
                        {profile.primary_name}
                      </span>
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold ${getRiskBadgeClass(profile.risk_level)}`}>
                        {profile.risk_level?.toUpperCase()}
                      </span>
                    </div>
                    {profile.known_aliases && profile.known_aliases.length > 0 && (
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                        AKA: {profile.known_aliases.join(', ')}
                      </p>
                    )}
                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                      Status: {profile.status}
                    </p>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}

        {/* Loading State */}
        {showResults && isLoading && (
          <div className="absolute top-full left-0 right-0 mt-2 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 z-50 p-3">
            <div className="flex items-center justify-center space-x-2">
              <div className="w-4 h-4 border-2 border-teal-200 border-t-teal-600 rounded-full animate-spin" />
              <span className="text-sm text-gray-600 dark:text-gray-400">Searching...</span>
            </div>
          </div>
        )}

        {/* Empty State */}
        {showResults && searchQuery.length > 2 && !isLoading && searchResults.length === 0 && (
          <div className="absolute top-full left-0 right-0 mt-2 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 z-50 p-3">
            <p className="text-sm text-gray-500 dark:text-gray-400">No profiles found</p>
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
              onClick={() => navigate(`/intelligence/profiles/${linkedProfile.id}`)}
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
            params.set('returnTo', '/incident/new');
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
      />
    </div>
  );
};

export default ProfileLinkingSection;