import { createServer } from 'vite';
import { spawn, execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import electronPath from 'electron';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(__dirname, '..');

async function startDev() {
  console.log('⚡ [Desktop Dev] Compiling Electron main/preload TypeScript...');
  execSync('tsc -p tsconfig.electron.json', { cwd: desktopRoot, stdio: 'inherit' });

  console.log('⚡ [Desktop Dev] Starting Vite dev server on port 3001...');
  const server = await createServer({
    configFile: path.resolve(desktopRoot, 'vite.config.ts'),
    root: desktopRoot,
  });
  await server.listen(3001);

  const serverUrl = 'http://localhost:3001';
  console.log(`🚀 [Desktop Dev] Vite dev server running at ${serverUrl}`);
  console.log('🖥️  [Desktop Dev] Launching Electron window...');

  const electronProcess = spawn(electronPath, ['.'], {
    cwd: desktopRoot,
    env: { ...process.env, VITE_DEV_SERVER_URL: serverUrl },
    stdio: 'inherit',
  });

  electronProcess.on('close', (code) => {
    console.log(`👋 Electron window closed (exit code: ${code}). Stopping Vite server...`);
    server.close();
    process.exit(code || 0);
  });
}

startDev().catch((err) => {
  console.error('❌ Failed to start Desktop dev mode:', err);
  process.exit(1);
});
