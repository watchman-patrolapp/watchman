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

/** WAV is not shipped — Android WebView and iOS Safari both play MP3/OGG. */
const COMPRESSED_EXT = new Set(['.mp3', '.ogg', '.opus']);

const missing = [];
const empty = [];
const uncompressed = [];

for (const file of SOUND_FILES) {
  const ext = path.extname(file).toLowerCase();
  if (!COMPRESSED_EXT.has(ext)) {
    uncompressed.push(file);
    continue;
  }
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

if (missing.length || empty.length || uncompressed.length) {
  console.error('\n[sound-assets] Required files under public/sounds/ are missing, too small, or not compressed.\n');
  if (uncompressed.length) {
    console.error('Not compressed audio (.mp3/.ogg/.opus):');
    uncompressed.forEach((f) => console.error('  -', f));
  }
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
