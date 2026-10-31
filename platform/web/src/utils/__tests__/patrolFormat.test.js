import test from "node:test";
import assert from "node:assert/strict";
import {
  initialsOf,
  formatShareClock,
  formatShareDate,
  formatShareDuration,
  isNightAt,
  shareCardTheme,
  shareVehicle,
  maskPhone,
  mapsLink,
  buildShareCardModel,
  buildShareCaption,
  isValidShareRef,
  parseSharePrefs,
  shareAreaName,
} from "../patrolFormat.js";

// 18:31 UTC = 20:31 SAST
const START = "2026-10-31 18:31:00+00";
const END = "2026-10-31T21:03:40Z";
const patrol = {
  user_name: "Khurshid Dustmurodov",
  zone: "Northfield",
  start_time: START,
  end_time: END,
  vehicle_type: "car",
  vehicle_make_model: "Ford Ranger Wildtrack",
  vehicle_reg: "kmd 113 ec",
  share_ref: "PT-7K3M",
};

test("initials", () => {
  assert.equal(initialsOf("Khurshid Dustmurodov"), "KD");
  assert.equal(initialsOf("  cher "), "C");
  assert.equal(initialsOf("Mary Ann van Wyk"), "MW");
  assert.equal(initialsOf(""), "?");
  assert.equal(initialsOf(null), "?");
});

test("clock + date use the org time zone, not the device", () => {
  assert.equal(formatShareClock(START, "Africa/Johannesburg"), "8:31 PM");
  assert.equal(formatShareClock(START, "UTC"), "6:31 PM");
  assert.equal(formatShareClock("2026-10-31T22:05:00Z", "Africa/Johannesburg"), "12:05 AM");
  assert.equal(formatShareClock("2026-10-31T10:00:00Z", "Africa/Johannesburg"), "12:00 PM");
  assert.equal(formatShareDate(START, "Africa/Johannesburg"), "Sat 31 Oct 2026");
  assert.equal(formatShareDate("2026-10-31T22:30:00Z", "Africa/Johannesburg"), "Sun 1 Nov 2026");
  assert.equal(formatShareClock(START, "Not/AZone"), "8:31 PM");
  assert.equal(formatShareClock(null), "");
});

test("duration", () => {
  assert.equal(formatShareDuration(START, END), "2h 32m");
  assert.equal(formatShareDuration(START, "2026-10-31T19:16:00Z"), "45m");
  assert.equal(formatShareDuration(END, START), "");
  assert.equal(formatShareDuration(START, null), "");
});

test("night window 18:00-06:00 local", () => {
  assert.equal(isNightAt("2026-10-31T15:59:00Z"), false); // 17:59
  assert.equal(isNightAt("2026-10-31T16:00:00Z"), true); // 18:00
  assert.equal(isNightAt("2026-11-01T03:59:00Z"), true); // 05:59
  assert.equal(isNightAt("2026-11-01T04:00:00Z"), false); // 06:00
  assert.equal(isNightAt(null), false);
});

test("theme follows the relevant event time", () => {
  const p = { start_time: "2026-10-31T14:00:00Z", end_time: "2026-10-31T17:00:00Z" }; // 16:00 / 19:00
  assert.equal(shareCardTheme("start", p), "light");
  assert.equal(shareCardTheme("end", p), "dark");
});

test("vehicle box: both, plate-only, type-only, none, light mobility, legacy", () => {
  assert.deepEqual(shareVehicle(patrol), { name: "Ford Ranger Wildtrack", plate: "KMD 113 EC" });
  assert.deepEqual(shareVehicle({ vehicle_reg: "CA 1" }), { name: "", plate: "CA 1" });
  assert.deepEqual(shareVehicle({ vehicle_type: "motorcycle" }), { name: "Motorcycle", plate: "" });
  assert.equal(shareVehicle({}), null);
  assert.equal(shareVehicle({ car_type: "-", reg_number: "-" }), null);
  assert.deepEqual(shareVehicle({ vehicle_type: "on_foot", vehicle_make_model: "x" }), { name: "On foot", plate: "" });
  assert.deepEqual(shareVehicle({ car_type: "Polo", reg_number: "nd 5" }), { name: "Polo", plate: "ND 5" });
});

test("phone masking never leaks the full number", () => {
  assert.equal(maskPhone("082 555 1267"), "082 *** **67");
  assert.equal(maskPhone("+27 82 555 1267"), "082 *** **67");
  assert.equal(maskPhone("12345"), "");
  assert.equal(maskPhone(null), "");
});

test("maps link rounds and validates", () => {
  assert.equal(mapsLink(-33.987654, 25.612345), "https://maps.google.com/?q=-33.9877,25.6123");
  assert.equal(mapsLink("x", 1), "");
  assert.equal(mapsLink(100, 1), "");
});

test("share ref format", () => {
  assert.equal(isValidShareRef("PT-7K3M"), true);
  assert.equal(isValidShareRef("PT-7K3O"), false); // O excluded
  assert.equal(isValidShareRef("PT-1234"), false); // 1 excluded
  assert.equal(isValidShareRef("PT-ABC"), false);
});

test("area comes from DB zone, then org name", () => {
  assert.equal(shareAreaName({ zone: " Northfield " }, "Org"), "Northfield");
  assert.equal(shareAreaName({ zone: "" }, "Org Name"), "Org Name");
  assert.equal(shareAreaName(null, null), "");
});

test("card model: sign-on and sign-off", () => {
  const on = buildShareCardModel({ kind: "start", patrol: { ...patrol, end_time: null } });
  assert.equal(on.theme, "dark");
  assert.equal(on.timeOn, "8:31 PM");
  assert.equal(on.timeOff, "—");
  assert.equal(on.duration, "On patrol");
  assert.equal(on.dateLabel, "Sat 31 Oct 2026");
  const off = buildShareCardModel({ kind: "end", patrol });
  assert.equal(off.timeOff, "11:03 PM");
  assert.equal(off.duration, "2h 32m");
  assert.equal(off.shareRef, "PT-7K3M");
  assert.equal(buildShareCardModel({ kind: "end", patrol, showVehicle: false }).vehicle, null);
});

test("caption: no phone or location unless toggled; masked phone; no raw coords", () => {
  const plain = buildShareCaption({ kind: "start", patrol, phone: "0825551267", location: { lat: -33.9, lng: 25.6 } });
  assert.match(plain, /Khurshid Dustmurodov signed on/);
  assert.match(plain, /Ref PT-7K3M/);
  assert.doesNotMatch(plain, /Phone|Location|0825551267/);
  const full = buildShareCaption({
    kind: "end",
    patrol,
    phone: "0825551267",
    location: { lat: -33.9, lng: 25.6 },
    options: { phone: true, location: true, vehicle: false },
  });
  assert.match(full, /Phone: 082 \*\*\* \*\*67/);
  assert.doesNotMatch(full, /0825551267/);
  assert.match(full, /Location: https:\/\/maps\.google\.com\/\?q=-33\.9000,25\.6000/);
  assert.doesNotMatch(full, /Vehicle/);
  assert.match(full, /Off 11:03 PM · 2h 32m/);
});

test("prefs parsing is defensive", () => {
  assert.deepEqual(parseSharePrefs(null), { vehicle: true, phone: false, location: false });
  assert.deepEqual(parseSharePrefs("{bad"), { vehicle: true, phone: false, location: false });
  assert.deepEqual(parseSharePrefs('{"phone":true,"vehicle":"x"}'), { vehicle: true, phone: true, location: false });
});

test("caption has no U+FFFD or lone surrogates", () => {
  for (const kind of ["start", "end"]) {
    const c = buildShareCaption({
      kind,
      patrol: { user_name: "Khurshid", zone: "Test Watch", start_time: "2026-11-01T01:26:00+02:00", end_time: "2026-11-01T03:10:00+02:00", vehicle_make_model: "Suzuki Baleno", vehicle_reg: "KKG 643 EC", share_ref: "PT-6BPZ" },
      options: { vehicle: true, phone: true, location: true },
      phone: "0821234567",
      location: { lat: -33.0, lng: 27.9 },
    });
    assert.ok(!c.includes("\uFFFD"));
    assert.ok(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(c));
    assert.ok(c.isWellFormed ? c.isWellFormed() : true);
    assert.equal(decodeURIComponent(encodeURIComponent(c)), c);
    assert.ok(!/[\u{10000}-\u{10FFFF}]/u.test(c), "no astral-plane characters in caption");
  }
});
