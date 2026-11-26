import test from "node:test";
import assert from "node:assert/strict";
import {
  cityOptionLabel,
  cityOptionNote,
  cityUsesSignupAreaList,
  cleanPlaceName,
  filterWatches,
  joinResultCopy,
  mySuburbRequestLabel,
  normalizeCityResults,
  normalizeMySuburbRequests,
  normalizeSuburbSuggestions,
  normalizeWatchList,
  placeQueryKey,
  requestResultCopy,
  shouldSearchPlaces,
  suburbRequestState,
} from "../placesView.js";

test("query key folds accents, apostrophes and punctuation like the SQL key", () => {
  assert.equal(placeQueryKey("  Port-Elizabeth "), "port elizabeth");
  assert.equal(placeQueryKey("Kwa'Mhlanga"), "kwamhlanga");
  assert.equal(placeQueryKey("Pietermaritzbúrg"), "pietermaritzburg");
  assert.equal(placeQueryKey(null), "");
});

test("searches start at two characters", () => {
  assert.equal(shouldSearchPlaces("g"), false);
  assert.equal(shouldSearchPlaces(" - "), false);
  assert.equal(shouldSearchPlaces("gq"), true);
});

test("suburb names are tidied and capped at 80 characters", () => {
  assert.equal(cleanPlaceName("  Walmer   Heights "), "Walmer Heights");
  assert.equal(cleanPlaceName("x".repeat(100)).length, 80);
});

test("city results keep only display fields and drop broken rows", () => {
  const rows = normalizeCityResults([
    { id: "1", name: "Gqeberha", province: "Eastern Cape", province_code: "EC", near_label: null, place_type: "city", formerly: "Port Elizabeth", population: 9, secret: "x" },
    { id: "", name: "Nowhere" },
    { id: "3" },
  ]);
  assert.deepEqual(rows, [
    { id: "1", name: "Gqeberha", province: "Eastern Cape", provinceCode: "EC", nearLabel: "", placeType: "city", formerly: "Port Elizabeth", alsoKnownAs: "" },
  ]);
  assert.deepEqual(normalizeCityResults(null), []);
});

test("city labels show province, near label and old name", () => {
  assert.equal(cityOptionLabel({ name: "Makhanda", province: "Eastern Cape" }), "Makhanda, Eastern Cape");
  assert.equal(cityOptionLabel({ name: "Middelburg", nearLabel: "near Steynsburg", province: "Eastern Cape" }), "Middelburg (near Steynsburg), Eastern Cape");
  assert.equal(cityOptionLabel({ name: "Gqeberha" }), "Gqeberha");
  assert.equal(cityOptionNote({ name: "Makhanda", formerly: "Grahamstown" }), "(formerly Grahamstown)");
  assert.equal(cityOptionNote({ name: "Gqeberha", alsoKnownAs: "Ibhayi" }), "(also called Ibhayi)");
  assert.equal(cityOptionNote({ name: "Makhado", formerly: "makhado" }), "");
  assert.equal(cityOptionNote({ name: "Durban" }), "");
});

test("watch lists never carry counts or contact details", () => {
  const rows = normalizeWatchList([
    { organization_id: "o1", name: "Theescombe NW", suburb: "Theescombe", my_status: "active", member_count: 40, phone: "1" },
    { organization_id: "o2", name: "Walmer Watch", suburb: null, my_status: "weird" },
    { organization_id: "", name: "Broken" },
  ]);
  assert.deepEqual(rows, [
    { id: "o1", name: "Theescombe NW", suburb: "Theescombe", myStatus: "active" },
    { id: "o2", name: "Walmer Watch", suburb: "", myStatus: "" },
  ]);
  for (const row of rows) assert.deepEqual(Object.keys(row).sort(), ["id", "myStatus", "name", "suburb"]);
});

test("watch filter matches name or suburb, ignoring case and punctuation", () => {
  const watches = [
    { id: "1", name: "Theescombe NW", suburb: "Theescombe" },
    { id: "2", name: "Walmer Watch", suburb: "Walmer Heights" },
  ];
  assert.deepEqual(filterWatches(watches, "walmer-h").map((w) => w.id), ["2"]);
  assert.deepEqual(filterWatches(watches, "NW").map((w) => w.id), ["1"]);
  assert.equal(filterWatches(watches, "  ").length, 2);
});

test("suburb suggestions carry their watches and set-up state", () => {
  const rows = normalizeSuburbSuggestions([
    { suburb_id: "s1", name: "Theescombe", match: "exact", state: "active", watches: [{ organization_id: "o1", name: "Theescombe NW", my_status: null }] },
    { suburb_id: "s2", name: "Theescomb Park", match: "odd", state: "being_set_up", watches: null },
  ]);
  assert.equal(rows[0].beingSetUp, false);
  assert.deepEqual(rows[0].watches, [{ id: "o1", name: "Theescombe NW", suburb: "Theescombe", myStatus: "" }]);
  assert.equal(rows[1].match, "similar");
  assert.equal(rows[1].beingSetUp, true);
  assert.deepEqual(rows[1].watches, []);
});

test("new suburb needs 2+ characters and no exact match", () => {
  assert.equal(suburbRequestState({ name: "a" }).canSubmit, false);
  assert.equal(suburbRequestState({ name: "a" }).tooShort, true);
  const exact = suburbRequestState({ name: " theescombe ", suggestions: [{ id: "s1", name: "Theescombe" }], confirmed: true });
  assert.equal(exact.exact.id, "s1");
  assert.equal(exact.canSubmit, false);
  assert.match(exact.hint, /already listed/);
});

test("close spellings need an explicit 'it's not one of these'", () => {
  const suggestions = [{ id: "s1", name: "Theescombe" }];
  const before = suburbRequestState({ name: "Theescomb", suggestions });
  assert.equal(before.needsConfirm, true);
  assert.equal(before.canSubmit, false);
  const after = suburbRequestState({ name: "Theescomb", suggestions, confirmed: true });
  assert.equal(after.canSubmit, true);
  const none = suburbRequestState({ name: "Brand New Park" });
  assert.equal(none.needsConfirm, false);
  assert.equal(none.canSubmit, true);
});

test("no submit while suggestions are still loading", () => {
  const state = suburbRequestState({ name: "Brand New Park", loading: true });
  assert.equal(state.canSubmit, false);
  assert.match(state.hint, /Checking/);
});

test("request and join copy is friendly for every status", () => {
  assert.equal(requestResultCopy({ status: "requested", suburb: "Kabega" }).title, "Sent for approval");
  assert.match(requestResultCopy({ status: "requested", suburb: "Kabega" }).body, /Kabega/);
  assert.match(requestResultCopy({ status: "exists", name: "Walmer", state: "active" }).title, /already listed/);
  assert.match(requestResultCopy({ status: "exists", name: "Walmer", state: "being_set_up" }).title, /being set up/);
  assert.equal(requestResultCopy({ status: "confirm_needed" }).title, "Is it one of these?");
  assert.equal(requestResultCopy({ status: "nope" }), null);
  assert.equal(joinResultCopy({ status: "joined", name: "Walmer Watch" }).title, "Welcome to Walmer Watch");
  assert.match(joinResultCopy({ status: "already_member" }).title, /already in the watch/);
  assert.match(joinResultCopy({ status: "pending", name: "X" }).title, /waiting/);
  assert.equal(joinResultCopy(null), null);
});

test("my suburb requests read in plain words", () => {
  const rows = normalizeMySuburbRequests([
    { suburb_id: "s1", suburb: "Kabega", city: "Gqeberha", state: "approved" },
    { suburb_id: "s2", suburb: "Mill Park", city: "", state: "?" },
    { suburb_id: "", suburb: "Broken" },
  ]);
  assert.equal(rows.length, 2);
  assert.equal(mySuburbRequestLabel(rows[0]), "Kabega, Gqeberha: approved");
  assert.equal(mySuburbRequestLabel(rows[1]), "Mill Park: waiting for approval");
  assert.equal(mySuburbRequestLabel({ suburb: "A", state: "merged" }), "A: joined to an existing suburb");
  assert.equal(mySuburbRequestLabel({ suburb: "A", state: "merged", mergedInto: "Theescombe" }), "A: joined to Theescombe");
  assert.equal(normalizeMySuburbRequests([{ suburb_id: "s", suburb: "A", state: "merged", merged_into: "B" }])[0].mergedInto, "B");
  assert.equal(mySuburbRequestLabel({ suburb: "A", state: "not_approved" }), "A: not approved");
});

test("only the platform's home city uses the sign-up area list", () => {
  assert.equal(cityUsesSignupAreaList("c1", "c1"), true);
  assert.equal(cityUsesSignupAreaList("c2", "c1"), false);
  assert.equal(cityUsesSignupAreaList("", "c1"), false);
  assert.equal(cityUsesSignupAreaList("c1", ""), false);
});
