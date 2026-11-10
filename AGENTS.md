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
