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

  const isGlobalOperator = isGlobalOperatorUser(user);

  const refreshOrganizations = useCallback(async ({ silent = false } = {}) => {
    if (!user?.id) {
      setOrganizations([]);
      setActiveOrganizationIdState("");
      setLoading(false);
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
    }
  }, [user?.id, user?.organizationId, user?.activeOrganizationId, isGlobalOperator]);

  useEffect(() => {
    if (!sessionReady) return undefined;
    void refreshOrganizations();
  }, [sessionReady, refreshOrganizations]);

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
      loading,
    }),
    [
      organizations,
      activeOrganizationId,
      activeOrganization,
      setActiveOrganizationId,
      refreshOrganizations,
      isGlobalOperator,
      loading,
    ]
  );

  return (
    <ActiveOrganizationContext.Provider value={value}>{children}</ActiveOrganizationContext.Provider>
  );
}
