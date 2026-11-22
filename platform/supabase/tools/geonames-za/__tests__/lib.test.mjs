import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { buildPlaces, isLatin, nameKey, parseAlternates, parseGeonames, toCsv } from "../lib.mjs";

const fx = (f) => fs.readFileSync(new URL(`../fixtures/${f}`, import.meta.url), "utf8");
const renames = JSON.parse(fs.readFileSync(new URL("../renames.json", import.meta.url), "utf8")).renames;
const notPlaces = JSON.parse(fs.readFileSync(new URL("../exclusions.json", import.meta.url), "utf8")).not_places;
const build = () =>
  buildPlaces(parseGeonames(fx("ZA.sample.txt")), { alternates: parseAlternates(fx("alt-ZA.sample.txt")), renames, notPlaces });
const byName = (r, n) => r.places.filter((p) => p.name === n);

test("nameKey folds case, accents, apostrophes and a trailing bracket", () => {
  assert.equal(nameKey("Gqeberha (Port Elizabeth)"), "gqeberha");
  assert.equal(nameKey("  King William's Town "), "king williams town");
  assert.equal(nameKey("Bela-Bela"), "bela bela");
  assert.equal(nameKey("Città del Capo"), "citta del capo");
  assert.equal(nameKey("eMalahleni"), "emalahleni");
  assert.equal(nameKey("Port St. John’s"), "port st johns");
  assert.equal(nameKey(null), "");
});

test("isLatin rejects other scripts", () => {
  assert.equal(isLatin("Port Elizabeth"), true);
  assert.equal(isLatin("ポート・エリザベス"), false);
});

test("only populated places become cities; no municipalities, suburbs, farms or wards", () => {
  const r = build();
  const names = r.places.map((p) => p.name);
  for (const n of ["Nelson Mandela Bay", "Port Elizabeth", "Theescombe", "Walmer", "Kroonstad Farm", "Nelson Mandela Bay Ward 10", "Mogale City"])
    assert.ok(!names.includes(n), n);
  assert.ok(r.dropped.some((d) => d.name === "Walmer" && /PPLX/.test(d.reason)));
  assert.ok(r.dropped.some((d) => d.name === "Mogale City" && /exclusions/.test(d.reason)));
  assert.deepEqual(byName(r, "Richmond").map((p) => p.geonames_id), [962331], "real town that shares a municipality name is kept");
  assert.ok(r.sharesAdminName.some((x) => x.name === "Richmond"));
});

test("official renames: new name primary, old names become old_name aliases", () => {
  const r = build();
  const mk = byName(r, "Makhanda")[0];
  assert.ok(mk && mk.geonames_id === 1000501 && mk.province_code === "ZA-EC");
  assert.equal(byName(r, "Grahamstown").length, 0);
  const mkAliases = r.aliases.filter((a) => a.geonames_id === 1000501);
  assert.deepEqual(mkAliases.find((a) => a.alias_key === "grahamstown").kind, "old_name");
  assert.ok(mkAliases.some((a) => a.alias === "IRhini" && a.kind === "alternate"));
  assert.ok(byName(r, "Komani").length === 1 && byName(r, "Queenstown").length === 0);
  const gq = r.aliases.filter((a) => a.geonames_id === 964420);
  assert.equal(gq.find((a) => a.alias_key === "port elizabeth").kind, "old_name");
  assert.ok(gq.some((a) => a.alias === "Ibhayi"));
  assert.ok(!gq.some((a) => a.alias === "PLZ"), "airport code dropped");
  assert.ok(!gq.some((a) => /ポ/.test(a.alias)), "non-Latin dropped");
  assert.ok(!gq.some((a) => a.alias === "Port Elisabeth"), "French exonym dropped");
  assert.equal(byName(r, "eMalahleni")[0].geonames_id, 939270);
  assert.equal(r.renamed.find((x) => x.official === "Makhado"), undefined, "apply:false is skipped");
});

test("duplicate points are folded; repeated names get a 'near' label", () => {
  const r = build();
  assert.equal(byName(r, "Witbank").length, 0, "old-name point folded into eMalahleni");
  assert.ok(r.aliases.some((a) => a.geonames_id === 939270 && a.alias_key === "witbank" && a.kind === "old_name"));
  const bb = r.places.filter((p) => p.name_key === "bela bela");
  assert.deepEqual(bb.map((p) => p.geonames_id), [7576313], "Bela Bela / Bela-Bela repeat folded into the official one");
  assert.ok(r.aliases.some((a) => a.geonames_id === 7576313 && a.alias_key === "warmbaths" && a.kind === "old_name"));
  const mid = byName(r, "Middelburg");
  assert.equal(mid.length, 3);
  const ec = mid.filter((p) => p.province_code === "ZA-EC");
  assert.equal(ec.length, 2);
  assert.ok(ec.every((p) => p.near_label && p.near_label.startsWith("near ")), JSON.stringify(ec));
  assert.notEqual(ec[0].near_label, ec[1].near_label);
  assert.equal(mid.find((p) => p.province_code === "ZA-MP").near_label, null);
});

test("ranked by population; csv escapes", () => {
  const r = build();
  assert.equal(r.places[0].name, "Gqeberha");
  assert.equal(r.stats.places, r.places.length);
  assert.equal(toCsv([{ a: 'x,"y"', b: null }], ["a", "b"]), 'a,b\n"x,""y""",\n');
});
