import { useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "../supabase/client";
import { useAuth } from "../auth/useAuth";
import { hasCapability, normalizeCapability } from "../auth/capabilities";
import { isRpcNotFoundError } from "../utils/isRpcNotFound";

const EMPTY = Object.freeze([]);

async function fetchMyOrgCapabilities() {
  const { data, error } = await supabase.rpc("get_my_org_capabilities");
  if (error) {
    // Before 20261031010000 is applied the RPC does not exist: treat as no capabilities.
    if (isRpcNotFoundError(error)) return EMPTY;
    throw error;
  }
  return Array.isArray(data) ? data.map(normalizeCapability).filter(Boolean) : EMPTY;
}

/**
 * Capabilities the signed-in user holds in their working organization.
 * Returns { capabilities: string[], has(cap), loading, refetch }. Never throws; errors read as [].
 */
export function useOrgCapabilities() {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const orgId = user?.activeOrganizationId ?? user?.organizationId ?? null;

  const query = useQuery({
    queryKey: ["org-capabilities", userId, orgId],
    queryFn: fetchMyOrgCapabilities,
    enabled: Boolean(userId),
    staleTime: 60_000,
    retry: false,
  });

  const capabilities = query.isError || !query.data ? EMPTY : query.data;
  const has = useCallback((cap) => hasCapability(capabilities, cap), [capabilities]);

  return {
    capabilities,
    has,
    loading: Boolean(userId) && query.isLoading,
    refetch: query.refetch,
  };
}

export default useOrgCapabilities;
