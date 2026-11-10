# Automatic desktop updates

This terminal follows `main` in `nisigma1/MALERA-POS`. Pushes to other branches do not update it. Pull this branch before making changes on another device; do not force-push or replace published update assets.

## Delivery

1. Push the change to `main`.
2. The **Desktop updates** GitHub Actions workflow installs locked dependencies, runs regression and updater tests, builds the app, checks a fresh production database and a simulated business day, audits UI workflows, packages the app, verifies its contents and native recovery module, then tests the installed app.
3. Only after these steps pass does it publish an immutable `desktop-<commit>-<run>-<attempt>` prerelease with the installer and update descriptor. This is an explicitly **QA / unsigned** channel. Signed production delivery is not configured in the active workflows.
4. The terminal checks every five minutes while the user is signed in, and on login. Scheduled checks download and verify updates; they never install, close the app or restart Windows.
5. Close the POS normally and open **MALERA POS** from its desktop or Start menu shortcut. Its launcher applies a staged update before starting the app. A running instance defers installation. The client makes a verified SQLite backup first and preserves the live data directory.

An update takes build time plus the terminal's polling interval; pushing does not immediately change the running app. Failed builds leave the previous version in place. When offline, the current app can launch; previously downloaded, verified updates can still be installed at launch.

The client checks repository, branch, workflow path, successful push run, source commit ancestry, release author, artifact name, platform, architecture and SHA-256 before installation. HTTPS and repository permissions form the trust boundary for this unsigned QA channel. No GitHub token is saved on the terminal. Keep push access limited to trusted developers. Public downloads stop working if the repository becomes private; provision a scoped authentication strategy before changing visibility.

## This PC

- Client and runtime: `%LOCALAPPDATA%\MALERA Update`
- Status: `status.json`; current installed commit/version: `state.json`
- Downloaded update metadata: `pending.json`
- Verified pre-update backups and matching restore manifests: `backups\`
- Task Scheduler task: `MALERA - Check GitHub updates`
- Normal business data: `%APPDATA%\FOX Kafeteri` (unchanged)

The updater does not invent prices, replace the database, restore old data automatically, or install while the POS is running. If installation fails it preserves the backup and records an error. Do not blindly downgrade an application after a schema migration; review compatibility and use the app's verified restore flow if needed. Backups are local; keep independent off-device backups too.

## Register another terminal

Install the app, then run from the repository root with a local Node runtime:

```powershell
./scripts/update/install-client.ps1 -Repository nisigma1/MALERA-POS -Branch main -NodePath 'C:\path\to\node.exe' -InstalledCommit '<full installer source commit>' -InstalledVersion '0.7.2-rc.4'
```

The bootstrap script copies the runtime and client outside the source checkout and registers a limited, interactive-user scheduled task. It rewrites app shortcuts to use the update launcher. Updates also repair installer-created shortcuts. No password or elevated task is stored.

Check now or view status:

```powershell
& "$env:LOCALAPPDATA\MALERA Update\runtime\node.exe" "$env:LOCALAPPDATA\MALERA Update\client.mjs" --check-only
& "$env:LOCALAPPDATA\MALERA Update\runtime\node.exe" "$env:LOCALAPPDATA\MALERA Update\client.mjs" --status
```

The version-1 updater is bootstrapped independently of app updates. Changes to the updater itself require rerunning the reviewed registration script; descriptors requiring another updater protocol are refused.

To stop automatic checks, disable the task in Task Scheduler and launch the installed executable directly. Re-enable the task and use the MALERA shortcut to resume the update path. Keep `state.json`, configuration and backups when repairing the client.
