import test from "node:test";
import assert from "node:assert/strict";
import {
  belongsToActiveOrganization,
  getWorkingOrganizationIncludeUnscoped,
  scopeToOrganization,
  setWorkingOrganization,
  shouldIncludeUnscopedProfiles,
} from "../organizationScopeCore.js";

test("legacy unscoped rows are no longer treated as the first watch", () => {
  assert.equal(shouldIncludeUnscopedProfiles({ name: "Theescombe Neighbourhood Watch" }), false);
  assert.equal(shouldIncludeUnscopedProfiles({ name: "Gardens Watch" }), false);
  assert.equal(getWorkingOrganizationIncludeUnscoped(), false);
  setWorkingOrganization({ id: "org-1", name: "Theescombe Neighbourhood Watch" });
  assert.equal(getWorkingOrganizationIncludeUnscoped(), false);
});

test("scope and membership use the organisation id only", () => {
  const org = "0a000000-0000-0000-0000-000000000001";
  const calls = [];
  const query = {
    eq(column, value) {
      calls.push(["eq", column, value]);
      return query;
    },
    or(expr) {
      calls.push(["or", expr]);
      return query;
    },
  };
  scopeToOrganization(query, org, true);
  assert.deepEqual(calls, [["eq", "organization_id", org]], "includeUnscoped is ignored");
  assert.equal(belongsToActiveOrganization({ organization_id: org }, org, true), true);
  assert.equal(belongsToActiveOrganization({ organization_id: null }, org, true), false);
  assert.equal(belongsToActiveOrganization({ organization_id: "other" }, org, true), false);
});
