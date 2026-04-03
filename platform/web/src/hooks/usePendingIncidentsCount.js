import { useState, useEffect, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { supabase } from '../supabase/client';

/**
 * Count of incidents awaiting moderation. Only meaningful when the caller enables it
 * for roles that can see pending rows (e.g. admin, committee).
 */
export function usePendingIncidentsCount(enabled) {
  const { pathname } = useLocation();
  const [count, setCount] = useState(0);

  const fetchCount = useCallback(async () => {
    if (!enabled) {
      setCount(0);
      return;
    }
    try {
      const { count: n, error } = await supabase
        .from('incidents')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'pending');
      if (error) throw error;
      setCount(typeof n === 'number' ? n : 0);
    } catch {
      setCount(0);
    }
  }, [enabled]);

  // Refetch when the route changes (e.g. leaving /admin/incidents) so the dock badge stays in
  // sync with the admin panel even if Realtime is delayed or unavailable.
  useEffect(() => {
    void fetchCount();
  }, [enabled, fetchCount, pathname]);

  useEffect(() => {
    if (!enabled) return undefined;

    const channel = supabase
      .channel('mobile-dock-pending-incidents')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'incidents' },
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
