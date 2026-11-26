// Pure helpers for organisation sign-up requests (watch and security company admins).

export const ORG_TYPE_LABELS = {
  nw_group: "Neighbourhood watch",
  security_company: "Security company",
};

export const REQUESTED_ROLE_LABELS = {
  nw_admin: "Watch admin",
  security_admin: "Security company admin",
  committee: "Committee",
  resident: "Resident",
  patroller: "Patroller",
};

/** Residents and patrollers waiting to join a watch are reviewed with review_watch_join, not approve_organization. */
export function isMemberJoinPerson(person) {
  return person?.member_role === "resident" || person?.member_role === "patroller";
}

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
  else if (item.source === "suburb_request") bits.push("New suburb and watch");
  else if (item.review_state === "requested") bits.push(`New ${orgTypeLabel(item.type).toLowerCase()}`);
  else bits.push(`${orgTypeLabel(item.type)} waiting for approval (set up before requests were reviewed)`);
  const area = item.suburb || item.watch_area || item.coverage_area;
  if (area) bits.push(area);
  const where = [item.city, item.province].filter(Boolean).join(", ");
  if (where) bits.push(where);
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
  if (request.state === "merged") {
    const into = request.merged_into || "an existing watch";
    return {
      tone: "info",
      title: `Your request was joined to ${into}`,
      body: `“${request.name}” is already covered by ${into}. Its watch admins will confirm you as a member.`,
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

// ---------------------------------------------------------------------------
// SA places P5: suburb requests, possible duplicates and merging
// ---------------------------------------------------------------------------

const DUPLICATE_REASONS = {
  same_suburb: "Same suburb",
  similar_suburb: "Similar suburb name",
  similar_name: "Similar watch name",
};

export function duplicateReasonLabel(reason) {
  return DUPLICATE_REASONS[reason] || "Looks similar";
}

/** Possible duplicates for a request: [{ id, name, suburb, reason }], broken rows dropped. */
export function requestDuplicates(item) {
  const rows = Array.isArray(item?.possible_duplicates) ? item.possible_duplicates : [];
  return rows
    .filter((d) => d && d.organization_id && d.name)
    .map((d) => ({ id: d.organization_id, name: d.name, suburb: d.suburb || "", reason: d.reason || "" }));
}

/** Only new watch requests with a known city can be merged into another watch. */
export function canMergeRequest(item) {
  return Boolean(item && item.kind === "new" && item.type === "nw_group" && item.city_id);
}

const SUBURB_STATUS = {
  requested: "new suburb, waiting",
  active: "existing suburb",
  merged: "merged",
  rejected: "not approved",
};

/** "Lorraine Park (new suburb, waiting)" for the request card. */
export function requestSuburbLine(item) {
  if (!item?.suburb) return "";
  const state = SUBURB_STATUS[item.suburb_status];
  return state ? `${item.suburb} (${state})` : item.suburb;
}

function key(text) {
  return String(text ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Watches the reviewer can merge into: approved watches in the request's city, minus the request
 * itself, possible duplicates first, then by suburb / name; filtered by the typed text.
 */
export function mergeTargetOptions(watches, item, filter = "") {
  const list = Array.isArray(watches) ? watches : [];
  const dupRank = new Map(requestDuplicates(item).map((d, i) => [d.id, i]));
  const k = key(filter);
  return list
    .filter((w) => w && w.organization_id && w.name && w.organization_id !== item?.organization_id)
    .map((w) => ({ id: w.organization_id, name: w.name, suburb: w.suburb || "", likely: dupRank.has(w.organization_id) }))
    .filter((w) => !k || key(`${w.name} ${w.suburb}`).includes(k))
    .sort((a, b) => {
      const ra = dupRank.has(a.id) ? dupRank.get(a.id) : Infinity;
      const rb = dupRank.has(b.id) ? dupRank.get(b.id) : Infinity;
      if (ra !== rb) return ra - rb;
      return key(a.suburb || a.name).localeCompare(key(b.suburb || b.name)) || key(a.name).localeCompare(key(b.name));
    });
}

/** Text for the confirm box before merging. */
export function mergeConfirmText(item, target) {
  const people = Array.isArray(item?.people) ? item.people.filter((p) => p && p.user_id) : [];
  const who = people.length === 1 ? people[0].name || "The requester" : people.length ? `${people.length} requesters` : "Nobody";
  const verb = people.length > 1 ? "join" : "joins";
  const area = item?.suburb || item?.watch_area;
  return [
    `Merge “${item?.name || "this request"}” into ${target?.name || "the chosen watch"}?`,
    `${who} ${verb} ${target?.name || "that watch"} as a waiting member; its watch admins approve them.`,
    area ? `“${area}” is saved as another spelling of ${target?.suburb || "that watch's suburb"}.` : "",
    "The duplicate request is closed.",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Toast after a merge. */
export function mergeResultMessage(result) {
  const into = result?.into_name || "the watch";
  const moved = Number(result?.moved) || 0;
  const busy = Number(result?.already_in_other_watch) || 0;
  let text = `Merged into ${into}.`;
  if (moved === 1) text += " 1 person is waiting for its watch admins to approve them.";
  else if (moved > 1) text += ` ${moved} people are waiting for its watch admins to approve them.`;
  if (busy === 1) text += " 1 requester had already joined another watch and was left there.";
  else if (busy > 1) text += ` ${busy} requesters had already joined other watches and were left there.`;
  return text;
}

/** One line for a person waiting to join a watch. */
export function joinRequestNote(person) {
  const role = requestedRoleLabel(person?.member_role);
  return person?.from_request ? `${role} · asked for “${person.from_request}”` : `${role} · asked to join`;
}
