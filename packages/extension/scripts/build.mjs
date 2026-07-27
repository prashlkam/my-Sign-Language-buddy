#!/usr/bin/env node
/**
 * Build the MV3 extension with esbuild.
 *
 * Why esbuild directly instead of Vite + a CRX plugin: MV3 content scripts
 * cannot be ES modules, but we want code splitting so that MediaPipe and
 * ONNX Runtime (tens of megabytes between them) load only when the user
 * actually turns the sign pipeline on. The standard workaround is a tiny IIFE
 * loader declared in the manifest that dynamic-imports the real ESM entry from
 * web_accessible_resources. That is two different output formats from one
 * source tree, which is three lines here and a fight with a bundler plugin.
 */
import * as esbuild from 'esbuild';
import { cp, mkdir, rm, readdir, access } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(root, '../..');
const out = join(root, 'dist');
const watch = process.argv.includes('--watch');

const shared = {
  bundle: true,
  target: ['chrome116'],
  jsx: 'automatic',
  sourcemap: watch ? 'inline' : false,
  minify: !watch,
  logLevel: 'info',
  define: { 'process.env.NODE_ENV': watch ? '"development"' : '"production"' },
  alias: { '@slb/core': join(repoRoot, 'packages/core/src/index.ts') },
};

async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

/** Copy a dependency's runtime assets, but don't hard-fail if it isn't installed. */
async function copyOptional(from, to, label) {
  if (!(await exists(from))) {
    console.warn(`  ! ${label}: not found at ${from} — the feature will be disabled at runtime`);
    return;
  }
  await cp(from, to, { recursive: true });
  console.log(`  + ${label}`);
}

async function copyAssets() {
  await cp(join(root, 'public'), out, { recursive: true });

  // MediaPipe vision WASM — needed for keypoint extraction.
  await copyOptional(
    join(repoRoot, 'node_modules/@mediapipe/tasks-vision/wasm'),
    join(out, 'wasm'),
    'mediapipe wasm',
  );

  // ONNX Runtime Web — only the wasm/mjs runtime files, not the whole dist.
  const ortDist = join(repoRoot, 'node_modules/onnxruntime-web/dist');
  if (await exists(ortDist)) {
    await mkdir(join(out, 'ort'), { recursive: true });
    const files = await readdir(ortDist);
    let n = 0;
    for (const f of files) {
      if (/\.(wasm|mjs)$/.test(f)) {
        await cp(join(ortDist, f), join(out, 'ort', f));
        n++;
      }
    }
    console.log(`  + onnxruntime wasm (${n} files)`);
  } else {
    console.warn('  ! onnxruntime-web not installed — the ONNX recogniser will be unavailable');
  }

  const models = join(root, 'public/models');
  const present = (await exists(models)) ? (await readdir(models)).filter((f) => !f.startsWith('.')) : [];
  if (present.length === 0) {
    console.warn('  ! no models in public/models — run `npm run fetch-models` for keypoint extraction');
  }
}

const builds = [
  // Tiny IIFE stub named in the manifest; everything real is lazily imported.
  { entry: 'src/content/loader.ts', outfile: 'content-loader.js', format: 'iife' },
  // Service worker: MV3 allows ESM here.
  { entry: 'src/background/service-worker.ts', outfile: 'service-worker.js', format: 'esm' },
  { entry: 'src/offscreen/offscreen.ts', outfile: 'offscreen.js', format: 'iife' },
  { entry: 'src/options/main.tsx', outfile: 'options.js', format: 'iife' },
  { entry: 'src/popup/main.tsx', outfile: 'popup.js', format: 'iife' },
];

async function run() {
  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });

  const contexts = [];

  // The content entry is built as split ESM into dist/content/ so the heavy
  // ML chunks stay out of the initial load.
  const contentOpts = {
    ...shared,
    entryPoints: [join(root, 'src/content/main.tsx')],
    outdir: join(out, 'content'),
    format: 'esm',
    splitting: true,
    chunkNames: '[name]-[hash]',
  };

  const simpleOpts = builds.map((b) => ({
    ...shared,
    entryPoints: [join(root, b.entry)],
    outfile: join(out, b.outfile),
    format: b.format,
  }));

  if (watch) {
    for (const opts of [contentOpts, ...simpleOpts]) {
      const ctx = await esbuild.context(opts);
      await ctx.watch();
      contexts.push(ctx);
    }
    await copyAssets();
    console.log('\nwatching… (asset copies do not re-run; restart if you edit public/)');
  } else {
    await Promise.all([contentOpts, ...simpleOpts].map((o) => esbuild.build(o)));
    console.log('bundles built; copying assets…');
    await copyAssets();
    console.log(`\ndone → ${out}\nLoad it: chrome://extensions → Developer mode → Load unpacked → ${out}`);
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
