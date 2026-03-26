import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/useAuth';
import { supabase } from '../supabase/client';
import { useCriminalProfile, useProfileIncidents, useProfileNetwork } from '../hooks/useCriminalIntelligence';
import CriminalProfileCard from '../components/intelligence/CriminalProfileCard';
import { 
  FaArrowLeft, FaNetworkWired, FaHistory, FaMapMarkerAlt, 
  FaLink, FaUserPlus, FaStickyNote, FaSpinner, FaTimes 
} from 'react-icons/fa';
import toast from 'react-hot-toast';

export default function CriminalProfileDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState('overview');
  const [showLinkModal, setShowLinkModal] = useState(false);
  const [showAssociateModal, setShowAssociateModal] = useState(false);
  const [showIntelModal, setShowIntelModal] = useState(false);
  const [incidentSearch, setIncidentSearch] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [selectedIncident, setSelectedIncident] = useState(null);
  const [connectionType, setConnectionType] = useState('person_of_interest');
  const [confidenceScore, setConfidenceScore] = useState(75);
  const [loading, setLoading] = useState(false);
  
  const { data: profile, isLoading: profileLoading } = useCriminalProfile(id);
  const { data: incidents } = useProfileIncidents(id);
  const { data: associates } = useProfileNetwork(id);

  // Search for incidents to link
  const searchIncidents = async (query) => {
    if (query.length < 3) return;
    try {
      const { data } = await supabase
        .from('incidents')
        .select('id, type, description, incident_date, location')
        .ilike('description', `%${query}%`)
        .limit(5);
      setSearchResults(data || []);
    } catch (error) {
      console.error('Error searching incidents:', error);
    }
  };

  // Link profile to incident
  const handleLinkIncident = async () => {
    if (!selectedIncident) return;
    setLoading(true);
    try {
      const { error } = await supabase.from('profile_incidents').insert({
        profile_id: id,
        incident_id: selectedIncident.id,
        connection_type: connectionType,
        confidence_score: confidenceScore,
        linked_by: user.id,
        linked_at: new Date().toISOString()
      });

      if (error) throw error;
      toast.success('Profile linked to incident successfully');
      setShowLinkModal(false);
      setSelectedIncident(null);
      // Refresh incidents list
      window.location.reload();
    } catch (error) {
      toast.error('Failed to link profile: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  // Add intelligence note
  const [intelForm, setIntelForm] = useState({
    content: '',
    source_type: 'investigation',
    intelligence_type: 'observation'
  });

  const handleAddIntel = async () => {
    if (!intelForm.content.trim()) {
      toast.error('Please enter intelligence content');
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.from('profile_intelligence').insert({
        profile_id: id,
        content: intelForm.content,
        source_type: intelForm.source_type,
        intelligence_type: intelForm.intelligence_type,
        reported_by: user.id,
        created_at: new Date().toISOString()
      });

      if (error) throw error;
      toast.success('Intelligence note added');
      setShowIntelModal(false);
      setIntelForm({ content: '', source_type: 'investigation', intelligence_type: 'observation' });
    } catch (error) {
      toast.error('Failed to add intelligence: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  if (profileLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <FaSpinner className="animate-spin text-4xl text-indigo-600" />
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center text-gray-500">
        <p>Profile not found</p>
        <button onClick={() => navigate(-1)} className="mt-4 text-indigo-600">
          Go Back
        </button>
      </div>
    );
  }

  const stats = {
    incidentCount: incidents?.length || 0,
    associateCount: associates?.length || 0,
    locationCount: 1,
    moConfidence: 85
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 pb-20">
      {/* HEADER WITH BACK BUTTON */}
      <header className="bg-white dark:bg-gray-800 shadow-sm border-b border-gray-200 dark:border-gray-700 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
          <button 
            onClick={() => navigate(-1)}
            className="flex items-center gap-2 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition"
          >
            <FaArrowLeft /> Back
          </button>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">
            Criminal Profile
          </h1>
          <div className="w-8" /> {/* Spacer for alignment */}
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* LEFT COLUMN - Profile Card */}
          <div className="lg:col-span-1">
            <CriminalProfileCard profile={profile} stats={stats} />
            
            {/* ACTIONS - FUNCTIONAL BUTTONS */}
            <div className="mt-6 bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-4">
              <h3 className="font-semibold text-gray-900 dark:text-white mb-4">Actions</h3>
              <div className="space-y-3">
                <button 
                  onClick={() => setShowLinkModal(true)}
                  className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition font-medium"
                >
                  <FaLink /> Link to Incident
                </button>
                <button 
                  onClick={() => setShowAssociateModal(true)}
                  className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-lg transition font-medium"
                >
                  <FaUserPlus /> Add Associate
                </button>
                <button 
                  onClick={() => setShowIntelModal(true)}
                  className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-lg transition font-medium"
                >
                  <FaStickyNote /> Add Intelligence Note
                </button>
              </div>
            </div>
          </div>

          {/* RIGHT COLUMN - Tabs */}
          <div className="lg:col-span-2">
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700">
              {/* TABS */}
              <div className="border-b border-gray-200 dark:border-gray-700">
                <nav className="flex gap-6 px-6">
                  {[
                    { id: 'overview', label: 'Overview', icon: FaHistory },
                    { id: 'network', label: 'Network', icon: FaNetworkWired, count: associates?.length },
                    { id: 'geography', label: 'Geography', icon: FaMapMarkerAlt }
                  ].map(tab => (
                    <button
                      key={tab.id}
                      onClick={() => setActiveTab(tab.id)}
                      className={`flex items-center gap-2 py-4 border-b-2 font-medium text-sm transition ${
                        activeTab === tab.id
                          ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400'
                          : 'border-transparent text-gray-500 hover:text-gray-700'
                      }`}
                    >
                      <tab.icon className="w-4 h-4" />
                      {tab.label}
                      {tab.count > 0 && <span className="ml-1 text-xs bg-gray-100 px-2 py-0.5 rounded-full">{tab.count}</span>}
                    </button>
                  ))}
                </nav>
              </div>

              {/* TAB CONTENT */}
              <div className="p-6">
                {activeTab === 'overview' && (
                  <div className="space-y-6">
                    <h3 className="font-semibold text-gray-900 dark:text-white text-lg">Linked Incidents</h3>
                    {incidents?.length === 0 ? (
                      <p className="text-gray-500 dark:text-gray-400">No incidents linked to this profile yet.</p>
                    ) : (
                      incidents.map(link => (
                        <div key={link.id} className="border border-gray-200 dark:border-gray-700 rounded-lg p-4 hover:shadow-md transition">
                          <div className="flex justify-between items-start">
                            <div>
                              <h4 className="font-medium text-gray-900 dark:text-white">{link.incidents?.type}</h4>
                              <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">{link.incidents?.description}</p>
                              <p className="text-xs text-gray-500 mt-2">
                                {link.incidents?.location} • {new Date(link.incidents?.incident_date).toLocaleDateString()}
                              </p>
                            </div>
                            <span className={`px-2 py-1 rounded text-xs font-bold ${
                              link.confidence_score > 80 ? 'bg-green-100 text-green-800' :
                              link.confidence_score > 50 ? 'bg-yellow-100 text-yellow-800' :
                              'bg-gray-100 text-gray-800'
                            }`}>
                              {link.confidence_score}% Match
                            </span>
                          </div>
                          <div className="mt-2 text-xs text-gray-500 capitalize">
                            Connection: {link.connection_type.replace(/_/g, ' ')}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                )}

                {activeTab === 'network' && (
                  <div>
                    <h3 className="font-semibold text-gray-900 dark:text-white mb-4">Associate Network</h3>
                    {associates?.length === 0 ? (
                      <p className="text-gray-500 dark:text-gray-400">No known associates recorded.</p>
                    ) : (
                      <div className="grid gap-4">
                        {associates.map(assoc => (
                          <div key={assoc.id} className="flex items-center gap-4 p-4 border border-gray-200 dark:border-gray-700 rounded-lg">
                            <div className="w-12 h-12 rounded-full bg-gray-300 flex items-center justify-center">
                              <FaUserPlus className="text-gray-600" />
                            </div>
                            <div className="flex-1">
                              <h4 className="font-medium text-gray-900 dark:text-white">
                                {assoc.profile?.primary_name || 'Unknown Associate'}
                              </h4>
                              <p className="text-sm text-gray-600 capitalize">
                                {assoc.relationship_type.replace(/_/g, ' ')} • {assoc.relationship_strength}
                              </p>
                            </div>
                            <button 
                              onClick={() => navigate(`/intelligence/profiles/${assoc.associate_profile_id}`)}
                              className="text-indigo-600 hover:text-indigo-700 text-sm font-medium"
                            >
                              View Profile
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {activeTab === 'geography' && (
                  <div>
                    <h3 className="font-semibold text-gray-900 dark:text-white mb-4">Geographic Activity</h3>
                    <div className="h-64 bg-gray-100 dark:bg-gray-700 rounded-lg flex items-center justify-center text-gray-500">
                      Map view placeholder - Last seen: {profile.last_seen_location || 'Unknown'}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* LINK TO INCIDENT MODAL */}
      {showLinkModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl max-w-lg w-full p-6">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-xl font-bold text-gray-900 dark:text-white">Link to Incident</h3>
              <button onClick={() => setShowLinkModal(false)} className="text-gray-400 hover:text-gray-600">
                <FaTimes />
              </button>
            </div>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Search Incident
                </label>
                <input
                  type="text"
                  placeholder="Type incident description..."
                  value={incidentSearch}
                  onChange={(e) => {
                    setIncidentSearch(e.target.value);
                    searchIncidents(e.target.value);
                  }}
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 dark:bg-gray-700 dark:text-white"
                />
              </div>

              {searchResults.length > 0 && (
                <div className="border border-gray-200 dark:border-gray-700 rounded-lg max-h-40 overflow-y-auto">
                  {searchResults.map(inc => (
                    <div 
                      key={inc.id}
                      onClick={() => setSelectedIncident(inc)}
                      className={`p-3 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700 border-b last:border-0 ${
                        selectedIncident?.id === inc.id ? 'bg-indigo-50 dark:bg-indigo-900/30 border-indigo-500' : ''
                      }`}
                    >
                      <p className="font-medium text-sm">{inc.type}</p>
                      <p className="text-xs text-gray-500">{inc.description?.substring(0, 60)}...</p>
                    </div>
                  ))}
                </div>
              )}

              {selectedIncident && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Connection Type
                    </label>
                    <select 
                      value={connectionType}
                      onChange={(e) => setConnectionType(e.target.value)}
                      className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 dark:bg-gray-700 dark:text-white"
                    >
                      <option value="person_of_interest">Person of Interest</option>
                      <option value="probable_suspect">Probable Suspect</option>
                      <option value="confirmed_perpetrator">Confirmed Perpetrator</option>
                      <option value="witness">Witness</option>
                      <option value="associate_present">Associate Present</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Confidence Score: {confidenceScore}%
                    </label>
                    <input 
                      type="range" 
                      min="1" 
                      max="100" 
                      value={confidenceScore}
                      onChange={(e) => setConfidenceScore(parseInt(e.target.value))}
                      className="w-full"
                    />
                  </div>
                </>
              )}

              <button 
                onClick={handleLinkIncident}
                disabled={!selectedIncident || loading}
                className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-lg font-medium transition"
              >
                {loading ? 'Linking...' : 'Link Profile to Incident'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ADD INTELLIGENCE NOTE MODAL */}
      {showIntelModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl max-w-lg w-full p-6">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-xl font-bold text-gray-900 dark:text-white">Add Intelligence Note</h3>
              <button onClick={() => setShowIntelModal(false)} className="text-gray-400 hover:text-gray-600">
                <FaTimes />
              </button>
            </div>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Intelligence Type
                </label>
                <select 
                  value={intelForm.intelligence_type}
                  onChange={(e) => setIntelForm({...intelForm, intelligence_type: e.target.value})}
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 dark:bg-gray-700 dark:text-white"
                >
                  <option value="observation">Observation</option>
                  <option value="communication">Communication</option>
                  <option value="travel_movement">Travel/Movement</option>
                  <option value="associates_meeting">Associates Meeting</option>
                  <option value="threat_assessment">Threat Assessment</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Source Type
                </label>
                <select 
                  value={intelForm.source_type}
                  onChange={(e) => setIntelForm({...intelForm, source_type: e.target.value})}
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 dark:bg-gray-700 dark:text-white"
                >
                  <option value="investigation">Investigation</option>
                  <option value="surveillance">Surveillance</option>
                  <option value="informant">Informant</option>
                  <option value="osint">OSINT</option>
                  <option value="public_record">Public Record</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Content
                </label>
                <textarea 
                  rows={4}
                  placeholder="Enter intelligence details..."
                  value={intelForm.content}
                  onChange={(e) => setIntelForm({...intelForm, content: e.target.value})}
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 dark:bg-gray-700 dark:text-white"
                />
              </div>

              <button 
                onClick={handleAddIntel}
                disabled={loading || !intelForm.content.trim()}
                className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-lg font-medium transition"
              >
                {loading ? 'Adding...' : 'Add Intelligence Note'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ADD ASSOCIATE MODAL (Simplified) */}
      {showAssociateModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl max-w-lg w-full p-6">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-xl font-bold text-gray-900 dark:text-white">Add Associate</h3>
              <button onClick={() => setShowAssociateModal(false)} className="text-gray-400 hover:text-gray-600">
                <FaTimes />
              </button>
            </div>
            <p className="text-gray-600 dark:text-gray-400 mb-4">
              Search and link an existing profile as an associate of {profile.primary_name}.
            </p>
            <input
              type="text"
              placeholder="Search profiles..."
              className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 mb-4 dark:bg-gray-700 dark:text-white"
              onChange={(e) => {
                if (e.target.value.length > 2) {
                  // TODO: Implement profile search
                  toast.info('Profile search not yet implemented');
                }
              }}
            />
            <button 
              onClick={() => {
                setShowAssociateModal(false);
                toast.info('Associate linking coming soon');
              }}
              className="w-full py-3 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg font-medium"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}