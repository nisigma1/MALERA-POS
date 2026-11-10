# Repository working rules

Read README.md and CONTRIBUTING.md before editing. Use docs/architecture/REPOSITORY_STRUCTURE.md for the code map.

- Preserve live business data and persisted identities. Never run QA against the operator profile.
- Keep money in integer cents and checkout effects atomic and idempotent.
- Preserve the SQLite recovery patch/provenance and full durability settings.
- Put UI components in feature folders and QA-only Electron code in electron/verification.
- Run relevant existing checks. Do not weaken tests or production safeguards to make checks pass.
- Keep generated output, business databases and secrets out of commits.
- main is the desktop delivery branch. Update imports, workflows and docs when moving files.
- Historical documents provide context; current contracts and verified provenance define behavior.

## Cafe terminal: preserve operation and business data

The owner explicitly requires the operational POS installation and business data to be preserved. Do not delete or uninstall the operational app, remove its shortcuts, or delete/reset/replace its live database or backups as a development, testing or repair shortcut. Never create test sales in the live profile.

Run installer/uninstaller acceptance on a disposable Windows CI runner or separate disposable test machine, not on the cafe terminal. A marked temporary database alone does not make an installer test safe on the operational PC, because installer registration and shortcuts can still affect the real installation.

Normal app updates may replace application binaries through the established update path while the POS is closed, after a verified backup. Preserve the existing installation identity and data path. Do not force-close the POS, automatically restore/downgrade business data, or bypass failed backup/integrity checks. If a repair would require a destructive recovery operation, stop and get explicit owner approval for that concrete recovery plan; a general request to fix the software is not authorization to erase its data.
