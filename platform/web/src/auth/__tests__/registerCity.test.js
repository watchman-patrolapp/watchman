import test from "node:test";
import assert from "node:assert/strict";
import { emptyRegisterForm, getRegisterTrack, validateRegisterForm } from "../registerTracks.js";

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

test("new form starts on the home-city area list", () => {
  const form = emptyRegisterForm();
  assert.equal(form.homeCityUsesAreaList, true);
  assert.equal(form.homeCityId, "");
});

for (const id of ["resident", "patroller"]) {
  test(`${id}: home city still needs a suburb from the list`, () => {
    const track = getRegisterTrack(id);
    assert.ok(track?.requiresNeighborhood);
    assert.match(validateRegisterForm(track, filled({ homeCityId: "c1" })) || "", /choose a suburb/);
    assert.equal(validateRegisterForm(track, filled({ homeCityId: "c1", neighborhoodOrganizationId: "o1" })), "");
  });

  test(`${id}: another city needs only the city`, () => {
    const track = getRegisterTrack(id);
    assert.match(validateRegisterForm(track, filled({ homeCityUsesAreaList: false })) || "", /choose your city/);
    assert.equal(validateRegisterForm(track, filled({ homeCityUsesAreaList: false, homeCityId: "c2", homeCityName: "Makhanda" })), "");
  });
}
