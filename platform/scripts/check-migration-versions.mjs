#!/usr/bin/env node
/**
 * Fail when two files in platform/supabase/migrations share a version prefix,
 * except the historical duplicates in ALLOWLIST.
 *
 * A version in the allowlist may appear at most EXPECTED times (today: 2).
 * A third file on that prefix is a new collision and fails.
 * Dropping one file of a pair (count 1, or 0) passes; remove the prefix from
 * ALLOWLIST in that same commit.
 *
 * CI: .github/workflows/ci.yml job "migrations".
 * Pre-commit: from the repo root, `npm run check:migrations`.
 */

import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** version -> how many files already share it. Do not add new prefixes. */
const ALLOWLIST = {
  "20260329240000": 2, // incident_section_updates_target_evidence + profile_associates_update_delete
  "20260329250000": 2, // criminal_profiles_legal_status + incident_section_updates_section_key_check_expand
  "20260815031000": 2, // city_hub_share_rls + role_based_signup
  "20260815076000": 2, // emergency_directory_media + neighbourhood_activity_feed_windows
};

const migrationsDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "supabase",
  "migrations",
);

const files = readdirSync(migrationsDir).filter((name) => name.endsWith(".sql"));
const byVersion = new Map();
const badNames = [];

for (const name of files) {
  const version = name.split("_", 1)[0];
  if (!/^\d{14}$/.test(version)) {
    badNames.push(name);
    continue;
  }
  const list = byVersion.get(version) ?? [];
  list.push(name);
  byVersion.set(version, list);
}

const errors = [];

for (const name of badNames) {
  errors.push(`${name}: version prefix must be exactly 14 digits (YYYYMMDDHHMMSS)`);
}

for (const [version, names] of byVersion) {
  const expected = ALLOWLIST[version];
  if (expected != null) {
    if (names.length > expected) {
      errors.push(
        `${version}: ${names.length} files, allowlist permits ${expected}:\n  ${names.sort().join("\n  ")}`,
      );
    }
    continue;
  }
  if (names.length > 1) {
    errors.push(
      `${version}: duplicate version (${names.length} files). Use a new 14-digit timestamp:\n  ${names.sort().join("\n  ")}`,
    );
  }
}

for (const version of Object.keys(ALLOWLIST)) {
  if (!byVersion.has(version)) {
    console.log(
      `note: ${version} is allowlisted but has no files. Remove it from ALLOWLIST.`,
    );
  } else if (byVersion.get(version).length < ALLOWLIST[version]) {
    console.log(
      `note: ${version} has ${byVersion.get(version).length} file(s); allowlist still expects ${ALLOWLIST[version]}. Remove it from ALLOWLIST once the pair is gone.`,
    );
  }
}

if (errors.length > 0) {
  console.error(`migration version check failed (${errors.length}):\n${errors.join("\n")}`);
  process.exit(1);
}

console.log(
  `migration versions ok (${files.length} files, ${Object.keys(ALLOWLIST).length} historical duplicate prefixes allowlisted)`,
);
