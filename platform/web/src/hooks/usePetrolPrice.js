import { useCallback, useEffect, useState } from "react";
import { supabase } from "../supabase/client";
import { useAuth } from "../auth/useAuth";
import { canSetAreaPetrolPrice } from "../auth/roleMatrix";
import { isRpcNotFoundError } from "../utils/isRpcNotFound";
import {
  clampPetrolPrice,
  DEFAULT_PETROL_ZAR_PER_LITRE,
} from "../utils/patrolFuelEstimate";

function storageKey(organizationId) {
  return `nw-petrol-price:${organizationId || "local"}`;
}

function readLocal(organizationId) {
  try {
    const raw = localStorage.getItem(storageKey(organizationId));
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? clampPetrolPrice(n) : null;
  } catch {
    return null;
  }
}

function writeLocal(organizationId, price) {
  try {
    localStorage.setItem(storageKey(organizationId), String(clampPetrolPrice(price)));
  } catch {
    /* ignore quota */
  }
}

function saveErrorMessage(error) {
  const msg = String(error?.message || error || "").toLowerCase();
  const code = String(error?.code || "");
  if (!msg || msg === "false") return "Could not save the neighbourhood price.";
  if (
    isRpcNotFoundError(error)
    || code === "PGRST205"
    || msg.includes("schema cache")
    || msg.includes("does not exist")
    || msg.includes("could not find the table")
  ) {
    return "The neighbourhood price table is not on the server yet. Apply the latest Supabase migration, then try again.";
  }
  if (msg.includes("not allowed") || msg.includes("permission") || msg.includes("rls") || msg.includes("42501")) {
    return "Your role cannot publish the neighbourhood pump price. The slider still applies on this device.";
  }
  if (msg.includes("out of scope") || msg.includes("organization required")) {
    return "Choose a neighbourhood first, then save the pump price.";
  }
  return error?.message || "Could not save the neighbourhood price.";
}

async function upsertViaTable(organizationId, price, userId) {
  const payload = {
    organization_id: organizationId,
    price_zar_per_litre: clampPetrolPrice(price),
    updated_at: new Date().toISOString(),
  };
  if (userId) payload.updated_by = userId;
  const { data, error } = await supabase
    .from("organization_petrol_price")
    .upsert(payload, { onConflict: "organization_id" })
    .select("price_zar_per_litre")
    .maybeSingle();
  return { data: data?.price_zar_per_litre ?? price, error };
}

export function usePetrolPrice(organizationId) {
  const { user } = useAuth();
  const canSaveArea = canSetAreaPetrolPrice(user?.role, user?.platformRole);
  const [price, setPriceState] = useState(DEFAULT_PETROL_ZAR_PER_LITRE);
  const [saving, setSaving] = useState(false);
  const [areaPrice, setAreaPrice] = useState(null);

  useEffect(() => {
    let ignore = false;
    const local = readLocal(organizationId);
    if (local != null) setPriceState(local);

    (async () => {
      if (!organizationId) return;
      try {
        const { data, error } = await supabase
          .from("organization_petrol_price")
          .select("price_zar_per_litre")
          .eq("organization_id", organizationId)
          .maybeSingle();
        if (ignore || error) return;
        const next = data?.price_zar_per_litre != null
          ? clampPetrolPrice(data.price_zar_per_litre)
          : null;
        if (next == null) return;
        setAreaPrice(next);
        if (local == null) setPriceState(next);
      } catch {
        /* table may not exist yet */
      }
    })();

    return () => {
      ignore = true;
    };
  }, [organizationId]);

  const setPrice = useCallback((value) => {
    const next = clampPetrolPrice(value);
    setPriceState(next);
    writeLocal(organizationId, next);
  }, [organizationId]);

  const saveArea = useCallback(async () => {
    if (!organizationId || organizationId === "00000000-0000-0000-0000-000000000000") {
      return { ok: false, message: "Choose a neighbourhood first, then save the pump price." };
    }
    if (!canSaveArea) {
      return { ok: false, message: "Your role cannot publish the neighbourhood pump price." };
    }
    setSaving(true);
    try {
      let saved = null;
      const rpc = await supabase.rpc("upsert_organization_petrol_price", {
        p_organization_id: organizationId,
        p_price: clampPetrolPrice(price),
      });
      if (!rpc.error && rpc.data != null) {
        saved = clampPetrolPrice(rpc.data);
      } else {
        const table = await upsertViaTable(organizationId, price, user?.id);
        if (table.error) {
          const failed = rpc.error && !isRpcNotFoundError(rpc.error) ? rpc.error : table.error;
          return { ok: false, message: saveErrorMessage(failed) };
        }
        saved = clampPetrolPrice(table.data);
      }
      setAreaPrice(saved);
      setPriceState(saved);
      writeLocal(organizationId, saved);
      return { ok: true };
    } catch (err) {
      return { ok: false, message: saveErrorMessage(err) };
    } finally {
      setSaving(false);
    }
  }, [organizationId, canSaveArea, price, user?.id]);

  return { price, setPrice, saveArea, canSaveArea, saving, areaPrice };
}
