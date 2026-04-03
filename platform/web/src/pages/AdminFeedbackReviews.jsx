import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/useAuth';
import { hasHydratedAppRole } from '../auth/appRole';
import { canAccessAdminPanel } from '../auth/staffRoles';
import { supabase } from '../supabase/client';
import toast from 'react-hot-toast';
import { FaArrowLeft, FaCheck, FaUndo, FaSync, FaEnvelope, FaUser, FaClock } from 'react-icons/fa';
import ThemeToggle from '../components/ThemeToggle';
import BrandedLoader from '../components/layout/BrandedLoader';

export default function AdminFeedbackReviews() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);

  useEffect(() => {
    if (!user) return;
    if (!hasHydratedAppRole(user.role)) return;
    if (!canAccessAdminPanel(user.role)) {
      toast.error('Access denied.');
      navigate('/dashboard', { replace: true });
    }
  }, [user, navigate]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('feedback')
        .select('id, name, email, message, created_at, reviewed_at, reviewed_by, submitter_user_id')
        .order('created_at', { ascending: false });
      if (error) throw error;
      setRows(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error(e);
      toast.error(e?.message || 'Could not load feedback');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!user?.id || !canAccessAdminPanel(user?.role)) return undefined;
    const ch = supabase
      .channel('admin-feedback-live')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'feedback' },
        () => {
          void load();
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [user?.id, user?.role, load]);

  const markReviewed = async (id) => {
    if (!user?.id) return;
    setBusyId(id);
    try {
      const { error } = await supabase
        .from('feedback')
        .update({
          reviewed_at: new Date().toISOString(),
          reviewed_by: user.id,
        })
        .eq('id', id);
      if (error) throw error;
      toast.success('Marked as reviewed');
      setRows((prev) =>
        prev.map((r) =>
          r.id === id
            ? { ...r, reviewed_at: new Date().toISOString(), reviewed_by: user.id }
            : r
        )
      );
    } catch (e) {
      toast.error(e?.message || 'Update failed');
    } finally {
      setBusyId(null);
    }
  };

  const reopen = async (id) => {
    setBusyId(id);
    try {
      const { error } = await supabase
        .from('feedback')
        .update({ reviewed_at: null, reviewed_by: null })
        .eq('id', id);
      if (error) throw error;
      toast.success('Moved back to pending');
      setRows((prev) =>
        prev.map((r) => (r.id === id ? { ...r, reviewed_at: null, reviewed_by: null } : r))
      );
    } catch (e) {
      toast.error(e?.message || 'Update failed');
    } finally {
      setBusyId(null);
    }
  };

  const unreviewed = rows.filter((r) => !r.reviewed_at);
  const reviewed = rows.filter((r) => r.reviewed_at);

  if (!user || !hasHydratedAppRole(user.role) || !canAccessAdminPanel(user.role)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-gray-900">
        <BrandedLoader message="Checking access…" size="lg" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 py-8 px-4 sm:px-6">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => navigate('/admin')}
            className="inline-flex items-center gap-2 px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded-xl text-sm font-medium"
          >
            <FaArrowLeft className="w-3 h-3" aria-hidden />
            Admin dashboard
          </button>
          <div className="flex items-center gap-2">
            <ThemeToggle variant="toolbar" />
            <button
              type="button"
              onClick={() => void load()}
              disabled={loading}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white text-sm"
            >
              <FaSync className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} aria-hidden />
              Refresh
            </button>
          </div>
        </div>

        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Feedback reviews</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Submissions from About → Send us your feedback. {unreviewed.length > 0 && (
              <span className="text-amber-700 dark:text-amber-300 font-medium">
                {unreviewed.length} pending
              </span>
            )}
          </p>
        </div>

        {loading ? (
          <div className="flex justify-center py-16">
            <BrandedLoader message="Loading feedback…" size="md" />
          </div>
        ) : rows.length === 0 ? (
          <p className="text-center text-gray-500 dark:text-gray-400 py-12">No feedback yet.</p>
        ) : (
          <div className="space-y-10">
            {unreviewed.length > 0 && (
              <section>
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">
                  Pending ({unreviewed.length})
                </h2>
                <ul className="space-y-4">
                  {unreviewed.map((r) => (
                    <li
                      key={r.id}
                      className="bg-white dark:bg-gray-800 rounded-2xl border border-amber-200/80 dark:border-amber-900/50 p-5 shadow-sm"
                    >
                      <FeedbackCardBody row={r} />
                      <div className="mt-4 flex justify-end">
                        <button
                          type="button"
                          disabled={busyId === r.id}
                          onClick={() => void markReviewed(r.id)}
                          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white text-sm font-medium"
                        >
                          <FaCheck className="w-3 h-3" aria-hidden />
                          {busyId === r.id ? 'Saving…' : 'Mark as reviewed'}
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {reviewed.length > 0 && (
              <section>
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">
                  Reviewed ({reviewed.length})
                </h2>
                <ul className="space-y-3">
                  {reviewed.map((r) => (
                    <li
                      key={r.id}
                      className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-4 opacity-90"
                    >
                      <FeedbackCardBody row={r} reviewed />
                      <div className="mt-3 flex justify-end">
                        <button
                          type="button"
                          disabled={busyId === r.id}
                          onClick={() => void reopen(r.id)}
                          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                        >
                          <FaUndo className="w-3 h-3" aria-hidden />
                          Reopen
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function FeedbackCardBody({ row, reviewed: isReviewed }) {
  const when = row.created_at
    ? new Date(row.created_at).toLocaleString(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
      })
    : '—';

  return (
    <>
      <div className="flex flex-wrap gap-3 text-sm text-gray-600 dark:text-gray-400 mb-2">
        <span className="inline-flex items-center gap-1.5">
          <FaClock className="w-3.5 h-3.5 opacity-70" aria-hidden />
          {when}
        </span>
        {isReviewed && row.reviewed_at && (
          <span className="text-xs text-green-600 dark:text-green-400">
            Reviewed {new Date(row.reviewed_at).toLocaleString()}
          </span>
        )}
      </div>
      <div className="space-y-2 text-sm">
        <p className="flex items-center gap-2 text-gray-900 dark:text-white font-medium">
          <FaUser className="w-3.5 h-3.5 text-teal-500 shrink-0" aria-hidden />
          {row.name || '—'}
        </p>
        <p className="flex items-center gap-2 text-gray-600 dark:text-gray-300">
          <FaEnvelope className="w-3.5 h-3.5 shrink-0 opacity-70" aria-hidden />
          <a href={`mailto:${encodeURIComponent(row.email)}`} className="underline hover:text-teal-600">
            {row.email}
          </a>
        </p>
        {row.submitter_user_id && (
          <p className="text-xs text-gray-500 dark:text-gray-500 font-mono">
            Account ID: {row.submitter_user_id}
          </p>
        )}
      </div>
      <p className="mt-3 text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap leading-relaxed">
        {row.message}
      </p>
    </>
  );
}
