import { useSyncExternalStore } from "react";
import { useAuth } from "./useAuth";
import { supabase } from "../supabase/client";
import { isRpcNotFoundError } from "../utils/isRpcNotFound";
import { CURRENT_TERMS_VERSION, termsGateDecision } from "../utils/termsGate";

// Acceptances made in this session (userId -> version), so the gate closes at once
// without waiting for the profile to reload.
const acceptedByUser = new Map();
const listeners = new Set();

function markAccepted(userId, version) {
  acceptedByUser.set(userId, version);
  listeners.forEach((fn) => fn());
}

function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function readOnline() {
  if (typeof navigator === "undefined") return true;
  return navigator.onLine !== false;
}

function subscribeOnline(fn) {
  window.addEventListener("online", fn);
  window.addEventListener("offline", fn);
  return () => {
    window.removeEventListener("online", fn);
    window.removeEventListener("offline", fn);
  };
}

export async function recordAcceptance(userId, source) {
  const { error } = await supabase.rpc("accept_terms", {
    p_version: CURRENT_TERMS_VERSION,
    p_source: source,
  });
  if (error && !isRpcNotFoundError(error)) throw error;
  // Missing RPC means the SQL has not been run yet: fail open for this session.
  markAccepted(userId, CURRENT_TERMS_VERSION);
}

/** "pass" | "signup" | "ask" for the signed-in user. */
export function useTermsGateDecision() {
  const { user } = useAuth();
  const userId = user?.uid || user?.id || null;
  const acceptedLocally = useSyncExternalStore(subscribe, () =>
    userId ? acceptedByUser.get(userId) ?? null : null
  );
  const online = useSyncExternalStore(subscribeOnline, readOnline, () => true);
  return {
    user,
    userId,
    decision: termsGateDecision({ user, online, acceptedLocally }),
  };
}
