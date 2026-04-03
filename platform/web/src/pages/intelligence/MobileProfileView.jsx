// Component definitions moved to top level
const ActionButton = ({ icon: Icon, label, color, onClick }) => (
  <button
    onClick={onClick}
    className={`p-3 rounded-xl text-white font-medium text-sm flex flex-col items-center gap-2 ${color} hover:opacity-90 transition`}
  >
    <Icon className="w-5 h-5" />
    <span>{label}</span>
  </button>
);

const InfoCard = ({ title, icon: Icon, children, className = "" }) => (
  <div className={`flex-shrink-0 w-64 snap-start bg-white dark:bg-gray-800 rounded-xl p-4 shadow-sm border border-gray-100 dark:border-gray-700 ${className}`}>
    <div className="flex items-center gap-2 mb-3">
      <Icon className="w-5 h-5 text-teal-600" />
      <h3 className="font-semibold text-gray-900 dark:text-white">{title}</h3>
    </div>
    <div className="text-sm text-gray-600 dark:text-gray-300 space-y-1">
      {children}
    </div>
  </div>
);

import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useCriminalProfile, useProfileIncidents } from '../../hooks/useCriminalIntelligence';
import { 
  FaArrowLeft, FaUser, FaExclamationTriangle, FaMapMarkerAlt, FaPhone, FaEye, FaHistory,
  FaFingerprint, FaClock, FaCalendarAlt, FaCar, FaWalking, FaBicycle, FaExclamation
} from 'react-icons/fa';
import QuickSightingButton from '../../components/patrol/QuickSightingButton';
import ThemeToggle from '../../components/ThemeToggle';
import BrandedLoader from '../../components/layout/BrandedLoader';
import PatrollerPhotoPreview from '../../components/patrol/PatrollerPhotoPreview';
import { connectionTypeLabel } from '../../data/profileIncidentLinkTaxonomy';

const MobileProfileView = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [photoLightbox, setPhotoLightbox] = useState(null);

  const { data: profile, isLoading: profileLoading } = useCriminalProfile(id);
  const { data: incidents } = useProfileIncidents(id);

  const getRiskBadgeClass = (riskLevel) => {
    switch (riskLevel) {
      case 'critical': return 'bg-red-600 animate-pulse';
      case 'high': return 'bg-orange-600';
      case 'medium': return 'bg-yellow-600';
      case 'low': return 'bg-green-600';
      default: return 'bg-gray-600';
    }
  };

  const getRiskIcon = (riskLevel) => {
    switch (riskLevel) {
      case 'critical':
      case 'high':
        return <FaExclamationTriangle className="w-4 h-4" />;
      default:
        return <FaUser className="w-4 h-4" />;
    }
  };

  const formatLastSeen = (dateString) => {
    if (!dateString) return 'Unknown';
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins} minutes ago`;
    if (diffHours < 24) return `${diffHours} hours ago`;
    if (diffDays < 7) return `${diffDays} days ago`;
    return date.toLocaleDateString();
  };

  if (profileLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-900 text-white">
        <BrandedLoader message="Loading profile…" size="lg" className="[&_p]:text-gray-300" />
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="min-h-screen bg-gray-900 text-white flex items-center justify-center">
        <div className="text-center">
          <FaUser className="w-16 h-16 text-gray-500 mx-auto mb-4" />
          <h2 className="text-xl font-semibold mb-2">Profile Not Found</h2>
          <p className="text-gray-400">The requested profile could not be found.</p>
          <button
            onClick={() => navigate(-1)}
            className="mt-4 px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700"
          >
            Go Back
          </button>
        </div>
      </div>
    );
  }

  const heroPhotoUrls = (profile.photo_urls || []).filter(Boolean);

  return (
    <div className="min-h-screen bg-gray-900 text-white pb-20">
      {/* Hero Section with Photo */}
      <div className="relative h-72">
        {heroPhotoUrls.length > 0 ? (
          <button
            type="button"
            onClick={() => setPhotoLightbox({ urls: heroPhotoUrls, index: 0 })}
            className="absolute inset-0 h-full w-full cursor-zoom-in border-0 bg-transparent p-0 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900"
            aria-label="View photographs full screen"
          >
            <img
              src={heroPhotoUrls[0]}
              className="h-full w-full object-cover object-top"
              alt={`${profile.primary_name}'s profile`}
            />
          </button>
        ) : (
          <img
            src="/default-suspect.png"
            className="h-full w-full object-cover object-top"
            alt={`${profile.primary_name}'s profile`}
          />
        )}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black via-transparent to-transparent" />
        
        <div className="absolute top-4 left-4 z-10">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="bg-black/50 backdrop-blur-md p-2 rounded-full"
          >
            <FaArrowLeft className="text-white" />
          </button>
        </div>
        <div className="absolute top-4 right-4 z-10">
          <ThemeToggle variant="overlay" />
        </div>

        <div className="absolute bottom-0 left-0 right-0 p-6">
          <div className={`inline-block px-3 py-1 rounded-full text-xs font-bold mb-2 ${getRiskBadgeClass(profile.risk_level)}`}>
            {getRiskIcon(profile.risk_level)}
            {profile.risk_level?.toUpperCase()} RISK
          </div>
          <h1 className="text-3xl font-bold">{profile.primary_name}</h1>
          {profile.known_aliases?.[0] && (
            <p className="text-gray-300 text-sm">AKA: {profile.known_aliases[0]}</p>
          )}
        </div>
      </div>

      {/* Quick Actions Grid */}
      <div className="p-4 grid grid-cols-3 gap-3">
        <ActionButton 
          icon={FaPhone} 
          label="Request Backup" 
          color="bg-blue-600"
          onClick={() => {
            // Trigger backup request
            toast.success('Backup requested');
          }}
        />
        <ActionButton 
          icon={FaMapMarkerAlt} 
          label="Last Location" 
          color="bg-green-600"
          onClick={() => {
            if (profile.last_seen_location) {
              // Navigate to map with location
              navigate(`/map?lat=${profile.last_seen_location.lat}&lng=${profile.last_seen_location.lng}`);
            }
          }}
        />
        <ActionButton 
          icon={FaEye} 
          label="Report Sighting" 
          color="bg-red-600"
          onClick={() => {
            // Report sighting functionality
            console.log('Report sighting clicked');
          }}
        />
      </div>

      {/* Swipeable Info Cards */}
      <div className="overflow-x-auto flex gap-4 p-4 snap-x snap-mandatory">
        <InfoCard title="Physical" icon={FaUser}>
          <strong>Height:</strong> {profile.height_cm}cm<br />
          <strong>Build:</strong> {profile.build_type}<br />
          <strong>Hair:</strong> {profile.hair_color}<br />
          <strong>Eyes:</strong> {profile.eye_color}<br />
          {profile.distinguishing_marks?.length > 0 && (
            <>
              <strong>Distinctive:</strong> {profile.distinguishing_marks.join(', ')}
            </>
          )}
        </InfoCard>
        
        <InfoCard title="Modus Operandi" icon={FaFingerprint}>
          <strong>Time:</strong> <span className="break-words whitespace-normal leading-relaxed">{profile.mo_signature?.time_patterns?.join(', ') || 'Unknown'}</span><br />
          <strong>Targets:</strong> <span className="break-words whitespace-normal leading-relaxed">{profile.mo_signature?.target_types?.join(', ') || 'Unknown'}</span><br />
          <strong>Entry:</strong> <span className="break-words whitespace-normal leading-relaxed">{profile.mo_signature?.entry_methods?.join(', ') || 'Unknown'}</span><br />
          <strong>Weapons:</strong> <span className="break-words whitespace-normal leading-relaxed">{profile.mo_signature?.weapons_preferred?.join(', ') || 'Unknown'}</span>
        </InfoCard>
        
        <InfoCard title="Recent Activity" icon={FaHistory}>
          <strong>Last Seen:</strong> {formatLastSeen(profile.last_seen_at)}<br />
          <strong>Location:</strong> {profile.last_seen_location?.address || 'Unknown'}<br />
          <strong>Incidents:</strong> {incidents?.length || 0}<br />
          <strong>Status:</strong> {profile.status}
        </InfoCard>

        <InfoCard title="Vehicle Info" icon={FaCar}>
          {profile.vehicle_info?.make_model && (
            <>
              <strong>Make/Model:</strong> {profile.vehicle_info.make_model}<br />
              <strong>Reg:</strong> {profile.vehicle_info.registration}<br />
              <strong>Color:</strong> {profile.vehicle_info.color}<br />
              <strong>Type:</strong> {profile.vehicle_info.type}
            </>
          )}
          {!profile.vehicle_info && 'No vehicle information available'}
        </InfoCard>
      </div>

      {/* Linked Incidents List */}
      <div className="p-4">
        <h3 className="font-semibold text-lg mb-3 flex items-center gap-2">
          <FaHistory />
          Linked Incidents ({incidents?.length || 0})
        </h3>
        {incidents && incidents.length > 0 ? (
          <div className="space-y-3">
            {incidents.map((link, index) => (
              <div key={index} className="bg-gray-800 rounded-lg p-3 border border-gray-700">
                <div className="flex justify-between items-start">
                  <div>
                    <h4 className="font-medium text-white">{link.incidents?.type}</h4>
                    <p className="text-sm text-gray-400 mt-1 line-clamp-2">
                      {link.incidents?.description}
                    </p>
                  </div>
                  <span className={`px-2 py-1 rounded text-xs font-medium ${
                    link.confidence_score == null || !Number.isFinite(Number(link.confidence_score))
                      ? 'bg-gray-700 text-gray-300'
                      : link.confidence_score > 80
                        ? 'bg-green-900/50 text-green-300'
                        : 'bg-yellow-900/50 text-yellow-300'
                  }`}>
                    {link.confidence_score != null && Number.isFinite(Number(link.confidence_score))
                      ? `${link.confidence_score}% confidence`
                      : 'Not assessed'}
                  </span>
                </div>
                <div className="mt-2 text-xs text-gray-500">
                  <span className="font-medium text-teal-400">{connectionTypeLabel(link.connection_type)}</span>
                  {' • '}
                  {new Date(link.linked_at || link.created_at).toLocaleDateString()}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-8 text-gray-500">
            No linked incidents found
          </div>
        )}
      </div>

      <PatrollerPhotoPreview
        key={photoLightbox ? `mobile-ph-${photoLightbox.index}` : 'mobile-ph-closed'}
        open={!!photoLightbox}
        onClose={() => setPhotoLightbox(null)}
        name={profile.primary_name?.trim() || 'Subject'}
        imageUrls={photoLightbox?.urls}
        initialIndex={photoLightbox?.index ?? 0}
      />

      {/* Quick Sighting Button */}
      <QuickSightingButton 
        profileId={id}
        profileName={profile.primary_name}
      />
    </div>
  );
};

export default MobileProfileView;