import {
  OFFLINE_READ_MESSAGE,
  OFFLINE_WRITE_MESSAGE,
  decideSupabaseFetch,
  isSupabaseAuthUrl,
} from "./policy.js";

function requestUrl(input) {
  if (typeof input === "string") return input;
  if (input && typeof input.url === "string") return input.url;
  return "";
}

function requestMethod(input, init) {
  if (init?.method) return init.method;
  if (input && typeof input !== "string" && input.method) return input.method;
  return "GET";
}

export function offlineResponse(message) {
  return new Response(JSON.stringify({ message, code: "offline", error: "offline" }), {
    status: 503,
    headers: { "Content-Type": "application/json" },
  });
}

function failureMessage(method, online) {
  const verb = String(method || "GET").toUpperCase();
  if (verb !== "GET" && verb !== "HEAD") return OFFLINE_WRITE_MESSAGE;
  if (online === false) return OFFLINE_WRITE_MESSAGE;
  return OFFLINE_READ_MESSAGE;
}

/**
 * Supabase client's fetch. Auth is untouched. Queued writes pass through.
 * Other offline writes, and network failures, become a short message.
 */
export async function offlineAwareFetch(input, init, deps = {}) {
  const fetchImpl = deps.fetch || globalThis.fetch;
  const online = deps.online ?? (typeof navigator === "undefined" || navigator.onLine !== false);
  const url = requestUrl(input);
  const method = requestMethod(input, init);
  const decision = decideSupabaseFetch({ url, method, online });
  if (decision.action === "block") {
    return offlineResponse(decision.message || OFFLINE_WRITE_MESSAGE);
  }
  try {
    return await fetchImpl(input, init);
  } catch (error) {
    if (isSupabaseAuthUrl(url)) throw error;
    return offlineResponse(failureMessage(method, online));
  }
}
