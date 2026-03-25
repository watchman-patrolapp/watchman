import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/useAuth";
import { supabase } from "../supabase/client";
import { 
  FaArrowLeft, 
  FaCheck, 
  FaTimes, 
  FaExclamationTriangle,
  FaCalendarAlt,
  FaMapMarkerAlt,
  FaUser,
  FaCar,
  FaImage,
  FaSync,
  FaSpinner
} from "react-icons/fa";
import toast from "react-hot-toast";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const POLLING_INTERVAL = 30000; // 30s fallback polling
const CACHE_STALE_TIME = 1000; // 1s before refetch

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function Badge({ children, variant = 'default' }) {
  const variants = {
    pending: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
    approved: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
    rejected: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
  };
  
  return (
    <span className={`px-3 py-1 text-xs font-semibold rounded-full ${variants[variant] || variants.default}`}>
      {children}
    </span>
  );
}

function ModerationCard({ incident, onApprove, onReject, processing }) {
  const formatDate = (dateStr) => {
    return new Date(dateStr).toLocaleString('en-ZA', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl p-5 shadow-sm">
      {/* Header */}
      <div className="flex flex-wrap justify-between items-start gap-3 mb-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
            <FaCalendarAlt className="w-4 h-4" />
            <span>{formatDate(incident.submitted_at)}</span>
          </div>
          <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
            <FaMapMarkerAlt className="w-4 h-4" />
            <span>{incident.location}</span>
          </div>
        </div>
        <Badge variant="pending">Pending</Badge>
      </div>

      {/* Reporter Info */}
      <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 mb-3 p-2 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
        <FaUser className="w-4 h-4" />
        <span>{incident.submitted_by_name}</span>
        {incident.submitted_by_car && (
          <>
            <span className="text-gray-400">•</span>
            <FaCar className="w-3 h-3" />
            <span>{incident.submitted_by_car}</span>
            {incident.submitted_by_reg && (
              <span className="text-gray-400">({incident.submitted_by_reg})</span>
            )}
          </>
        )}
      </div>

      {/* Incident Details */}
      <div className="mb-4">
        <h3 className="font-semibold text-gray-900 dark:text-white mb-1">{incident.type}</h3>
        <p className="text-gray-700 dark:text-gray-300 text-sm leading-relaxed bg-gray-50 dark:bg-gray-700/30 p-3 rounded-xl">
          {incident.description}
        </p>
      </div>

      {/* Additional Info */}
      <div className="space-y-1 text-sm mb-4">
        {incident.suspect_name && (
          <p className="text-gray-700 dark:text-gray-300">
            <span className="font-medium">Suspect:</span> {incident.suspect_name}
          </p>
        )}
        {incident.suspect_description && (
          <p className="text-gray-700 dark:text-gray-300">
            <span className="font-medium">Description:</span> {incident.suspect_description}
          </p>
        )}
        {incident.vehicle_info && (
          <p className="text-gray-700 dark:text-gray-300">
            <span className="font-medium">Vehicle:</span> {incident.vehicle_info}
          </p>
        )}
        {incident.saps_case_number && (
          <p className="text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-900/20 p-2 rounded-lg">
            <span className="font-medium">SAPS Case #:</span> {incident.saps_case_number}
          </p>
        )}
      </div>

      {/* Photos */}
      {incident.media_urls && incident.media_urls.length > 0 && (
        <div className="mb-4">
          <div className="flex items-center gap-2 mb-2 text-sm text-gray-600 dark:text-gray-400">
            <FaImage className="w-4 h-4" />
            <span>Evidence Photos ({incident.media_urls.length})</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {incident.media_urls.map((url, idx) => (
              <a key={idx} href={url} target="_blank" rel="noopener noreferrer">
                <img 
                  src={url} 
                  alt={`Evidence ${idx + 1}`}
                  className="w-20 h-20 object-cover rounded-lg border border-gray-200 dark:border-gray-700 hover:opacity-90 transition"
                />
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex gap-3 pt-3 border-t border-gray-100 dark:border-gray-700">
        <button
          onClick={() => onApprove(incident.id)}
          disabled={processing === `approve-${incident.id}`}
          className="flex-1 inline-flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed text-white px-4 py-2.5 rounded-xl text-sm font-medium transition shadow-sm"
        >
          {processing === `approve-${incident.id}` ? (
            <FaSpinner className="w-4 h-4 animate-spin" />
          ) : (
            <FaCheck className="w-4 h-4" />
          )}
          Approve
        </button>
        <button
          onClick={() => onReject(incident.id)}
          disabled={processing === `reject-${incident.id}`}
          className="flex-1 inline-flex items-center justify-center gap-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed text-white px-4 py-2.5 rounded-xl text-sm font-medium transition shadow-sm"
        >
          {processing === `reject-${incident.id}` ? (
            <FaSpinner className="w-4 h-4 animate-spin" />
          ) : (
            <FaTimes className="w-4 h-4" />
          )}
          Reject
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function IncidentModeration() {
  const navigate = useNavigate();
  const { user } = useAuth();
  
  const [incidents, setIncidents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [processing, setProcessing] = useState(null);
  
  // Track processed IDs to prevent re-appearing (cache-busting)
  const processedIds = useRef(new Set());
  const lastFetchTime = useRef(0);
  const realtimeChannel = useRef(null);

  // ---------------------------------------------------------------------------
  // Data Fetching with deduplication
  // ---------------------------------------------------------------------------
  
  const fetchPendingIncidents = useCallback(async (options = {}) => {
    const { force = false, silent = false } = options;
    
    // Prevent fetch spam (except force refresh)
    const now = Date.now();
    if (!force && now - lastFetchTime.current < CACHE_STALE_TIME) {
      return;
    }
    
    if (!silent) setLoading(true);
    setError(null);
    
    try {
      const { data, error: fetchError } = await supabase
        .from('incidents')
        .select('*')
        .eq('status', 'pending')
        .order('submitted_at', { ascending: false });

      if (fetchError) throw fetchError;
      
      // Filter out locally processed IDs (prevents re-appearing during cache lag)
      const filtered = (data || []).filter(i => !processedIds.current.has(i.id));
      
      setIncidents(filtered);
      lastFetchTime.current = now;
    } catch (err) {
      console.error("Error fetching incidents:", err);
      setError(err.message);
      if (!silent) toast.error("Failed to load pending incidents");
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  // ---------------------------------------------------------------------------
  // Realtime Subscription (primary sync method)
  // ---------------------------------------------------------------------------
  
  useEffect(() => {
    // Initial fetch
    fetchPendingIncidents();
    
    // Setup realtime subscription
    realtimeChannel.current = supabase
      .channel('incident-moderation')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'incidents',
          filter: 'status=eq.pending'
        },
        (payload) => {
          console.log('Realtime update:', payload);
          
          switch (payload.eventType) {
            case 'DELETE':
              setIncidents(prev => prev.filter(i => i.id !== payload.old.id));
              break;
              
            case 'UPDATE':
              // If updated to non-pending, remove from list
              if (payload.new.status !== 'pending') {
                setIncidents(prev => prev.filter(i => i.id !== payload.new.id));
                processedIds.current.add(payload.new.id);
              } else {
                // Still pending, update data
                setIncidents(prev => prev.map(i => 
                  i.id === payload.new.id ? payload.new : i
                ));
              }
              break;
              
            case 'INSERT':
              // Only add if not locally processed
              if (!processedIds.current.has(payload.new.id)) {
                setIncidents(prev => [payload.new, ...prev]);
              }
              break;
          }
        }
      )
      .subscribe((status) => {
        console.log('Realtime subscription status:', status);
      });

    // Fallback polling (every 30s) for when realtime fails
    const pollInterval = setInterval(() => {
      fetchPendingIncidents({ silent: true, force: true });
    }, POLLING_INTERVAL);

    return () => {
      if (realtimeChannel.current) {
        supabase.removeChannel(realtimeChannel.current);
      }
      clearInterval(pollInterval);
    };
  }, [fetchPendingIncidents]);

  // ---------------------------------------------------------------------------
  // Actions with optimistic UI + verification
  // ---------------------------------------------------------------------------
  
  const handleApprove = async (id) => {
    if (processing) return; // Prevent concurrent actions
    
    setProcessing(`approve-${id}`);
    
    // Optimistic: immediately hide and track as processed
    setIncidents(prev => prev.filter(i => i.id !== id));
    processedIds.current.add(id);
    
    try {
      // Use RPC for atomic operation (bypasses RLS caching issues)
      const { error: rpcError } = await supabase.rpc('approve_incident', {
        incident_id: id,
        admin_id: user.id
      });

      // Fallback to direct update if RPC doesn't exist
      if (rpcError?.message?.includes('function') || rpcError?.code === '42883') {
        const { error: updateError } = await supabase
          .from('incidents')
          .update({ 
            status: 'approved', 
            approved_by: user.id, 
            approved_at: new Date().toISOString()
          })
          .eq('id', id)
          .select();

        if (updateError) throw updateError;
      } else if (rpcError) {
        throw rpcError;
      }

      toast.success("Incident approved and published");
      
      // Verify after short delay (catches any cache lag)
      setTimeout(() => verifyRemoval(id, 'approved'), 500);
      
    } catch (err) {
      console.error("Approve failed:", err);
      toast.error(`Failed to approve: ${err.message}`);
      
      // Revert optimistic update
      processedIds.current.delete(id);
      fetchPendingIncidents({ force: true });
    } finally {
      setProcessing(null);
    }
  };

  const handleReject = async (id) => {
    const reason = prompt("Reason for rejection (optional):")?.trim();
    
    // User cancelled
    if (reason === null) return;
    
    setProcessing(`reject-${id}`);
    
    // Optimistic removal
    setIncidents(prev => prev.filter(i => i.id !== id));
    processedIds.current.add(id);
    
    try {
      const { error: rpcError } = await supabase.rpc('reject_incident', {
        incident_id: id,
        admin_id: user.id,
        rejection_reason: reason || null
      });

      if (rpcError) throw rpcError;

      toast.success("Incident rejected and archived");
      
      setTimeout(() => verifyRemoval(id, 'rejected'), 500);
      
    } catch (err) {
      console.error("Reject failed:", err);
      toast.error(`Rejection failed: ${err.message}`);
      
      processedIds.current.delete(id);
      fetchPendingIncidents({ force: true });
    } finally {
      setProcessing(null);
    }
  };

  // Verify incident was actually removed from pending (handles cache lag)
  const verifyRemoval = async (id, expectedStatus) => {
    try {
      const { data, error } = await supabase
        .from('incidents')
        .select('id, status')
        .eq('id', id)
        .maybeSingle();

      if (error) throw error;

      // If still exists as pending, force refresh
      if (data?.status === 'pending') {
        console.warn(`Incident ${id} still pending after ${expectedStatus}, forcing refresh`);
        fetchPendingIncidents({ force: true });
      }
    } catch (err) {
      console.error("Verification failed:", err);
    }
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  
  if (loading && incidents.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800">
        <div className="text-center">
          <FaSpinner className="w-8 h-8 text-indigo-600 animate-spin mx-auto mb-3" />
          <p className="text-gray-500 dark:text-gray-400">Loading pending incidents...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800 py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-4xl mx-auto">

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
          <button
            onClick={() => navigate("/admin")}
            className="inline-flex items-center gap-2 px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded-xl hover:bg-gray-300 dark:hover:bg-gray-600 transition text-sm font-medium"
          >
            <FaArrowLeft className="w-3 h-3" />
            Admin
          </button>
          
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            Incident Moderation
          </h1>
          
          <button
            onClick={() => fetchPendingIncidents({ force: true })}
            disabled={loading}
            className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-xl transition text-sm font-medium shadow-sm"
          >
            <FaSync className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>

        {/* Error State */}
        {error && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-2xl p-6 mb-6 text-center">
            <FaExclamationTriangle className="w-8 h-8 text-red-500 mx-auto mb-2" />
            <p className="text-red-700 dark:text-red-300 mb-3">{error}</p>
            <button
              onClick={() => fetchPendingIncidents({ force: true })}
              className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-medium transition"
            >
              Retry
            </button>
          </div>
        )}

        {/* Stats */}
        <div className="mb-6 flex items-center justify-between text-sm text-gray-500 dark:text-gray-400">
          <span>{incidents.length} pending incident{incidents.length !== 1 ? 's' : ''}</span>
          {processedIds.current.size > 0 && (
            <span className="text-amber-600 dark:text-amber-400">
              {processedIds.current.size} processed this session
            </span>
          )}
        </div>

        {/* Content */}
        <div className="space-y-6">
          {incidents.length === 0 ? (
            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-12 text-center">
              <FaCheck className="w-12 h-12 text-green-500 mx-auto mb-3" />
              <p className="text-gray-900 dark:text-white font-medium">No pending incidents</p>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">All caught up! Check back later.</p>
            </div>
          ) : (
            incidents.map(incident => (
              <ModerationCard
                key={incident.id}
                incident={incident}
                onApprove={handleApprove}
                onReject={handleReject}
                processing={processing}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}