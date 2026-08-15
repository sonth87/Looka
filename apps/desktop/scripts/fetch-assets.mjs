/**
 * Collect the MediaPipe runtime into public/ so the app carries it.
 *
 * Both the WASM runtime and the model files are otherwise fetched from a CDN at
 * startup, which makes an "offline-first" kiosk fail the moment it has no
 * network — the exact situation it exists to survive. The WASM ships inside the
 * npm package; the .task models do not, so they are downloaded once here and
 * committed to the build, never at run time.
 *
 * Run: pnpm --filter @face/desktop fetch:assets
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(here, '..', 'public');

const MODELS = [
  {
    file: 'face_landmarker.task',
    url: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
  },
  {
    file: 'hand_landmarker.task',
    url: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
  },
];

/**
 * Locate the installed package directory.
 *
 * The package restricts its "exports", so package.json cannot be resolved
 * directly; resolve a file it does export and walk up to the package root.
 */
function mediapipeDir() {
  const entry = require.resolve('@mediapipe/tasks-vision');
  let dir = path.dirname(entry);
  for (let i = 0; i < 5; i++) {
    if (fs.existsSync(path.join(dir, 'wasm'))) return dir;
    dir = path.dirname(dir);
  }
  throw new Error(`Could not find the wasm folder near ${entry}`);
}

function copyWasm() {
  const srcDir = path.join(mediapipeDir(), 'wasm');
  const destDir = path.join(publicDir, 'wasm');

  if (!fs.existsSync(srcDir)) {
    throw new Error(`MediaPipe wasm directory not found at ${srcDir}`);
  }
  fs.mkdirSync(destDir, { recursive: true });

  let copied = 0;
  for (const name of fs.readdirSync(srcDir)) {
    fs.copyFileSync(path.join(srcDir, name), path.join(destDir, name));
    copied++;
  }
  console.log(`wasm: copied ${copied} files -> public/wasm/`);
}

async function fetchModels() {
  const destDir = path.join(publicDir, 'models');
  fs.mkdirSync(destDir, { recursive: true });

  for (const { file, url } of MODELS) {
    const dest = path.join(destDir, file);
    if (fs.existsSync(dest) && fs.statSync(dest).size > 0) {
      console.log(`models: ${file} already present, skipping`);
      continue;
    }
    process.stdout.write(`models: downloading ${file} ... `);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${res.status} fetching ${url}`);
    fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
    console.log(`${(fs.statSync(dest).size / 1024 / 1024).toFixed(1)} MB`);
  }
}

try {
  copyWasm();
  await fetchModels();
  console.log('\nAssets ready. The app no longer reaches the network to start its face engine.');
} catch (err) {
  console.error('\nAsset preparation failed:', err.message);
  process.exit(1);
}
