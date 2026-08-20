import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import HotspotPinPicker from './HotspotPinPicker';
import { HOTSPOT_KINDS } from '../../utils/hotspotKinds';
import { insertHotspotEvent, updateHotspotEvent } from '../../utils/hotspotService';
import {
  combineWatchDateTime,
  watchDateInputValue,
  watchDayStamp,
  watchTimeInputValue,
} from '../../utils/watchTime';

export default function HotspotEventForm({ userId, initial, onClose, onSaved }) {
  const [kind, setKind] = useState(initial?.kind || 'break_in');
  const [address, setAddress] = useState(initial?.address || '');
  const [date, setDate] = useState(
    watchDateInputValue(initial?.occurred_at) || watchDayStamp()
  );
  const [time, setTime] = useState(
    initial?.time_known === false ? '' : watchTimeInputValue(initial?.occurred_at)
  );
  const [timeKnown, setTimeKnown] = useState(initial ? Boolean(initial.time_known) : true);
  const [notes, setNotes] = useState(initial?.notes || '');
  const [pin, setPin] = useState(
    initial?.latitude != null
      ? { lat: initial.latitude, lng: initial.longitude }
      : null
  );
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!initial) return;
    setKind(initial.kind || 'break_in');
    setAddress(initial.address || '');
    setDate(watchDateInputValue(initial.occurred_at) || watchDayStamp());
    setTime(initial.time_known === false ? '' : watchTimeInputValue(initial.occurred_at));
    setTimeKnown(Boolean(initial.time_known));
    setNotes(initial.notes || '');
    if (initial.latitude != null) setPin({ lat: initial.latitude, lng: initial.longitude });
  }, [initial]);

  const handlePick = ({ lat, lng, label, source }) => {
    setPin({ lat, lng });
    if (!label) return;
    setAddress((prev) => {
      if (!prev.trim() || source === 'search') return label;
      return prev;
    });
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!pin) {
      toast.error('Tap the map or search an address to drop a pin.');
      return;
    }
    if (!address.trim()) {
      toast.error('Enter the address.');
      return;
    }
    if (!date) {
      toast.error('Enter the date.');
      return;
    }
    if (timeKnown && !time) {
      toast.error('Enter the time, or uncheck “Time is known”.');
      return;
    }
    if (saving) return;
    setSaving(true);
    try {
      const occurredAt = combineWatchDateTime(date, timeKnown && time ? time : '12:00');
      if (!occurredAt) {
        toast.error('Invalid date or time.');
        return;
      }
      const row = {
        kind,
        address: address.trim(),
        latitude: pin.lat,
        longitude: pin.lng,
        occurred_at: occurredAt,
        time_known: timeKnown,
        notes: notes.trim() || null,
      };
      if (initial?.id) {
        const saved = await updateHotspotEvent(initial.id, row);
        toast.success('Pin updated.');
        onSaved?.(saved || { ...initial, ...row, id: initial.id });
      } else {
        const created = await insertHotspotEvent({ ...row, created_by: userId });
        toast.success('Pin added.');
        onSaved?.(created);
      }
      onClose?.();
    } catch (err) {
      toast.error(err.message || 'Could not save hotspot.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Break-in</p>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          House, shop, office, or other premises — including theft from a business after entry.
        </p>
        <div className="grid grid-cols-2 gap-2">
          {HOTSPOT_KINDS.filter((k) => k.group === 'break_in').map((opt) => (
            <label
              key={opt.id}
              className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm cursor-pointer ${
                kind === opt.id
                  ? 'border-red-400 bg-red-50 dark:border-red-700 dark:bg-red-950/30'
                  : 'border-gray-200 dark:border-gray-600'
              }`}
            >
              <input
                type="radio"
                name="kind"
                checked={kind === opt.id}
                onChange={() => setKind(opt.id)}
              />
              <span className="text-gray-800 dark:text-gray-100">{opt.id === 'break_in' ? 'Confirmed' : 'Attempted'}</span>
            </label>
          ))}
        </div>
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 pt-1">Cable / infrastructure</p>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Copper, street, telecom, or municipal cables — even if it happened next to a business.
        </p>
        <div className="grid grid-cols-2 gap-2">
          {HOTSPOT_KINDS.filter((k) => k.group === 'cable').map((opt) => (
            <label
              key={opt.id}
              className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm cursor-pointer ${
                kind === opt.id
                  ? 'border-orange-400 bg-orange-50 dark:border-orange-700 dark:bg-orange-950/30'
                  : 'border-gray-200 dark:border-gray-600'
              }`}
            >
              <input
                type="radio"
                name="kind"
                checked={kind === opt.id}
                onChange={() => setKind(opt.id)}
              />
              <span className="text-gray-800 dark:text-gray-100">
                {opt.id === 'cable_theft' ? 'Confirmed theft' : 'Attempted theft'}
              </span>
            </label>
          ))}
        </div>
      </div>

      <label className="block text-sm">
        <span className="text-gray-600 dark:text-gray-400">Address</span>
        <input
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="e.g. Lot 158 Kragga Kamma Road"
          className="mt-1 w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm"
          required
        />
      </label>

      <HotspotPinPicker pin={pin} onPick={handlePick} />
      <p className="text-xs text-gray-500">Search or tap the map to place the pin.</p>

      <div className="grid grid-cols-2 gap-2">
        <label className="block text-sm">
          <span className="text-gray-600 dark:text-gray-400">Date</span>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="mt-1 w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm"
            required
          />
        </label>
        <label className="block text-sm">
          <span className="text-gray-600 dark:text-gray-400">Time</span>
          <input
            type="time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            disabled={!timeKnown}
            className="mt-1 w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm disabled:opacity-50"
          />
        </label>
      </div>
      <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
        <input
          type="checkbox"
          checked={timeKnown}
          onChange={(e) => {
            setTimeKnown(e.target.checked);
            if (!e.target.checked) setTime('');
          }}
        />
        Time is known
      </label>

      <label className="block text-sm">
        <span className="text-gray-600 dark:text-gray-400">Notes (optional)</span>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
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
          className="px-3 py-2 text-sm rounded-lg bg-red-600 text-white font-medium hover:bg-red-700 disabled:opacity-50"
        >
          {saving ? 'Saving…' : initial?.id ? 'Save changes' : 'Add pin'}
        </button>
      </div>
    </form>
  );
}
