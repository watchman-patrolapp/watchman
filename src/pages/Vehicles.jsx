// src/pages/Vehicles.jsx
import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/useAuth';
import { supabase } from '../supabase/client';
import toast from 'react-hot-toast';
import { FaCar, FaBicycle, FaWalking, FaArrowLeft, FaPlus, FaStar, FaTrash } from 'react-icons/fa';
import VehicleIcon from '../components/VehicleIcon'; // ✅ NEW IMPORT

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VEHICLE_TYPES = [
  { value: 'car',     label: 'Car',     icon: FaCar      },
  { value: 'bicycle', label: 'Bicycle', icon: FaBicycle  },
  { value: 'on_foot', label: 'On Foot', icon: FaWalking  },
];

const COLORS = [
  { value: 'gray',   label: 'Gray'   },
  { value: 'red',    label: 'Red'    },
  { value: 'blue',   label: 'Blue'   },
  { value: 'green',  label: 'Green'  },
  { value: 'black',  label: 'Black'  },
  { value: 'white',  label: 'White'  },
  { value: 'silver', label: 'Silver' },
  { value: 'yellow', label: 'Yellow' },
  { value: 'orange', label: 'Orange' },
];

const EMPTY_FORM = {
  vehicle_type: 'car',
  make_model: '',
  registration: '',
  color: 'gray',
};

// Color mapping (kept for form color picker UI)
const COLOR_HEX = {
  gray:   '#6b7280',
  red:    '#ef4444',
  blue:   '#3b82f6',
  green:  '#22c55e',
  black:  '#1f2937',
  white:  '#cbd5e1',
  silver: '#94a3b8',
  yellow: '#eab308',
  orange: '#f97316',
};

// ---------------------------------------------------------------------------
// DeleteConfirm — inline confirmation, avoids browser confirm()
// ---------------------------------------------------------------------------

function DeleteConfirm({ onConfirm, onCancel, loading }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-gray-500 dark:text-gray-400">Sure?</span>
      <button
        onClick={onConfirm}
        disabled={loading}
        className="px-2 py-1 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-xs rounded-lg transition"
      >
        {loading ? '...' : 'Yes'}
      </button>
      <button
        onClick={onCancel}
        className="px-2 py-1 bg-gray-200 dark:bg-gray-600 hover:bg-gray-300 dark:hover:bg-gray-500 text-gray-700 dark:text-gray-200 text-xs rounded-lg transition"
      >
        No
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function Vehicles() {
  const navigate = useNavigate();
  const { user, refreshUser } = useAuth();

  const [vehicles, setVehicles]       = useState([]);
  const [loading, setLoading]         = useState(true);
  const [showForm, setShowForm]       = useState(false);
  const [form, setForm]               = useState(EMPTY_FORM);
  const [saving, setSaving]           = useState(false);
  const [deletingId, setDeletingId]   = useState(null);
  const [confirmId, setConfirmId]     = useState(null);
  const [settingPrimary, setSettingPrimary] = useState(null);

  // ---------------------------------------------------------------------------
  // Load vehicles
  // ---------------------------------------------------------------------------

  const loadVehicles = useCallback(async () => {
    const { data, error } = await supabase
      .from('user_vehicles')
      .select('*')
      .eq('user_id', user.id)
      .order('is_primary', { ascending: false });

    if (error) {
      toast.error('Failed to load vehicles');
    } else {
      setVehicles(data || []);
    }
    setLoading(false);
  }, [user.id]);

  useEffect(() => {
    loadVehicles();
  }, [loadVehicles]);

  // ---------------------------------------------------------------------------
  // Add vehicle
  // ---------------------------------------------------------------------------

  const handleAdd = async () => {
    let payload = {
      user_id: user.id,
      vehicle_type: form.vehicle_type,
      make_model: form.make_model.trim(),
      registration: form.registration.trim(),
      color: form.color,
      is_primary: vehicles.length === 0,
    };

    if (form.vehicle_type === 'car') {
      if (!payload.make_model || !payload.registration) {
        toast.error('Make/Model and Registration are required for cars');
        return;
      }
    } else if (form.vehicle_type === 'bicycle') {
      if (!payload.make_model) {
        toast.error('Bicycle description is required');
        return;
      }
    } else {
      payload.make_model   = 'On foot';
      payload.registration = '';
      payload.color        = 'gray';
    }

    setSaving(true);
    const { error } = await supabase.from('user_vehicles').insert(payload);
    setSaving(false);

    if (error) {
      toast.error('Failed to add vehicle');
    } else {
      toast.success('Vehicle added');
      setShowForm(false);
      setForm(EMPTY_FORM);
      await loadVehicles();
      refreshUser?.();
    }
  };

  // ---------------------------------------------------------------------------
  // Delete vehicle
  // ---------------------------------------------------------------------------

  const handleDelete = async (id) => {
    setDeletingId(id);
    const { error } = await supabase.from('user_vehicles').delete().eq('id', id);
    setDeletingId(null);
    setConfirmId(null);

    if (error) {
      toast.error('Delete failed');
    } else {
      toast.success('Vehicle removed');
      await loadVehicles();
      refreshUser?.();
    }
  };

  // ---------------------------------------------------------------------------
  // Set primary
  // ---------------------------------------------------------------------------

  const handleSetPrimary = async (id) => {
    setSettingPrimary(id);
    try {
      const { error: clearErr } = await supabase
        .from('user_vehicles')
        .update({ is_primary: false })
        .eq('user_id', user.id);

      if (clearErr) throw clearErr;

      const { error: setErr } = await supabase
        .from('user_vehicles')
        .update({ is_primary: true })
        .eq('id', id);

      if (setErr) throw setErr;

      toast.success('Primary vehicle updated');
      await loadVehicles();
      refreshUser?.();
    } catch (err) {
      console.error('Set primary failed:', err);
      toast.error('Failed to update primary vehicle');
      await loadVehicles();
    } finally {
      setSettingPrimary(null);
    }
  };

  // ---------------------------------------------------------------------------
  // Derived helpers
  // ---------------------------------------------------------------------------

  const getDisplayText = (v) => {
    if (v.vehicle_type === 'on_foot')  return 'On foot';
    if (v.vehicle_type === 'bicycle')  return v.make_model || 'Bicycle';
    return `${v.make_model}${v.registration ? ` · ${v.registration}` : ''}`;
  };

  const showMakeModel   = form.vehicle_type !== 'on_foot';
  const showReg         = form.vehicle_type === 'car' || form.vehicle_type === 'bicycle';
  const showColor       = form.vehicle_type === 'car' || form.vehicle_type === 'bicycle';

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center dark:text-white">
        Loading vehicles...
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800 p-6">
      <div className="max-w-2xl mx-auto">

        {/* ── Header ── */}
        <div className="flex items-center justify-between mb-6">
          <button
            onClick={() => navigate(-1)}
            className="inline-flex items-center gap-2 px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded-xl hover:bg-gray-300 dark:hover:bg-gray-600 transition text-sm font-medium"
          >
            <FaArrowLeft className="w-3 h-3" aria-hidden="true" />
            Back
          </button>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Your Vehicles</h1>
          <div className="w-20" />
        </div>

        {/* ── Vehicle list ── */}
        <div className="bg-slate-100 dark:bg-slate-700 rounded-2xl shadow border border-slate-200 dark:border-slate-600 overflow-hidden mb-4">
          {vehicles.length === 0 ? (
            <p className="text-gray-500 dark:text-gray-400 text-center py-10">
              No vehicles added yet.
            </p>
          ) : (
            <div className="divide-y divide-slate-200 dark:divide-slate-600">
              {vehicles.map((v) => (
                <div
                  key={v.id}
                  className="flex items-center justify-between px-5 py-4 gap-4 bg-white dark:bg-slate-800"
                >
                  {/* Left: icon + info */}
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div className="w-8 h-8 flex items-center justify-center flex-shrink-0">
                      {/* ✅ Using shared VehicleIcon component */}
                      <VehicleIcon type={v.vehicle_type} color={v.color} size="md" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-semibold text-gray-900 dark:text-white truncate">
                          {getDisplayText(v)}
                        </p>
                        {v.is_primary && (
                          <span className="flex items-center gap-1 px-2 py-0.5 bg-green-100 dark:bg-green-900/40 text-green-800 dark:text-green-300 text-xs rounded-full font-medium flex-shrink-0">
                            <FaStar className="w-2.5 h-2.5" aria-hidden="true" />
                            Primary
                          </span>
                        )}
                      </div>
                      {v.vehicle_type === 'bicycle' && v.registration && (
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          ID: {v.registration}
                        </p>
                      )}
                      <p className="text-xs text-gray-400 dark:text-gray-500 capitalize">
                        {v.vehicle_type.replace('_', ' ')}
                        {v.color && v.vehicle_type !== 'on_foot' && ` · ${v.color}`}
                      </p>
                    </div>
                  </div>

                  {/* Right: actions */}
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {confirmId === v.id ? (
                      <DeleteConfirm
                        loading={deletingId === v.id}
                        onConfirm={() => handleDelete(v.id)}
                        onCancel={() => setConfirmId(null)}
                      />
                    ) : (
                      <>
                        {!v.is_primary && (
                          <button
                            onClick={() => handleSetPrimary(v.id)}
                            disabled={settingPrimary === v.id}
                            className="text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-200 text-xs font-medium disabled:opacity-50 transition"
                          >
                            {settingPrimary === v.id ? 'Setting...' : 'Set Primary'}
                          </button>
                        )}
                        <button
                          onClick={() => setConfirmId(v.id)}
                          className="p-1.5 text-red-400 hover:text-red-600 dark:text-red-500 dark:hover:text-red-300 transition rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20"
                          title="Delete vehicle"
                          aria-label={`Delete ${getDisplayText(v)}`}
                        >
                          <FaTrash className="w-3.5 h-3.5" aria-hidden="true" />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Add vehicle form ── */}
        {showForm ? (
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow border border-gray-100 dark:border-gray-700 p-6">
            <h2 className="text-lg font-semibold mb-4 text-gray-900 dark:text-white">
              Add Vehicle
            </h2>
            <div className="space-y-3">

              {/* Type picker */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px' }}>
                {VEHICLE_TYPES.map(({ value, label, icon }) => {
                  const active = form.vehicle_type === value;
                  return (
                    <button
                      key={value}
                      onClick={() => setForm({ ...EMPTY_FORM, vehicle_type: value })}
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: '6px',
                        padding: '12px 8px',
                        borderRadius: '12px',
                        border: `2px solid ${active ? '#6366f1' : '#e5e7eb'}`,
                        backgroundColor: active ? '#eef2ff' : 'transparent',
                        color: active ? '#4338ca' : '#6b7280',
                        fontSize: '13px',
                        fontWeight: 500,
                        cursor: 'pointer',
                        transition: 'all 0.15s',
                      }}
                      aria-pressed={active}
                    >
                      {icon && <icon style={{ width: '20px', height: '20px' }} aria-hidden="true" />}
                      {label}
                    </button>
                  );
                })}
              </div>

              {showMakeModel && (
                <input
                  type="text"
                  placeholder={
                    form.vehicle_type === 'car'
                      ? 'Make & Model (e.g. Toyota Corolla)'
                      : 'Bicycle description (e.g. Mountain Bike)'
                  }
                  value={form.make_model}
                  onChange={(e) => setForm({ ...form, make_model: e.target.value })}
                  className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  aria-label={form.vehicle_type === 'car' ? 'Car make and model' : 'Bicycle description'}
                />
              )}

              {showReg && (
                <input
                  type="text"
                  placeholder={
                    form.vehicle_type === 'car'
                      ? 'Registration number (e.g. GP 123-456)'
                      : 'Bicycle ID / serial (optional)'
                  }
                  value={form.registration}
                  onChange={(e) => setForm({ ...form, registration: e.target.value })}
                  className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  aria-label={form.vehicle_type === 'car' ? 'Vehicle registration number' : 'Bicycle ID or serial'}
                />
              )}

              {showColor && (
                <div>
                  <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">Colour</p>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', alignItems: 'center' }}>
                    {COLORS.map(({ value, label }) => {
                      const selected = form.color === value;
                      const hex = COLOR_HEX[value] || '#6b7280';
                      const baseBorder = value === 'white' ? '#cbd5e1' : 'transparent';
                      return (
                        <button
                          key={value}
                          title={label}
                          onClick={() => setForm({ ...form, color: value })}
                          style={{
                            width: '28px',
                            height: '28px',
                            borderRadius: '50%',
                            backgroundColor: hex,
                            border: `2px solid ${selected ? '#6366f1' : baseBorder}`,
                            outline: selected ? '2px solid #c7d2fe' : 'none',
                            outlineOffset: '1px',
                            transform: selected ? 'scale(1.18)' : 'scale(1)',
                            cursor: 'pointer',
                            transition: 'all 0.15s',
                            flexShrink: 0,
                          }}
                          aria-label={`Select ${label} color`}
                          aria-pressed={selected}
                        />
                      );
                    })}
                  </div>
                  <p style={{ marginTop: '6px', fontSize: '12px', color: '#6b7280', textTransform: 'capitalize' }}>
                    Selected: {form.color}
                  </p>
                </div>
              )}

              {form.vehicle_type === 'on_foot' && (
                <div className="flex items-center gap-3 p-3 bg-teal-50 dark:bg-teal-900/20 rounded-xl border border-teal-100 dark:border-teal-800">
                  <FaWalking className="w-5 h-5 text-teal-500" aria-hidden="true" />
                  <p className="text-sm text-teal-700 dark:text-teal-300">
                    No extra details needed for on-foot patrol.
                  </p>
                </div>
              )}

              <div className="flex gap-2 pt-1">
                <button
                  onClick={handleAdd}
                  disabled={saving}
                  className="flex-1 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white py-2.5 rounded-xl font-medium text-sm transition"
                >
                  {saving ? 'Saving...' : 'Save Vehicle'}
                </button>
                <button
                  onClick={() => { setShowForm(false); setForm(EMPTY_FORM); }}
                  className="flex-1 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 py-2.5 rounded-xl font-medium text-sm transition"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setShowForm(true)}
            className="w-full flex items-center justify-center gap-2 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl font-medium text-sm transition shadow"
          >
            <FaPlus className="w-3.5 h-3.5" aria-hidden="true" />
            Add Vehicle
          </button>
        )}
      </div>
    </div>
  );
}