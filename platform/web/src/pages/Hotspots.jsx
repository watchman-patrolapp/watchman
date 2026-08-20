import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  FaArrowLeft,
  FaPlus,
  FaVideo,
  FaTrash,
  FaEdit,
  FaTimes,
} from 'react-icons/fa';
import toast from 'react-hot-toast';
import ThemeToggle from '../components/ThemeToggle';
import BrandedLoader from '../components/layout/BrandedLoader';
import { useAuth } from '../auth/useAuth';
import { canManageHotspots } from '../auth/staffRoles';
import { homePathForRole } from '../auth/roleMatrix';
import { clusterHotZones, travelPathSegments } from '../utils/hotspotGeometry';
import { suggestCamerasForEvent } from '../utils/cameraSuggestions';
import { hotspotKindLabel, hotspotKindMeta } from '../utils/hotspotKinds';
import {
  fetchHotspotEvents,
  fetchCameraSpots,
  fetchHotspotCameraChecks,
  deleteHotspotEvent,
  deleteCameraSpot,
} from '../utils/hotspotService';
import HotspotsMap from '../components/hotspots/HotspotsMap';
import HotspotEventForm from '../components/hotspots/HotspotEventForm';
import CameraSpotForm from '../components/hotspots/CameraSpotForm';
import CameraSuggestionsPanel from '../components/hotspots/CameraSuggestionsPanel';
import { formatWatchDateTime, parsePatrolTime } from '../utils/watchTime';
import '../styles/hotspots-map.css';

const RANGE_OPTIONS = [
  { id: '7', label: 'Last 7 days', days: 7 },
  { id: '30', label: 'Last 30 days', days: 30 },
  { id: '90', label: 'Last 90 days', days: 90 },
  { id: 'all', label: 'All time', days: null },
];

function whenLabel(ev) {
  if (!ev.occurred_at) return 'Date unknown';
  const formatted = formatWatchDateTime(ev.occurred_at, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  if (!formatted) return 'Date unknown';
  if (!ev.time_known) {
    return formatWatchDateTime(ev.occurred_at, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }) || 'Date unknown';
  }
  return formatted;
}

function filterByRange(events, days) {
  if (!days) return events;
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  return events.filter((e) => {
    const t = parsePatrolTime(e.occurred_at)?.getTime();
    return Number.isFinite(t) && t >= cutoff;
  });
}

export default function Hotspots() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const canWrite = canManageHotspots(user?.role);
  const backTo = homePathForRole(user?.role, user?.platformRole);
  const backLabel =
    backTo === "/security"
      ? "Back to command"
      : backTo === "/city-admin"
        ? "Back to city admin"
        : "Back to home";

  const [loading, setLoading] = useState(true);
  const [events, setEvents] = useState([]);
  const [cameras, setCameras] = useState([]);
  const [rangeId, setRangeId] = useState('90');
  const [showPath, setShowPath] = useState(true);
  const [showCameras, setShowCameras] = useState(true);
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [selectedCamera, setSelectedCamera] = useState(null);
  const [checks, setChecks] = useState([]);
  const [panel, setPanel] = useState(null);
  const [editingEvent, setEditingEvent] = useState(null);
  const [editingCamera, setEditingCamera] = useState(null);
  const loadGen = useRef(0);
  const checksGen = useRef(0);
  const [deleteBusyId, setDeleteBusyId] = useState(null);

  const load = useCallback(async () => {
    const gen = ++loadGen.current;
    try {
      const [ev, cam] = await Promise.all([fetchHotspotEvents(), fetchCameraSpots()]);
      if (gen !== loadGen.current) return;
      setEvents(ev);
      setCameras(cam);
      setSelectedEvent((prev) => (prev ? ev.find((x) => x.id === prev.id) || null : null));
      setSelectedCamera((prev) => (prev ? cam.find((x) => x.id === prev.id) || null : null));
    } catch (err) {
      if (gen !== loadGen.current) return;
      toast.error(err.message || 'Could not load hotspots.');
    } finally {
      if (gen === loadGen.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const loadChecks = useCallback(async (eventId) => {
    const gen = ++checksGen.current;
    if (!eventId) {
      setChecks([]);
      return;
    }
    try {
      const rows = await fetchHotspotCameraChecks(eventId);
      if (gen !== checksGen.current) return;
      setChecks(rows);
    } catch {
      if (gen !== checksGen.current) return;
      setChecks([]);
    }
  }, []);

  useEffect(() => {
    void loadChecks(selectedEvent?.id);
  }, [selectedEvent?.id, loadChecks]);

  const rangeDays = RANGE_OPTIONS.find((r) => r.id === rangeId)?.days ?? 90;
  const visibleEvents = useMemo(() => filterByRange(events, rangeDays), [events, rangeDays]);
  const zones = useMemo(() => clusterHotZones(visibleEvents), [visibleEvents]);
  const pathSegments = useMemo(() => {
    const fromZones = zones.map((z) => z.thread).filter((t) => t && t.length >= 2);
    if (fromZones.length) return fromZones;
    return travelPathSegments(visibleEvents);
  }, [zones, visibleEvents]);
  const suggestions = useMemo(
    () => (selectedEvent ? suggestCamerasForEvent(selectedEvent, cameras, visibleEvents) : []),
    [selectedEvent, cameras, visibleEvents]
  );

  const closeForms = () => {
    setPanel(null);
    setEditingEvent(null);
    setEditingCamera(null);
  };

  const openEditEvent = (ev) => {
    setSelectedEvent(ev);
    setSelectedCamera(null);
    setEditingEvent(ev);
    setPanel('event');
  };

  const onSaved = async (saved) => {
    await load();
    if (saved?.id) setSelectedEvent(saved);
  };

  const removeEvent = async (ev) => {
    if (deleteBusyId) return;
    if (!window.confirm(`Remove pin at ${ev.address}?`)) return;
    setDeleteBusyId(ev.id);
    try {
      await deleteHotspotEvent(ev.id);
      if (selectedEvent?.id === ev.id) setSelectedEvent(null);
      toast.success('Pin removed.');
      await load();
    } catch (err) {
      toast.error(err.message || 'Could not delete.');
    } finally {
      setDeleteBusyId(null);
    }
  };

  const removeCamera = async (cam) => {
    if (deleteBusyId) return;
    if (!window.confirm(`Remove camera “${cam.name}”?`)) return;
    setDeleteBusyId(cam.id);
    try {
      await deleteCameraSpot(cam.id);
      if (selectedCamera?.id === cam.id) setSelectedCamera(null);
      toast.success('Camera removed.');
      await load();
    } catch (err) {
      toast.error(err.message || 'Could not delete.');
    } finally {
      setDeleteBusyId(null);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <BrandedLoader message="Loading hotspots…" />
      </div>
    );
  }

  const formOpen = panel === 'event' || panel === 'camera';

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex flex-col pb-16">
      <header className="sticky top-0 z-40 border-b border-gray-200 bg-white/90 backdrop-blur-sm dark:border-gray-800 dark:bg-gray-900/90">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-2 px-4 py-3 sm:px-6">
          <button
            type="button"
            onClick={() => navigate(backTo)}
            className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
          >
            <FaArrowLeft className="h-3 w-3" />
            {backLabel}
          </button>
          <ThemeToggle variant="toolbar" />
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 py-4 sm:px-6">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Hotspots</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Break-ins and cable theft. Pins in the same neighborhood form a transparent hot zone; a thread joins them in date order.
            </p>
          </div>
          {canWrite && (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  setEditingEvent(null);
                  setPanel('event');
                }}
                className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700"
              >
                <FaPlus className="h-3 w-3" />
                Add pin
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditingCamera(null);
                  setPanel('camera');
                }}
                className="inline-flex items-center gap-2 rounded-lg bg-teal-600 px-3 py-2 text-sm font-medium text-white hover:bg-teal-700"
              >
                <FaVideo className="h-3 w-3" />
                Add camera
              </button>
            </div>
          )}
        </div>
        <div className="mb-4 flex flex-wrap items-center gap-3 text-sm">
          <label className="flex items-center gap-2">
            <span className="text-gray-500">Range</span>
            <select
              value={rangeId}
              onChange={(e) => setRangeId(e.target.value)}
              className="rounded-lg border border-gray-300 bg-white px-2 py-1 dark:border-gray-600 dark:bg-gray-800"
            >
              {RANGE_OPTIONS.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-gray-700 dark:text-gray-300">
            <input type="checkbox" checked={showPath} onChange={(e) => setShowPath(e.target.checked)} />
            Travel thread
          </label>
          <label className="flex items-center gap-2 text-gray-700 dark:text-gray-300">
            <input type="checkbox" checked={showCameras} onChange={(e) => setShowCameras(e.target.checked)} />
            Cameras
          </label>
          <span className="text-xs text-gray-400">
            {visibleEvents.length} pin{visibleEvents.length === 1 ? '' : 's'} · {zones.length} hot zone
            {zones.length === 1 ? '' : 's'} · {cameras.length} camera{cameras.length === 1 ? '' : 's'}
          </span>
        </div>

        <div className="grid w-full flex-1 gap-4 lg:grid-cols-[1fr_20rem]">
        <div className="relative h-[min(70vh,640px)] min-h-[320px] rounded-2xl overflow-hidden border border-gray-200 dark:border-gray-700 bg-gray-100 dark:bg-gray-800">
          <HotspotsMap
            events={visibleEvents}
            cameras={cameras}
            zones={zones}
            pathSegments={pathSegments}
            showPath={showPath}
            showCameras={showCameras}
            selectedEventId={selectedEvent?.id}
            onSelectEvent={(ev) => {
              setSelectedEvent(ev);
              setSelectedCamera(null);
            }}
            onSelectCamera={(cam) => {
              setSelectedCamera(cam);
              setSelectedEvent(null);
            }}
            onEditEvent={canWrite ? openEditEvent : undefined}
          />
          {selectedEvent && canWrite && (
            <div className="absolute top-3 right-3 z-[500] flex gap-2">
              <button
                type="button"
                onClick={() => openEditEvent(selectedEvent)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-white/95 px-3 py-2 text-sm font-medium text-gray-900 shadow dark:bg-gray-900/95 dark:text-white"
              >
                <FaEdit className="w-3 h-3" />
                Edit pin
              </button>
            </div>
          )}
          {visibleEvents.length === 0 && (
            <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center">
              <p className="pointer-events-auto rounded-full bg-white/95 dark:bg-gray-900/95 px-4 py-2 text-sm text-gray-600 dark:text-gray-300 shadow">
                No pins in this range{canWrite ? ' — add a break-in or cable theft pin to start a zone.' : '.'}
              </p>
            </div>
          )}
        </div>

        <aside className="space-y-3">
          {selectedEvent && (
            <section className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className={`text-xs uppercase tracking-wide font-semibold ${hotspotKindMeta(selectedEvent.kind).toneClass}`}>
                    {hotspotKindLabel(selectedEvent.kind, { short: true })}
                  </p>
                  <h2 className="font-semibold text-gray-900 dark:text-white">{selectedEvent.address}</h2>
                  <p className="text-sm text-gray-500">{whenLabel(selectedEvent)}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedEvent(null)}
                  className="p-1 text-gray-400 hover:text-gray-700"
                  aria-label="Close"
                >
                  <FaTimes />
                </button>
              </div>
              {selectedEvent.notes ? (
                <p className="text-sm text-gray-600 dark:text-gray-300 mt-2">{selectedEvent.notes}</p>
              ) : null}
              {canWrite && (
                <div className="flex gap-2 mt-3">
                  <button
                    type="button"
                    onClick={() => {
                      openEditEvent(selectedEvent);
                    }}
                    className="inline-flex items-center gap-1 text-sm px-3 py-1.5 rounded-md bg-gray-900 text-white dark:bg-white dark:text-gray-900"
                  >
                    <FaEdit className="w-3 h-3" /> Edit pin
                  </button>
                  <button
                    type="button"
                    onClick={() => void removeEvent(selectedEvent)}
                    className="inline-flex items-center gap-1 text-sm px-2 py-1 rounded-md border border-red-300 text-red-700 dark:border-red-800 dark:text-red-400"
                  >
                    <FaTrash className="w-3 h-3" /> Remove
                  </button>
                </div>
              )}
              <CameraSuggestionsPanel
                event={selectedEvent}
                suggestions={suggestions}
                checks={checks}
                userId={user?.id}
                onChecksChange={() => void loadChecks(selectedEvent.id)}
              />
            </section>
          )}

          {selectedCamera && (
            <section className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-xs uppercase tracking-wide text-teal-600 font-semibold">Camera</p>
                  <h2 className="font-semibold text-gray-900 dark:text-white">{selectedCamera.name}</h2>
                  {selectedCamera.address ? (
                    <p className="text-sm text-gray-500">{selectedCamera.address}</p>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedCamera(null)}
                  className="p-1 text-gray-400 hover:text-gray-700"
                  aria-label="Close"
                >
                  <FaTimes />
                </button>
              </div>
              <p className="text-sm text-gray-500 mt-1">Range ~{selectedCamera.range_meters} m</p>
              {selectedCamera.notes ? (
                <p className="text-sm text-gray-600 dark:text-gray-300 mt-2">{selectedCamera.notes}</p>
              ) : null}
              {canWrite && (
                <div className="flex gap-2 mt-3">
                  <button
                    type="button"
                    onClick={() => {
                      setEditingCamera(selectedCamera);
                      setPanel('camera');
                    }}
                    className="inline-flex items-center gap-1 text-sm px-2 py-1 rounded-md border border-gray-300 dark:border-gray-600"
                  >
                    <FaEdit className="w-3 h-3" /> Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => void removeCamera(selectedCamera)}
                    className="inline-flex items-center gap-1 text-sm px-2 py-1 rounded-md border border-red-300 text-red-700"
                  >
                    <FaTrash className="w-3 h-3" /> Remove
                  </button>
                </div>
              )}
            </section>
          )}

          <section className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-white mb-2">Pins in range</h2>
            {visibleEvents.length === 0 ? (
              <p className="text-sm text-gray-500">None yet.</p>
            ) : (
              <ul className="space-y-1 max-h-64 overflow-y-auto">
                {visibleEvents.map((ev) => (
                  <li key={ev.id} className="flex items-stretch gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedEvent(ev);
                        setSelectedCamera(null);
                      }}
                      className={`min-w-0 flex-1 text-left rounded-lg px-2 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-700/60 ${
                        selectedEvent?.id === ev.id ? 'bg-red-50 dark:bg-red-950/30' : ''
                      }`}
                    >
                      <span className="font-medium text-gray-900 dark:text-white">{ev.address}</span>
                      <span className="block text-xs text-gray-500">
                        {hotspotKindLabel(ev.kind, { short: true })} · {whenLabel(ev)}
                      </span>
                    </button>
                    {canWrite ? (
                      <button
                        type="button"
                        onClick={() => openEditEvent(ev)}
                        className="shrink-0 rounded-lg px-2 text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:hover:bg-gray-700 dark:hover:text-white"
                        aria-label={`Edit pin at ${ev.address}`}
                        title="Edit pin"
                      >
                        <FaEdit className="w-3.5 h-3.5" />
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>
      </div>

      {formOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4">
          <div className="w-full sm:max-w-lg max-h-[92vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl bg-white dark:bg-gray-800 p-4 shadow-xl">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                {panel === 'event'
                  ? editingEvent
                    ? 'Edit pin'
                    : 'Add pin'
                  : editingCamera
                    ? 'Edit camera'
                    : 'Add camera'}
              </h2>
              <button type="button" onClick={closeForms} className="p-1 text-gray-400" aria-label="Close form">
                <FaTimes />
              </button>
            </div>
            {panel === 'event' ? (
              <HotspotEventForm
                key={editingEvent?.id || 'new-event'}
                userId={user?.id}
                initial={editingEvent}
                onClose={closeForms}
                onSaved={onSaved}
              />
            ) : (
              <CameraSpotForm
                userId={user?.id}
                initial={editingCamera}
                onClose={closeForms}
                onSaved={onSaved}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
