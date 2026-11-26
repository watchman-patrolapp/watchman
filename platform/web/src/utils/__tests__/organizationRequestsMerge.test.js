import test from "node:test";
import assert from "node:assert/strict";
import {
  canMergeRequest,
  duplicateReasonLabel,
  isMemberJoinPerson,
  joinRequestNote,
  mergeConfirmText,
  mergeResultMessage,
  mergeTargetOptions,
  requestBannerCopy,
  requestDuplicates,
  requestSuburbLine,
  requestSummary,
  requestedRoleLabel,
} from "../organizationRequestsView.js";

const request = {
  kind: "new",
  type: "nw_group",
  organization_id: "req-1",
  name: "Theescomb Neighbourhood Watch",
  source: "suburb_request",
  city: "Gqeberha",
  city_id: "c1",
  province: "Eastern Cape",
  suburb: "Theescomb",
  suburb_status: "requested",
  people: [{ user_id: "u4", name: "Res D", member_role: "resident", membership_status: "pending" }],
  possible_duplicates: [
    { organization_id: "o1", name: "Theescombe Neighbourhood Watch", suburb: "Theescombe", reason: "similar_suburb" },
    { organization_id: "", name: "broken" },
  ],
};

test("suburb requests read as a new suburb and watch, with city and province", () => {
  assert.equal(requestSummary(request), "New suburb and watch · Theescomb · Gqeberha, Eastern Cape");
  assert.equal(requestSuburbLine(request), "Theescomb (new suburb, waiting)");
  assert.equal(requestSuburbLine({ suburb: "Walmer", suburb_status: "active" }), "Walmer (existing suburb)");
  assert.equal(requestSuburbLine({ suburb: "X", suburb_status: "odd" }), "X");
  assert.equal(requestSuburbLine({}), "");
});

test("resident and patroller requesters have plain labels and use the member review path", () => {
  assert.equal(requestedRoleLabel("resident"), "Resident");
  assert.equal(requestedRoleLabel("patroller"), "Patroller");
  assert.equal(isMemberJoinPerson({ member_role: "resident" }), true);
  assert.equal(isMemberJoinPerson({ member_role: "patroller" }), true);
  assert.equal(isMemberJoinPerson({ member_role: "nw_admin" }), false);
  assert.equal(isMemberJoinPerson(null), false);
  assert.equal(joinRequestNote({ member_role: "resident", from_request: "Theescomb" }), "Resident · asked for “Theescomb”");
  assert.equal(joinRequestNote({ member_role: "patroller" }), "Patroller · asked to join");
});

test("possible duplicates drop broken rows and have friendly reasons", () => {
  assert.deepEqual(requestDuplicates(request), [
    { id: "o1", name: "Theescombe Neighbourhood Watch", suburb: "Theescombe", reason: "similar_suburb" },
  ]);
  assert.deepEqual(requestDuplicates({}), []);
  assert.equal(duplicateReasonLabel("same_suburb"), "Same suburb");
  assert.equal(duplicateReasonLabel("similar_suburb"), "Similar suburb name");
  assert.equal(duplicateReasonLabel("similar_name"), "Similar watch name");
  assert.equal(duplicateReasonLabel("x"), "Looks similar");
});

test("only new watch requests with a city can be merged", () => {
  assert.equal(canMergeRequest(request), true);
  assert.equal(canMergeRequest({ ...request, kind: "join" }), false);
  assert.equal(canMergeRequest({ ...request, type: "security_company" }), false);
  assert.equal(canMergeRequest({ ...request, city_id: null }), false);
  assert.equal(canMergeRequest(null), false);
});

test("merge targets: duplicates first, the request itself excluded, filterable", () => {
  const watches = [
    { organization_id: "o2", name: "Walmer Watch", suburb: "Walmer" },
    { organization_id: "req-1", name: "Theescomb Neighbourhood Watch", suburb: "" },
    { organization_id: "o3", name: "Algoa Park Watch", suburb: "Algoa Park" },
    { organization_id: "o1", name: "Theescombe Neighbourhood Watch", suburb: "Theescombe" },
    { organization_id: "", name: "broken" },
  ];
  const all = mergeTargetOptions(watches, request);
  assert.deepEqual(all.map((w) => w.id), ["o1", "o3", "o2"]);
  assert.equal(all[0].likely, true);
  assert.equal(all[1].likely, false);
  assert.deepEqual(mergeTargetOptions(watches, request, "walm").map((w) => w.id), ["o2"]);
  assert.deepEqual(mergeTargetOptions(watches, request, "ALGOA-park").map((w) => w.id), ["o3"]);
  assert.deepEqual(mergeTargetOptions(null, request), []);
});

test("merge confirm text says who moves where and that they wait for approval", () => {
  const text = mergeConfirmText(request, { id: "o1", name: "Theescombe Neighbourhood Watch", suburb: "Theescombe" });
  assert.match(text, /^Merge “Theescomb Neighbourhood Watch” into Theescombe Neighbourhood Watch\?/);
  assert.match(text, /Res D joins Theescombe Neighbourhood Watch as a waiting member; its watch admins approve them\./);
  assert.match(text, /“Theescomb” is saved as another spelling of Theescombe\./);
  assert.match(text, /The duplicate request is closed\./);
  const many = mergeConfirmText({ ...request, suburb: "", watch_area: "", people: [{ user_id: "a" }, { user_id: "b" }] }, { name: "W" });
  assert.match(many, /2 requesters join W/);
  assert.ok(!/another spelling/.test(many));
});

test("merge result toast is plain", () => {
  assert.equal(mergeResultMessage({ into_name: "Walmer Watch", moved: 1 }), "Merged into Walmer Watch. 1 person is waiting for its watch admins to approve them.");
  assert.equal(mergeResultMessage({ into_name: "W", moved: 2, already_in_other_watch: 1 }),
    "Merged into W. 2 people are waiting for its watch admins to approve them. 1 requester had already joined another watch and was left there.");
  assert.equal(mergeResultMessage({}), "Merged into the watch.");
});

test("requester banner explains a merged request", () => {
  const copy = requestBannerCopy({ name: "Kragga Kamma Neighbourhood Watch", state: "merged", merged_into: "No Area Watch" });
  assert.equal(copy.tone, "info");
  assert.equal(copy.title, "Your request was joined to No Area Watch");
  assert.match(copy.body, /watch admins will confirm you/);
  assert.match(requestBannerCopy({ name: "X", state: "merged" }).title, /an existing watch/);
});
