// SA places P6: no city or suburb is assumed in app code. A Gqeberha / Port Elizabeth /
// Nelson Mandela Bay / Theescombe literal may only live in the files below, each for a reason.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../src");
const PATTERN = /gqeberha|port elizabeth|nelson mandela|theescombe/i;

const ALLOWED = {
  "components/places/CityPicker.jsx": "search hint: old place names still work (Port Elizabeth -> Gqeberha)",
  "config/neighborhoodRegions.js": "legacy 'Zone A' rows were the first watch area",
  "utils/organizationScope.js": "legacy rows with no organisation belong to the first watch (retire after backfill)",
  "utils/geoSearchPlace.js": "address search fallback when no city is known",
  "utils/leaderboardFunFacts.js": "landmark distance fun facts (content, not a default)",
  "pages/DeleteAccount.jsx": "legal operator address",
  "pages/PrivacyPolicy.jsx": "legal operator address",
  "pages/TermsOfUse.jsx": "legal operator address",
  "pages/dev/ShareCardFixtures.jsx": "dev-only share card fixtures",
};

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "__tests__") walk(full, out);
    } else if (/\.(jsx?|tsx?)$/.test(entry.name)) out.push(full);
  }
  return out;
}

test("no hardcoded Gqeberha / Theescombe outside the allow-list", () => {
  const hits = walk(SRC)
    .map((f) => path.relative(SRC, f).split(path.sep).join("/"))
    .filter((rel) => PATTERN.test(fs.readFileSync(path.join(SRC, rel), "utf8")));
  const unexpected = hits.filter((rel) => !ALLOWED[rel]);
  assert.deepEqual(unexpected, [], `Use the city from the database instead of a literal in: ${unexpected.join(", ")}`);
});

test("allow-list has no stale entries", () => {
  for (const rel of Object.keys(ALLOWED)) {
    const full = path.join(SRC, rel);
    assert.ok(fs.existsSync(full) && PATTERN.test(fs.readFileSync(full, "utf8")), `${rel} no longer needs an exception`);
  }
});
