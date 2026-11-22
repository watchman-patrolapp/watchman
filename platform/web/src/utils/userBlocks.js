import { useEffect, useSyncExternalStore } from "react";
import { supabase } from "../supabase/client";

/**
 * Members this user has blocked. Kept in one shared store so every chat
 * bubble, City Hub card and profile sheet agrees without refetching.
 * If the user_blocks table is not live yet, blocking simply reads as empty.
 */
let state = { userId: null, ids: new Set(), loaded: false };
let loading = null;
const listeners = new Set();

function emit(next) {
  state = next;
  listeners.forEach((fn) => fn());
}

function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function isMissingTable(error) {
  const code = error?.code;
  const msg = String(error?.message || "").toLowerCase();
  return code === "42P01" || code === "PGRST205" || msg.includes("user_blocks");
}

export function loadBlockedUsers(userId, { force = false } = {}) {
  if (!userId) {
    if (state.userId) emit({ userId: null, ids: new Set(), loaded: false });
    return Promise.resolve(state.ids);
  }
  if (!force && state.userId === userId && state.loaded) return Promise.resolve(state.ids);
  if (loading && !force) return loading;
  loading = (async () => {
    try {
      const { data, error } = await supabase
        .from("user_blocks")
        .select("blocked_id")
        .eq("blocker_id", userId);
      if (error) {
        if (!isMissingTable(error)) console.warn("user_blocks load failed:", error.message);
        emit({ userId, ids: new Set(), loaded: true });
      } else {
        emit({ userId, ids: new Set((data || []).map((r) => String(r.blocked_id))), loaded: true });
      }
    } finally {
      loading = null;
    }
    return state.ids;
  })();
  return loading;
}

/** Blocks a member. Returns a friendly error string, or null on success. */
export async function blockUser(userId, targetId) {
  if (!userId || !targetId || String(userId) === String(targetId)) return "You can't block this member.";
  const { error } = await supabase.from("user_blocks").insert({ blocker_id: userId, blocked_id: targetId });
  if (error && error.code !== "23505") {
    console.warn("block failed:", error.message);
    return isMissingTable(error)
      ? "Blocking isn't available yet. Please try again later."
      : "Could not block this member. Please try again.";
  }
  const ids = new Set(state.ids);
  ids.add(String(targetId));
  emit({ userId, ids, loaded: true });
  return null;
}

/** Unblocks a member. Returns a friendly error string, or null on success. */
export async function unblockUser(userId, targetId) {
  if (!userId || !targetId) return "Could not unblock this member.";
  const { error } = await supabase
    .from("user_blocks")
    .delete()
    .eq("blocker_id", userId)
    .eq("blocked_id", targetId);
  if (error) {
    console.warn("unblock failed:", error.message);
    return "Could not unblock this member. Please try again.";
  }
  const ids = new Set(state.ids);
  ids.delete(String(targetId));
  emit({ userId, ids, loaded: true });
  return null;
}

/** The caller's blocks with names, for the Profile list. */
export async function listMyBlockedUsers() {
  const { data, error } = await supabase.rpc("list_my_blocked_users");
  if (error) {
    console.warn("list_my_blocked_users failed:", error.message);
    return { rows: [], error: true };
  }
  return { rows: data || [], error: false };
}

/** Set of blocked user ids (strings) for the signed-in user. */
export function useBlockedUserIds(userId) {
  useEffect(() => {
    loadBlockedUsers(userId);
  }, [userId]);
  const snap = useSyncExternalStore(subscribe, () => state, () => state);
  return snap.userId === userId ? snap.ids : EMPTY;
}

const EMPTY = new Set();

/** Messages that must always show, even from a blocked member. */
export function isSafetyChatMessage(message) {
  return Boolean(message?.is_critical || message?.is_emergency);
}
