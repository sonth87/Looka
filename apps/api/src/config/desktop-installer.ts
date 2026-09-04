import { registerAs } from '@nestjs/config';

export const desktopInstaller = registerAs('desktopInstaller', () => ({
  // Paths to the built Electron installers to embed in an activation zip —
  // static files, copied in as-is (see ActivationPackageService's own doc
  // comment: never rebuilt per device). Left unset in dev/test: the zip then
  // contains activation.json alone, which is still a complete, testable
  // artifact for the registration flow, just missing the installer an
  // operator would need to actually run it on a kiosk.
  pathMac: process.env.DESKTOP_INSTALLER_PATH_MAC,
  pathWin: process.env.DESKTOP_INSTALLER_PATH_WIN,
}));
