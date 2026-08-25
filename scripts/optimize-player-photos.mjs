// Optimize existing player photos in the Supabase `player-photos` bucket.
//
// - Lists every object, downloads the raw bytes
// - Recompresses with Jimp: max 900px, JPEG q0.82 (transparent PNGs stay PNG)
// - Re-uploads to the SAME path with long cache headers (photo_url in the DB
//   stays valid) — the object is atomically replaced
// - Writes a before/after report to scripts/photo-optimize-report.csv
//
// RUN ONLY WHEN READY:
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/optimize-player-photos.mjs
//
// Requires: npm i -D jimp   (pure-JS image processing, no native build)

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import Jimp from 'jimp';

const __dirname = dirname(fileURLToPath(import.meta.url));

function env(name) {
  const value = process.env[name];
  if (value) return value;
  const fromFile = readFileSync(resolve(__dirname, '..', '.env.local'), 'utf8')
    .split('\n')
    .find((line) => line.startsWith(`${name}=`));
  if (!fromFile) return undefined;
  return fromFile.slice(name.length + 1);
}

const SUPABASE_URL = env('SUPABASE_URL') ?? env('VITE_SUPABASE_URL');
const SERVICE_ROLE_KEY = env('SUPABASE_SERVICE_ROLE_KEY');
const BUCKET = env('PHOTO_BUCKET') ?? 'player-photos';
const MAX_DIMENSION = 900;
const JPEG_QUALITY = 0.82;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Put SUPABASE_SERVICE_ROLE_KEY in .env.local (dashboard > Settings > API).');
  process.exit(1);
}

const headers = { Authorization: `Bearer ${SERVICE_ROLE_KEY}`, apikey: SERVICE_ROLE_KEY, 'Content-Type': 'application/json' };

async function listObjects() {
  const response = await fetch(`${SUPABASE_URL}/storage/v1/object/list/${BUCKET}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ prefix: '', limit: 1000 }),
  });
  if (!response.ok) throw new Error(`list failed: ${response.status} ${await response.text()}`);
  const objects = await response.json();
  if (!Array.isArray(objects)) throw new Error('Unexpected list response');
  return objects;
}

async function downloadObject(name) {
  const response = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${encodeURIComponent(name)}`, { headers });
  if (!response.ok) throw new Error(`download ${name} failed: ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

async function uploadObject(name, buffer, contentType) {
  const response = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${encodeURIComponent(name)}`, {
    method: 'POST',
    headers: {
      ...headers,
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=31536000, immutable',
      'x-upsert': 'true',
    },
    body: buffer,
  });
  if (!response.ok) throw new Error(`upload ${name} failed: ${response.status} ${await response.text()}`);
}

async function optimize(buffer) {
  const image = await Jimp.read(buffer);
  const scale = Math.min(1, MAX_DIMENSION / Math.max(image.bitmap.width, image.bitmap.height));
  if (scale < 1) image.resize(Math.max(1, Math.round(image.bitmap.width * scale)), Math.max(1, Math.round(image.bitmap.height * scale)));
  const hasAlpha = image.hasAlpha();
  if (hasAlpha) {
    const png = await image.getBufferAsync(Jimp.MIME_PNG);
    return { buffer: png, contentType: 'image/png', extension: 'png' };
  }
  image.background(0xffffffff);
  const jpeg = await image.quality(JPEG_QUALITY * 100).getBufferAsync(Jimp.MIME_JPEG);
  return { buffer: jpeg, contentType: 'image/jpeg', extension: 'jpg' };
}

const objects = await listObjects();
const report = [['name', 'before_bytes', 'after_bytes', 'reduction_pct']];
let saved = 0;
let failures = 0;

console.log(`Found ${objects.length} objects in ${BUCKET}...`);

for (const object of objects) {
  const name = object.name;
  try {
    const raw = await downloadObject(name);
    const optimized = await optimize(raw);
    await uploadObject(name, optimized.buffer, optimized.contentType);
    const reduction = Math.round((1 - optimized.buffer.length / raw.length) * 100);
    saved += raw.length - optimized.buffer.length;
    report.push([name, raw.length, optimized.buffer.length, reduction]);
    console.log(`ok   ${name}  ${(raw.length / 1024).toFixed(0)}KB -> ${(optimized.buffer.length / 1024).toFixed(0)}KB (-${reduction}%)`);
  } catch (error) {
    failures += 1;
    report.push([name, 'ERROR', error.message, '']);
    console.error(`FAIL ${name}  ${error.message}`);
  }
}

writeFileSync(resolve(__dirname, 'photo-optimize-report.csv'), report.map((row) => row.join(',')).join('\n'), 'utf8');
console.log(`\nDone. Saved ${(saved / 1024 / 1024).toFixed(1)} MB (${saved ? Math.round((saved / (saved + 0)) * 100) : 0}%) — report: scripts/photo-optimize-report.csv`);
console.log(`${failures} failure(s).`);
