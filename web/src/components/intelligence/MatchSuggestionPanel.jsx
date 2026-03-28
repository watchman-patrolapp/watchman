import React from 'react';
import { FaRobot, FaCheck, FaTimes, FaUserPlus, FaPercentage } from 'react-icons/fa';
import { useNavigate } from 'react-router-dom';

export default function MatchSuggestionPanel({ matches, onConfirm, onReject }) {
  const navigate = useNavigate();
  
  if (!matches || matches.length === 0) return null;

  return (
    <div className="bg-gradient-to-r from-indigo-50 to-purple-50 dark:from-indigo-900/20 dark:to-purple-900/20 border border-indigo-200 dark:border-indigo-800 rounded-xl p-6 mb-6">
      <div className="flex items-center gap-2 mb-4">
        <FaRobot className="w-5 h-5 text-indigo-600" />
        <h3 className="font-bold text-gray-900 dark:text-white">AI Match Suggestions</h3>
        <span className="px-2 py-1 bg-indigo-100 dark:bg-indigo-800 text-indigo-700 dark:text-indigo-300 text-xs rounded-full">
          {matches.length} potential matches
        </span>
      </div>

      <div className="space-y-3">
        {matches.map((match) => (
          <div key={match.id} className="bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-lg bg-gray-200 overflow-hidden">
                {match.profile?.photo_urls?.[0] ? (
                  <img src={match.profile.photo_urls[0]} alt="" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-gray-300 text-gray-500">
                    <FaUserPlus />
                  </div>
                )}
              </div>
              
              <div>
                <h4 className="font-semibold text-gray-900 dark:text-white">
                  {match.profile?.primary_name || 'Unknown Subject'}
                </h4>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  {match.match_reason}
                </p>
                <div className="flex items-center gap-2 mt-1">
                  <span className={`text-sm font-bold flex items-center gap-1 ${
                    match.match_confidence > 0.8 ? 'text-green-600' :
                    match.match_confidence > 0.6 ? 'text-yellow-600' :
                    'text-orange-600'
                  }`}>
                    <FaPercentage className="w-3 h-3" />
                    {Math.round(match.match_confidence * 100)}% Match
                  </span>
                  <span className="text-xs text-gray-400">• {match.profile?.incident_count || 0} prior incidents</span>
                </div>
              </div>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => onConfirm(match)}
                className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-medium flex items-center gap-2 transition"
              >
                <FaCheck />
                Confirm
              </button>
              <button
                onClick={() => onReject(match.id)}
                className="px-4 py-2 bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-lg text-sm font-medium flex items-center gap-2 transition"
              >
                <FaTimes />
                Reject
              </button>
              <button
                onClick={() => navigate(`/intelligence/profiles/${match.suggested_profile_id}`)}
                className="px-4 py-2 bg-indigo-100 hover:bg-indigo-200 dark:bg-indigo-900/50 dark:hover:bg-indigo-800 text-indigo-700 dark:text-indigo-300 rounded-lg text-sm font-medium transition"
              >
                View Profile
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}