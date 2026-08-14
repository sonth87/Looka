/**
 * Collect the runtimes the browser build needs into public/.
 *
 * Two libraries here load a .wasm file over HTTP at startup rather than through
 * the bundler: MediaPipe for face landmarks, and sql.js for the local database.
 * Neither is resolved by Vite, so without this step the dev server answers those
 * requests with index.html — the loaders receive HTML where they expected wasm
 * and fail with a parse error that names neither the file nor the cause.
 *
 * The .task models are not published inside the npm package, so they are fetched
 * once here and committed to the build rather than pulled at run time.
 *
 * Run: pnpm --filter @face/web fetch:assets
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
 * Locate an installed package directory.
 *
 * Packages that restrict their "exports" cannot have package.json resolved
 * directly, so resolve a file they do export and walk up to the package root.
 */
function packageDirContaining(specifier, marker) {
  const entry = require.resolve(specifier);
  let dir = path.dirname(entry);
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(dir, marker))) return dir;
    dir = path.dirname(dir);
  }
  throw new Error(`Could not find ${marker} near ${entry}`);
}

function copyMediapipeWasm() {
  const srcDir = path.join(packageDirContaining('@mediapipe/tasks-vision', 'wasm'), 'wasm');
  const destDir = path.join(publicDir, 'wasm');
  fs.mkdirSync(destDir, { recursive: true });

  let copied = 0;
  for (const name of fs.readdirSync(srcDir)) {
    fs.copyFileSync(path.join(srcDir, name), path.join(destDir, name));
    copied++;
  }
  console.log(`mediapipe: copied ${copied} files -> public/wasm/`);
}

function copySqlJsWasm() {
  const srcDir = path.join(packageDirContaining('sql.js', 'dist'), 'dist');
  const destDir = path.join(publicDir, 'wasm');
  fs.mkdirSync(destDir, { recursive: true });

  // Both non-debug variants, because which one is requested depends on the glue
  // file the bundler resolves: sql.js publishes a browser build that asks for
  // sql-wasm-browser.wasm and a generic one that asks for sql-wasm.wasm, and
  // locateFile only rewrites the directory, never the filename. Shipping only
  // one meant the dev server answered the other with index.html under a 200,
  // so the failure surfaced as a wasm magic-word error naming no file.
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
  copyMediapipeWasm();
  copySqlJsWasm();
  await fetchModels();
  console.log('\nAssets ready. The web build no longer reaches the network to start.');
} catch (err) {
  console.error('\nAsset preparation failed:', err.message);
  process.exit(1);
}
