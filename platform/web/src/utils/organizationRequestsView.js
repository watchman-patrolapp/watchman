// Pure helpers for organisation sign-up requests (watch and security company admins).

export const ORG_TYPE_LABELS = {
  nw_group: "Neighbourhood watch",
  security_company: "Security company",
};

export const REQUESTED_ROLE_LABELS = {
  nw_admin: "Watch admin",
  security_admin: "Security company admin",
  committee: "Committee",
};

export function orgTypeLabel(type) {
  return ORG_TYPE_LABELS[type] || "Organisation";
}

export function requestedRoleLabel(role) {
  return REQUESTED_ROLE_LABELS[role] || "Admin";
}

/** One line under the request title: what kind of request and where. */
export function requestSummary(item) {
  if (!item) return "";
  const bits = [];
  if (item.kind === "join") bits.push(`Admin request to join ${item.name || "this organisation"}`);
  else if (item.review_state === "requested") bits.push(`New ${orgTypeLabel(item.type).toLowerCase()}`);
  else bits.push(`${orgTypeLabel(item.type)} waiting for approval (set up before requests were reviewed)`);
  const area = item.watch_area || item.coverage_area;
  if (area) bits.push(area);
  if (item.city) bits.push(item.city);
  return bits.join(" · ");
}

/** Only the pending people (or everyone listed for older pending orgs). */
export function requestPeople(item) {
  const people = Array.isArray(item?.people) ? item.people : [];
  return people.filter((p) => p && p.user_id);
}

export function sortRequests(items) {
  const list = Array.isArray(items) ? [...items] : [];
  const rank = (x) => (x.kind === "join" ? 1 : x.review_state === "requested" ? 0 : 2);
  return list.sort((a, b) => rank(a) - rank(b) || String(b.requested_at || "").localeCompare(String(a.requested_at || "")));
}

/** Copy for the requester's own banner. Returns null when there is nothing to show. */
export function requestBannerCopy(request) {
  if (!request || !request.name) return null;
  const role = request.requested_role === "security_admin" ? "security company" : "neighbourhood watch";
  if (request.state === "pending") {
    return {
      tone: "info",
      title: `Your ${role} request is being reviewed`,
      body: `We're checking “${request.name}”. Admin tools unlock once it's approved. You can use the app as a resident in the meantime.`,
    };
  }
  if (request.state === "not_approved") {
    return {
      tone: "warn",
      title: `Your ${role} request wasn't approved`,
      body: `“${request.name}” wasn't approved. If you think this is a mistake, contact Watchman support.`,
    };
  }
  return null;
}
