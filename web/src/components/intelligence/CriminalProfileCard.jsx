import React from 'react';
import { 
  FaUserSecret, FaExclamationTriangle, FaNetworkWired, 
  FaMapMarkerAlt, FaFingerprint, FaHistory, FaChartLine,
  FaCalendarAlt, FaIdCard, FaFlag
} from 'react-icons/fa';
import { formatMoMatchConfidence, moMatchCardTitle } from '../../utils/moMatchDisplay';

const RiskBadge = ({ level }) => {
  const styles = {
    low: 'bg-green-100 text-green-800 border-green-300',
    medium: 'bg-yellow-100 text-yellow-800 border-yellow-300',
    high: 'bg-orange-100 text-orange-800 border-orange-300',
    critical: 'bg-red-100 text-red-800 border-red-300 animate-pulse'
  };
  
  return (
    <span className={`px-3 py-1 rounded-full text-xs font-bold border-2 ${styles[level] || styles.medium}`}>
      {level?.toUpperCase()} RISK
    </span>
  );
};

const StatBox = ({ icon: Icon, label, value, color, title, valueClassName = '' }) => (
  <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3 text-center" title={title}>
    <Icon className={`w-6 h-6 mx-auto mb-1 text-${color}-500`} />
    <div className={`text-2xl font-bold text-gray-900 dark:text-white ${valueClassName}`}>{value}</div>
    <div className="text-xs text-gray-500 dark:text-gray-400">{label}</div>
  </div>
);

export default function CriminalProfileCard({ profile, stats = {} }) {
  const mo = formatMoMatchConfidence(stats.moConfidence);

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
      {/* Header */}
      <div className="relative h-32 bg-gradient-to-r from-slate-800 to-slate-900">
        <div className="absolute top-4 right-4 flex gap-2">
          <RiskBadge level={profile.risk_level} />
          {profile.priority === 'urgent' && (
            <span className="px-3 py-1 rounded-full text-xs font-bold bg-red-600 text-white animate-pulse">
              PRIORITY
            </span>
          )}
        </div>
        
        <div className="absolute -bottom-12 left-6">
          <div className="w-24 h-24 rounded-2xl bg-gray-200 border-4 border-white dark:border-gray-800 overflow-hidden shadow-lg">
            {profile.photo_urls?.[0] ? (
              <img src={profile.photo_urls[0]} alt="" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-gray-300">
                <FaUserSecret className="w-10 h-10 text-gray-500" />
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="pt-16 px-6 pb-6">
        {/* Identity */}
        <div className="mb-6">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-1">
            {profile.primary_name}
          </h2>
          
          <div className="flex flex-wrap gap-2 text-sm text-gray-600 dark:text-gray-400 mb-2">
            {profile.date_of_birth && (
              <span className="flex items-center gap-1">
                <FaCalendarAlt className="w-3 h-3" />
                DOB: {new Date(profile.date_of_birth).toLocaleDateString()}
              </span>
            )}
            {profile.nationality?.length > 0 && (
              <span>• {profile.nationality.join(', ')}</span>
            )}
            <span>• Status: <span className="capitalize font-medium text-teal-600">{profile.status}</span></span>
          </div>

          {/* Aliases */}
          {profile.known_aliases?.length > 0 && (
            <div className="flex flex-wrap gap-2 items-center">
              <span className="text-xs text-gray-500 uppercase font-medium">AKA:</span>
              {profile.known_aliases.map((alias, i) => (
                <span key={i} className="px-2 py-1 bg-gray-100 dark:bg-gray-700 rounded text-xs text-gray-700 dark:text-gray-300">
                  {alias}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-4 gap-3 mb-6">
          <StatBox icon={FaHistory} label="Incidents" value={stats.incidentCount || 0} color="blue" />
          <StatBox icon={FaNetworkWired} label="Associates" value={stats.associateCount || 0} color="purple" />
          <StatBox icon={FaMapMarkerAlt} label="Locations" value={stats.locationCount || 0} color="green" />
          <StatBox
            icon={FaFingerprint}
            label="MO Match"
            value={mo.display}
            color="orange"
            title={moMatchCardTitle(mo.assessed)}
            valueClassName={mo.assessed ? '' : 'font-normal text-gray-400 dark:text-gray-500'}
          />
        </div>

        {/* Watchlist Flags */}
        {profile.watchlist_flags?.length > 0 && (
          <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl">
            <div className="flex items-center gap-2 mb-2 text-red-800 dark:text-red-300 font-semibold text-sm">
              <FaExclamationTriangle />
              <span>WATCHLIST ALERTS</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {profile.watchlist_flags.map((flag, i) => (
                <span key={i} className="px-3 py-1 bg-red-100 dark:bg-red-800 text-red-800 dark:text-red-200 rounded-full text-xs font-medium flex items-center gap-1">
                  <FaFlag className="w-3 h-3" />
                  {flag.replace(/_/g, ' ').toUpperCase()}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Physical Description */}
        {(profile.height_cm || profile.build_type || profile.eye_color) && (
          <div className="mb-6 p-4 bg-gray-50 dark:bg-gray-700/50 rounded-xl">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
              <FaIdCard className="text-teal-600" />
              Physical Description
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              {profile.height_cm && (
                <div>
                  <span className="text-gray-500 dark:text-gray-400">Height:</span>
                  <span className="ml-2 text-gray-900 dark:text-white font-medium">{profile.height_cm}cm</span>
                </div>
              )}
              {profile.build_type && (
                <div>
                  <span className="text-gray-500 dark:text-gray-400">Build:</span>
                  <span className="ml-2 text-gray-900 dark:text-white font-medium capitalize">{profile.build_type}</span>
                </div>
              )}
              {profile.eye_color && (
                <div>
                  <span className="text-gray-500 dark:text-gray-400">Eyes:</span>
                  <span className="ml-2 text-gray-900 dark:text-white font-medium">{profile.eye_color}</span>
                </div>
              )}
              {profile.hair_color && (
                <div>
                  <span className="text-gray-500 dark:text-gray-400">Hair:</span>
                  <span className="ml-2 text-gray-900 dark:text-white font-medium">{profile.hair_color}</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* MO Signature */}
        {profile.mo_signature && (
          <div className="border-t border-gray-200 dark:border-gray-700 pt-6">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
              <FaChartLine className="text-teal-600" />
              Modus Operandi Signature
            </h3>
            <div className="space-y-3">
              {profile.mo_signature.target_types?.length > 0 && (
                <div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded-lg">
                  <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                    <span className="text-xs text-blue-600 dark:text-blue-400 font-semibold uppercase tracking-wide w-24 shrink-0">
                      Targets
                    </span>
                    <span className="text-sm text-gray-900 dark:text-white break-words">
                      {profile.mo_signature.target_types.join(', ')}
                    </span>
                  </div>
                </div>
              )}
              {profile.mo_signature.time_patterns?.length > 0 && (
                <div className="bg-purple-50 dark:bg-purple-900/20 p-4 rounded-lg">
                  <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                    <span className="text-xs text-purple-600 dark:text-purple-400 font-semibold uppercase tracking-wide w-24 shrink-0">
                      Time Pattern
                    </span>
                    <span className="text-sm text-gray-900 dark:text-white break-words">
                      {profile.mo_signature.time_patterns.join(', ')}
                    </span>
                  </div>
                </div>
              )}
              {profile.mo_signature.entry_methods?.length > 0 && (
                <div className="bg-orange-50 dark:bg-orange-900/20 p-4 rounded-lg">
                  <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                    <span className="text-xs text-orange-600 dark:text-orange-400 font-semibold uppercase tracking-wide w-24 shrink-0">
                      Entry
                    </span>
                    <span className="text-sm text-gray-900 dark:text-white break-words">
                      {profile.mo_signature.entry_methods.join(', ')}
                    </span>
                  </div>
                </div>
              )}
            </div>
            
            {/* Weapons (if present) */}
            {profile.mo_signature?.weapons_preferred?.length > 0 && (
              <div className="mt-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3">
                <span className="text-xs font-medium text-red-600 dark:text-red-400 uppercase">Preferred Weapons</span>
                <div className="text-sm text-gray-900 dark:text-white mt-1">
                  {profile.mo_signature.weapons_preferred.join(', ')}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const MOTag = ({ label, values, color }) => (
  <div className={`bg-${color}-50 dark:bg-${color}-900/20 rounded-lg p-3`}>
    <span className={`text-xs font-medium text-${color}-600 dark:text-${color}-400 uppercase`}>{label}</span>
    <div className="text-sm text-gray-900 dark:text-white font-medium mt-1 break-words whitespace-normal leading-relaxed">
      {values.join(', ')}
    </div>
  </div>
);
