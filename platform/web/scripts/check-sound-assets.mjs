/**
 * Fails the build if any required sound under public/sounds/ is missing or empty.
 * Run from package.json prebuild / predev.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { SOUND_FILES } from './sound-asset-list.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SOUNDS_DIR = path.join(__dirname, '../public/sounds');

const missing = [];
const empty = [];

for (const file of SOUND_FILES) {
  const full = path.join(SOUNDS_DIR, file);
  if (!fs.existsSync(full)) {
    missing.push(file);
    continue;
  }
  const st = fs.statSync(full);
  if (!st.isFile() || st.size < 100) {
    empty.push(file);
  }
}

if (missing.length || empty.length) {
  console.error('\n[sound-assets] Required files under public/sounds/ are missing or too small.\n');
  if (missing.length) {
    console.error('Missing:');
    missing.forEach((f) => console.error('  -', f));
  }
  if (empty.length) {
    console.error('Invalid (empty or <100 bytes):');
    empty.forEach((f) => console.error('  -', f));
  }
  console.error('\nRegenerate placeholders from platform/web:');
  console.error('  node scripts/generate-placeholder-sounds.mjs\n');
  process.exit(1);
}

console.log('[sound-assets] OK —', SOUND_FILES.length, 'files in public/sounds/');
