import { supabase } from "../supabase/client";

export function membershipRpcMessage(err) {
  const raw = String(err?.message || err?.details || "").toLowerCase();
  if (raw.includes("transfer_required")) {
    return "You already have a security company. Use Transfer instead of choosing another one.";
  }
  if (raw.includes("transfer_cooldown")) {
    return "You can transfer again 30 days after your last transfer.";
  }
  if (raw.includes("already_with_company")) {
    return "You are already with that company.";
  }
  if (raw.includes("cannot withdraw")) {
    return "Only a pending claim can be withdrawn.";
  }
  if (raw.includes("only pending")) {
    return "Only pending claims can be verified or rejected.";
  }
  if (raw.includes("expire verified")) {
    return "Verified clients cannot be deleted. Expire them instead.";
  }
  return err?.message || "Could not update security membership.";
}

export function isActiveMembership(row) {
  const s = String(row?.membership_status || "");
  return s === "self_reported" || s === "verified";
}

export async function claimSecurityCompany(companyId, memberReference) {
  return supabase.rpc("claim_security_company", {
    p_company_id: companyId,
    p_member_reference: memberReference || null,
  });
}

export async function withdrawSecurityMembership(membershipId) {
  return supabase.rpc("withdraw_security_membership", {
    p_membership_id: membershipId,
  });
}

export async function transferSecurityMembership(toCompanyId, memberReference, notes) {
  return supabase.rpc("transfer_security_membership", {
    p_to_company_id: toCompanyId,
    p_member_reference: memberReference || null,
    p_notes: notes || null,
  });
}

export async function reviewSecurityMembership(membershipId, status, notes) {
  return supabase.rpc("review_security_membership", {
    p_membership_id: membershipId,
    p_status: status,
    p_notes: notes || null,
  });
}

export async function deleteSecurityMembershipClaim(membershipId) {
  return supabase.rpc("delete_security_membership_claim", {
    p_membership_id: membershipId,
  });
}

export async function listSecurityMembershipClaims(queue = "pending", mineOnly = false) {
  return supabase.rpc("list_security_membership_claims", {
    p_queue: queue,
    p_mine_only: mineOnly,
  });
}

export async function listSecurityMembershipEvents(mineOnly = false) {
  return supabase.rpc("list_security_membership_events", {
    p_mine_only: mineOnly,
  });
}
