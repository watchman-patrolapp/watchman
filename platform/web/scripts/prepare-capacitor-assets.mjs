/**
 * Copies public/icon-512.png → assets/logo.png for @capacitor/assets (Easy Mode).
 * Single source of truth for app + PWA + Android launcher artwork.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const src = path.join(root, 'public', 'icon-512.png');
const destDir = path.join(root, 'assets');
const dest = path.join(destDir, 'logo.png');

if (!fs.existsSync(src)) {
  console.error('Missing source icon:', src);
  console.error('Add or update public/icon-512.png, then re-run.');
  process.exit(1);
}

fs.mkdirSync(destDir, { recursive: true });
fs.copyFileSync(src, dest);
console.log('Prepared', dest, 'from', src);
