import React, { useEffect, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { FaTimes, FaUserSecret, FaExternalLinkAlt, FaUpload } from 'react-icons/fa';
import { supabase } from '../../supabase/client';
import { useAuth } from '../../auth/useAuth';
import toast from 'react-hot-toast';

const RISK_OPTIONS = [
  { value: 'critical', label: 'Critical' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
];

const PRIORITY_OPTIONS = [
  { value: 'routine', label: 'Routine' },
  { value: 'priority', label: 'Priority' },
  { value: 'urgent', label: 'Urgent' },
  { value: 'immediate', label: 'Immediate' },
];

export default function QuickCreateProfileDrawer({
  open,
  onClose,
  suspectDescription = '',
  onCreated,
}) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [primaryName, setPrimaryName] = useState('');
  const [riskLevel, setRiskLevel] = useState('medium');
  const [priority, setPriority] = useState('routine');
  const [aliases, setAliases] = useState('');
  const [notes, setNotes] = useState('');
  const [photos, setPhotos] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [fileKey, setFileKey] = useState(0);
  const wasOpenRef = useRef(false);

  useEffect(() => {
    if (open && !wasOpenRef.current) {
      setPrimaryName('');
      setRiskLevel('medium');
      setPriority('routine');
      setAliases('');
      setNotes(suspectDescription || '');
      setPhotos((prev) => {
        prev.forEach((p) => {
          if (p.preview) URL.revokeObjectURL(p.preview);
        });
        return [];
      });
      setFileKey((k) => k + 1);
    }
    wasOpenRef.current = open;
  }, [open, suspectDescription]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  const handlePhotoChange = async (e) => {
    const picked = Array.from(e.target.files || []);
    e.target.value = '';
    if (picked.length === 0) return;

    const valid = picked.filter((file) => {
      if (!file.type.startsWith('image/')) {
        toast.error(`${file.name} is not an image`);
        return false;
      }
      if (file.size > 5 * 1024 * 1024) {
        toast.error(`${file.name} is too large (max 5MB)`);
        return false;
      }
      return true;
    });

    for (const file of valid) {
      let addedId = null;
      setPhotos((prev) => {
        if (prev.length >= 3) return prev;
        addedId = `ph_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
        return [
          ...prev,
          { id: addedId, file, preview: URL.createObjectURL(file), url: '', uploading: true },
        ];
      });
      if (!addedId) {
        toast.error('Maximum 3 photos');
        break;
      }

      try {
        const fileExt = file.name.split('.').pop();
        const fileName = `${Date.now()}_${Math.random().toString(36).substring(7)}.${fileExt}`;
        const filePath = `criminal-profiles/${user.id}/${fileName}`;

        const { error: uploadError } = await supabase.storage
          .from('criminal-photos')
          .upload(filePath, file, { cacheControl: '3600', upsert: false });

        if (uploadError) throw uploadError;

        const {
          data: { publicUrl },
        } = supabase.storage.from('criminal-photos').getPublicUrl(filePath);

        setPhotos((prev) =>
          prev.map((p) => (p.id === addedId ? { ...p, url: publicUrl, uploading: false } : p))
        );
      } catch (err) {
        console.error('Upload error:', err);
        toast.error(`Upload failed: ${err.message}`);
        setPhotos((prev) => {
          const victim = prev.find((p) => p.id === addedId);
          if (victim?.preview) URL.revokeObjectURL(victim.preview);
          return prev.filter((p) => p.id !== addedId);
        });
      }
    }
  };

  const removePhoto = (id) => {
    setPhotos((prev) => {
      const p = prev.find((x) => x.id === id);
      if (p?.preview) URL.revokeObjectURL(p.preview);
      return prev.filter((x) => x.id !== id);
    });
  };

  const openFullEditor = () => {
    const params = new URLSearchParams();
    params.set('returnTo', '/incident/new');
    const desc = notes.trim() || suspectDescription;
    if (desc) params.set('description', desc);
    if (primaryName.trim()) params.set('hintName', primaryName.trim());
    onClose();
    navigate(`/intelligence/profiles/new?${params.toString()}`);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!user?.id) {
      toast.error('You must be signed in');
      return;
    }
    if (!primaryName.trim()) {
      toast.error('Primary name is required');
      return;
    }
    if (photos.some((p) => p.uploading)) {
      toast.error('Wait for photos to finish uploading');
      return;
    }

    setSubmitting(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const authUid = sessionData?.session?.user?.id;
      if (!authUid) {
        toast.error('Session expired; sign in again.');
        return;
      }

      const known_aliases = aliases
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const mark = notes.trim();
      const distinguishing_marks = mark ? [mark] : [];
      const photo_urls = photos.map((p) => p.url).filter(Boolean);

      const { data, error } = await supabase
        .from('criminal_profiles')
        .insert({
          primary_name: primaryName.trim(),
          date_of_birth: null,
          place_of_birth: null,
          gender: null,
          nationality: [],
          height_cm: null,
          weight_kg: null,
          build_type: null,
          eye_color: null,
          hair_color: null,
          complexion: null,
          distinguishing_marks,
          risk_level: riskLevel,
          status: 'active',
          priority,
          watchlist_flags: [],
          known_aliases,
          id_numbers: [],
          last_seen_at: null,
          last_seen_location: null,
          last_seen_coordinates: null,
          gang_affiliation: null,
          criminal_organization: null,
          mo_signature: null,
          photo_urls,
          created_by: authUid,
          first_identified_at: new Date().toISOString(),
        })
        .select('id, primary_name, risk_level')
        .single();

      if (error) throw error;

      onCreated?.(data);
      onClose();
    } catch (err) {
      console.error('Quick profile create:', err);
      toast.error(err.message || 'Failed to create profile');
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  const panel = (
    <div className="fixed inset-0 z-[200] flex justify-end" role="dialog" aria-modal="true" aria-labelledby="quick-profile-title">
      <button
        type="button"
        className="absolute inset-0 bg-black/40 backdrop-blur-[1px]"
        aria-label="Close"
        onClick={onClose}
      />
      <div className="relative flex h-full w-full max-w-md flex-col bg-white shadow-2xl dark:bg-gray-900 dark:text-white animate-[slideIn_0.2s_ease-out]">
        <style>{`
          @keyframes slideIn {
            from { transform: translateX(100%); opacity: 0.9; }
            to { transform: translateX(0); opacity: 1; }
          }
        `}</style>

        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-700">
          <div className="flex items-center gap-2">
            <FaUserSecret className="text-indigo-600" />
            <h2 id="quick-profile-title" className="text-lg font-semibold text-gray-900 dark:text-white">
              Quick profile
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
            aria-label="Close"
          >
            <FaTimes className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Create a minimal record now; use <strong>Open full editor</strong> for complete intelligence fields.
            </p>

            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">Primary name *</label>
              <input
                type="text"
                value={primaryName}
                onChange={(e) => setPrimaryName(e.target.value)}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
                placeholder="e.g. Unknown male suspect"
                required
                autoFocus
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">Risk</label>
                <select
                  value={riskLevel}
                  onChange={(e) => setRiskLevel(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
                >
                  {RISK_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">Priority</label>
                <select
                  value={priority}
                  onChange={(e) => setPriority(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
                >
                  {PRIORITY_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">Aliases</label>
              <input
                type="text"
                value={aliases}
                onChange={(e) => setAliases(e.target.value)}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
                placeholder="Comma-separated"
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">Description / marks</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={4}
                className="w-full resize-y rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
                placeholder="Clothing, height, behaviour…"
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">Photos (max 3)</label>
              <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-gray-300 px-3 py-3 text-sm text-gray-600 dark:border-gray-600 dark:text-gray-400">
                <FaUpload />
                <span>Add images</span>
                <input
                  key={fileKey}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={handlePhotoChange}
                  disabled={photos.length >= 3}
                />
              </label>
              {photos.length > 0 && (
                <ul className="mt-2 space-y-2">
                  {photos.map((p) => (
                    <li key={p.id} className="flex items-center gap-2 text-xs">
                      <div className="h-12 w-12 flex-shrink-0 overflow-hidden rounded border border-gray-200 dark:border-gray-600">
                        <img src={p.preview || p.url} alt="" className="h-full w-full object-cover" />
                      </div>
                      <span className="flex-1 truncate text-gray-600 dark:text-gray-400">
                        {p.uploading ? 'Uploading…' : p.file?.name || 'Photo'}
                      </span>
                      <button type="button" onClick={() => removePhoto(p.id)} className="text-red-600">
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <div className="border-t border-gray-200 bg-gray-50 px-4 py-3 dark:border-gray-700 dark:bg-gray-800/80">
            <div className="flex flex-col gap-2">
              <button
                type="submit"
                disabled={submitting}
                className="w-full rounded-lg bg-indigo-600 py-2.5 font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {submitting ? 'Saving…' : 'Create & link to this suspect'}
              </button>
              <button
                type="button"
                onClick={openFullEditor}
                className="flex w-full items-center justify-center gap-2 rounded-lg border border-gray-300 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700"
              >
                <FaExternalLinkAlt className="h-3 w-3" />
                Open full editor
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );

  return createPortal(panel, document.body);
}
