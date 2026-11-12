import test from "node:test";
import assert from "node:assert/strict";
import {
  buildListingPayload,
  buildReviewPayload,
  clampRating,
  parseModerationFilter,
  ratingSummary,
  reviewViewerState,
  reviewerLabel,
  validateReviewForm,
  effectiveIncludeNeighbours,
  firstNameOnly,
  friendlyServiceError,
  hoursToJson,
  neighbourBadge,
  normaliseSaPhone,
  parseContactsTab,
  parseIncludeNeighbours,
  parseTags,
  showNeighboursCheckbox,
  telUrl,
  whatsappUrl,
  withIncludeNeighbours,
} from "../localServices.js";

test("SA phone numbers normalise for wa.me", () => {
  assert.equal(normaliseSaPhone("082 123 4567"), "27821234567");
  assert.equal(normaliseSaPhone("+27 82 123 4567"), "27821234567");
  assert.equal(normaliseSaPhone("0027821234567"), "27821234567");
  assert.equal(normaliseSaPhone("27821234567"), "27821234567");
  assert.equal(normaliseSaPhone("abc"), "");
  assert.equal(normaliseSaPhone("12"), "");
  assert.equal(whatsappUrl("0821234567"), "https://wa.me/27821234567");
  assert.equal(telUrl("0821234567"), "tel:+27821234567");
  assert.equal(whatsappUrl(""), "");
});

test("friendly errors never leak raw messages", () => {
  assert.match(friendlyServiceError({ message: "you can have up to 3 active listings" }), /up to 3 active listings/);
  assert.match(friendlyServiceError({ message: "please agree to publish your contact details to members" }), /agree/i);
  assert.match(friendlyServiceError({ message: "not found" }), /could not find/i);
  assert.match(friendlyServiceError({ message: "this listing is hidden; a moderator must restore it" }), /moderator must restore/i);
  assert.match(friendlyServiceError({ code: "PGRST202", message: "Could not find the function" }), /Run the local services SQL/);
  const raw = "duplicate key value violates unique constraint xyz";
  const out = friendlyServiceError({ message: raw });
  assert.equal(out, "Could not save your listing. Try again.");
  assert.ok(!out.includes("duplicate"));
});

test("first name only", () => {
  assert.equal(firstNameOnly("Thandi Nkosi"), "Thandi");
  assert.equal(firstNameOnly("  "), "A neighbour");
  assert.equal(firstNameOnly(null), "A neighbour");
});

test("tags are cleaned and capped", () => {
  assert.deepEqual(parseTags("Geyser, leaks,, a, GEYSER"), ["geyser", "leaks"]);
  assert.equal(parseTags(Array.from({ length: 20 }, (_, i) => `tag${i}`).join(",")).length, 12);
});

test("hours_json is always an object", () => {
  assert.deepEqual(hoursToJson(""), {});
  assert.deepEqual(hoursToJson(" Mon-Fri 8-5 "), { note: "Mon-Fri 8-5" });
});

test("payload never carries serves_whole_city and hours is an object", () => {
  const p = buildListingPayload({ title: "T", hours: "9-5", tags: "a1", show_to_neighbours: 1, consent_publish_contact: true }, ["p"]);
  assert.equal("serves_whole_city" in p, false);
  assert.equal(typeof p.hours_json, "object");
  assert.equal(p.show_to_neighbours, true);
  assert.deepEqual(p.photo_paths, ["p"]);
});

test("include-neighbours defaults off, needs neighbours, and reads neighbours=1", () => {
  const list = [{ organization_id: "b" }];
  assert.equal(parseIncludeNeighbours(""), false);
  assert.equal(parseIncludeNeighbours("tab=services&neighbours=1"), true);
  assert.equal(parseIncludeNeighbours("neighbours=0"), false);
  assert.equal(showNeighboursCheckbox([]), false);
  assert.equal(showNeighboursCheckbox(list), true);
  assert.equal(effectiveIncludeNeighbours("neighbours=1", []), false);
  assert.equal(effectiveIncludeNeighbours("neighbours=1", list), true);
  assert.equal(effectiveIncludeNeighbours("tab=services", list), false);
  const on = withIncludeNeighbours(new URLSearchParams("tab=services"), true);
  assert.equal(on.get("neighbours"), "1");
  assert.equal(withIncludeNeighbours(on, false).has("neighbours"), false);
});

test("contacts tab defaults to emergency", () => {
  assert.equal(parseContactsTab(""), "emergency");
  assert.equal(parseContactsTab("tab=services"), "services");
  assert.equal(parseContactsTab("tab=bogus"), "emergency");
});

test("neighbour badge only on neighbour rows", () => {
  assert.equal(neighbourBadge({ is_neighbour: false, suburb_name: "X" }), "");
  assert.equal(neighbourBadge({ is_neighbour: true, suburb_name: "Walmer" }), "Walmer");
});

test("review payload clamps rating and ties vouch to use", () => {
  const p = buildReviewPayload("L1", { rating: 9, body: "  Great  ", used_service: false, vouch: true });
  assert.deepEqual(p, { p_listing_id: "L1", p_rating: 5, p_body: "Great", p_used_service: false, p_vouch: false });
  const q = buildReviewPayload("L1", { rating: 4, body: "", used_service: true, vouch: true });
  assert.equal(q.p_body, null);
  assert.equal(q.p_vouch, true);
  assert.equal(buildReviewPayload("L1", { rating: 2, body: "x".repeat(1200) }).p_body.length, 1000);
});

test("review validation and rating helpers", () => {
  assert.equal(clampRating("abc"), 0);
  assert.equal(clampRating(0), 0);
  assert.equal(clampRating(3.4), 3);
  assert.match(validateReviewForm({ rating: 0 }), /rating/i);
  assert.equal(validateReviewForm({ rating: 4, body: "ok" }), "");
  assert.equal(ratingSummary({ rating_count: 0 }), "No ratings yet");
  assert.equal(ratingSummary({ rating_count: 1, avg_rating: "4.00" }), "4.0 (1 rating)");
});

test("review viewer state and reviewer label", () => {
  assert.equal(reviewViewerState({ isVerified: true, isOwner: true }), "owner");
  assert.equal(reviewViewerState({ isVerified: false, isOwner: false }), "needs_verification");
  assert.equal(reviewViewerState({ isVerified: true, isOwner: false }), "can_review");
  assert.equal(reviewerLabel({ reviewer_first_name: "Thandi", reviewer_street: "Oak Street" }), "Thandi, Oak Street");
  assert.equal(reviewerLabel({}), "A neighbour");
});

test("review errors map to friendly copy", () => {
  assert.equal(friendlyServiceError(new Error("only verified households can rate services")), "Only verified households can rate services.");
  assert.equal(friendlyServiceError(new Error("you cannot review your own listing")), "You cannot review your own listing.");
  assert.equal(friendlyServiceError(new Error("boom stack trace")), "Could not save your listing. Try again.");
});

test("moderation filter parsing", () => {
  assert.equal(parseModerationFilter("Hidden"), "hidden");
  assert.equal(parseModerationFilter("nope"), "pending");
});
