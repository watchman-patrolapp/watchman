import test from "node:test";
import assert from "node:assert/strict";
import { contactRoleLabel, filterContacts, groupContacts } from "../communityContactsView.js";

const rows = [
  { organization_id: "2", organization_name: "lorraine NW", organization_type: "nw_group", admin_name: "Ann", admin_email: "ann@x.test" },
  { organization_id: "1", organization_name: "Theescombe NW", organization_type: "nw_group", admin_name: "Ben", admin_phone: "041 000" },
  { organization_id: "3", organization_name: "Fidelity", organization_type: "security_company", admin_name: null },
  { organization_id: "4", organization_name: "Old city ops", organization_type: "city_admin" },
];

test("groups watches and security companies A-Z and drops retired types", () => {
  const groups = groupContacts(rows);
  assert.deepEqual(groups.map((g) => g.type), ["nw_group", "security_company"]);
  assert.deepEqual(groups[0].rows.map((r) => r.organization_id), ["2", "1"]);
  assert.deepEqual(groups[1].rows.map((r) => r.organization_id), ["3"]);
  assert.deepEqual(groupContacts(null).map((g) => g.rows.length), [0, 0]);
});

test("filter matches organisation, admin name, email or phone", () => {
  assert.equal(filterContacts(rows, "").length, 4);
  assert.deepEqual(filterContacts(rows, "THEES").map((r) => r.organization_id), ["1"]);
  assert.deepEqual(filterContacts(rows, "ann@").map((r) => r.organization_id), ["2"]);
  assert.deepEqual(filterContacts(rows, "041").map((r) => r.organization_id), ["1"]);
  assert.deepEqual(filterContacts(undefined, "x"), []);
});

test("role label", () => {
  assert.equal(contactRoleLabel("nw_admin"), "NW admin");
  assert.equal(contactRoleLabel("committee"), "Committee");
  assert.equal(contactRoleLabel(null), "");
});
