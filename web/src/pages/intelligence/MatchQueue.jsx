import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../supabase/client';
import { matchQueueConfidenceToScore } from '../../utils/intelligenceConfidence';
import { FaUserSecret, FaExclamationTriangle, FaEye, FaHistory, FaCheck, FaTimes, FaArrowLeft } from 'react-icons/fa';
import toast from 'react-hot-toast';

function formatSourceType(sourceType) {
  if (!sourceType) return 'Unknown';
  return sourceType.replace(/_/g, ' ');
}

function confidenceBadgeClass(pct) {
  if (pct == null) return 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300';
  if (pct > 80) return 'bg-green-100 dark:bg-green-900/40 text-green-800 dark:text-green-300';
  if (pct > 60) return 'bg-yellow-100 dark:bg-yellow-900/40 text-yellow-800 dark:text-yellow-300';
  return 'bg-red-100 dark:bg-red-900/40 text-red-800 dark:text-red-300';
}

export default function MatchQueue() {
  const navigate = useNavigate();
  const [matches, setMatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedMatch, setSelectedMatch] = useState(null);
  const [actionLoading, setActionLoading] = useState(false);

  const fetchMatches = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('profile_match_queue')
        .select(`
          id,
          source_type,
          match_confidence,
          match_reason,
          status,
          created_at,
          source_incident_id,
          suggested_profile_id,
          source_evidence_id,
          profile:suggested_profile_id (
            id, primary_name, photo_urls, risk_level, status, known_aliases, last_seen_at
          ),
          incident:source_incident_id (
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
  }, []);

  useEffect(() => {
    fetchMatches();
  }, [fetchMatches]);

  const handleMatchAction = async (matchId, action) => {
    setActionLoading(true);
    try {
      const { data: row, error: fetchErr } = await supabase
        .from('profile_match_queue')
        .select('id, suggested_profile_id, source_incident_id, match_confidence')
        .eq('id', matchId)
        .single();

      if (fetchErr) throw fetchErr;
      if (!row?.suggested_profile_id || !row?.source_incident_id) {
        toast.error('Match record is missing profile or incident');
        return;
      }

      const { data: authData } = await supabase.auth.getUser();
      const reviewerId = authData?.user?.id ?? null;
      const now = new Date().toISOString();

      if (action === 'approve') {
        const confidenceScore = matchQueueConfidenceToScore(row.match_confidence);
        const insertPayload = {
          profile_id: row.suggested_profile_id,
          incident_id: row.source_incident_id,
          connection_type: 'probable_suspect',
          linked_by: reviewerId,
          evidence_strength: 'moderate'
        };
        if (confidenceScore != null) insertPayload.confidence_score = confidenceScore;

        const { error: linkError } = await supabase.from('profile_incidents').insert(insertPayload);

        if (linkError) {
          if (linkError.code === '23505' || /duplicate|unique/i.test(linkError.message || '')) {
            toast.error('This profile is already linked to that incident.');
          } else {
            throw linkError;
          }
          return;
        }
      }

      const { error: updErr } = await supabase
        .from('profile_match_queue')
        .update({
          status: action === 'approve' ? 'confirmed' : 'rejected',
          reviewed_at: now,
          reviewed_by: reviewerId,
          review_notes:
            action === 'approve'
              ? 'Approved from match queue — profile–incident link created'
              : 'Rejected from match queue'
        })
        .eq('id', matchId);

      if (updErr) throw updErr;

      toast.success(action === 'approve' ? 'Match approved — link created.' : 'Match rejected.');
      setSelectedMatch((prev) => (prev?.id === matchId ? null : prev));
      fetchMatches();
    } catch (error) {
      console.error('Error updating match:', error);
      toast.error(error.message || 'Failed to update match');
    } finally {
      setActionLoading(false);
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
    if (!dateStr) return '—';
    return new Date(dateStr).toLocaleDateString('en-ZA', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const selectedPct = selectedMatch ? matchQueueConfidenceToScore(selectedMatch.match_confidence) : null;

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 pb-20">
      <header className="bg-white dark:bg-gray-800 shadow-sm border-b border-gray-200 dark:border-gray-700 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <button
            type="button"
            onClick={() => navigate('/intelligence')}
            className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white mb-3 transition"
          >
            <FaArrowLeft className="w-3 h-3" />
            Intelligence home
          </button>
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
              <FaExclamationTriangle className="text-red-600" />
              Match Verification Queue
            </h1>
            <div className="text-sm text-gray-500 dark:text-gray-400">
              {matches.length} pending {matches.length === 1 ? 'match' : 'matches'}
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
            <div className="space-y-4">
              {matches.map((match) => {
                const pct = matchQueueConfidenceToScore(match.match_confidence);
                const pctLabel = pct != null ? `${pct}%` : '—';
                return (
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
                        <div className="flex items-center gap-3 mb-2 flex-wrap">
                          <h3 className="font-semibold text-gray-900 dark:text-white text-lg">
                            {match.profile?.primary_name}
                          </h3>
                          <span className={`px-2 py-1 rounded-full text-xs font-bold ${getRiskBadgeClass(match.profile?.risk_level)}`}>
                            {match.profile?.risk_level?.toUpperCase()} RISK
                          </span>
                          <span className="px-2 py-0.5 bg-indigo-100 dark:bg-indigo-900/40 text-indigo-800 dark:text-indigo-300 text-xs rounded-full capitalize">
                            {formatSourceType(match.source_type)}
                          </span>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm text-gray-600 dark:text-gray-400">
                          <div>
                            <span className="font-medium">Incident:</span> {match.incident?.type ?? '—'}
                          </div>
                          <div>
                            <span className="font-medium">Confidence:</span>{' '}
                            <span className={`px-2 py-0.5 rounded ${confidenceBadgeClass(pct)}`}>
                              {pctLabel}
                            </span>
                          </div>
                          <div>
                            <span className="font-medium">Location:</span> {match.incident?.location ?? '—'}
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
                );
              })}
            </div>

            {selectedMatch && (
              <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6">
                <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
                  <h2 className="text-xl font-bold text-gray-900 dark:text-white">Match Details</h2>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={actionLoading}
                      onClick={() => handleMatchAction(selectedMatch.id, 'approve')}
                      className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition disabled:opacity-50"
                    >
                      <FaCheck /> Approve
                    </button>
                    <button
                      type="button"
                      disabled={actionLoading}
                      onClick={() => handleMatchAction(selectedMatch.id, 'reject')}
                      className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition disabled:opacity-50"
                    >
                      <FaTimes /> Reject
                    </button>
                  </div>
                </div>

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
                      <span className="font-medium">Last Seen:</span>{' '}
                      {selectedMatch.profile?.last_seen_at
                        ? new Date(selectedMatch.profile.last_seen_at).toLocaleString()
                        : 'Unknown'}
                    </div>
                  </div>
                </div>

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

                <div className="mb-6">
                  <h3 className="font-semibold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
                    <FaEye />
                    Match Analysis
                  </h3>
                  <div className="grid grid-cols-2 gap-4 text-sm text-gray-600 dark:text-gray-400">
                    <div>
                      <span className="font-medium">Confidence Score:</span>{' '}
                      <span className={`px-2 py-0.5 rounded ${confidenceBadgeClass(selectedPct)}`}>
                        {selectedPct != null ? `${selectedPct}%` : '—'}
                      </span>
                    </div>
                    <div>
                      <span className="font-medium">Source:</span>{' '}
                      <span className="capitalize">{formatSourceType(selectedMatch.source_type)}</span>
                    </div>
                    <div className="col-span-2">
                      <span className="font-medium">Reason:</span>{' '}
                      <span className="text-gray-700 dark:text-gray-300">
                        {selectedMatch.match_reason || 'No reason recorded'}
                      </span>
                    </div>
                    <div>
                      <span className="font-medium">Queued:</span> {new Date(selectedMatch.created_at).toLocaleString()}
                    </div>
                  </div>
                </div>

                <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
                  <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                    Approve creates a profile–incident link with confidence from this queue entry (when available).
                    Reject only updates the queue — no link is created.
                  </p>
                  <div className="flex gap-3 flex-wrap">
                    <button
                      type="button"
                      disabled={actionLoading}
                      onClick={() => handleMatchAction(selectedMatch.id, 'approve')}
                      className="flex items-center gap-2 px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 transition font-medium disabled:opacity-50"
                    >
                      <FaCheck /> Approve Match
                    </button>
                    <button
                      type="button"
                      disabled={actionLoading}
                      onClick={() => handleMatchAction(selectedMatch.id, 'reject')}
                      className="flex items-center gap-2 px-6 py-3 bg-red-600 text-white rounded-lg hover:bg-red-700 transition font-medium disabled:opacity-50"
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
