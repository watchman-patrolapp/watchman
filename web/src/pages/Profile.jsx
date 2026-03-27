import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/useAuth';
import { supabase } from '../supabase/client';
import toast from 'react-hot-toast';
import { FaUser, FaMapMarkerAlt, FaCar, FaSave } from 'react-icons/fa';
import ReactCrop, { centerCrop, makeAspectCrop } from 'react-image-crop';
import 'react-image-crop/dist/ReactCrop.css';

export default function Profile() {
  const navigate = useNavigate();
  const { user, refreshUser } = useAuth();
  const [loading, setLoading] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [form, setForm] = useState({
    fullName: '',
    address: '',
  });

  // Crop states
  const [selectedImage, setSelectedImage] = useState(null); // file object
  const [imagePreviewUrl, setImagePreviewUrl] = useState(null);
  const [crop, setCrop] = useState();
  const [completedCrop, setCompletedCrop] = useState(null);
  const [showCropModal, setShowCropModal] = useState(false);
  const [imageRef, setImageRef] = useState(null);

  useEffect(() => {
    if (user) {
      setForm({
        fullName: user.fullName || '',
        address: user.address || '',
      });
    }
  }, [user]);

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  // When a file is selected, show crop modal
  const handleFileSelect = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    // Create preview URL
    const previewUrl = URL.createObjectURL(file);
    setSelectedImage(file);
    setImagePreviewUrl(previewUrl);
    setShowCropModal(true);
  };

  // Initial crop configuration (square, centered)
  const onImageLoad = (e) => {
    const { width, height } = e.currentTarget;
    const crop = centerCrop(
      makeAspectCrop(
        {
          unit: '%',
          width: 90,
        },
        1, // 1:1 aspect ratio (square)
        width,
        height
      ),
      width,
      height
    );
    setCrop(crop);
    setImageRef(e.currentTarget);
  };

  // Upload the cropped image
  const handleCropConfirm = async () => {
    if (!completedCrop || !imageRef) return;

    // Create a canvas to draw the cropped image
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const scaleX = imageRef.naturalWidth / imageRef.width;
    const scaleY = imageRef.naturalHeight / imageRef.height;

    canvas.width = completedCrop.width;
    canvas.height = completedCrop.height;

    ctx.drawImage(
      imageRef,
      completedCrop.x * scaleX,
      completedCrop.y * scaleY,
      completedCrop.width * scaleX,
      completedCrop.height * scaleY,
      0,
      0,
      completedCrop.width,
      completedCrop.height
    );

    // Convert canvas to blob
    canvas.toBlob(async (blob) => {
      setUploadingAvatar(true);
      try {
        const fileExt = selectedImage.name.split('.').pop();
        const fileName = `${user.id}-${Date.now()}.${fileExt}`;

        // Upload cropped blob to Supabase
        const { error: uploadError } = await supabase.storage
          .from('avatars')
          .upload(fileName, blob);
        if (uploadError) throw uploadError;

        const { data: urlData } = supabase.storage
          .from('avatars')
          .getPublicUrl(fileName);
        const publicUrl = urlData.publicUrl;

        // Update user profile in database
        const { error: updateError } = await supabase
          .from('users')
          .update({ avatar_url: publicUrl })
          .eq('id', user.id);
        if (updateError) throw updateError;

        await refreshUser();
        toast.success('Avatar updated!');
      } catch (err) {
        console.error('Avatar upload error:', err);
        toast.error('Avatar upload failed: ' + err.message);
      } finally {
        setUploadingAvatar(false);
        setShowCropModal(false);
        URL.revokeObjectURL(imagePreviewUrl);
        setSelectedImage(null);
        setImagePreviewUrl(null);
      }
    }, 'image/jpeg', 0.9); // Adjust quality as needed
  };

  const handleSaveProfile = async () => {
    setLoading(true);
    try {
      const { error } = await supabase
        .from('users')
        .update({
          full_name: form.fullName,
          address: form.address,
        })
        .eq('id', user.id);
      if (error) throw error;
      await refreshUser();
      toast.success('Profile updated!');
    } catch (err) {
      console.error(err);
      toast.error('Failed to update profile.');
    } finally {
      setLoading(false);
    }
  };

  const primaryVehicle = user?.vehicles?.find(v => v.is_primary);

  return (
    <div className="min-h-screen bg-gray-100 dark:bg-gray-900 p-6">
      <div className="max-w-2xl mx-auto bg-white dark:bg-gray-800 p-6 rounded shadow">
        <div className="flex justify-between items-center mb-4">
          <h1 className="text-2xl font-bold dark:text-white">Your Profile</h1>
          <button onClick={() => navigate(-1)} className="text-gray-600 dark:text-gray-400 hover:underline">
            Back
          </button>
        </div>

        {/* Avatar section */}
        <div className="mb-6 flex flex-col items-center">
          {user?.avatarUrl ? (
            <img src={user.avatarUrl} alt="Avatar" className="w-24 h-24 rounded-full object-cover mb-2" />
          ) : (
            <div className="w-24 h-24 rounded-full bg-gray-300 dark:bg-gray-600 flex items-center justify-center mb-2">
              <FaUser className="text-gray-600 dark:text-gray-400 text-3xl" />
            </div>
          )}
          <label className="cursor-pointer bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700">
            {uploadingAvatar ? 'Uploading...' : 'Change Photo'}
            <input
              type="file"
              accept="image/*"
              onChange={handleFileSelect}
              className="hidden"
              disabled={uploadingAvatar}
            />
          </label>
        </div>

        {/* Crop Modal – fixed for vertical images */}
        {showCropModal && imagePreviewUrl && (
          <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4">
            <div className="bg-white dark:bg-gray-800 p-6 rounded-lg max-w-3xl w-full max-h-[90vh] overflow-y-auto">
              <h2 className="text-xl font-bold mb-4 dark:text-white">Crop Image</h2>
              <div className="flex justify-center items-center min-h-[300px]">
                <ReactCrop
                  crop={crop}
                  onChange={(_, percentCrop) => setCrop(percentCrop)}
                  onComplete={(c) => setCompletedCrop(c)}
                  aspect={1}
                  circularCrop
                >
                  <img
                    src={imagePreviewUrl}
                    alt="Crop preview"
                    onLoad={onImageLoad}
                    className="max-w-full max-h-[60vh] w-auto h-auto object-contain"
                  />
                </ReactCrop>
              </div>
              <div className="flex justify-end gap-3 mt-4 sticky bottom-0 bg-white dark:bg-gray-800 pt-2">
                <button
                  onClick={() => {
                    setShowCropModal(false);
                    URL.revokeObjectURL(imagePreviewUrl);
                    setSelectedImage(null);
                    setImagePreviewUrl(null);
                  }}
                  className="px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCropConfirm}
                  disabled={!completedCrop}
                  className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                >
                  Upload
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Profile fields */}
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1 dark:text-gray-300">Full Name</label>
            <div className="flex items-center border dark:border-gray-600 rounded px-3 py-2">
              <FaUser className="text-gray-400 mr-2" />
              <input
                type="text"
                name="fullName"
                value={form.fullName}
                onChange={handleChange}
                className="w-full focus:outline-none dark:bg-gray-800 dark:text-white"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1 dark:text-gray-300">Address</label>
            <div className="flex items-center border dark:border-gray-600 rounded px-3 py-2">
              <FaMapMarkerAlt className="text-gray-400 mr-2" />
              <input
                type="text"
                name="address"
                value={form.address}
                onChange={handleChange}
                className="w-full focus:outline-none dark:bg-gray-800 dark:text-white"
              />
            </div>
          </div>
        </div>

        {/* Vehicle info */}
        <div className="mt-6 border-t dark:border-gray-700 pt-4">
          <h2 className="text-lg font-semibold mb-2 flex items-center dark:text-white">
            <FaCar className="mr-2" /> Vehicle
          </h2>
          {primaryVehicle ? (
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded-full" style={{ backgroundColor: primaryVehicle.color }} />
              <span className="dark:text-white">{primaryVehicle.make_model} ({primaryVehicle.registration})</span>
              <span className="px-2 py-1 bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 text-xs rounded ml-2">
                Primary
              </span>
            </div>
          ) : user?.carType ? (
            <p className="dark:text-gray-300">{user.carType} ({user.registrationNumber})</p>
          ) : (
            <p className="text-gray-500 dark:text-gray-400">No vehicle added.</p>
          )}
          <button
            onClick={() => navigate('/vehicles')}
            className="mt-2 bg-indigo-600 text-white px-4 py-2 rounded hover:bg-indigo-700 text-sm"
          >
            Manage Vehicles
          </button>
        </div>

        {/* Save button */}
        <div className="mt-6 flex justify-end">
          <button
            onClick={handleSaveProfile}
            disabled={loading}
            className="bg-green-600 text-white px-6 py-2 rounded hover:bg-green-700 transition disabled:opacity-50 flex items-center gap-2"
          >
            <FaSave />
            {loading ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}