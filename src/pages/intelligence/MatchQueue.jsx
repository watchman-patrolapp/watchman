import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../supabase/client';
import { FaUserSecret, FaExclamationTriangle, FaEye, FaHistory, FaCheck, FaTimes } from 'react-icons/fa';
import toast from 'react-hot-toast';

export default function MatchQueue() {
  const navigate = useNavigate();
  const [matches, setMatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedMatch, setSelectedMatch] = useState(null);

  useEffect(() => {
    fetchMatches();
  }, []);

  const fetchMatches = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('profile_incidents')
        .select(`
          *,
          profile:profile_id (
            id, primary_name, photo_urls, risk_level, status, known_aliases
          ),
          incident:incident_id (
            id, type, description, location, submitted_at, submitted_by_name
          )
        `)
        .eq('status', 'pending')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setMatches(data || []);
    } catch (error) {
      console.error('Error fetching matches:', error);
      toast.error('Failed to load match queue');
    } finally {
      setLoading(false);
    }
  };

  const handleMatchAction = async (matchId, action) => {
    try {
      const { error } = await supabase
        .from('profile_incidents')
        .update({
          status: action === 'approve' ? 'confirmed' : 'rejected',
          verification_notes: action === 'approve' ? 'Manually verified by analyst' : 'Rejected by analyst',
          updated_at: new Date().toISOString()
        })
        .eq('id', matchId);

      if (error) throw error;

      toast.success(action === 'approve' ? 'Match approved!' : 'Match rejected!');
      fetchMatches();
    } catch (error) {
      console.error('Error updating match:', error);
      toast.error('Failed to update match');
    }
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

  const formatIncidentDate = (dateStr) => {
    return new Date(dateStr).toLocaleDateString('en-ZA', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 pb-20">
      {/* Header */}
      <header className="bg-white dark:bg-gray-800 shadow-sm border-b border-gray-200 dark:border-gray-700 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
              <FaExclamationTriangle className="text-red-600" />
              Match Verification Queue
            </h1>
            <div className="text-sm text-gray-500 dark:text-gray-400">
              {matches.length} pending matches
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {loading ? (
          <div className="text-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mx-auto"></div>
          </div>
        ) : matches.length === 0 ? (
          <div className="text-center py-12 text-gray-500 dark:text-gray-400">
            <FaExclamationTriangle className="w-16 h-16 mx-auto mb-4 opacity-30" />
            <p>No pending matches to verify.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Match List */}
            <div className="space-y-4">
              {matches.map(match => (
                <div
                  key={match.id}
                  onClick={() => setSelectedMatch(match)}
                  className={`bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-4 cursor-pointer hover:shadow-md transition ${
                    selectedMatch?.id === match.id ? 'ring-2 ring-indigo-500' : ''
                  }`}
                >
                  <div className="flex items-start gap-4">
                    <div className="w-16 h-16 bg-gray-200 dark:bg-gray-600 rounded-full flex-shrink-0 overflow-hidden">
                      {match.profile?.photo_urls?.[0] ? (
                        <img src={match.profile.photo_urls[0]} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-gray-500">
                          <FaUserSecret className="w-8 h-8" />
                        </div>
                      )}
                    </div>
                    
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 mb-2">
                        <h3 className="font-semibold text-gray-900 dark:text-white text-lg">
                          {match.profile?.primary_name}
                        </h3>
                        <span className={`px-2 py-1 rounded-full text-xs font-bold ${getRiskBadgeClass(match.profile?.risk_level)}`}>
                          {match.profile?.risk_level?.toUpperCase()} RISK
                        </span>
                        <span className="px-2 py-0.5 bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-300 text-xs rounded-full">
                          {match.connection_type.replace(/_/g, ' ')}
                        </span>
                      </div>
                      
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm text-gray-600 dark:text-gray-400">
                        <div>
                          <span className="font-medium">Incident:</span> {match.incident?.type}
                        </div>
                        <div>
                          <span className="font-medium">Confidence:</span>{' '}
                          <span className={`px-2 py-0.5 rounded ${
                            match.confidence_score > 80 ? 'bg-green-100 dark:bg-green-900/40 text-green-800 dark:text-green-300' :
                            match.confidence_score > 60 ? 'bg-yellow-100 dark:bg-yellow-900/40 text-yellow-800 dark:text-yellow-300' :
                            'bg-red-100 dark:bg-red-900/40 text-red-800 dark:text-red-300'
                          }`}>
                            {match.confidence_score}%
                          </span>
                        </div>
                        <div>
                          <span className="font-medium">Location:</span> {match.incident?.location}
                        </div>
                        <div>
                          <span className="font-medium">Reported:</span> {formatIncidentDate(match.incident?.submitted_at)}
                        </div>
                      </div>

                      {match.profile?.known_aliases?.length > 0 && (
                        <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
                          AKA: {match.profile.known_aliases.join(', ')}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Match Details */}
            {selectedMatch && (
              <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-xl font-bold text-gray-900 dark:text-white">Match Details</h2>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleMatchAction(selectedMatch.id, 'approve')}
                      className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition"
                    >
                      <FaCheck /> Approve
                    </button>
                    <button
                      onClick={() => handleMatchAction(selectedMatch.id, 'reject')}
                      className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition"
                    >
                      <FaTimes /> Reject
                    </button>
                  </div>
                </div>

                {/* Profile Details */}
                <div className="mb-6">
                  <h3 className="font-semibold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
                    <FaUserSecret />
                    Suspect Profile
                  </h3>
                  <div className="grid grid-cols-2 gap-4 text-sm text-gray-600 dark:text-gray-400">
                    <div>
                      <span className="font-medium">Name:</span> {selectedMatch.profile?.primary_name}
                    </div>
                    <div>
                      <span className="font-medium">Status:</span> {selectedMatch.profile?.status}
                    </div>
                    <div>
                      <span className="font-medium">Risk Level:</span>{' '}
                      <span className={`px-2 py-1 rounded-full text-xs font-bold ${getRiskBadgeClass(selectedMatch.profile?.risk_level)}`}>
                        {selectedMatch.profile?.risk_level?.toUpperCase()}
                      </span>
                    </div>
                    <div>
                      <span className="font-medium">Last Seen:</span> {selectedMatch.profile?.last_seen_at ? new Date(selectedMatch.profile.last_seen_at).toLocaleString() : 'Unknown'}
                    </div>
                  </div>
                </div>

                {/* Incident Details */}
                <div className="mb-6">
                  <h3 className="font-semibold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
                    <FaHistory />
                    Incident Information
                  </h3>
                  <div className="space-y-2 text-sm text-gray-600 dark:text-gray-400">
                    <div>
                      <span className="font-medium">Type:</span> {selectedMatch.incident?.type}
                    </div>
                    <div>
                      <span className="font-medium">Location:</span> {selectedMatch.incident?.location}
                    </div>
                    <div>
                      <span className="font-medium">Reported by:</span> {selectedMatch.incident?.submitted_by_name}
                    </div>
                    <div>
                      <span className="font-medium">Date:</span> {formatIncidentDate(selectedMatch.incident?.submitted_at)}
                    </div>
                    <div>
                      <span className="font-medium">Description:</span>
                      <p className="mt-1 text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-700 p-3 rounded-lg">
                        {selectedMatch.incident?.description}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Match Analysis */}
                <div className="mb-6">
                  <h3 className="font-semibold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
                    <FaEye />
                    Match Analysis
                  </h3>
                  <div className="grid grid-cols-2 gap-4 text-sm text-gray-600 dark:text-gray-400">
                    <div>
                      <span className="font-medium">Confidence Score:</span>{' '}
                      <span className={`px-2 py-0.5 rounded ${
                        selectedMatch.confidence_score > 80 ? 'bg-green-100 dark:bg-green-900/40 text-green-800 dark:text-green-300' :
                        selectedMatch.confidence_score > 60 ? 'bg-yellow-100 dark:bg-yellow-900/40 text-yellow-800 dark:text-yellow-300' :
                        'bg-red-100 dark:bg-red-900/40 text-red-800 dark:text-red-300'
                      }`}>
                        {selectedMatch.confidence_score}%
                      </span>
                    </div>
                    <div>
                      <span className="font-medium">Connection Type:</span>{' '}
                      <span className="capitalize">{selectedMatch.connection_type.replace(/_/g, ' ')}</span>
                    </div>
                    <div>
                      <span className="font-medium">Created:</span> {new Date(selectedMatch.created_at).toLocaleString()}
                    </div>
                    <div>
                      <span className="font-medium">Evidence:</span> Automated analysis
                    </div>
                  </div>
                </div>

                {/* Actions */}
                <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
                  <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                    Review the match details above and approve or reject this connection.
                  </p>
                  <div className="flex gap-3">
                    <button
                      onClick={() => handleMatchAction(selectedMatch.id, 'approve')}
                      className="flex items-center gap-2 px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 transition font-medium"
                    >
                      <FaCheck /> Approve Match
                    </button>
                    <button
                      onClick={() => handleMatchAction(selectedMatch.id, 'reject')}
                      className="flex items-center gap-2 px-6 py-3 bg-red-600 text-white rounded-lg hover:bg-red-700 transition font-medium"
                    >
                      <FaTimes /> Reject Match
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}