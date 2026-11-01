import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../supabase/client";
import { isGlobalOperatorUser } from "./roleMatrix";
import { useAuth } from "./useAuth";
import { ActiveOrganizationContext } from "./ActiveOrganizationContext";
import {
  readStoredActiveOrganizationId,
  writeStoredActiveOrganizationId,
} from "./activeOrganizationStorage";
import { setWorkingOrganization } from "../utils/organizationScope";

export function ActiveOrganizationProvider({ children }) {
  const { user, sessionReady } = useAuth();
  const [organizations, setOrganizations] = useState([]);
  const [activeOrganizationId, setActiveOrganizationIdState] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadedKey, setLoadedKey] = useState(null);

  const isGlobalOperator = isGlobalOperatorUser(user);
  const profileLoaded = Boolean(user?.profileLoaded);
  const requestKey = user?.id
    ? `${user.id}|${isGlobalOperator}|${user.organizationId || ""}|${user.activeOrganizationId || ""}`
    : "";

  const refreshOrganizations = useCallback(async ({ silent = false } = {}) => {
    if (!user?.id) {
      setOrganizations([]);
      setActiveOrganizationIdState("");
      setLoading(false);
      setLoadedKey("");
      return;
    }

    if (!silent) setLoading(true);
    try {
      const { data, error } = await supabase
        .from("organizations")
        .select("id, name, type, status")
        .eq("type", "nw_group")
        .neq("status", "suspended")
        .order("name");
      if (error) throw error;
      const orgs = data || [];
      setOrganizations(orgs);

      if (isGlobalOperator) {
        const fromProfile = user.activeOrganizationId;
        const stored = readStoredActiveOrganizationId(user.id);
        const candidate = orgs.some((org) => org.id === fromProfile)
          ? fromProfile
          : orgs.some((org) => org.id === stored)
            ? stored
            : "";
        setActiveOrganizationIdState(candidate);
        if (!candidate && stored) {
          writeStoredActiveOrganizationId(user.id, "");
        }
      } else {
        setActiveOrganizationIdState(user.organizationId || "");
      }
    } catch (err) {
      console.error(err);
      if (!isGlobalOperator) {
        setActiveOrganizationIdState(user.organizationId || "");
      }
    } finally {
      setLoading(false);
      setLoadedKey(requestKey);
    }
  }, [user?.id, user?.organizationId, user?.activeOrganizationId, isGlobalOperator, requestKey]);

  useEffect(() => {
    if (!sessionReady) return undefined;
    if (user?.id && !profileLoaded) return undefined;
    void refreshOrganizations();
  }, [sessionReady, profileLoaded, user?.id, refreshOrganizations]);

  // Stay "loading" until the orgs were resolved for the current profile, so guards never
  // see a stale empty area for one render (that sent deep links to /choose-area).
  const settling = Boolean(user?.id) && (!profileLoaded || loadedKey !== requestKey);

  const setActiveOrganizationId = useCallback(
    async (organizationId) => {
      const next = organizationId || "";
      setActiveOrganizationIdState(next);
      if (isGlobalOperator && user?.id) {
        writeStoredActiveOrganizationId(user.id, next);
        const { error } = await supabase.rpc("set_active_organization", {
          p_organization_id: next || null,
        });
        if (error && !String(error.message || "").includes("Could not find the function")) {
          console.error(error);
        }
      }
    },
    [isGlobalOperator, user?.id]
  );

  const activeOrganization = useMemo(
    () => organizations.find((org) => org.id === activeOrganizationId) || null,
    [organizations, activeOrganizationId]
  );

  useEffect(() => {
    setWorkingOrganization(activeOrganization);
  }, [activeOrganization]);

  const value = useMemo(
    () => ({
      organizations,
      activeOrganizationId: activeOrganizationId || null,
      activeOrganization,
      setActiveOrganizationId,
      refreshOrganizations,
      isGlobalOperator,
      needsAreaSelection: Boolean(isGlobalOperator && !activeOrganizationId),
      loading: loading || settling,
    }),
    [
      organizations,
      activeOrganizationId,
      activeOrganization,
      setActiveOrganizationId,
      refreshOrganizations,
      isGlobalOperator,
      loading,
      settling,
    ]
  );

  return (
    <ActiveOrganizationContext.Provider value={value}>{children}</ActiveOrganizationContext.Provider>
  );
}
