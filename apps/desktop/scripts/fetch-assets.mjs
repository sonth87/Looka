/**
 * Collect the runtimes the desktop app needs into public/ so it carries them.
 *
 * Both the MediaPipe WASM runtime and the model files are otherwise fetched
 * from a CDN at startup, which makes an "offline-first" kiosk fail the moment
 * it has no network — the exact situation it exists to survive. sql.js's own
 * .wasm is the same story: unpackaged, it's requested from wherever
 * SQLiteStorageAdapter's wasmBaseUrl points, and under the packaged app's
 * file:// origin there is no server to fall back to. All three ship inside
 * their npm packages; the .task models do not, so those are downloaded once
 * here and committed to the build, never at run time.
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
  {
    // "lite" rather than "full"/"heavy": this runs alongside face and hand
    // detection every frame on the same kiosk hardware, and the shoulder-
    // level check it feeds only needs two landmarks to be roughly right, not
    // studio-grade pose accuracy.
    file: 'pose_landmarker_lite.task',
    url: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
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

/**
 * Locate the installed sql.js package directory.
 *
 * Same restricted-"exports" situation as mediapipeDir() above: resolve a file
 * the package does export and walk up to find its dist/ folder.
 */
function sqlJsDir() {
  const entry = require.resolve('sql.js');
  let dir = path.dirname(entry);
  for (let i = 0; i < 5; i++) {
    if (fs.existsSync(path.join(dir, 'dist'))) return dir;
    dir = path.dirname(dir);
  }
  throw new Error(`Could not find the dist folder near ${entry}`);
}

function copySqlJsWasm() {
  const srcDir = path.join(sqlJsDir(), 'dist');
  const destDir = path.join(publicDir, 'wasm');
  fs.mkdirSync(destDir, { recursive: true });

  // Both non-debug variants, because which one is requested depends on the
  // glue file the bundler resolves: sql.js publishes a browser build that
  // asks for sql-wasm-browser.wasm and a generic one that asks for
  // sql-wasm.wasm, and locateFile only rewrites the directory, never the
  // filename. Shipping only one means the other 404s at runtime with no
  // useful error, same class of failure copyWasm() above exists to avoid.
  const names = ['sql-wasm.wasm', 'sql-wasm-browser.wasm'];
  const copied = [];
  for (const name of names) {
    const src = path.join(srcDir, name);
    if (!fs.existsSync(src)) continue;
    fs.copyFileSync(src, path.join(destDir, name));
    copied.push(name);
  }
  if (copied.length === 0) {
    throw new Error(`none of ${names.join(', ')} found in ${srcDir}`);
  }
  console.log(`sql.js: copied ${copied.join(', ')} -> public/wasm/`);
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
  copySqlJsWasm();
  await fetchModels();
  console.log('\nAssets ready. The app no longer reaches the network to start its face engine.');
} catch (err) {
  console.error('\nAsset preparation failed:', err.message);
  process.exit(1);
}
