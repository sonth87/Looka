import { registerAs } from '@nestjs/config';

export const desktopInstaller = registerAs('desktopInstaller', () => ({
  // Path to the built Electron installer to embed in every activation zip —
  // a static file, copied in as-is (see ActivationPackageService's own doc
  // comment: never rebuilt per device). Left unset in dev/test: the zip then
  // contains activation.json alone, which is still a complete, testable
  // artifact for the registration flow, just missing the installer an
  // operator would need to actually run it on a kiosk.
  path: process.env.DESKTOP_INSTALLER_PATH,
}));
