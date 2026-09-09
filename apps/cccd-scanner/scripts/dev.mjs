import { createServer } from 'vite';
import { spawn, execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import electronPath from 'electron';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, '..');

async function startDev() {
  console.log('[cccd-scanner dev] Compiling Electron main/preload TypeScript...');
  execSync('tsc -p tsconfig.electron.json', { cwd: appRoot, stdio: 'inherit' });

  console.log('[cccd-scanner dev] Starting Vite dev server on port 3010...');
  const server = await createServer({
    configFile: path.resolve(appRoot, 'vite.config.ts'),
    root: appRoot,
  });
  await server.listen(3010);

  const serverUrl = 'http://localhost:3010';
  console.log(`[cccd-scanner dev] Vite dev server running at ${serverUrl}`);
  console.log('[cccd-scanner dev] Launching Electron window...');

  const electronProcess = spawn(electronPath, ['.'], {
    cwd: appRoot,
    env: { ...process.env, VITE_DEV_SERVER_URL: serverUrl },
    stdio: 'inherit',
  });

  electronProcess.on('close', (code) => {
    console.log(`[cccd-scanner dev] Electron window closed (exit code: ${code}). Stopping Vite server...`);
    server.close();
    process.exit(code || 0);
  });
}

startDev().catch((err) => {
  console.error('[cccd-scanner dev] Failed to start dev mode:', err);
  process.exit(1);
});
