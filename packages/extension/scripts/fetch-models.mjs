#!/usr/bin/env node
/**
 * Fetch the MediaPipe landmarker bundles into public/models/.
 *
 * These are Google's published model files, not ours. They are not committed
 * (see .gitignore) because they are large binaries with their own licence —
 * check the MediaPipe model card before redistributing them in a packaged
 * build.
 *
 * Nothing here is a sign language model. These extract hand and body keypoints;
 * turning keypoints into signs is M3 (PLAN.md §6) and needs trained weights we
 * do not have yet.
 */
import { mkdir, writeFile, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dest = join(root, 'public/models');

const MODELS = [
  {
    name: 'hand_landmarker.task',
    url: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
  },
  {
    name: 'pose_landmarker_lite.task',
    url: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
  },
];

async function have(path) {
  try {
    return (await stat(path)).size > 0;
  } catch {
    return false;
  }
}

await mkdir(dest, { recursive: true });

let failures = 0;
for (const m of MODELS) {
  const path = join(dest, m.name);
  if (await have(path)) {
    console.log(`= ${m.name} (already present)`);
    continue;
  }
  process.stdout.write(`↓ ${m.name} … `);
  try {
    const res = await fetch(m.url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    await writeFile(path, buf);
    console.log(`${(buf.length / 1e6).toFixed(1)} MB`);
  } catch (err) {
    failures++;
    console.log(`failed: ${err.message}`);
  }
}

if (failures > 0) {
  console.error(
    `\n${failures} model(s) missing. The extension still builds and the caption\n` +
      `pipeline (speech → text, type-to-speak) works without them; only the\n` +
      `camera/keypoint path is disabled.`,
  );
  process.exit(1);
}
