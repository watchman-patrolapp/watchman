import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/useAuth';
import { supabase } from '../supabase/client';
import toast from 'react-hot-toast';
import { FaUser, FaMapMarkerAlt, FaCar, FaSave, FaEnvelope, FaPhone, FaLock, FaExclamationTriangle } from 'react-icons/fa';
import ThemeToggle from '../components/ThemeToggle';
import { TbWifi, TbWifiOff } from 'react-icons/tb';
import { getUserReduceMobileData, setUserReduceMobileData } from '../utils/dataSaverProfile';
import { formatAuthErrorMessage } from '../utils/authErrorMessage';
import ReactCrop, { centerCrop, makeAspectCrop } from 'react-image-crop';
import 'react-image-crop/dist/ReactCrop.css';

/**
 * Soft cap before we warn the user (not an abort). Embedded IDE browsers often take 30–60s+ for
 * Supabase signIn + updateUser without being broken — 28s was too aggressive.
 */
const PASSWORD_CHANGE_FLOW_MS = 90_000;

export default function Profile() {
  const navigate = useNavigate();
  const { user, refreshUser, signOut } = useAuth();
  const [loading, setLoading] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [pwdLoading, setPwdLoading] = useState(false);
  const [passwordForm, setPasswordForm] = useState({
    current: '',
    next: '',
    confirm: '',
  });
  const [form, setForm] = useState({
    fullName: '',
    address: '',
    phone: '',
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
        phone: user.phone || '',
      });
    }
  }, [user]);

  const [reduceMobileData, setReduceMobileData] = useState(() => getUserReduceMobileData());

  const privacyContactEmail = (import.meta.env.VITE_PRIVACY_CONTACT_EMAIL || '').trim();
  const [authIdentities, setAuthIdentities] = useState(null);
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteAccountAck, setDeleteAccountAck] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);

  useEffect(() => {
    if (!user?.id) {
      setAuthIdentities(null);
      return;
    }
    let cancelled = false;
    void supabase.auth.getUser().then(({ data }) => {
      if (cancelled) return;
      setAuthIdentities(data.user?.identities ?? []);
    });
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  const canDeleteWithPassword =
    Array.isArray(authIdentities) && authIdentities.some((i) => i.provider === 'email');
  useEffect(() => {
    const sync = () => setReduceMobileData(getUserReduceMobileData());
    window.addEventListener('watchman-reduce-mobile-data-changed', sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener('watchman-reduce-mobile-data-changed', sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handlePasswordFieldChange = (e) => {
    setPasswordForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleChangePassword = async () => {
    const email = user?.email?.trim();
    if (!email) {
      toast.error('No email on this account; password change is not available.');
      return;
    }
    const { current, next, confirm } = passwordForm;
    if (!current || !next) {
      toast.error('Enter your current password and a new password.');
      return;
    }
    if (next.length < 6) {
      toast.error('New password must be at least 6 characters.');
      return;
    }
    if (next !== confirm) {
      toast.error('New password and confirmation do not match.');
      return;
    }
    if (next === current) {
      toast.error('Choose a different password than your current one.');
      return;
    }

    setPwdLoading(true);
    let timedOut = false;
    const timeoutId = setTimeout(() => {
      timedOut = true;
      setPwdLoading(false);
      toast.error(
        'Password change is taking too long — often the embedded browser in Cursor blocks auth. Open the app in Chrome or Edge and try again (your password may already have changed).',
        { duration: 8000 }
      );
    }, PASSWORD_CHANGE_FLOW_MS);

    try {
      const { error: signErr } = await supabase.auth.signInWithPassword({
        email,
        password: current,
      });
      if (timedOut) return;
      if (signErr) {
        toast.error(formatAuthErrorMessage(signErr) || 'Current password is incorrect.');
        return;
      }

      const { error: updErr } = await supabase.auth.updateUser({ password: next });
      if (timedOut) return;
      if (updErr) throw updErr;

      clearTimeout(timeoutId);
      void supabase.functions.invoke('notify-password-changed', { body: {} }).then(({ error: notifyErr }) => {
        if (notifyErr) console.warn('Password change notification email:', notifyErr.message);
      });

      setPasswordForm({ current: '', next: '', confirm: '' });
      if (!timedOut) toast.success('Password updated.');
    } catch (err) {
      if (timedOut) return;
      console.error(err);
      toast.error(formatAuthErrorMessage(err));
    } finally {
      clearTimeout(timeoutId);
      if (!timedOut) setPwdLoading(false);
    }
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

  const handleDeleteMyAccount = async () => {
    const email = user?.email?.trim();
    if (!email) {
      toast.error('No email on this account.');
      return;
    }
    if (!deleteAccountAck) {
      toast.error('Confirm that you understand your account will be permanently deleted.');
      return;
    }
    if (!deletePassword) {
      toast.error('Enter your current password to confirm deletion.');
      return;
    }

    setDeleteBusy(true);
    try {
      const { error: signErr } = await supabase.auth.signInWithPassword({
        email,
        password: deletePassword,
      });
      if (signErr) {
        toast.error(formatAuthErrorMessage(signErr) || 'Password is incorrect.');
        return;
      }

      const { data, error } = await supabase.functions.invoke('delete-my-account', {
        body: { confirm: true },
      });

      if (error) {
        let msg = error.message || 'Request failed';
        try {
          const ctx = error.context;
          if (ctx && typeof ctx.json === 'function') {
            const bodyJson = await ctx.json();
            if (bodyJson?.error) msg = String(bodyJson.error);
          }
        } catch {
          /* keep msg */
        }
        throw new Error(msg);
      }
      if (data && typeof data === 'object' && 'error' in data && data.error) {
        throw new Error(String(data.error));
      }

      setDeletePassword('');
      setDeleteAccountAck(false);
      toast.success('Your account has been deleted.');
      await signOut();
      navigate('/login', { replace: true });
    } catch (err) {
      console.error('delete-my-account:', err);
      toast.error(err.message || 'Could not delete account. Deploy the delete-my-account Edge Function if this persists.');
    } finally {
      setDeleteBusy(false);
    }
  };

  const handleSaveProfile = async () => {
    const digits = String(form.phone || '').replace(/\D/g, '');
    if (digits.length < 10) {
      toast.error('Enter a valid phone number (at least 10 digits).');
      return;
    }
    const phoneTrimmed = form.phone.trim();
    setLoading(true);
    try {
      const { error } = await supabase
        .from('users')
        .update({
          full_name: form.fullName,
          address: form.address,
          phone: phoneTrimmed,
        })
        .eq('id', user.id);

      const missingPhoneColumn =
        error?.code === 'PGRST204' &&
        typeof error?.message === 'string' &&
        error.message.toLowerCase().includes('phone');

      if (missingPhoneColumn) {
        const { error: rowErr } = await supabase
          .from('users')
          .update({
            full_name: form.fullName,
            address: form.address,
          })
          .eq('id', user.id);
        if (rowErr) throw rowErr;

        const { error: metaErr } = await supabase.auth.updateUser({
          data: {
            phone: phoneTrimmed,
            full_name: form.fullName.trim(),
            address: form.address.trim(),
          },
        });
        if (metaErr) throw metaErr;

        await refreshUser();
        toast.success(
          'Profile updated. Phone is saved on your account; add column users.phone in Supabase (migration 20260328250000) to store it on the member row.'
        );
        return;
      }

      if (error) throw error;

      const { error: metaErr } = await supabase.auth.updateUser({
        data: {
          phone: phoneTrimmed,
          full_name: form.fullName.trim(),
          address: form.address.trim(),
        },
      });
      if (metaErr) console.warn('Profile: auth metadata sync', metaErr);

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
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <h1 className="text-2xl font-bold dark:text-white">Your Profile</h1>
          <div className="flex items-center gap-2 shrink-0">
            <ThemeToggle variant="toolbar" />
            <button type="button" onClick={() => navigate(-1)} className="text-gray-600 dark:text-gray-400 hover:underline text-sm font-medium">
              Back
            </button>
          </div>
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
            <label className="block text-sm font-medium mb-1 dark:text-gray-300">Email</label>
            <div className="flex items-center border dark:border-gray-600 rounded px-3 py-2 bg-gray-50 dark:bg-gray-900/50">
              <FaEnvelope className="text-gray-400 mr-2 shrink-0" />
              <span className="text-sm text-gray-700 dark:text-gray-300 break-all">{user?.email || '—'}</span>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">This is the email you use to sign in.</p>
          </div>

          <div className="border-t dark:border-gray-700 pt-4 mt-2">
            <h2 className="text-lg font-semibold mb-3 flex items-center dark:text-white">
              <FaLock className="mr-2" /> Change password
            </h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
              For accounts that sign in with email and password. You will be asked for your current password first.
            </p>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium mb-1 dark:text-gray-300">Current password</label>
                <input
                  type="password"
                  name="current"
                  value={passwordForm.current}
                  onChange={handlePasswordFieldChange}
                  autoComplete="current-password"
                  className="w-full border dark:border-gray-600 rounded px-3 py-2 dark:bg-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1 dark:text-gray-300">New password</label>
                <input
                  type="password"
                  name="next"
                  value={passwordForm.next}
                  onChange={handlePasswordFieldChange}
                  autoComplete="new-password"
                  className="w-full border dark:border-gray-600 rounded px-3 py-2 dark:bg-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1 dark:text-gray-300">Confirm new password</label>
                <input
                  type="password"
                  name="confirm"
                  value={passwordForm.confirm}
                  onChange={handlePasswordFieldChange}
                  autoComplete="new-password"
                  className="w-full border dark:border-gray-600 rounded px-3 py-2 dark:bg-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <button
                type="button"
                onClick={handleChangePassword}
                disabled={pwdLoading}
                className="bg-gray-800 dark:bg-gray-700 text-white px-4 py-2 rounded hover:bg-gray-900 dark:hover:bg-gray-600 transition disabled:opacity-50 text-sm"
              >
                {pwdLoading ? 'Updating…' : 'Update password'}
              </button>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1 dark:text-gray-300">Phone number</label>
            <div className="flex items-center border dark:border-gray-600 rounded px-3 py-2">
              <FaPhone className="text-gray-400 mr-2 shrink-0" />
              <input
                type="tel"
                name="phone"
                value={form.phone}
                onChange={handleChange}
                autoComplete="tel"
                placeholder="e.g. 082 123 4567"
                className="w-full focus:outline-none dark:bg-gray-800 dark:text-white"
                required
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

          <div className="rounded-xl border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-900/40 p-4">
            <div className="flex items-start gap-3">
              {reduceMobileData ? (
                <TbWifi className="text-teal-600 dark:text-teal-400 mt-0.5 shrink-0" aria-hidden />
              ) : (
                <TbWifiOff className="text-gray-600 dark:text-gray-400 mt-0.5 shrink-0" aria-hidden />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-medium dark:text-white">Use less mobile data</span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={reduceMobileData}
                    onClick={() => {
                      const next = !reduceMobileData;
                      setReduceMobileData(next);
                      setUserReduceMobileData(next);
                    }}
                    className={`relative inline-flex h-6 w-11 shrink-0 rounded-full transition-colors ${
                      reduceMobileData ? 'bg-teal-600' : 'bg-gray-300 dark:bg-gray-600'
                    }`}
                  >
                    <span
                      className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition translate-y-0.5 ${
                        reduceMobileData ? 'translate-x-5' : 'translate-x-0.5'
                      }`}
                    />
                  </button>
                </div>
                <p className="text-xs text-gray-600 dark:text-gray-400 mt-2 leading-relaxed">
                  When on, slows automatic background refreshes only. Emergency chat, sends, and live map
                  uploads are unchanged.
                </p>
              </div>
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
            className="mt-2 bg-teal-600 text-white px-4 py-2 rounded hover:bg-teal-700 text-sm"
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

        <div className="mt-10 pt-6 border-t border-red-200 dark:border-red-900/50 rounded-lg border border-red-100 dark:border-red-900/40 bg-red-50/80 dark:bg-red-950/20 p-4 space-y-3">
          <h2 className="text-lg font-semibold text-red-800 dark:text-red-300 flex items-center gap-2">
            <FaExclamationTriangle className="shrink-0" aria-hidden />
            Delete account
          </h2>
          <p className="text-sm text-red-900/90 dark:text-red-200/90 leading-relaxed">
            Permanently delete your login, profile, patrol sign-ups, vehicles on file, chat messages you
            sent, and criminal-intelligence profiles you created. Incident reports you submitted may
            stay in the system with the submitter field cleared where the database allows. This cannot be
            undone.
          </p>
          {authIdentities === null ? (
            <p className="text-sm text-gray-600 dark:text-gray-400">Checking account type…</p>
          ) : canDeleteWithPassword ? (
            <>
              <label className="flex items-start gap-2 text-sm text-red-900 dark:text-red-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={deleteAccountAck}
                  onChange={(e) => setDeleteAccountAck(e.target.checked)}
                  className="mt-1 w-4 h-4 shrink-0"
                />
                <span>I understand my account and the data above will be permanently deleted.</span>
              </label>
              <div>
                <label className="block text-sm font-medium mb-1 text-red-900 dark:text-red-200">
                  Current password
                </label>
                <input
                  type="password"
                  value={deletePassword}
                  onChange={(e) => setDeletePassword(e.target.value)}
                  autoComplete="current-password"
                  className="w-full border border-red-200 dark:border-red-800 rounded px-3 py-2 dark:bg-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-500"
                  placeholder="Required to confirm it’s you"
                />
              </div>
              <button
                type="button"
                onClick={() => void handleDeleteMyAccount()}
                disabled={deleteBusy || !deleteAccountAck || !deletePassword}
                className="bg-red-700 text-white px-4 py-2 rounded hover:bg-red-800 transition disabled:opacity-50 text-sm font-medium"
              >
                {deleteBusy ? 'Deleting…' : 'Delete my account permanently'}
              </button>
            </>
          ) : (
            <div className="text-sm text-red-900 dark:text-red-200 space-y-2">
              <p>
                This account signs in with a provider that does not use a password. To delete your data,
                send a request from your registered email
                {privacyContactEmail ? (
                  <>
                    {' '}
                    to{' '}
                    <a
                      href={`mailto:${privacyContactEmail}?subject=${encodeURIComponent('Account deletion request')}&body=${encodeURIComponent(`Please delete my Neighbourhood Watch account.\n\nRegistered email: ${user?.email || ''}\nUser ID: ${user?.id || ''}\n`)}`}
                      className="font-medium underline underline-offset-2"
                    >
                      {privacyContactEmail}
                    </a>
                  </>
                ) : (
                  <>
                    {' '}
                    (set <code className="text-xs bg-red-100 dark:bg-red-900/50 px-1 rounded">VITE_PRIVACY_CONTACT_EMAIL</code>{' '}
                    in your app environment for a mailto link).
                  </>
                )}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}