/**
 * Writes minimal valid WAV placeholders (~0.1s quiet tone) for each entry in sound-asset-list.mjs.
 * Run: node scripts/generate-placeholder-sounds.mjs
 * Safe to re-run; overwrites existing files.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { SOUND_FILES } from './sound-asset-list.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SOUNDS_DIR = path.join(__dirname, '../public/sounds');

/** 16-bit mono PCM WAV */
function buildWavBuffer({ sampleRate = 8000, durationSec = 0.12, frequencyHz = 880, amplitude = 0.12 }) {
  const numSamples = Math.floor(sampleRate * durationSec);
  const numChannels = 1;
  const bitsPerSample = 16;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const byteRate = sampleRate * blockAlign;
  const dataSize = numSamples * blockAlign;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const env = Math.min(1, i / (sampleRate * 0.02)) * Math.min(1, (numSamples - i) / (sampleRate * 0.03));
    const v = Math.sin(2 * Math.PI * frequencyHz * t) * amplitude * env;
    const s = Math.max(-32768, Math.min(32767, Math.round(v * 32767)));
    buffer.writeInt16LE(s, 44 + i * 2);
  }

  return buffer;
}

function hashToFreq(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return 440 + (Math.abs(h) % 440);
}

fs.mkdirSync(SOUNDS_DIR, { recursive: true });

for (const file of SOUND_FILES) {
  const out = path.join(SOUNDS_DIR, file);
  const base = path.basename(file, '.wav');
  const buf = buildWavBuffer({ frequencyHz: hashToFreq(base) });
  fs.writeFileSync(out, buf);
  console.log('wrote', path.relative(path.join(__dirname, '..'), out), `(${buf.length} bytes)`);
}

console.log('Done:', SOUND_FILES.length, 'placeholder WAV files in public/sounds/');
