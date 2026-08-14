import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

/**
 * File logging for the main process.
 *
 * Console output is invisible when the app is launched by double-clicking, which
 * is exactly how it runs on a kiosk — so a crash there leaves nothing to look
 * at. Everything is mirrored to a file under userData instead, and the previous
 * run is kept so a restart does not erase the evidence of why it restarted.
 */

let stream: fs.WriteStream | null = null;

export function logFilePath(): string {
  return path.join(app.getPath('userData'), 'logs', 'main.log');
}

function previousLogPath(): string {
  return path.join(app.getPath('userData'), 'logs', 'main.previous.log');
}

export function initLogger(): void {
  if (stream) return;

  const file = logFilePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });

  // Keep one generation back: the run that crashed is usually the one before
  // the run where somebody goes looking.
  try {
    if (fs.existsSync(file)) fs.renameSync(file, previousLogPath());
  } catch {
    /* rotation is best-effort; never block startup on it */
  }

  stream = fs.createWriteStream(file, { flags: 'a' });

  const original = { log: console.log, warn: console.warn, error: console.error };
  const write = (level: string, args: unknown[]) => {
    const line = `${new Date().toISOString()} ${level} ${args
      .map((a) => (a instanceof Error ? `${a.message}\n${a.stack}` : String(a)))
      .join(' ')}\n`;
    stream?.write(line);
  };

  console.log = (...a: unknown[]) => { write('INFO ', a); original.log(...a); };
  console.warn = (...a: unknown[]) => { write('WARN ', a); original.warn(...a); };
  console.error = (...a: unknown[]) => { write('ERROR', a); original.error(...a); };

  console.log(
    `--- start ${app.getName()} ${app.getVersion()} | electron ${process.versions.electron} | node ${process.versions.node} ---`
  );
}

/**
 * Record every way the process can end.
 *
 * A kiosk that "just closes" is the hardest thing to explain after the fact,
 * because the usual suspects — an unhandled rejection, a dead GPU process, a
 * quit triggered by a closing window — all leave no trace by default.
 */
export function installCrashHandlers(): void {
  process.on('uncaughtException', (err) => {
    console.error('[fatal] uncaught exception:', err);
    // Deliberately not exiting: an error in one handler should not take the
    // kiosk down mid-session while somebody is standing in front of it.
  });

  process.on('unhandledRejection', (reason) => {
    console.error('[fatal] unhandled rejection:', reason);
  });

  app.on('child-process-gone', (_e, details) => {
    console.error(
      `[fatal] child process gone: type=${details.type} reason=${details.reason} exit=${details.exitCode}`
    );
  });

  app.on('before-quit', () => console.log('[lifecycle] before-quit'));
  app.on('will-quit', () => console.log('[lifecycle] will-quit'));
  app.on('quit', (_e, code) => console.log(`[lifecycle] quit code=${code}`));
  app.on('window-all-closed', () => console.log('[lifecycle] window-all-closed'));
}

export function closeLogger(): void {
  stream?.end();
  stream = null;
}
