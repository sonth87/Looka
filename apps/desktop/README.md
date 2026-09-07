# @face/desktop (Looka)

Electron kiosk app for guided face capture.

## Building the Windows package

```
pnpm --filter @face/desktop run package:win
```

This produces **three different things** under `release/`, and it is easy to
grab the wrong one when testing a build by hand:

| Artifact | What it actually is | What happens when you run it |
| --- | --- | --- |
| `release/win-unpacked/Looka.exe` | The unpacked app itself — Electron runtime + `resources/app.asar`, no installer wrapper. | Runs the kiosk app directly, exactly like an install would once one has completed. **This is what to run to test app behavior without installing anything.** |
| `release/Looka-<version>-win-x64.exe` | The **NSIS installer** (`electron-builder.json`'s `nsis.oneClick: false`, `allowToChangeInstallationDirectory: true`). | Opens a **"Looka Setup" wizard window** — license/directory/shortcut steps, an Install button, a Finish button. It does **not** run the kiosk app on its own; nothing gets installed or written to `%APPDATA%\FacePlatformKiosk` until the wizard is clicked through to completion. If you launch it unattended (e.g. from a script) and don't interact with it, the wizard just sits open — no camera UI, no logs, no persistence — which looks exactly like "the app is silently broken" if you don't realize it's an installer, not the app. |
| `release/Looka-<version>-win-x64.zip` | A zipped copy of `win-unpacked/`. | Extract and run `Looka.exe` inside it — same as the unpacked folder above. |

Because `nsis.oneClick` is `false`, the installer also lets the operator pick
a custom install directory (`allowToChangeInstallationDirectory: true`), so a
completed install will **not** necessarily live under the usual
`%LOCALAPPDATA%\Programs\Looka` — it lives wherever whoever ran the wizard
pointed it. `activation.json` (for `findAndImportActivationFileIfPresent()`
in `src/main/secrets.ts`) has to sit next to *that* installed `Looka.exe`,
not next to the installer `.exe` in `release/` and not next to
`win-unpacked/Looka.exe` unless that's genuinely where the operator installed
it.

**Quick sanity check without installing anything:**

```
pnpm --filter @face/desktop run package:win:dir   # --dir: skip the installer, just produce win-unpacked/
release\win-unpacked\Looka.exe                     # run the real app directly
```

`app.setName('FacePlatformKiosk')` in `src/main/index.ts` pins the userData
folder to `%APPDATA%\FacePlatformKiosk` regardless of which of the three
artifacts above you run, and regardless of the current `productName`
("Looka") — see that call's own doc comment. `logs/main.log` under that
folder is the first place to look; `src/main/logger.ts` mirrors every
`console.log/warn/error` there from the moment the process starts, including
a fatal top-level `.catch()` on the `app.whenReady()` chain and a global
`unhandledRejection` handler (`installCrashHandlers()`), so a startup
exception should never be silent.
