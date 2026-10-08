# FOX release checklist

## Pre-release
- Review clean git status and intentional version/lockfile change.
- npm ci; npm test; npm run typecheck; npm run build.
- No DB, installers, keys or environment secrets tracked; inspect source/history.
- Preserve stable appId/name and current userData location.

## Package
- npm run package:win; ./scripts/verify-release.ps1.
- Confirm final SHA-256, manifest commit/version/x64 and Authenticode status.
- Fresh installed smoke, offline network-disabled renderer, crash/restart.
- Actual A→B installed upgrade; uninstall/reinstall preserves all business rows.
- Confirm single instance and native SQLite; record second-laptop/clean-machine limits.

## Release
- Push reviewed main; immutable vX.Y.Z matching package version.
- Require CI and Windows release workflow success.
- Review private draft, notes and three artifacts; download/recheck hashes.
- Publish only after human operational review; never upload QA or DB files.

## Deploy
- Close FOX; safely back up the full data folder.
- Install/update under the same Windows user; launch shortcut.
- Verify floor plan, existing data, stock, orders and reports.
- Confirm readiness before operating; preserve backups, never reset DB.
