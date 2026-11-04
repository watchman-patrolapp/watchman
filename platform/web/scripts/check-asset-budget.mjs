/**
 * Fails the build if any file under public/ exceeds 500 KB.
 * Wired from package.json prebuild so a multi-megabyte favicon or WAV cannot regress.
 *
 * To allow a file, add its path relative to public/ (forward slashes) to ALLOWLIST
 * with a reason. Prefer compressing the asset instead.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '../public');
const MAX_BYTES = 500 * 1024;

/** @type {{ file: string, reason: string }[]} */
const ALLOWLIST = [
  // { file: 'videos/intro.mp4', reason: 'streamed, not precached' },
];

const allowed = new Set(ALLOWLIST.map((entry) => entry.file));

function walk(dir, acc = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      walk(full, acc);
    } else if (ent.isFile() || ent.isSymbolicLink()) {
      acc.push(full);
    }
  }
  return acc;
}

const offenders = [];
let files = 0;
let largest = { rel: '', size: 0 };

for (const full of walk(PUBLIC_DIR)) {
  const rel = path.relative(PUBLIC_DIR, full).split(path.sep).join('/');
  let size = 0;
  try {
    const st = fs.statSync(full);
    if (!st.isFile()) continue;
    size = st.size;
  } catch {
    continue;
  }
  files += 1;
  if (size > largest.size) largest = { rel, size };
  if (size > MAX_BYTES && !allowed.has(rel)) {
    offenders.push({ rel, size });
  }
}

if (offenders.length) {
  console.error(`\n[asset-budget] Files in public/ exceed ${MAX_BYTES} bytes (500 KB):\n`);
  offenders
    .sort((a, b) => b.size - a.size)
    .forEach((item) => {
      console.error(`  - ${item.rel} (${item.size} bytes)`);
    });
  console.error('\nCompress the asset, or add it to ALLOWLIST in scripts/check-asset-budget.mjs with a reason.\n');
  process.exit(1);
}

console.log(
  `[asset-budget] OK — ${files} files in public/, largest ${largest.rel || '(none)'} (${largest.size} bytes), limit ${MAX_BYTES}`,
);
