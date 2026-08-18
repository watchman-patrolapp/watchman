import { supabase } from "../supabase/client";

const NESTED_SELECT = `
  *,
  organizations!security_company_id (
    name,
    security_company_branding (*)
  )
`;

const ORG_SELECT = `
  *,
  organizations!security_company_id (name)
`;

function firstRelated(value) {
  if (Array.isArray(value)) return value[0] || null;
  return value || null;
}

export function shapeSecurityMembershipRow(row) {
  if (!row) return null;
  const org = firstRelated(row.organizations);
  const branding =
    firstRelated(row.security_company_branding) ||
    firstRelated(org?.security_company_branding) ||
    null;
  return {
    ...row,
    organizations: org ? { name: org.name } : org,
    security_company_branding: branding,
  };
}

async function hydrateMemberships(rows) {
  const list = (rows || []).filter(Boolean);
  const companyIds = [
    ...new Set(list.map((row) => row.security_company_id).filter(Boolean)),
  ];
  const needsOrg = list.some((row) => !firstRelated(row.organizations)?.name);
  const needsBrand = list.some((row) => {
    const org = firstRelated(row.organizations);
    return !(
      firstRelated(row.security_company_branding) ||
      firstRelated(org?.security_company_branding)
    );
  });

  if (!companyIds.length || (!needsOrg && !needsBrand)) {
    return list.map(shapeSecurityMembershipRow);
  }

  const [{ data: orgs }, { data: brands }] = await Promise.all([
    needsOrg
      ? supabase.from("organizations").select("id, name").in("id", companyIds)
      : Promise.resolve({ data: [] }),
    needsBrand
      ? supabase.from("security_company_branding").select("*").in("security_company_id", companyIds)
      : Promise.resolve({ data: [] }),
  ]);

  const orgById = Object.fromEntries((orgs || []).map((org) => [org.id, org]));
  const brandById = Object.fromEntries(
    (brands || []).map((brand) => [brand.security_company_id, brand])
  );

  return list.map((row) =>
    shapeSecurityMembershipRow({
      ...row,
      organizations:
        firstRelated(row.organizations) ||
        (orgById[row.security_company_id]
          ? { name: orgById[row.security_company_id].name }
          : row.organizations),
      security_company_branding:
        firstRelated(row.security_company_branding) ||
        brandById[row.security_company_id] ||
        null,
    })
  );
}

function applyMembershipFilters(query, { residentUserId, securityCompanyId, limit }) {
  let next = query.order("updated_at", { ascending: false }).limit(limit);
  if (residentUserId) next = next.eq("resident_user_id", residentUserId);
  if (securityCompanyId) next = next.eq("security_company_id", securityCompanyId);
  return next;
}

export async function fetchResidentSecurityMemberships({
  residentUserId,
  securityCompanyId,
  limit = 100,
} = {}) {
  const attempts = [NESTED_SELECT, ORG_SELECT, "*"];
  let lastError = null;

  for (const select of attempts) {
    const { data, error } = await applyMembershipFilters(
      supabase.from("resident_security_memberships").select(select),
      { residentUserId, securityCompanyId, limit }
    );
    if (!error) {
      return { data: await hydrateMemberships(data || []), error: null };
    }
    lastError = error;
  }

  return { data: [], error: lastError };
}
