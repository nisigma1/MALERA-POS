# FOX Windows deployment

Release candidate 0.4.2. Install the Windows x64 NSIS installer; do not copy source or win-unpacked. The target laptop needs no Node, npm, Git, Python or build tools. GitHub CLI is needed only for the optional authenticated download helper. Internet is required to download a release; the installed POS operates offline.

## Install and upgrade

Download `FOX-Setup-X.Y.Z-x64.exe`, its `.sha256`, and `release-manifest.json` from the private approved release, or transfer them by USB. Compare `Get-FileHash -Algorithm SHA256` with both checksum and manifest. Close FOX, make a backup, then run the installer under the same Windows user. Installation is per user, with Desktop and Start Menu shortcuts. Launch FOX Kafeteri, verify the 27 positions, existing orders, sales and inventory before operating.

The stable identity is `com.foxkafeteri.pos`; product and Electron app name are `FOX Kafeteri`. Keep these stable in future releases. Installing newer binaries does not install a replacement database. Startup applies transactional migrations and inserts only missing reference IDs. Failed migrations stop startup and preserve the database; there is no blank-database recovery fallback.

## Data and backup

Main calls `app.setName('FOX Kafeteri')` before resolving `app.getPath('userData')`. On this verified Windows account the operational database is `C:\Users\Nisigma\AppData\Roaming\FOX Kafeteri\fox.sqlite`. For another account, open `%APPDATA%\FOX Kafeteri`. This directory is separate from application binaries. Uninstall is configured to retain it; isolated real uninstall/reinstall tests are recorded in the release audit.

Close FOX and confirm no FOX process remains before making a manual copy of the entire data directory, including any SQLite WAL/SHM files. Never copy only fox.sqlite while FOX is running. A technical live backup must use SQLite's backup API. No automatic pre-migration backup is introduced: take the closed-app backup before every upgrade, retain it separately, and never overwrite it during installation.

If installation fails, preserve this folder and retry the verified installer. Do not delete, rename, reset or replace the database. If migration fails, stop and seek technical assistance; restoration from a known backup requires an explicit operator decision and may lose later transactions.

## Signing and security

Current installer is **UNSIGNED**. No production code-signing certificate is available. Windows may show Unknown Publisher/SmartScreen. Do not disable Defender or bypass certificate verification; follow the site's security policy. Future real signing uses electron-builder's `CSC_LINK`/`CSC_KEY_PASSWORD` or Windows-specific `WIN_CSC_LINK`/`WIN_CSC_KEY_PASSWORD` via environment/GitHub Secrets. Never commit certificates or passwords. Validate Authenticode status after signing; checksums are then calculated from the signed final artifact.

No autoupdate, telemetry, Windows startup task, file association, firewall rule or runtime network listener is installed. Only one operational FOX instance is allowed. A second launch restores/focuses the existing window.

## Private release administration

Development uses Node 24.13.1 from .nvmrc and the committed npm lockfile. Run `npm ci`, `npm test`, `npm run typecheck`, `npm run build`. Choose a reviewed version with `npm version patch --no-git-tag-version`; commit package.json and package-lock.json. Build with `npm run package:win` and verify with `./scripts/verify-release.ps1`. Perform installed smoke, crash/restart, A→B upgrade and reinstall tests before deploying.

Push main, then create an immutable `vX.Y.Z` tag matching package version. The Windows workflow validates the exact tag, private repository, native rebuild, all tests and verified package before creating a **draft** release. Review the three assets, commit, checksum, signing and release notes manually before publication. Never replace artifacts on an existing tag. Do not publish QA versions.

Optional reviewed install helper: `./scripts/install-fox.ps1 -Repository nisigma1/fox-pos`. Requires an already authenticated GitHub CLI; accepts only published stable releases, validates checksum/manifest, waits for installer and cleans its owned download folder. No token is embedded or persisted. Do not use `irm | iex`.

A second physical Windows laptop and a clean VM without developer dependencies remain separate acceptance checks. Do not call this production-ready until these operational tests and product/stock configuration are reviewed. Existing unusual prices or incomplete historical costs are business-data issues, not installer corrections.

Implementation references: [electron-builder NSIS](https://www.electron.build/v26/docs/nsis/) and [application contents](https://www.electron.build/v26/docs/contents/).
