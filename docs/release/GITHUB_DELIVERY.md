# GitHub delivery — FOX 0.7.2-rc.4

Repository: https://github.com/nisigma1/fox-pos (private).

## Delivered contents

The repository includes the complete application source, renderer assets, Electron main/preload code, database schema and migrations, dependency lockfile, native recovery patch, tests, packaging scripts, Windows workflows and operator/owner documentation.

The private prerelease `v0.7.2-rc.4` contains the Windows x64 installer, its SHA-256 checksum, update blockmap, release manifest, CycloneDX SBOM and an additional source ZIP containing the repository snapshot prepared for this delivery. The source ZIP contains no installed dependencies, generated QA profiles or business database. Standard GitHub source archives are also available for the release tag.

## Artifact provenance

- Version: `0.7.2-rc.4`.
- Database schema: `6`.
- Installer: `FOX-Setup-0.7.2-rc.4-x64.exe`.
- SHA-256: `8ffa453d070b487900e3d82911a7b10058d3663536594dcbe7209e7b5c7cd179`.
- Packaged source commit and release tag target: `b1ee939aced60c4f54274c22a2b9b29eb378432a`.
- Channel: `QA`; Authenticode status: `UNSIGNED`.

Subsequent main-branch changes add the bounded reservation screenshot QA driver and updated delivery documentation; they do not change the packaged runtime. The manifest remains exactly as produced when the installer was packaged. Its original `tag:null` means it was built before this GitHub distribution tag existed.

## Existing verification

The rc.4 application passed five consecutive local Windows suites of 562 tests, typecheck and build. Installed acceptance covered 57 checks; packaged visual checks covered 139 views with no reported issues; financial acceptance covered 106 checks; reservation acceptance covered 45 checks. Actual process restart, backup/restore and normal uninstall/reinstall were exercised. These are the existing rc.4 acceptance results, not a claim that uploading files reran those tests.

GitHub Actions run `38474525229` was rejected before execution by the account's billing/spending limit. It is not a successful CI result. The installer was verified locally on Windows; uploading it does not change that provenance.

Trusted production signing, real thermal-printer paper acceptance and final acceptance on the intended cafe laptop remain separate deployment steps. This upload does not label the unsigned candidate as a signed production release.

## Private business data

No live SQLite database, sales, stock quantities, reservation/customer details, local cost-recovery audit or backups are uploaded. These remain in the owner's Windows profile and are preserved by installation. Recent owner-confirmed historical cost restoration was a local data correction, not an application source change.
