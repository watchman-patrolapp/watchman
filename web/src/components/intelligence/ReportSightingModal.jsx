import React, { useState, useEffect } from 'react';
import { supabase } from '../../supabase/client';
import { toast } from 'react-hot-toast';
import { FaMapMarkerAlt, FaClock, FaUser, FaExclamationTriangle, FaTimes } from 'react-icons/fa';

const ReportSightingModal = ({ isOpen, onClose, profileId, profileName }) => {
  const [formData, setFormData] = useState({
    description: '',
    location: '',
    accuracy: 0,
    timestamp: new Date().toISOString()
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [locationError, setLocationError] = useState('');

  // Get current location
  useEffect(() => {
    if (isOpen) {
      getCurrentLocation();
    }
  }, [isOpen]);

  const getCurrentLocation = () => {
    if (!navigator.geolocation) {
      setLocationError('Geolocation is not supported by this browser');
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude, accuracy } = position.coords;
        setFormData(prev => ({
          ...prev,
          location: JSON.stringify({
            lat: latitude,
            lng: longitude,
            accuracy: accuracy
          }),
          accuracy: accuracy
        }));
        setLocationError('');
      },
      () => {
        setLocationError('Unable to get current location');
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 30000
      }
    );
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      // Get current user
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        throw new Error('User not authenticated');
      }

      // Parse location
      let locationData;
      try {
        locationData = JSON.parse(formData.location);
      } catch {
        throw new Error('Invalid location data');
      }

      // Insert into profile_geography table
      const { error: insertError } = await supabase
        .from('profile_geography')
        .insert({
          profile_id: profileId,
          coordinates: {
            type: 'Point',
            coordinates: [locationData.lng, locationData.lat]
          },
          location_accuracy: locationData.accuracy,
          description: formData.description,
          reported_by: user.id,
          reported_at: formData.timestamp
        });

      if (insertError) throw insertError;

      toast.success('Sighting reported successfully');
      onClose();
      setFormData({
        description: '',
        location: '',
        accuracy: 0,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Error reporting sighting:', error);
      toast.error('Failed to report sighting: ' + error.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-2xl max-w-md w-full p-6 shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <FaExclamationTriangle className="text-red-600" />
            Report Sighting
          </h2>
          <button
            onClick={onClose}
            className="p-1 rounded-full hover:bg-gray-200 dark:hover:bg-gray-700 transition"
          >
            <FaTimes className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        <div className="mb-4 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
          <p className="text-sm text-blue-700 dark:text-blue-300">
            <strong>Target:</strong> {profileName}
          </p>
          <p className="text-xs text-blue-600 dark:text-blue-400 mt-1">
            Location will be automatically captured from your device
          </p>
        </div>

        {locationError && (
          <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
            <p className="text-sm text-red-700 dark:text-red-300">{locationError}</p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Description
            </label>
            <textarea
              name="description"
              value={formData.description}
              onChange={handleChange}
              placeholder="Describe what you saw (e.g., 'Suspect seen walking towards Kragga Kamma Road')"
              className="w-full rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-4 py-2.5 text-gray-900 dark:text-white placeholder-gray-400 focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition resize-y"
              rows={3}
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                <FaClock className="inline w-4 h-4 mr-1" />
                Time
              </label>
              <input
                type="datetime-local"
                name="timestamp"
                value={formData.timestamp.slice(0, 16)}
                onChange={handleChange}
                className="w-full rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-4 py-2.5 text-gray-900 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                <FaMapMarkerAlt className="inline w-4 h-4 mr-1" />
                Accuracy
              </label>
              <div className="bg-gray-100 dark:bg-gray-700 rounded-xl px-4 py-2.5">
                <span className="text-sm text-gray-600 dark:text-gray-300">
                  {formData.accuracy ? `${Math.round(formData.accuracy)}m` : 'Getting location...'}
                </span>
              </div>
            </div>
          </div>

          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded-xl hover:bg-gray-300 dark:hover:bg-gray-600 transition font-medium"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || locationError}
              className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl transition font-medium flex items-center justify-center gap-2"
            >
              {isSubmitting ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Reporting...
                </>
              ) : (
                <>
                  <FaExclamationTriangle />
                  Report Sighting
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default ReportSightingModal;