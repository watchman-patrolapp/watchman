import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/useAuth';
import { canUseHouseholdMode, isHouseholdModeRole, isResidentAppRole } from '../auth/roleMatrix';
import { supabase } from '../supabase/client';
import toast from 'react-hot-toast';
import { FaUser, FaMapMarkerAlt, FaCar, FaSave, FaEnvelope, FaPhone, FaLock, FaExclamationTriangle, FaCheck, FaShieldAlt } from 'react-icons/fa';
import ThemeToggle from '../components/ThemeToggle';
import AppNotificationBell from '../components/layout/AppNotificationBell';
import { TbWifi, TbWifiOff } from 'react-icons/tb';
import { getUserReduceMobileData, setUserReduceMobileData } from '../utils/dataSaverProfile';
import { formatAuthErrorMessage } from '../utils/authErrorMessage';
import ReactCrop, { centerCrop, makeAspectCrop } from 'react-image-crop';
import 'react-image-crop/dist/ReactCrop.css';
import SecurityMembershipCard from '../components/security/SecurityMembershipCard';
import { formatVerifiedBy, getResidentVerificationLog, requestPatrollerRole, withdrawPatrollerRoleRequest } from '../utils/residentVerification';
import { getMyHouseholdCivic, pingResidentPresence } from '../utils/householdCivic';
import ResidentAwayForm from '../components/resident/ResidentAwayForm';
import HouseholdCivicRow from '../components/resident/HouseholdCivicRow';
import { isRpcNotFoundError } from '../utils/isRpcNotFound';
import { loadPublicSignupOptions, securityCompanyOptionLabel } from '../utils/signupOptions';
import { fetchResidentSecurityMemberships } from '../utils/residentSecurityMemberships';
import {
  claimSecurityCompany,
  isActiveMembership,
  listSecurityMembershipEvents,
  membershipRpcMessage,
  transferSecurityMembership,
  withdrawSecurityMembership,
} from '../utils/securityMembershipActions';
import HomePinPicker from '../components/profile/HomePinPicker';
import EmergencyContactSection from '../components/profile/EmergencyContactSection';
import { hasHomePin, setMyHomePin } from '../utils/homePin';
import { ensureMyHouseholdProfile } from '../utils/householdProfile';
import { HOUSEHOLD_MODE_INTRO, markHouseholdIntroSeen } from '../utils/householdModeIntro';
import { useScopedOrganization } from '../utils/organizationScope';
import { resolveAreaCoords } from '../utils/areaWeather';
import { displayWatchAreaName } from '../config/neighborhoodRegions';

/**
 * Soft cap before we warn the user (not an abort). Embedded IDE browsers often take 30–60s+ for
 * Supabase signIn + updateUser without being broken — 28s was too aggressive.
 */
const PASSWORD_CHANGE_FLOW_MS = 90_000;

export default function Profile() {
  const navigate = useNavigate();
  const { user, refreshUser, signOut } = useAuth();
  const { activeOrganizationId, activeOrganization } = useScopedOrganization();
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
  const [securityCompanyOptions, setSecurityCompanyOptions] = useState([]);
  const [securityMembershipForm, setSecurityMembershipForm] = useState({
    security_company_id: '',
    member_reference: '',
  });
  const [securityMembershipRow, setSecurityMembershipRow] = useState(null);
  const [membershipEvents, setMembershipEvents] = useState([]);
  const [transferForm, setTransferForm] = useState({
    security_company_id: '',
    member_reference: '',
    notes: '',
  });
  const [membershipBusy, setMembershipBusy] = useState(false);
  const [verificationLog, setVerificationLog] = useState([]);
  const [verificationPending, setVerificationPending] = useState(false);
  const [patrollerRequestStatus, setPatrollerRequestStatus] = useState(null);
  const [patrollerRequestBusy, setPatrollerRequestBusy] = useState(false);
  const [civic, setCivic] = useState(null);
  const [homePin, setHomePin] = useState(null);
  const [pinBusy, setPinBusy] = useState(false);
  const [areaCenter, setAreaCenter] = useState(null);

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
      setHomePin(
        hasHomePin(user)
          ? { lat: Number(user.homeLat), lng: Number(user.homeLng) }
          : null
      );
    }
  }, [user]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const scrollToPin = () => {
      document.getElementById('home-pin')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    if (window.location.hash === '#home-pin') {
      const t = window.setTimeout(scrollToPin, 80);
      return () => window.clearTimeout(t);
    }
    return undefined;
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const coords = await resolveAreaCoords(
        activeOrganizationId || user?.organizationId,
        activeOrganization?.name
      );
      if (!cancelled) setAreaCenter(coords);
    })();
    return () => {
      cancelled = true;
    };
  }, [activeOrganizationId, activeOrganization?.name, user?.organizationId]);

  useEffect(() => {
    if (!user?.id || !canUseHouseholdMode(user?.role)) return;
    let cancelled = false;
    void (async () => {
      if (isHouseholdModeRole(user?.role)) {
        await ensureMyHouseholdProfile();
        markHouseholdIntroSeen(user.id);
      }
      const { data, error } = await getResidentVerificationLog(user.id);
      if (cancelled) return;
      if (error && !isRpcNotFoundError(error)) {
        console.warn('verification log:', error.message);
      }
      setVerificationLog(data || []);
      setVerificationPending(!user.isVerifiedResident && isResidentAppRole(user?.role));
      await pingResidentPresence();
      const civicRow = await getMyHouseholdCivic();
      if (!cancelled) setCivic(civicRow);
      if (isResidentAppRole(user?.role)) {
        const { data: requestRow, error: requestErr } = await supabase
          .from('resident_profiles')
          .select('patroller_request_status')
          .eq('user_id', user.id)
          .maybeSingle();
        if (!cancelled) {
          if (requestErr && !isRpcNotFoundError(requestErr) && !/patroller_request/i.test(requestErr.message || '')) {
            console.warn('patroller request status:', requestErr.message);
          }
          setPatrollerRequestStatus(requestRow?.patroller_request_status || null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id, user?.role, user?.isVerifiedResident]);

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    void (async () => {
      try {
        const [{ securityCompanies }, membershipResult, eventsResult] = await Promise.all([
          loadPublicSignupOptions(),
          fetchResidentSecurityMemberships({ residentUserId: user.id, limit: 20 }),
          listSecurityMembershipEvents(true),
        ]);

        if (cancelled) return;
        const memberships = membershipResult.data || [];
        const membership = memberships.find(isActiveMembership) || memberships[0] || null;
        if (membershipResult.error) console.warn('Profile membership load:', membershipResult.error);
        setSecurityCompanyOptions(securityCompanies);
        setSecurityMembershipRow(membership);
        setMembershipEvents(eventsResult.error ? [] : eventsResult.data || []);
        if (membership && isActiveMembership(membership)) {
          setSecurityMembershipForm({
            security_company_id: membership.security_company_id || '',
            member_reference: membership.member_reference || '',
          });
        }
      } catch (err) {
        console.warn('Profile membership load:', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

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

  const saveHomePin = async (next) => {
    setHomePin(next);
    setPinBusy(true);
    try {
      const { error } = await setMyHomePin(next);
      if (error) throw error;
      await refreshUser();
      toast.success(next ? 'Home pin saved.' : 'Home pin cleared.');
    } catch (err) {
      toast.error(err.message || 'Could not save home pin.');
    } finally {
      setPinBusy(false);
    }
  };

  const handlePatrollerRequest = async (withdraw) => {
    setPatrollerRequestBusy(true);
    try {
      const { error } = withdraw
        ? await withdrawPatrollerRoleRequest()
        : await requestPatrollerRole();
      if (error) {
        if (isRpcNotFoundError(error)) {
          toast.error('Apply the patroller-request SQL on Supabase first.');
          return;
        }
        throw error;
      }
      setPatrollerRequestStatus(withdraw ? null : 'pending');
      toast.success(
        withdraw
          ? 'Request cancelled.'
          : 'Request sent. Neighbourhood admin will review it.'
      );
    } catch (err) {
      toast.error(err.message || 'Could not send that request.');
    } finally {
      setPatrollerRequestBusy(false);
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

  const reloadMembership = async () => {
    const [{ data }, eventsResult] = await Promise.all([
      fetchResidentSecurityMemberships({ residentUserId: user.id, limit: 20 }),
      listSecurityMembershipEvents(true),
    ]);
    const memberships = data || [];
    const membership = memberships.find(isActiveMembership) || memberships[0] || null;
    setSecurityMembershipRow(membership);
    setMembershipEvents(eventsResult.error ? [] : eventsResult.data || []);
    return membership;
  };

  const handleSaveSecurityMembership = async () => {
    if (!user?.id) return;
    if (!securityMembershipForm.security_company_id) {
      toast.error('Select your security company first.');
      return;
    }
    setMembershipBusy(true);
    try {
      const { error } = await claimSecurityCompany(
        securityMembershipForm.security_company_id,
        securityMembershipForm.member_reference
      );
      if (error) throw error;
      await reloadMembership();
      toast.success('Security membership saved. Awaiting company verification.');
    } catch (err) {
      console.error(err);
      toast.error(membershipRpcMessage(err));
    } finally {
      setMembershipBusy(false);
    }
  };

  const handleWithdrawMembership = async () => {
    if (!securityMembershipRow?.id) return;
    if (!window.confirm('Withdraw this pending company claim?')) return;
    setMembershipBusy(true);
    try {
      const { error } = await withdrawSecurityMembership(securityMembershipRow.id);
      if (error) throw error;
      const next = await reloadMembership();
      if (!next || !isActiveMembership(next)) {
        setSecurityMembershipForm({ security_company_id: '', member_reference: '' });
      }
      toast.success('Claim withdrawn.');
    } catch (err) {
      toast.error(membershipRpcMessage(err));
    } finally {
      setMembershipBusy(false);
    }
  };

  const handleTransferMembership = async () => {
    if (!transferForm.security_company_id) {
      toast.error('Select the company you are moving to.');
      return;
    }
    if (!window.confirm('Transfer your security membership to the new company? Your current company will be notified in the logs, and the new company must verify you again.')) {
      return;
    }
    setMembershipBusy(true);
    try {
      const { error } = await transferSecurityMembership(
        transferForm.security_company_id,
        transferForm.member_reference,
        transferForm.notes
      );
      if (error) throw error;
      await reloadMembership();
      setTransferForm({ security_company_id: '', member_reference: '', notes: '' });
      toast.success('Transfer submitted. The new company still needs to verify you.');
    } catch (err) {
      toast.error(membershipRpcMessage(err));
    } finally {
      setMembershipBusy(false);
    }
  };

  const areaName = displayWatchAreaName(activeOrganization?.name) || 'your neighbourhood';
  const primaryVehicle = user?.vehicles?.find(v => v.is_primary);

  return (
    <div className="min-h-screen bg-gray-100 dark:bg-gray-900 p-6">
      <div className="max-w-2xl mx-auto bg-white dark:bg-gray-800 p-6 rounded shadow">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <h1 className="text-2xl font-bold dark:text-white">Your Profile</h1>
          <div className="flex items-center gap-2 shrink-0">
            <AppNotificationBell variant="toolbar" />
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

        {isHouseholdModeRole(user?.role) ? (
          <section
            id="household-settings"
            className="mb-6 rounded-xl border border-teal-200 bg-teal-50 p-4 dark:border-teal-900 dark:bg-teal-950/40"
          >
            <h2 className="text-lg font-semibold text-teal-950 dark:text-teal-100">
              {HOUSEHOLD_MODE_INTRO.title}
            </h2>
            <p className="mt-1 text-sm leading-relaxed text-teal-900/85 dark:text-teal-200/90">
              {HOUSEHOLD_MODE_INTRO.body}
            </p>
            <p className="mt-2 text-xs text-teal-800 dark:text-teal-300">
              Email is your login and stays unchanged here. Update phone only if it changed. Home pin
              and security company are the household fields below.
            </p>
          </section>
        ) : null}

        <section
          id="home-pin"
          className="mb-6 scroll-mt-4 rounded-xl border border-teal-200 bg-teal-50 p-4 dark:border-teal-900 dark:bg-teal-950/40"
        >
          <h2 className="flex items-center gap-2 text-lg font-semibold text-teal-950 dark:text-teal-100">
            <FaMapMarkerAlt className="h-4 w-4" aria-hidden />
            Home pin
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-teal-900/85 dark:text-teal-200/90">
            Your address is not detected automatically. The map opens on {areaName}. Set this pin so
            My sector can show the closest households. Search often misses lots or lands in another
            suburb — tap your roof, or use the location button while you are at home.
          </p>
          <div className="mt-3">
            <HomePinPicker
              pin={homePin}
              areaCenter={areaCenter}
              onPick={(next) => void saveHomePin(next)}
            />
          </div>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-teal-800 dark:text-teal-300">
              {homePin
                ? pinBusy
                  ? 'Saving pin…'
                  : 'Pin saved. Move it if this is the wrong roof.'
                : 'No pin yet — My sector cannot rank nearby homes without it.'}
            </p>
            {homePin ? (
              <button
                type="button"
                onClick={() => void saveHomePin(null)}
                className="text-xs font-medium text-teal-800 underline dark:text-teal-200"
              >
                Clear pin
              </button>
            ) : null}
          </div>
        </section>

        {canUseHouseholdMode(user?.role) && civic ? (
          <div className="mb-6 rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
            <p className="mb-2 text-sm font-semibold text-gray-900 dark:text-white">Your household</p>
            <p className="mb-3 text-xs text-gray-500 dark:text-gray-400">
              Only you see this. Neighbours cannot.
            </p>
            <HouseholdCivicRow civic={civic} />
          </div>
        ) : null}

        {isResidentAppRole(user?.role) ? (
          <div
            className={`mb-6 rounded-xl border p-4 ${
              user?.isVerifiedResident
                ? 'border-emerald-200 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/30'
                : 'border-amber-300 bg-amber-50 dark:border-amber-500/40 dark:bg-amber-950/30'
            }`}
          >
            <p className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
              {user?.isVerifiedResident ? (
                <FaCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-300" aria-hidden />
              ) : (
                <FaExclamationTriangle className="h-4 w-4 text-amber-600" aria-hidden />
              )}
              Household verification
            </p>
            {user?.isVerifiedResident ? (
              <p className="mt-1 text-sm text-emerald-900 dark:text-emerald-100">
                {formatVerifiedBy(verificationLog)}
              </p>
            ) : (
              <p className="mt-1 text-sm font-medium text-amber-950 dark:text-amber-100">
                Not verified yet
                {verificationPending && verificationLog.length
                  ? ` · ${verificationLog.filter((row) => row.kind === 'vouch').length}/2 neighbour vouches`
                  : ''}
              </p>
            )}
            {verificationLog.length > 0 ? (
              <ul className="mt-2 space-y-1 text-xs text-gray-600 dark:text-gray-300">
                {verificationLog.map((row, index) => (
                  <li key={`${row.kind}-${row.actor_name}-${index}`}>
                    {row.kind === 'staff'
                      ? `${row.actor_name} · ${row.actor_role?.replace(/_/g, ' ') || 'staff'}`
                      : `Vouch from ${row.actor_name}`}
                    {row.created_at
                      ? ` · ${new Date(row.created_at).toLocaleDateString()}`
                      : ''}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}

        {isResidentAppRole(user?.role) ? (
          <div className="mb-6 rounded-xl border border-cyan-200 bg-cyan-50 p-4 dark:border-cyan-900 dark:bg-cyan-950/30">
            <p className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
              <FaShieldAlt className="h-4 w-4 text-cyan-700 dark:text-cyan-300" aria-hidden />
              Become a patroller
            </p>
            <p className="mt-1 text-sm text-cyan-950/80 dark:text-cyan-100/90">
              Ask your neighbourhood watch to promote this household account to patroller. You keep
              the same login. Main admin, technical support, or NW admin will approve or decline.
            </p>
            {patrollerRequestStatus === 'pending' ? (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <p className="text-sm font-medium text-amber-900 dark:text-amber-100">
                  Request sent — waiting for review.
                </p>
                <button
                  type="button"
                  onClick={() => void handlePatrollerRequest(true)}
                  disabled={patrollerRequestBusy}
                  className="rounded-lg bg-white px-3 py-1.5 text-xs font-medium text-gray-700 ring-1 ring-gray-300 hover:bg-gray-50 disabled:opacity-50 dark:bg-gray-800 dark:text-gray-200 dark:ring-gray-600"
                >
                  {patrollerRequestBusy ? 'Cancelling…' : 'Cancel request'}
                </button>
              </div>
            ) : patrollerRequestStatus === 'rejected' ? (
              <div className="mt-3 space-y-2">
                <p className="text-sm font-medium text-rose-900 dark:text-rose-100">
                  Your last request was declined. You can ask again.
                </p>
                <button
                  type="button"
                  onClick={() => void handlePatrollerRequest(false)}
                  disabled={patrollerRequestBusy || !user?.isVerifiedResident}
                  className="rounded-lg bg-cyan-700 px-3 py-2 text-sm font-medium text-white hover:bg-cyan-800 disabled:opacity-50"
                >
                  {patrollerRequestBusy ? 'Sending…' : 'Request again'}
                </button>
              </div>
            ) : (
              <div className="mt-3 space-y-2">
                {!user?.isVerifiedResident ? (
                  <p className="text-xs text-amber-900 dark:text-amber-100">
                    Verify your household first, then you can send this request.
                  </p>
                ) : null}
                <button
                  type="button"
                  onClick={() => void handlePatrollerRequest(false)}
                  disabled={patrollerRequestBusy || !user?.isVerifiedResident}
                  className="rounded-lg bg-cyan-700 px-3 py-2 text-sm font-medium text-white hover:bg-cyan-800 disabled:opacity-50"
                >
                  {patrollerRequestBusy ? 'Sending…' : 'Request to become a patroller'}
                </button>
              </div>
            )}
          </div>
        ) : null}

        {canUseHouseholdMode(user?.role) ? <ResidentAwayForm /> : null}

        {/* Crop Modal – fixed for vertical images */}
        {showCropModal && imagePreviewUrl && (
          <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/75 p-4">
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
                placeholder="e.g. Lot 158 Kragga Kamma Road"
              />
            </div>
          </div>

          {canUseHouseholdMode(user?.role) ? (
            <div className="space-y-4">
              <EmergencyContactSection slot={1} user={user} onSaved={() => void refreshUser()} />
              <EmergencyContactSection slot={2} user={user} onSaved={() => void refreshUser()} />
            </div>
          ) : null}

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

        <div className="mt-6 border-t dark:border-gray-700 pt-4 space-y-3">
          <h2 className="text-lg font-semibold dark:text-white">Security-company membership</h2>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Pick one armed-response company. They verify that you are their client. If you chose the wrong
            company, withdraw the pending claim or transfer — do not add a second company.
          </p>

          {securityMembershipRow && isActiveMembership(securityMembershipRow) ? (
            <>
              <SecurityMembershipCard membership={securityMembershipRow} />
              {securityMembershipRow.membership_status === 'self_reported' ? (
                <button
                  type="button"
                  disabled={membershipBusy}
                  onClick={handleWithdrawMembership}
                  className="rounded bg-gray-600 px-4 py-2 text-sm text-white hover:bg-gray-700 disabled:opacity-50"
                >
                  Withdraw this pending claim
                </button>
              ) : null}

              <div className="mt-4 space-y-2 rounded-xl border border-indigo-200 bg-indigo-50/60 p-4 dark:border-indigo-900 dark:bg-indigo-950/30">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Transfer to another company</h3>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  This closes your current company and opens a pending claim at the new one. Transfers are
                  logged so companies can see where clients came from or went.
                </p>
                <select
                  value={transferForm.security_company_id}
                  onChange={(e) =>
                    setTransferForm((prev) => ({ ...prev, security_company_id: e.target.value }))
                  }
                  className="w-full rounded border px-3 py-2 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
                >
                  <option value="">Select new company</option>
                  {securityCompanyOptions
                    .filter((company) => company.id !== securityMembershipRow.security_company_id)
                    .map((company) => (
                      <option key={company.id} value={company.id}>
                        {securityCompanyOptionLabel(company)}
                      </option>
                    ))}
                </select>
                <input
                  type="text"
                  placeholder="New membership reference (optional)"
                  value={transferForm.member_reference}
                  onChange={(e) =>
                    setTransferForm((prev) => ({ ...prev, member_reference: e.target.value }))
                  }
                  className="w-full rounded border px-3 py-2 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
                />
                <input
                  type="text"
                  placeholder="Reason (optional)"
                  value={transferForm.notes}
                  onChange={(e) => setTransferForm((prev) => ({ ...prev, notes: e.target.value }))}
                  className="w-full rounded border px-3 py-2 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
                />
                <button
                  type="button"
                  disabled={membershipBusy}
                  onClick={handleTransferMembership}
                  className="rounded bg-indigo-600 px-4 py-2 text-sm text-white hover:bg-indigo-700 disabled:opacity-50"
                >
                  Transfer membership
                </button>
              </div>
            </>
          ) : (
            <>
              {securityMembershipRow ? <SecurityMembershipCard membership={securityMembershipRow} /> : null}
              <div className="grid gap-3 md:grid-cols-2">
                <select
                  value={securityMembershipForm.security_company_id}
                  onChange={(e) =>
                    setSecurityMembershipForm((prev) => ({ ...prev, security_company_id: e.target.value }))
                  }
                  className="w-full rounded border px-3 py-2 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
                >
                  <option value="">Select security company</option>
                  {securityCompanyOptions.map((company) => (
                    <option key={company.id} value={company.id}>
                      {securityCompanyOptionLabel(company)}
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  placeholder="Membership reference (optional)"
                  value={securityMembershipForm.member_reference}
                  onChange={(e) =>
                    setSecurityMembershipForm((prev) => ({ ...prev, member_reference: e.target.value }))
                  }
                  className="w-full rounded border px-3 py-2 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
                />
              </div>
              <button
                type="button"
                disabled={membershipBusy}
                onClick={handleSaveSecurityMembership}
                className="rounded bg-indigo-600 px-4 py-2 text-sm text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                Save security membership
              </button>
            </>
          )}

          {membershipEvents.length > 0 ? (
            <div className="pt-2">
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">Membership log</p>
              <ul className="space-y-1 text-xs text-gray-500 dark:text-gray-400">
                {membershipEvents.slice(0, 8).map((event) => (
                  <li key={event.id}>
                    {event.created_at ? new Date(event.created_at).toLocaleDateString() : ''} ·{' '}
                    {event.event_type === 'transferred'
                      ? `Transferred ${event.from_company_name || '—'} → ${event.to_company_name || '—'}`
                      : `${event.event_type}${event.to_company_name ? ` · ${event.to_company_name}` : event.from_company_name ? ` · ${event.from_company_name}` : ''}`}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
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