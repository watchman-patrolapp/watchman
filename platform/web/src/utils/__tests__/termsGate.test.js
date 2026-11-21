import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CURRENT_TERMS_VERSION,
  acceptedAtSignup,
  termsFieldsFromUsersRow,
  termsGateDecision,
  termsSignupMetadataFrom,
} from "../termsGate.js";

const V = CURRENT_TERMS_VERSION;
const loaded = (extra = {}) => ({
  id: "u1",
  profileLoaded: true,
  termsColumnPresent: true,
  termsVersion: null,
  ...extra,
});

test("reads the users row and notices when the column is missing", () => {
  assert.deepEqual(termsFieldsFromUsersRow({ id: "u1" }), {
    termsColumnPresent: false,
    termsVersion: null,
    termsAcceptedAt: null,
  });
  assert.deepEqual(termsFieldsFromUsersRow({ terms_version: null, terms_accepted_at: null }), {
    termsColumnPresent: true,
    termsVersion: null,
    termsAcceptedAt: null,
  });
  assert.equal(termsFieldsFromUsersRow({ terms_version: V }).termsVersion, V);
  assert.equal(termsFieldsFromUsersRow(null).termsColumnPresent, false);
});

test("asks a member who has never accepted", () => {
  assert.equal(termsGateDecision({ user: loaded() }), "ask");
});

test("asks again when the version changes", () => {
  assert.equal(termsGateDecision({ user: loaded({ termsVersion: "2020-01-01" }) }), "ask");
});

test("passes a member who accepted the current version", () => {
  assert.equal(termsGateDecision({ user: loaded({ termsVersion: V }) }), "pass");
  assert.equal(termsGateDecision({ user: loaded(), acceptedLocally: V }), "pass");
});

test("fails open when it cannot tell", () => {
  assert.equal(termsGateDecision({ user: null }), "pass");
  assert.equal(termsGateDecision({ user: loaded({ profileLoaded: false }) }), "pass");
  assert.equal(termsGateDecision({ user: loaded({ profileFromCache: true }) }), "pass");
  assert.equal(termsGateDecision({ user: loaded({ termsColumnPresent: false }) }), "pass");
  assert.equal(termsGateDecision({ user: loaded({ termsColumnPresent: undefined }) }), "pass");
  assert.equal(termsGateDecision({ user: loaded(), online: false }), "pass");
});

test("records a fresh sign-up silently when the Register form accepted this version", () => {
  const meta = { terms_version: V, terms_accepted_at: "2026-11-21T10:00:00Z" };
  assert.equal(acceptedAtSignup(meta), true);
  assert.equal(termsGateDecision({ user: loaded({ user_metadata: meta }) }), "signup");
  const old = { terms_version: "2026-08-15", terms_accepted_at: "2026-08-15T10:00:00Z" };
  assert.equal(acceptedAtSignup(old), false);
  assert.equal(termsGateDecision({ user: loaded({ user_metadata: old }) }), "ask");
  assert.equal(acceptedAtSignup({ terms_accepted_at: "x" }), false);
  assert.equal(acceptedAtSignup(undefined), false);
});

test("sign-up metadata is copied onto the profile", () => {
  const meta = termsSignupMetadataFrom({ user_metadata: { terms_version: V, terms_accepted_at: "t", other: 1 } });
  assert.deepEqual(meta, { terms_version: V, terms_accepted_at: "t" });
  assert.equal(termsGateDecision({ user: loaded({ termsSignupMetadata: meta }) }), "signup");
  assert.deepEqual(termsSignupMetadataFrom(null), { terms_version: null, terms_accepted_at: null });
});
