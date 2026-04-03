import React, { useState } from 'react';
import { FaEye, FaMapMarkerAlt } from 'react-icons/fa';
import { useAuth } from '../../auth/useAuth';
import { supabase } from '../../supabase/client';
import toast from 'react-hot-toast';

export default function QuickSightingButton({ profileId, profileName }) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);

  const reportSighting = async () => {
    if (!navigator.geolocation) {
      toast.error('Geolocation not available');
      return;
    }

    setLoading(true);
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        try {
          const { error } = await supabase.from('profile_geography').insert({
            profile_id: profileId,
            location_type: 'sighting',
            coordinates: `(${position.coords.latitude}, ${position.coords.longitude})`,
            location_name: `Sighting reported by ${user.user_metadata?.full_name || user.email}`,
            first_seen_at: new Date().toISOString(),
            last_seen_at: new Date().toISOString(),
            created_by: user.id
          });

          if (error) throw error;
          toast.success(`Sighting of ${profileName} reported successfully!`);
        } catch {
          toast.error('Failed to report sighting');
        } finally {
          setLoading(false);
        }
      },
      () => {
        toast.error('Could not get location');
        setLoading(false);
      }
    );
  };

  return (
    <button
      onClick={reportSighting}
      disabled={loading}
      className="fixed bottom-6 right-6 w-16 h-16 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white rounded-full shadow-2xl flex items-center justify-center text-2xl transition z-50"
    >
      {loading ? (
        <div className="w-6 h-6 border-2 border-white/30 border-t-white rounded-full animate-spin" />
      ) : (
        <FaEye />
      )}
    </button>
  );
}