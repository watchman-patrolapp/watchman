import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../supabase/client';
import { format } from 'date-fns';
import { 
  FaArrowLeft, FaCalendarAlt, FaMapMarkerAlt, FaUserSecret, 
  FaFileAlt, FaUser, FaExclamationTriangle 
} from 'react-icons/fa';
import CriminalProfileCard from '../components/intelligence/CriminalProfileCard';
import toast from 'react-hot-toast';

export default function IncidentDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [incident, setIncident] = useState(null);
  const [evidence, setEvidence] = useState([]);
  const [linkedProfiles, setLinkedProfiles] = useState([]);
  const [activeTab, setActiveTab] = useState('details');
  const [loading, setLoading] = useState(true);

  const fetchIncidentDetails = useCallback(async () => {
    try {
      // Fetch incident
      const { data: incidentData, error: incidentError } = await supabase
        .from('incidents')
        .select('*')
        .eq('id', id)
        .single();

      if (incidentError) throw incidentError;
      setIncident(incidentData);

      // Fetch evidence
      const { data: evidenceData, error: evidenceError } = await supabase
        .from('incident_evidence')
        .select('*')
        .eq('incident_id', id);

      if (evidenceError) throw evidenceError;
      setEvidence(evidenceData || []);

      // Fetch linked profiles - CRITICAL INTEGRATION
      const { data: profilesData, error: profilesError } = await supabase
        .from('profile_incidents')
        .select(`
          *,
          profile:profile_id (*)
        `)
        .eq('incident_id', id);

      if (profilesError) throw profilesError;
      setLinkedProfiles(profilesData || []);

    } catch (error) {
      console.error('Error fetching incident:', error);
      toast.error('Failed to load incident details');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchIncidentDetails();
  }, [fetchIncidentDetails]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
      </div>
    );
  }

  if (!incident) {
    return (
      <div className="min-h-screen flex items-center justify-center text-gray-500">
        Incident not found
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 pb-20">
      {/* Header */}
      <header className="bg-white dark:bg-gray-800 shadow-sm border-b border-gray-200 dark:border-gray-700 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <button 
            onClick={() => navigate('/incidents')}
            className="flex items-center gap-2 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white mb-2"
          >
            <FaArrowLeft /> Back to Incidents
          </button>
          <div className="flex justify-between items-start">
            <div>
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
                Incident #{id.slice(0, 8)}
              </h1>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                Reported by {incident.submitted_by_name} on {format(new Date(incident.submitted_at), 'MMM dd, yyyy HH:mm')}
              </p>
            </div>
            <span className={`px-3 py-1 rounded-full text-sm font-medium ${
              incident.status === 'pending' ? 'bg-yellow-100 text-yellow-800' :
              incident.status === 'approved' ? 'bg-green-100 text-green-800' :
              'bg-red-100 text-red-800'
            }`}>
              {incident.status?.toUpperCase()}
            </span>
          </div>
        </div>
      </header>

      {/* Tabs */}
      <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <nav className="flex gap-8">
            {[
              { id: 'details', label: 'Details', icon: FaFileAlt },
              { id: 'evidence', label: 'Evidence', icon: FaFileAlt, count: evidence.length },
              { id: 'intelligence', label: 'Intelligence', icon: FaUserSecret, count: linkedProfiles.length }
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 py-4 border-b-2 font-medium text-sm transition ${
                  activeTab === tab.id
                    ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400'
                    : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
                }`}
              >
                <tab.icon className="w-4 h-4" />
                {tab.label}
                {tab.count > 0 && (
                  <span className="ml-2 px-2 py-0.5 bg-gray-100 dark:bg-gray-700 rounded-full text-xs">
                    {tab.count}
                  </span>
                )}
              </button>
            ))}
          </nav>
        </div>
      </div>

      {/* Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {activeTab === 'details' && (
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6 space-y-6">
            <DetailRow icon={FaCalendarAlt} label="Date of Incident" value={format(new Date(incident.incident_date), 'MMM dd, yyyy')} />
            <DetailRow icon={FaMapMarkerAlt} label="Location" value={incident.location} />
            <DetailRow icon={FaExclamationTriangle} label="Type" value={incident.type} />
            
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Description
              </label>
              <p className="text-gray-900 dark:text-white bg-gray-50 dark:bg-gray-700 p-4 rounded-lg">
                {incident.description}
              </p>
            </div>

            {incident.suspect_description && (
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Suspect Information
                </label>
                <div className="bg-gray-50 dark:bg-gray-700 p-4 rounded-lg">
                  <p className="text-gray-900 dark:text-white">{incident.suspect_description}</p>
                  {incident.suspect_name && (
                    <p className="text-sm text-gray-600 dark:text-gray-400 mt-2">
                      Name: {incident.suspect_name}
                    </p>
                  )}
                </div>
              </div>
            )}

            {incident.vehicle_info && (
              <DetailRow icon={FaUser} label="Vehicle Information" value={incident.vehicle_info} />
            )}

            {incident.witness_present && (
              <DetailRow icon={FaUser} label="Witness" value={incident.witness_name || 'Yes (name withheld)'} />
            )}

            {incident.saps_case_number && (
              <DetailRow icon={FaFileAlt} label="SAPS Case Number" value={incident.saps_case_number} />
            )}
          </div>
        )}

        {activeTab === 'evidence' && (
          <div className="space-y-4">
            {evidence.length === 0 ? (
              <div className="text-center py-12 text-gray-500 dark:text-gray-400">
                No structured evidence recorded for this incident.
              </div>
            ) : (
              evidence.map(item => (
                <div key={item.id} className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6">
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <h3 className="font-semibold text-gray-900 dark:text-white capitalize">
                        {item.category.replace(/_/g, ' ')}
                      </h3>
                      <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                        Added {format(new Date(item.created_at), 'MMM dd, yyyy HH:mm')}
                      </p>
                    </div>
                  </div>
                  
                  <p className="text-gray-700 dark:text-gray-300 mb-4">{item.description}</p>
                  
                  {item.metadata && Object.keys(item.metadata).length > 0 && (
                    <div className="bg-gray-50 dark:bg-gray-700 p-3 rounded-lg mb-4">
                      <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Details:</h4>
                      <div className="grid grid-cols-2 gap-2 text-sm">
                        {Object.entries(item.metadata).map(([key, value]) => (
                          <div key={key}>
                            <span className="text-gray-500 capitalize">{key.replace(/_/g, ' ')}:</span>{' '}
                            <span className="text-gray-900 dark:text-white">{value.toString()}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {item.media_urls && item.media_urls.length > 0 && (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      {item.media_urls.map((url, idx) => (
                        <img 
                          key={idx} 
                          src={url} 
                          alt={`Evidence ${idx + 1}`}
                          className="rounded-lg object-cover h-32 w-full cursor-pointer hover:opacity-90 transition"
                          onClick={() => window.open(url, '_blank')}
                        />
                      ))}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        )}

        {activeTab === 'intelligence' && (
          <div className="space-y-6">
            {linkedProfiles.length === 0 ? (
              <div className="text-center py-12">
                <FaUserSecret className="w-16 h-16 text-gray-300 dark:text-gray-600 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
                  No Linked Profiles
                </h3>
                <p className="text-gray-500 dark:text-gray-400 mb-4">
                  This incident is not linked to any criminal profiles yet.
                </p>
                <button 
                  onClick={() => navigate(`/incident-form?link=${id}`)}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition"
                >
                  Link Suspect to Profile
                </button>
              </div>
            ) : (
              <>
                <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-4 mb-6">
                  <h3 className="font-semibold text-amber-800 dark:text-amber-200 flex items-center gap-2">
                    <FaExclamationTriangle />
                    Intelligence Summary
                  </h3>
                  <p className="text-sm text-amber-700 dark:text-amber-300 mt-1">
                    {linkedProfiles.length} suspect(s) linked to this incident with varying confidence levels.
                    Review profiles for modus operandi patterns and associate networks.
                  </p>
                </div>

                {linkedProfiles.map(link => (
                  <div key={link.id} className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6">
                    <div className="flex justify-between items-start mb-4">
                      <div>
                        <span className={`inline-block px-2 py-1 rounded text-xs font-bold mb-2 ${
                          link.connection_type === 'confirmed_perpetrator' ? 'bg-red-100 text-red-800' :
                          link.connection_type === 'probable_suspect' ? 'bg-orange-100 text-orange-800' :
                          'bg-blue-100 text-blue-800'
                        }`}>
                          {link.connection_type.replace(/_/g, ' ').toUpperCase()}
                        </span>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm text-gray-500">Confidence:</span>
                          {link.confidence_score != null && Number.isFinite(Number(link.confidence_score)) ? (
                            <>
                              <div className="w-24 bg-gray-200 dark:bg-gray-600 rounded-full h-2">
                                <div 
                                  className={`h-2 rounded-full ${
                                    link.confidence_score > 80 ? 'bg-green-500' :
                                    link.confidence_score > 50 ? 'bg-yellow-500' :
                                    'bg-red-500'
                                  }`}
                                  style={{ width: `${Math.min(100, Math.max(0, Number(link.confidence_score)))}%` }}
                                />
                              </div>
                              <span className="text-sm font-medium text-gray-900 dark:text-white">{link.confidence_score}%</span>
                            </>
                          ) : (
                            <span className="text-sm text-gray-500 dark:text-gray-400">Not set — review link to add score</span>
                          )}
                        </div>
                      </div>
                      <button 
                        onClick={() => navigate(`/intelligence/profiles/${link.profile_id}`)}
                        className="px-4 py-2 bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300 rounded-lg text-sm font-medium hover:bg-indigo-200 transition"
                      >
                        View Full Profile
                      </button>
                    </div>

                    {link.profile && (
                      <CriminalProfileCard 
                        profile={link.profile} 
                        stats={{
                          incidentCount: link.profile.incident_count || 1,
                          associateCount: link.profile.associate_count || 0,
                          moConfidence: link.confidence_score
                        }}
                      />
                    )}

                    {link.verification_notes && (
                      <div className="mt-4 p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg text-sm text-gray-600 dark:text-gray-400">
                        <strong>Analyst Notes:</strong> {link.verification_notes}
                      </div>
                    )}
                  </div>
                ))}
              </>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

function DetailRow({ icon: Icon, label, value }) {
  return (
    <div className="flex items-start gap-3">
      <Icon className="w-5 h-5 text-gray-400 mt-0.5" />
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
          {label}
        </label>
        <p className="text-gray-900 dark:text-white mt-1">{value}</p>
      </div>
    </div>
  );
}
