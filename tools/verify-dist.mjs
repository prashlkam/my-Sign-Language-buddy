#!/usr/bin/env node
/**
 * Pre-flight check on the built extension.
 *
 * Chrome's failure mode for a bad manifest is a modal that names one problem at
 * a time, so a missing file costs a full load-unload cycle to find. This walks
 * every path the manifest references and reports all of them at once.
 */
import { access, readFile, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../packages/extension/dist',
);

const problems = [];
const checked = new Set();

async function must(rel, why) {
  if (checked.has(rel)) return;
  checked.add(rel);
  try {
    await access(join(dist, rel));
  } catch {
    problems.push(`missing ${rel} (${why})`);
  }
}

async function mustHaveFiles(dir, why) {
  try {
    const entries = await readdir(join(dist, dir));
    if (entries.length === 0) problems.push(`${dir}/ is empty (${why})`);
  } catch {
    problems.push(`missing ${dir}/ (${why})`);
  }
}

let manifest;
try {
  manifest = JSON.parse(await readFile(join(dist, 'manifest.json'), 'utf8'));
} catch (err) {
  console.error(`manifest.json is missing or invalid JSON: ${err.message}`);
  console.error('Run `npm run build` first.');
  process.exit(1);
}

await must(manifest.background.service_worker, 'background.service_worker');
await must(manifest.action.default_popup, 'action.default_popup');
await must(manifest.options_page, 'options_page');

for (const cs of manifest.content_scripts ?? []) {
  for (const js of cs.js ?? []) await must(js, 'content_scripts');
  for (const css of cs.css ?? []) await must(css, 'content_scripts');
}

for (const war of manifest.web_accessible_resources ?? []) {
  for (const r of war.resources ?? []) {
    if (r.endsWith('/*')) await mustHaveFiles(r.slice(0, -2), 'web_accessible_resources');
    else if (!r.includes('*')) await must(r, 'web_accessible_resources');
  }
}

// Referenced by HTML rather than by the manifest, so easy to forget.
await must('offscreen.html', 'created by the service worker at runtime');
await must('offscreen.js', 'loaded by offscreen.html');
await must('content/main.js', 'dynamic-imported by content-loader.js');
await must('pcm-worklet.js', 'loaded by the offscreen AudioContext');

// Not fatal: the extension runs without these, only the camera path is off.
const warnings = [];
for (const model of ['models/hand_landmarker.task', 'models/pose_landmarker_lite.task']) {
  try {
    await access(join(dist, model));
  } catch {
    warnings.push(`${model} absent — keypoint extraction will be disabled (npm run fetch-models)`);
  }
}

for (const w of warnings) console.warn(`warn: ${w}`);

if (problems.length > 0) {
  console.error(`\n${problems.length} problem(s) would stop Chrome loading this build:`);
  for (const p of problems) console.error(`  ✗ ${p}`);
  process.exit(1);
}

console.log(`✓ manifest v${manifest.manifest_version} "${manifest.name}" — ${checked.size} referenced paths present`);
console.log(`  load unpacked from: ${dist}`);
