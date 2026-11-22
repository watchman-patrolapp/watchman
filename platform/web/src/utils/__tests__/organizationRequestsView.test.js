import test from "node:test";
import assert from "node:assert/strict";
import {
  requestBannerCopy,
  requestPeople,
  requestSummary,
  requestedRoleLabel,
  sortRequests,
} from "../organizationRequestsView.js";

test("request summary says what kind of request it is and where", () => {
  assert.equal(
    requestSummary({ kind: "new", type: "nw_group", review_state: "requested", watch_area: "Lorraine", city: "Gqeberha (Port Elizabeth)" }),
    "New neighbourhood watch · Lorraine · Gqeberha (Port Elizabeth)"
  );
  assert.equal(requestSummary({ kind: "join", name: "Fidelity", type: "security_company" }), "Admin request to join Fidelity");
  assert.match(requestSummary({ kind: "new", type: "security_company" }), /set up before requests were reviewed/);
  assert.equal(requestSummary(null), "");
});

test("people list drops empty rows; role labels are plain", () => {
  assert.deepEqual(requestPeople({ people: [{ user_id: "a" }, null, {}] }), [{ user_id: "a" }]);
  assert.deepEqual(requestPeople({}), []);
  assert.equal(requestedRoleLabel("nw_admin"), "Watch admin");
  assert.equal(requestedRoleLabel("security_admin"), "Security company admin");
  assert.equal(requestedRoleLabel("other"), "Admin");
});

test("new requests come first, then join requests, then older pending orgs", () => {
  const sorted = sortRequests([
    { name: "old", kind: "new", requested_at: "2026-11-01" },
    { name: "join", kind: "join", requested_at: "2026-11-20" },
    { name: "new-a", kind: "new", review_state: "requested", requested_at: "2026-11-10" },
    { name: "new-b", kind: "new", review_state: "requested", requested_at: "2026-11-21" },
  ]).map((x) => x.name);
  assert.deepEqual(sorted, ["new-b", "new-a", "join", "old"]);
});

test("requester banner copy", () => {
  const pending = requestBannerCopy({ name: "Lorraine Watch", requested_role: "nw_admin", state: "pending" });
  assert.equal(pending.tone, "info");
  assert.match(pending.title, /neighbourhood watch request is being reviewed/);
  assert.match(pending.body, /Admin tools unlock once it's approved/);
  const declined = requestBannerCopy({ name: "Acme", requested_role: "security_admin", state: "not_approved" });
  assert.equal(declined.tone, "warn");
  assert.match(declined.title, /security company request wasn't approved/);
  assert.equal(requestBannerCopy({ name: "x", state: "approved" }), null);
  assert.equal(requestBannerCopy(null), null);
});
