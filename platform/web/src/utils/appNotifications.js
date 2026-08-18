import { useCallback, useEffect, useState } from "react";
import { supabase } from "../supabase/client";
import { isRpcNotFoundError } from "./isRpcNotFound";

export async function listMyAppNotifications(limit = 30) {
  const { data, error } = await supabase.rpc("list_my_app_notifications", { p_limit: limit });
  if (error) return { data: [], error };
  return { data: data || [], error: null };
}

export async function markAppNotificationsRead(ids) {
  return supabase.rpc("mark_app_notifications_read", {
    p_ids: ids?.length ? ids : null,
  });
}

export function useAppNotifications(userId) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);

  const reload = useCallback(async () => {
    if (!userId) {
      setRows([]);
      return;
    }
    setLoading(true);
    const { data, error } = await listMyAppNotifications();
    if (error && !isRpcNotFoundError(error)) {
      console.warn("app notifications:", error.message);
    }
    setRows(data || []);
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (!userId) return undefined;
    const channel = supabase
      .channel(`app-notifications-${userId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "app_notifications", filter: `user_id=eq.${userId}` },
        (payload) => {
          const row = payload.new;
          if (!row?.id) return;
          setRows((prev) => (prev.some((item) => item.id === row.id) ? prev : [row, ...prev]));
        }
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [userId]);

  const unread = rows.filter((row) => !row.read_at);

  const markRead = useCallback(
    async (ids) => {
      const { error } = await markAppNotificationsRead(ids);
      if (error && !isRpcNotFoundError(error)) {
        console.warn("mark notifications read:", error.message);
        return;
      }
      const now = new Date().toISOString();
      setRows((prev) =>
        prev.map((row) => {
          if (row.read_at) return row;
          if (ids?.length && !ids.includes(row.id)) return row;
          return { ...row, read_at: now };
        })
      );
    },
    []
  );

  return { rows, unread, unreadCount: unread.length, loading, reload, markRead };
}
