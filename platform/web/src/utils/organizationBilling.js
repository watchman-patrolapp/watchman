import { supabase } from "../supabase/client";
import { parsePatrolTime } from "./watchTime";

/** Fallback defaults when the admin catalog has not been loaded yet. */
export const TRIAL_MONTHS = 2;
export const SMALL_ORG_USER_LIMIT = 10;
export const ANNUAL_FEE_UNDER_LIMIT_ZAR = 2500;
export const ANNUAL_FEE_AT_OR_ABOVE_LIMIT_ZAR = 3500;
export const SECURITY_ANNUAL_FEE_UNDER_LIMIT_ZAR = 15000;
export const SECURITY_ANNUAL_FEE_AT_OR_ABOVE_LIMIT_ZAR = 25000;

export const DEFAULT_BILLING_CATALOG = {
  nw_under_limit_zar: ANNUAL_FEE_UNDER_LIMIT_ZAR,
  nw_at_or_above_limit_zar: ANNUAL_FEE_AT_OR_ABOVE_LIMIT_ZAR,
  security_under_limit_zar: SECURITY_ANNUAL_FEE_UNDER_LIMIT_ZAR,
  security_at_or_above_limit_zar: SECURITY_ANNUAL_FEE_AT_OR_ABOVE_LIMIT_ZAR,
  small_org_user_limit: SMALL_ORG_USER_LIMIT,
  trial_months: TRIAL_MONTHS,
};

export function isSecurityCompanyType(orgType) {
  return String(orgType || "").toLowerCase() === "security_company";
}

export function feeUserNoun(orgType, count = 0) {
  const n = Number(count) || 0;
  if (isSecurityCompanyType(orgType)) {
    return n === 1 ? "operator" : "operators";
  }
  return n === 1 ? "user" : "users";
}

function positiveInt(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.round(n);
}

export function normalizeBillingCatalog(row) {
  return {
    nw_under_limit_zar: positiveInt(row?.nw_under_limit_zar, ANNUAL_FEE_UNDER_LIMIT_ZAR),
    nw_at_or_above_limit_zar: positiveInt(row?.nw_at_or_above_limit_zar, ANNUAL_FEE_AT_OR_ABOVE_LIMIT_ZAR),
    security_under_limit_zar: positiveInt(row?.security_under_limit_zar, SECURITY_ANNUAL_FEE_UNDER_LIMIT_ZAR),
    security_at_or_above_limit_zar: positiveInt(
      row?.security_at_or_above_limit_zar,
      SECURITY_ANNUAL_FEE_AT_OR_ABOVE_LIMIT_ZAR
    ),
    small_org_user_limit: Math.max(1, positiveInt(row?.small_org_user_limit, SMALL_ORG_USER_LIMIT)),
    trial_months: positiveInt(row?.trial_months, TRIAL_MONTHS),
  };
}

export function parseListPriceZar(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n);
}

export async function loadBillingCatalog() {
  const { data, error } = await supabase
    .from("platform_billing_catalog")
    .select("*")
    .eq("id", "default")
    .maybeSingle();
  if (error) {
    console.warn("Billing catalog:", error.message);
    return { ...DEFAULT_BILLING_CATALOG };
  }
  return normalizeBillingCatalog(data || DEFAULT_BILLING_CATALOG);
}

export function suggestedAnnualFeeZar(
  memberCount = 0,
  orgType = "nw_group",
  catalog = DEFAULT_BILLING_CATALOG,
  customFeeZar = null
) {
  const custom = parseListPriceZar(customFeeZar);
  if (custom != null) return custom;
  const rates = normalizeBillingCatalog(catalog);
  const count = Number(memberCount) || 0;
  const commercial = isSecurityCompanyType(orgType);
  if (count < rates.small_org_user_limit) {
    return commercial ? rates.security_under_limit_zar : rates.nw_under_limit_zar;
  }
  return commercial ? rates.security_at_or_above_limit_zar : rates.nw_at_or_above_limit_zar;
}

export function annualFeeScheduleCopy(orgType = "nw_group", catalog = DEFAULT_BILLING_CATALOG) {
  const rates = normalizeBillingCatalog(catalog);
  const under = suggestedAnnualFeeZar(0, orgType, rates);
  const over = suggestedAnnualFeeZar(rates.small_org_user_limit, orgType, rates);
  const noun = feeUserNoun(orgType, 2);
  const label = isSecurityCompanyType(orgType) ? "Security companies" : "Neighborhood watches";
  return `${label}: ${rates.trial_months} months free, then R${under}/year under ${rates.small_org_user_limit} ${noun}, or R${over}/year for ${rates.small_org_user_limit}+ ${noun}.`;
}

export function getTrialEndsAt(createdAt, trialMonths = TRIAL_MONTHS) {
  const start =
    createdAt instanceof Date
      ? createdAt
      : parsePatrolTime(createdAt) || new Date(createdAt);
  if (!start || Number.isNaN(start.getTime())) return null;
  const months = Math.max(0, Number(trialMonths) || TRIAL_MONTHS);
  const end = new Date(start.getTime());
  end.setMonth(end.getMonth() + months);
  return end;
}

export function daysUntil(date) {
  if (!date) return 0;
  const ms = date.getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / 86400000));
}

/**
 * Display-only subscription summary. `pending` during the trial window is shown as trial.
 */
export function getOrganizationSubscriptionView({
  createdAt,
  annualFeeStatus,
  memberCount = 0,
  orgType = "nw_group",
  catalog = DEFAULT_BILLING_CATALOG,
  customAnnualFeeZar = null,
} = {}) {
  const rates = normalizeBillingCatalog(catalog);
  const fee = suggestedAnnualFeeZar(memberCount, orgType, rates, customAnnualFeeZar);
  const custom = parseListPriceZar(customAnnualFeeZar) != null;
  const status = String(annualFeeStatus || "pending").toLowerCase();
  const trialEndsAt = getTrialEndsAt(createdAt, rates.trial_months);
  const inTrial = Boolean(trialEndsAt && Date.now() < trialEndsAt.getTime());
  const trialDaysLeft = daysUntil(trialEndsAt);
  const userLabel = `${memberCount} ${feeUserNoun(orgType, memberCount)}`;
  const priceLabel = custom ? `R${fee}/year (set price)` : `R${fee}/year`;

  if (status === "waived") {
    return {
      key: "waived",
      badge: "Subscription: waived",
      detail: `No charge. List price ${priceLabel} · ${userLabel}.`,
      amountZar: fee,
      inTrial: false,
    };
  }
  if (status === "paid") {
    return {
      key: "paid",
      badge: "Subscription: paid",
      detail: `${priceLabel} · ${userLabel}.`,
      amountZar: fee,
      inTrial: false,
    };
  }
  if (status === "overdue") {
    return {
      key: "overdue",
      badge: "Subscription: overdue",
      detail: `${priceLabel} due · ${userLabel}.`,
      amountZar: fee,
      inTrial: false,
    };
  }
  if (inTrial) {
    return {
      key: "trial",
      badge: "Subscription: trial",
      detail: `${trialDaysLeft} day${trialDaysLeft === 1 ? "" : "s"} free left, then ${priceLabel} · ${userLabel}.`,
      amountZar: fee,
      inTrial: true,
      trialDaysLeft,
    };
  }
  return {
    key: "due",
    badge: "Subscription: due",
    detail: `${priceLabel} now due · ${userLabel}.`,
    amountZar: fee,
    inTrial: false,
  };
}

export function countLocalMembersByOrg(rows = [], globalUserIds = new Set()) {
  return rows.reduce((acc, row) => {
    if (!row?.organization_id) return acc;
    if (row.user_id && globalUserIds.has(row.user_id)) return acc;
    acc[row.organization_id] = (acc[row.organization_id] || 0) + 1;
    return acc;
  }, {});
}

export function subscriptionBadgeClass(key) {
  if (key === "paid" || key === "waived") {
    return "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200";
  }
  if (key === "trial") {
    return "bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-200";
  }
  if (key === "overdue" || key === "due") {
    return "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200";
  }
  return "bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200";
}
