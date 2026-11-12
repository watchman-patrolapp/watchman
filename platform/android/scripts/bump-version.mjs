#!/usr/bin/env node
/**
 * Update platform/android/version.properties.
 *
 *   node scripts/bump-version.mjs --bump-code
 *   node scripts/bump-version.mjs --bump-code --name 1.0.6
 *   node scripts/bump-version.mjs --code 7 --name 1.0.6
 *
 * Prints the resulting VERSION_CODE and VERSION_NAME.
 * Does not read or write keystores or signing secrets.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const file = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'version.properties');

function usage() {
  console.log(`Usage:
  node scripts/bump-version.mjs --bump-code [--name 1.0.6]
  node scripts/bump-version.mjs --code 7 --name 1.0.6`);
}

function parseArgs(argv) {
  const out = { bumpCode: false, code: null, name: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--bump-code') out.bumpCode = true;
    else if (arg === '--code') out.code = argv[++i];
    else if (arg === '--name') out.name = argv[++i];
    else if (arg === '--help' || arg === '-h') out.help = true;
    else {
      console.error(`Unknown argument: ${arg}`);
      usage();
      process.exit(1);
    }
  }
  return out;
}

function readProps(text) {
  const props = {};
  for (const line of text.split(/\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    props[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return props;
}

function parseCode(raw, label) {
  const text = String(raw ?? '').trim();
  const code = Number.parseInt(text, 10);
  if (!Number.isInteger(code) || code < 1 || String(code) !== text) {
    console.error(`${label} must be a positive integer`);
    process.exit(1);
  }
  return code;
}

const args = parseArgs(process.argv.slice(2));
if (args.help || (!args.bumpCode && args.code == null && args.name == null)) {
  usage();
  process.exit(args.help ? 0 : 1);
}
if (args.code === undefined || args.name === undefined) {
  console.error('Missing value for --code or --name');
  usage();
  process.exit(1);
}

const raw = fs.readFileSync(file, 'utf8');
const props = readProps(raw);
let code = parseCode(props.VERSION_CODE, 'VERSION_CODE');
if (args.code != null) {
  code = parseCode(args.code, '--code');
} else if (args.bumpCode) {
  code += 1;
}

let name = props.VERSION_NAME || '1.0.5';
if (args.name != null) {
  name = String(args.name).trim();
  if (!/^[0-9A-Za-z][0-9A-Za-z._+-]*$/.test(name)) {
    console.error('--name must be a version string such as 1.0.6');
    process.exit(1);
  }
}

const header = `# Android version for za.co.africuz.watchman.
# VERSION_CODE must increase by at least 1 for every Play upload.
# VERSION_NAME is the user-visible version (versionName).
# Override without editing this file:
#   ./gradlew bundleRelease -Pwatchman.versionCode=7 -Pwatchman.versionName=1.0.6
#   WATCHMAN_VERSION_CODE=7 WATCHMAN_VERSION_NAME=1.0.6 ./gradlew bundleRelease
# Precedence: -P flags, then those env vars, then this file, then 6 / 1.0.5.
`;
fs.writeFileSync(file, `${header}VERSION_CODE=${code}\nVERSION_NAME=${name}\n`);
console.log(`VERSION_CODE=${code}`);
console.log(`VERSION_NAME=${name}`);
