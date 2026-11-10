# Project scripts

Run scripts from the repository root. Prefer the stable npm commands in [package.json](../package.json).

| Directory   | Purpose                                                        | Common command                                  |
| ----------- | -------------------------------------------------------------- | ----------------------------------------------- |
| `build/`    | Bundle Electron entry points and rebuild patched native SQLite | `npm run build`, `npm run rebuild:native`       |
| `dev/`      | Start Vite and Electron together                               | `npm run dev`                                   |
| `qa/`       | Run tests, runtime checks and certification scenarios          | `npm test`, `npm run verify:runtime`            |
| `release/`  | Package, sign, inspect and install release artifacts           | `npm run package:win`, `npm run verify:release` |
| `fixtures/` | TypeScript fixtures bundled by QA scripts                      | Invoked by verification scripts                 |
| `windows/`  | Native dialog automation, window capture and SHM mapping       | Invoked by Windows QA scripts                   |
| `lib/`      | Shared tooling utilities                                       | Imported by other scripts                       |

Native SQLite rebuilds apply the checked-in recovery patch and compile from source. Keep that step enabled for application verification and release builds. QA commands must use their isolated profiles and must never target the owner's live database.

See [repository structure](../docs/architecture/REPOSITORY_STRUCTURE.md) and [deployment](../docs/release/INSTALLATION.md) for more detail.
