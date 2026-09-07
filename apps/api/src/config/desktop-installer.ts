import { registerAs } from '@nestjs/config';

export const desktopInstaller = registerAs('desktopInstaller', () => ({
  // Paths to the built Electron app to embed in an activation zip — copied
  // in as-is (see ActivationPackageService's own doc comment: never rebuilt
  // per device). Point these at the UNPACKED app folder (electron-builder's
  // `release/win-unpacked/` on Windows, or the `.app` bundle on mac), not an
  // NSIS/dmg installer — see ActivationPackageService's 2026-09-07 note on
  // why. Left unset in dev/test: the zip then contains activation.json
  // alone, which is still a complete, testable artifact for the
  // registration flow, just missing the app an operator would need to
  // actually run it on a kiosk.
  pathMac: process.env.DESKTOP_INSTALLER_PATH_MAC,
  pathWin: process.env.DESKTOP_INSTALLER_PATH_WIN,
}));
