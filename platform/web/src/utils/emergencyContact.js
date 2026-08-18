import { supabase } from "../supabase/client";
import { isRpcNotFoundError } from "./isRpcNotFound";

export const EMERGENCY_CONTACT_RELATIONSHIPS = [
  { value: "spouse", label: "Spouse / partner" },
  { value: "parent", label: "Parent" },
  { value: "child", label: "Child" },
  { value: "sibling", label: "Sibling" },
  { value: "in_law", label: "In-law" },
  { value: "family", label: "Family" },
  { value: "neighbour", label: "Neighbour" },
  { value: "friend", label: "Friend" },
  { value: "other", label: "Other" },
];

export function emergencyContactRelationshipLabel(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const key = raw.toLowerCase().replace(/[\s-]+/g, "_");
  return EMERGENCY_CONTACT_RELATIONSHIPS.find((row) => row.value === key)?.label || raw;
}

export function formatEmergencyContact(name, phone, relationship) {
  const n = String(name || "").trim();
  const p = String(phone || "").trim();
  const r = emergencyContactRelationshipLabel(relationship);
  const parts = [n, r, p].filter(Boolean);
  return parts.join(" · ");
}

/** Prefer the linked neighbour’s live name/phone when they are in the loaded user list. */
export function resolveEmergencyContact(row, usersById = {}) {
  const linkedId = row?.emergencyContactUserId || "";
  const linked = linkedId ? usersById[linkedId] : null;
  const name = String(linked?.fullName || row?.emergencyContactName || "").trim();
  const phone = String(linked?.phone || row?.emergencyContactPhone || "").trim();
  const storedRelationship = String(row?.emergencyContactRelationship || "").trim();
  const relationship = storedRelationship || (linkedId ? "neighbour" : "");
  return {
    name,
    phone,
    relationship,
    relationshipLabel: emergencyContactRelationshipLabel(relationship),
    label: formatEmergencyContact(name, phone, relationship),
    linked: Boolean(linkedId),
  };
}

export function resolveEmergencyContacts(row, usersById = {}) {
  return {
    primary: resolveEmergencyContact(
      {
        emergencyContactUserId: row?.emergencyContactUserId,
        emergencyContactName: row?.emergencyContactName,
        emergencyContactPhone: row?.emergencyContactPhone,
        emergencyContactRelationship: row?.emergencyContactRelationship,
      },
      usersById
    ),
    backup: resolveEmergencyContact(
      {
        emergencyContactUserId: row?.emergencyContact2UserId,
        emergencyContactName: row?.emergencyContact2Name,
        emergencyContactPhone: row?.emergencyContact2Phone,
        emergencyContactRelationship: row?.emergencyContact2Relationship,
      },
      usersById
    ),
  };
}

export async function listEmergencyContactCandidates() {
  const { data, error } = await supabase.rpc("list_emergency_contact_candidates");
  if (error) {
    if (!isRpcNotFoundError(error)) {
      console.warn("list_emergency_contact_candidates:", error.message);
    }
    return { data: [], error };
  }
  return { data: Array.isArray(data) ? data : [], error: null };
}

export async function listNeighborhoodNextOfKin() {
  const { data, error } = await supabase.rpc("list_neighborhood_next_of_kin");
  if (error) {
    if (!isRpcNotFoundError(error)) {
      console.warn("list_neighborhood_next_of_kin:", error.message);
    }
    return { data: [], error };
  }
  return { data: Array.isArray(data) ? data : [], error: null };
}

export async function setMyEmergencyContact({
  contactUserId = null,
  name = "",
  phone = "",
  relationship = "",
  clear = false,
  slot = 1,
} = {}) {
  const args = {
    p_contact_user_id: contactUserId || null,
    p_name: name || null,
    p_phone: phone || null,
    p_clear: Boolean(clear),
    p_relationship: relationship || null,
    p_slot: Number(slot) === 2 ? 2 : 1,
  };
  const first = await supabase.rpc("set_my_emergency_contact", args);
  if (!first.error || !isRpcNotFoundError(first.error)) return first;
  const { p_slot: _slot, ...withoutSlot } = args;
  const second = await supabase.rpc("set_my_emergency_contact", withoutSlot);
  if (!second.error || !isRpcNotFoundError(second.error) || Number(slot) === 2) return second;
  const { p_relationship: _ignored, ...withoutRelationship } = withoutSlot;
  return supabase.rpc("set_my_emergency_contact", withoutRelationship);
}
