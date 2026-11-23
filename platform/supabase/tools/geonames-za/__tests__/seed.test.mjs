import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { buildPlaces, parseAlternates, parseCsv, parseGeonames, toCsv } from "../lib.mjs";
import { seedChunks } from "../seed.mjs";

const fx = (f) => fs.readFileSync(new URL(`../fixtures/${f}`, import.meta.url), "utf8");
const json = (f) => JSON.parse(fs.readFileSync(new URL(`../${f}`, import.meta.url), "utf8"));
const built = buildPlaces(parseGeonames(fx("ZA.sample.txt")), {
  alternates: parseAlternates(fx("alt-ZA.sample.txt")),
  renames: json("renames.json").renames,
  notPlaces: json("exclusions.json").not_places,
});
const placeCols = ["geonames_id", "name", "name_key", "province_code", "place_type", "feature_code", "population", "lat", "lng", "near_label"];
const places = parseCsv(toCsv(built.places, placeCols));
const aliases = parseCsv(toCsv(built.aliases, ["geonames_id", "alias", "alias_key", "kind"]));

test("parseCsv reads back what toCsv wrote", () => {
  const rows = [{ a: 'He said "hi", twice', b: "" }, { a: "x\ny", b: "2" }];
  assert.deepEqual(parseCsv(toCsv(rows, ["a", "b"])), rows);
  assert.equal(places.length, built.places.length);
});

test("seed chunks cover every place once, biggest first, each ending with an OK notice", () => {
  const files = seedChunks(places, aliases, { chunks: 3 });
  assert.deepEqual(files.map((f) => f.name), ["sa-places-seed-01.sql", "sa-places-seed-02.sql", "sa-places-seed-03.sql"]);
  assert.equal(files.reduce((n, f) => n + f.places, 0), places.length);
  assert.equal(files.reduce((n, f) => n + f.aliases, 0), aliases.length);
  for (const [i, f] of files.entries()) {
    const label = `SA places seed 0${i + 1} of 03`;
    assert.match(f.sql, new RegExp(`RAISE NOTICE '${label}: OK';\\nEND\\n\\$load\\$;`));
    assert.ok(f.sql.includes(`'${label}: not applied, missing %. Run the SA places schema first. Nothing was changed.'`));
    assert.ok(f.sql.includes("Place names © GeoNames (geonames.org), CC BY 4.0."));
  }
  const top = places.reduce((a, b) => (Number(b.population) > Number(a.population) ? b : a));
  assert.ok(files[0].sql.includes(`(${top.geonames_id}, '${top.name.replace(/'/g, "''")}'`), "most populous place in chunk 01");
  for (const p of places) {
    const hits = files.filter((f) => f.sql.includes(`\n  (${p.geonames_id}, `)).length;
    assert.equal(hits, 1, `${p.name} in exactly one chunk`);
  }
});

test("names are quoted safely and old names can link hand-added rows", () => {
  const extra = [...places, { geonames_id: "1", name: "King William's Town", name_key: "king williams town", province_code: "ZA-EC", place_type: "village", feature_code: "PPL", population: "0", lat: "-32.8", lng: "27.4", near_label: "" }];
  const sql = seedChunks(extra, aliases, { chunks: 1 })[0].sql;
  assert.ok(sql.includes("(1, 'King William''s Town', 'ZA-EC', 'village', 'PPL', 0, -32.8, 27.4, NULL)"));
  assert.ok(sql.includes("(1000501, 'grahamstown')"), "old name Grahamstown links to Makhanda");
  assert.ok(sql.includes("(981827, 'louis trichardt')"), "old name Louis Trichardt links to Makhado");
  assert.throws(() => seedChunks([{ ...extra[0], province_code: "ZA-XX" }], [], { chunks: 1 }), /unknown province/);
});
