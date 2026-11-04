/**
 * Fail the build if a Vite client env var name contains SERVICE_ROLE or SECRET.
 * Every VITE_* value is inlined into the browser bundle.
 * Run from package.json prebuild.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

const PREFIX = 'VITE_';
const BANNED_PARTS = ['SERVICE_ROLE', 'SECRET'];
const NAME_RE = /\bVITE_[A-Za-z0-9_]+\b/g;

const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  'dist-ssr',
  'dev-dist',
  '.git',
]);

const TEXT_EXT = new Set([
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.ts',
  '.tsx',
  '.html',
  '.json',
  '.md',
  '.yml',
  '.yaml',
  '.toml',
  '.example',
  '.env',
  '.local',
  '.css',
]);

function isForbiddenName(name) {
  if (!name.startsWith(PREFIX)) return false;
  const rest = name.slice(PREFIX.length).toUpperCase();
  return BANNED_PARTS.some((part) => rest.includes(part));
}

function shouldScan(filePath) {
  const base = path.basename(filePath);
  if (base === 'package-lock.json') return false;
  if (base === 'check-no-secrets-in-env.mjs') return false;
  if (base === '.env' || base.startsWith('.env.')) return true;
  return TEXT_EXT.has(path.extname(base).toLowerCase());
}

function walk(dir, out) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    if (SKIP_DIRS.has(ent.name)) continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(full, out);
    else if (ent.isFile() && shouldScan(full)) out.push(full);
  }
}

const hits = [];

for (const key of Object.keys(process.env)) {
  if (isForbiddenName(key)) hits.push(`process.env: ${key}`);
}

const files = [];
walk(root, files);

for (const file of files) {
  let text;
  try {
    const buf = fs.readFileSync(file);
    if (buf.includes(0)) continue;
    text = buf.toString('utf8');
  } catch {
    continue;
  }
  const names = text.match(NAME_RE) || [];
  const bad = [...new Set(names.filter(isForbiddenName))];
  for (const name of bad) {
    hits.push(`${path.relative(root, file)}: ${name}`);
  }
}

if (hits.length) {
  console.error(
    '[check-no-secrets-in-env] Refusing to build. A VITE_* variable name contains SERVICE_ROLE or SECRET.'
  );
  console.error('Vite inlines every VITE_* value into the client bundle.');
  hits.forEach((hit) => console.error('  -', hit));
  process.exit(1);
}

console.log('[check-no-secrets-in-env] OK');
