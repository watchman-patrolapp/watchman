import test from "node:test";
import assert from "node:assert/strict";
import { cityLabel, cityResult } from "../cityScopeView.js";
import { orgCityError, orgCityValue, suburbAfterCityChange, suburbsForCity } from "../orgCityForm.js";
import {
  contactCities,
  contactPlaceLine,
  filterContacts,
  filterContactsByCity,
} from "../communityContactsView.js";
import { FALLBACK_PLACE, cityStreetVariants, searchPlace, swapSuburbForCity, viewboxAround } from "../geoSearchPlace.js";
import {
  cityCoverageLabel,
  emptyRegisterForm,
  getRegisterTrack,
  signupCityMetadata,
  trackAsksForCity,
  validateRegisterForm,
} from "../../auth/registerTracks.js";
import { DEFAULT_PATROL_ZONE, displayPatrolZone, formatPatrolPlaceLabel } from "../../config/neighborhoodRegions.js";

test("cityResult never invents a city", () => {
  assert.deepEqual(cityResult({ id: "c1", name: " Makhanda " }), { id: "c1", name: "Makhanda" });
  assert.deepEqual(cityResult(null), { id: null, name: "" });
  assert.deepEqual(cityResult({ id: "c1" }), { id: null, name: "" });
  assert.equal(cityLabel({ name: "" }), "your city");
  assert.equal(cityLabel({ name: "Cape Town" }), "Cape Town");
});

test("org form: city value, suburb list follows the city, new orgs need a city", () => {
  const names = new Map([["ct", { name: "Cape Town", province: "Western Cape" }]]);
  assert.deepEqual(orgCityValue({ city_id: "ct" }, names), { id: "ct", name: "Cape Town", province: "Western Cape", nearLabel: "" });
  assert.equal(orgCityValue({ city_id: "" }, names), null);
  assert.equal(orgCityValue({ city_id: "x" }, names).name, "This city");
  const subs = [{ id: "s1", city_id: "gq" }, { id: "s2", city_id: "ct" }, { id: "s3", city_id: null }];
  assert.deepEqual(suburbsForCity(subs, "ct").map((s) => s.id), ["s2", "s3"]);
  assert.equal(suburbsForCity(subs, "").length, 3);
  assert.equal(suburbAfterCityChange(subs, "s1", "ct"), "");
  assert.equal(suburbAfterCityChange(subs, "s2", "ct"), "s2");
  assert.equal(suburbAfterCityChange(subs, "s3", "gq"), "s3");
  assert.match(orgCityError({ city: null }, false), /Choose the city or town/);
  assert.equal(orgCityError({ city: { id: "ct" } }, false), "");
  assert.equal(orgCityError({ city: null }, true), "", "edits keep their own city");
});

test("contacts: place line, city list and filters", () => {
  const rows = [
    { organization_name: "Theescombe NW", suburb: "Theescombe", city: "Gqeberha", province: "Eastern Cape" },
    { organization_name: "Gardens Watch", suburb: "Gardens", city: "Cape Town", province: "Western Cape" },
    { organization_name: "Cape Guard", suburb: null, city: "Cape Town", province: "Western Cape" },
    { organization_name: "Old Row" },
  ];
  assert.equal(contactPlaceLine(rows[0]), "Theescombe · Gqeberha, Eastern Cape");
  assert.equal(contactPlaceLine(rows[2]), "Cape Town, Western Cape");
  assert.equal(contactPlaceLine(rows[3]), "", "older database: no place line");
  assert.equal(contactPlaceLine({ city: "Eastern Cape Town", province: "Eastern Cape" }), "Eastern Cape Town");
  assert.deepEqual(contactCities(rows), ["Cape Town", "Gqeberha"]);
  assert.equal(filterContactsByCity(rows, "cape town").length, 2);
  assert.equal(filterContactsByCity(rows, "").length, 4);
  assert.deepEqual(filterContacts(rows, "gardens").map((r) => r.organization_name), ["Gardens Watch"]);
  assert.equal(filterContacts(rows, "western cape").length, 2);
});

test("address search hints: the given city, else the fallback place", () => {
  assert.equal(searchPlace({}), FALLBACK_PLACE);
  const ct = searchPlace({ cityName: "Cape Town", province: "Western Cape", suburb: "Rondebosch" });
  assert.deepEqual(cityStreetVariants("Main Road", ct), ["Main Road, Cape Town", "Main Road"]);
  assert.equal(swapSuburbForCity("5 Main Road, Rondebosch", ct), "5 Main Road, Cape Town");
  assert.equal(swapSuburbForCity("5 Main Road", { city: "", suburb: "x" }), "5 Main Road");
  assert.ok(!cityStreetVariants("Main Road", ct).some((v) => /Gqeberha|Port Elizabeth/.test(v)));
  // the fallback keeps today's Gqeberha retries
  assert.deepEqual(cityStreetVariants("Kragga Kamma Road", FALLBACK_PLACE), [
    "Kragga Kamma Road, Gqeberha",
    "Kragga Kamma Road, Port Elizabeth",
    "Kragga Kamma Road",
  ]);
  assert.equal(viewboxAround(-33.92, 18.42), "18.20,-33.76,18.64,-34.09");
  assert.equal(viewboxAround(NaN, 1), "");
});

function filled(overrides = {}) {
  return {
    ...emptyRegisterForm(),
    firstName: "Thandi",
    lastName: "Mokoena",
    phone: "0821234567",
    email: "thandi@example.com",
    password: "secret1",
    confirmPassword: "secret1",
    address: "1 Main Road",
    emergencyContactFirstName: "Sipho",
    emergencyContactLastName: "Mokoena",
    emergencyContactPhone: "0827654321",
    ...overrides,
  };
}

test("watch sign-up asks for the watch's city", () => {
  const track = getRegisterTrack("neighborhood_watch");
  assert.ok(trackAsksForCity(track));
  const base = filled({ watchName: "Fingo Watch", watchArea: "Fingo" });
  assert.match(validateRegisterForm(track, base), /city or town your watch is in/);
  assert.equal(validateRegisterForm(track, { ...base, homeCityId: "mak", homeCityName: "Makhanda" }), "");
  assert.deepEqual(signupCityMetadata(track, { ...base, homeCityId: "mak", homeCityName: "Makhanda" }), {
    home_city_id: "mak",
    home_city_name: "Makhanda",
  });
});

test("security sign-up: company city, whole-city cover uses it, area picks only where listed", () => {
  const track = getRegisterTrack("security_company");
  assert.ok(trackAsksForCity(track));
  const base = filled({
    companyName: "Cape Guard",
    companyRegistration: "PSIRA 1",
    companyAddress: "1 Long St",
    coverageScope: "city",
  });
  assert.match(validateRegisterForm(track, base), /city or town your company is based in/);
  const inCt = { ...base, homeCityId: "ct", homeCityName: "Cape Town", homeCityUsesAreaList: false };
  assert.equal(validateRegisterForm(track, inCt), "");
  assert.equal(cityCoverageLabel(inCt), "Cape Town");
  assert.match(
    validateRegisterForm(track, { ...inCt, coverageScope: "areas", coverageOrganizationIds: ["o1"] }),
    /whole-city coverage for now/,
  );
  assert.equal(
    validateRegisterForm(track, { ...inCt, homeCityUsesAreaList: true, coverageScope: "areas", coverageOrganizationIds: ["o1"] }),
    "",
  );
});

test("resident / patroller metadata unchanged; other tracks send no city", () => {
  const resident = getRegisterTrack("resident");
  assert.deepEqual(signupCityMetadata(resident, filled({ homeCityId: "gq", homeCityName: "Gqeberha" })), {
    home_city_id: "gq",
    home_city_name: "Gqeberha",
  });
  assert.deepEqual(signupCityMetadata(resident, filled()), { home_city_id: null, home_city_name: null });
  assert.deepEqual(signupCityMetadata(null, filled()), {});
});

test("patrol labels assume no city or suburb", () => {
  assert.equal(DEFAULT_PATROL_ZONE, "Patrol area");
  assert.equal(formatPatrolPlaceLabel(), "Patrol area");
  assert.equal(formatPatrolPlaceLabel("Sea Point", "Cape Town"), "Sea Point, Cape Town");
  assert.equal(displayPatrolZone("Zone A"), "Theescombe", "legacy beta rows keep their historical name");
  assert.equal(displayPatrolZone(""), null);
});
