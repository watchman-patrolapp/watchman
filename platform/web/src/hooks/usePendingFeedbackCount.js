import { useState, useEffect, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { supabase } from '../supabase/client';

/**
 * Count of feedback rows not yet marked reviewed. Only for staff roles (caller enables).
 */
export function usePendingFeedbackCount(enabled) {
  const { pathname } = useLocation();
  const [count, setCount] = useState(0);

  const fetchCount = useCallback(async () => {
    if (!enabled) {
      setCount(0);
      return;
    }
    try {
      const { count: n, error } = await supabase
        .from('feedback')
        .select('*', { count: 'exact', head: true })
        .is('reviewed_at', null);
      if (error) throw error;
      setCount(typeof n === 'number' ? n : 0);
    } catch {
      setCount(0);
    }
  }, [enabled]);

  useEffect(() => {
    void fetchCount();
  }, [enabled, fetchCount, pathname]);

  useEffect(() => {
    if (!enabled) return undefined;

    const channel = supabase
      .channel('staff-pending-feedback')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'feedback' },
        () => {
          void fetchCount();
        }
      )
      .subscribe();

    const onVis = () => {
      if (!document.hidden) void fetchCount();
    };
    document.addEventListener('visibilitychange', onVis);

    return () => {
      supabase.removeChannel(channel);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [enabled, fetchCount]);

  return count;
}
