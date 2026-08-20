import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import HotspotPinPicker from './HotspotPinPicker';
import { insertCameraSpot, updateCameraSpot } from '../../utils/hotspotService';
import { compassLabel } from '../../utils/cameraSuggestions';

const COMPASS = [
  { label: 'N', deg: 0 },
  { label: 'NE', deg: 45 },
  { label: 'E', deg: 90 },
  { label: 'SE', deg: 135 },
  { label: 'S', deg: 180 },
  { label: 'SW', deg: 225 },
  { label: 'W', deg: 270 },
  { label: 'NW', deg: 315 },
];

export default function CameraSpotForm({ userId, initial, onClose, onSaved }) {
  const [name, setName] = useState(initial?.name || '');
  const [address, setAddress] = useState(initial?.address || '');
  const [bearing, setBearing] = useState(
    Number.isFinite(initial?.facing_bearing) ? String(Math.round(initial.facing_bearing)) : ''
  );
  const [rangeM, setRangeM] = useState(String(initial?.range_meters ?? 50));
  const [notes, setNotes] = useState(initial?.notes || '');
  const [pin, setPin] = useState(
    initial?.latitude != null ? { lat: initial.latitude, lng: initial.longitude } : null
  );
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!initial) return;
    setName(initial.name || '');
    setAddress(initial.address || '');
    setBearing(Number.isFinite(initial.facing_bearing) ? String(Math.round(initial.facing_bearing)) : '');
    setRangeM(String(initial.range_meters ?? 50));
    setNotes(initial.notes || '');
    if (initial.latitude != null) setPin({ lat: initial.latitude, lng: initial.longitude });
  }, [initial]);

  const handlePick = ({ lat, lng, label }) => {
    setPin({ lat, lng });
    if (label && !address.trim()) setAddress(label);
  };

  const submit = async (e) => {
    e.preventDefault();
    if (saving) return;
    if (!name.trim()) {
      toast.error('Name this camera (e.g. Lot 12 garage).');
      return;
    }
    if (!pin) {
      toast.error('Pin the camera on the map.');
      return;
    }
    const range = Number(rangeM);
    if (!Number.isFinite(range) || range < 10 || range > 300) {
      toast.error('Range must be between 10 and 300 metres.');
      return;
    }
    let facing = null;
    if (bearing.trim()) {
      facing = Number(bearing);
      if (!Number.isFinite(facing) || facing < 0 || facing >= 360) {
        toast.error('Facing must be 0–359 degrees, or leave blank.');
        return;
      }
    }
    setSaving(true);
    try {
      const row = {
        name: name.trim(),
        address: address.trim() || null,
        latitude: pin.lat,
        longitude: pin.lng,
        facing_bearing: facing,
        range_meters: Math.round(range),
        notes: notes.trim() || null,
      };
      if (initial?.id) {
        await updateCameraSpot(initial.id, row);
        toast.success('Camera updated.');
      } else {
        await insertCameraSpot({ ...row, created_by: userId });
        toast.success('Camera spot added.');
      }
      onSaved?.();
      onClose?.();
    } catch (err) {
      toast.error(err.message || 'Could not save camera.');
    } finally {
      setSaving(false);
    }
  };

  const bearingNum = Number(bearing);

  return (
    <form onSubmit={submit} className="space-y-3">
      <label className="block text-sm">
        <span className="text-gray-600 dark:text-gray-400">Name</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Lot 12 garage"
          className="mt-1 w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm"
          required
        />
      </label>
      <label className="block text-sm">
        <span className="text-gray-600 dark:text-gray-400">Address (optional)</span>
        <input
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          className="mt-1 w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm"
        />
      </label>

      <HotspotPinPicker pin={pin} onPick={handlePick} />

      <div>
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-1">Facing (optional)</p>
        <div className="flex flex-wrap gap-1 mb-2">
          {COMPASS.map((c) => (
            <button
              key={c.label}
              type="button"
              onClick={() => setBearing(String(c.deg))}
              className={`px-2 py-1 text-xs rounded-md border ${
                Number(bearing) === c.deg
                  ? 'bg-teal-600 text-white border-teal-600'
                  : 'border-gray-300 dark:border-gray-600'
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
        <input
          type="number"
          min={0}
          max={359}
          step={1}
          value={bearing}
          onChange={(e) => setBearing(e.target.value)}
          placeholder="Degrees 0–359"
          className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm"
        />
        {Number.isFinite(bearingNum) && (
          <p className="text-xs text-gray-500 mt-1">Points {compassLabel(bearingNum)}</p>
        )}
      </div>

      <label className="block text-sm">
        <span className="text-gray-600 dark:text-gray-400">Typical range (metres)</span>
        <input
          type="number"
          min={10}
          max={300}
          value={rangeM}
          onChange={(e) => setRangeM(e.target.value)}
          className="mt-1 w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm"
        />
      </label>

      <label className="block text-sm">
        <span className="text-gray-600 dark:text-gray-400">Notes (optional)</span>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          placeholder="e.g. garage, points at Kragga Kamma"
          className="mt-1 w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm"
        />
      </label>

      <div className="flex justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onClose}
          className="px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={saving}
          className="px-3 py-2 text-sm rounded-lg bg-teal-600 text-white font-medium hover:bg-teal-700 disabled:opacity-50"
        >
          {saving ? 'Saving…' : initial?.id ? 'Save camera' : 'Add camera'}
        </button>
      </div>
    </form>
  );
}
