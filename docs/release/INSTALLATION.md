# Installation and deployment

The current application is a Windows x64 QA release candidate. Its automatic channel is unsigned; signed production delivery is not configured in the active workflows.

## Install or upgrade

Download the installer, matching checksum and release manifest from the repository's desktop prerelease. Validate the checksum against both the `.sha256` file and manifest. Close MALERA normally and make a verified application backup before running the installer as the same Windows user.

The installer is per-user. It preserves `%APPDATA%\FOX Kafeteri` and upgrades application binaries. Startup handles reviewed database migrations; migration failures stop startup rather than silently creating a blank database. Never delete the profile to resolve an installation problem.

The executable remains `FOX Kafeteri.exe` and the app ID remains `com.foxkafeteri.pos` for compatibility. The visible product is MALERA POS.

## Automatic updates

See [automatic updates](AUTOMATIC_UPDATES.md). `main` is the delivery branch. The workflow builds and tests a commit before publishing it; terminals download in the background and install at next launch while closed, after backup. Failed builds or missing publication do not change the installed app.

## Build a local QA installer

From a clean, committed Windows checkout:

```powershell
npm ci
npm test
node --test tests/updateClient.node.mjs
npm run package:win -- --qa
./scripts/release/verify-release.ps1
```

Build tools are required on the development machine. The installed POS itself needs no Node, Git, Python or compiler; the standalone updater carries its own Node runtime.

Use [acceptance checks](ACCEPTANCE_CHECKLIST.md) before handing the terminal over. Signing-provider configuration helpers remain in `scripts/release/` for future reviewed production delivery; old release-engineering documents live in `docs/history/`.
