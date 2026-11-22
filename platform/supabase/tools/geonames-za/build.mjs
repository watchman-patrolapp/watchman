#!/usr/bin/env node
// Usage: node build.mjs --src <dir with ZA.txt and alternatenames ZA.txt as alt-ZA.txt> [--out out]
// Download (not committed): https://download.geonames.org/export/dump/ZA.zip
//                           https://download.geonames.org/export/dump/alternatenames/ZA.zip (save its ZA.txt as alt-ZA.txt)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildPlaces, parseAlternates, parseGeonames, toCsv } from "./lib.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : def;
};
const src = arg("src");
const out = path.resolve(arg("out", path.join(here, "out")));
if (!src) {
  console.error("Missing --src <folder with ZA.txt and alt-ZA.txt>");
  process.exit(1);
}
const zaPath = path.join(src, "ZA.txt");
const altPath = path.join(src, "alt-ZA.txt");
const rows = parseGeonames(fs.readFileSync(zaPath, "utf8"));
const alternates = fs.existsSync(altPath) ? parseAlternates(fs.readFileSync(altPath, "utf8")) : new Map();
const renames = JSON.parse(fs.readFileSync(path.join(here, "renames.json"), "utf8")).renames;
const notPlaces = JSON.parse(fs.readFileSync(path.join(here, "exclusions.json"), "utf8")).not_places;
const result = buildPlaces(rows, { alternates, renames, notPlaces });

fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, "places.csv"), toCsv(result.places, ["geonames_id", "name", "name_key", "province_code", "place_type", "feature_code", "population", "lat", "lng", "near_label"]));
fs.writeFileSync(path.join(out, "aliases.csv"), toCsv(result.aliases, ["geonames_id", "alias", "alias_key", "kind"]));
fs.writeFileSync(path.join(out, "dropped.csv"), toCsv(result.dropped, ["id", "name", "fcode", "province", "reason"]));
const meta = {
  source: "GeoNames ZA.zip + alternatenames/ZA.zip",
  licence: "CC BY 4.0 — Place names © GeoNames (geonames.org)",
  source_file_modified: fs.statSync(zaPath).mtime.toISOString(),
  built_at: new Date().toISOString(),
  stats: result.stats,
  renames: result.renamed.map((r) => ({ official: r.official, result: r.result })),
};
fs.writeFileSync(path.join(out, "meta.json"), JSON.stringify(meta, null, 2) + "\n");
const reasons = result.dropped.reduce((m, d) => {
  const k = d.reason.startsWith("old-name point") ? "old-name point folded into a bigger place" : d.reason.startsWith("repeat of") ? "repeat of the same place within 15 km" : d.reason;
  m[k] = (m[k] || 0) + 1;
  return m;
}, {});
const top = (n) => result.places.slice(0, n).map((p) => `${p.name} (${p.province_code}, ${p.population.toLocaleString("en-ZA")})`).join(", ");
fs.writeFileSync(
  path.join(out, "report.md"),
  `# GeoNames ZA build report\n\n- Source file modified: ${meta.source_file_modified}\n- Licence: ${meta.licence}\n` +
    `- Places: ${result.stats.places} (${result.stats.with_population} with a population figure)\n` +
    `- Aliases: ${result.stats.aliases} (${result.stats.old_name_aliases} old names)\n` +
    `- Repeated names given a "near …" label: ${result.stats.disambiguated}\n` +
    `- By province: ${Object.entries(result.stats.by_province).map(([k, v]) => `${k} ${v}`).join(", ")}\n` +
    `- By type: ${Object.entries(result.stats.by_type).map(([k, v]) => `${k} ${v}`).join(", ")}\n\n` +
    `## Renames\n${result.renamed.map((r) => `- ${r.official}: ${r.result}`).join("\n")}\n\n` +
    `## Dropped (${result.dropped.length} source rows of class P or near-P)\n${Object.entries(reasons).sort((a, b) => b[1] - a[1]).map(([k, v]) => `- ${k}: ${v}`).join("\n")}\n\n` +
    `## Kept, but the name is also a municipality (review)\n${result.sharesAdminName.map((x) => `- ${x.name} (${x.province}, ${x.id})`).join("\n") || "- none"}\n\n` +
    `## Largest 15\n${top(15)}\n`,
);
console.log(JSON.stringify(meta.stats));
