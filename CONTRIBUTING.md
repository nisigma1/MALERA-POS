# Contributing

## Development

Clone `main`; use the Node version in `.nvmrc`, Python and Visual Studio C++ tools on Windows x64. Run `npm ci`, then `npm run dev`. Installation validates/applies the tracked SQLite recovery patch before native compilation; do not substitute an unpatched addon.

After the one-time history consolidation, use a fresh clone. Save uncommitted work separately first. Do not merge old branches/history back into `main`.

## Where changes belong

| Change                                | Location                             |
| ------------------------------------- | ------------------------------------ |
| Screen composition                    | `src/pages/`                         |
| Feature UI                            | Matching folder in `src/components/` |
| Shared controls                       | `src/components/common/`             |
| Business calculations and validation  | `src/domain/`                        |
| Floor geometry and display identities | `src/presentation/`                  |
| IPC contract                          | `src/types/api.ts`                   |
| Main-process request validation       | `electron/ipc/`                      |
| Durable transactions                  | `electron/database/`                 |
| Receipt jobs and printer integration  | `electron/receipts/`                 |
| QA-only Electron entry points         | `electron/verification/`             |
| Build and packaging                   | `scripts/build/`, `scripts/release/` |
| Automatic update broker               | `scripts/update/`                    |

Renderer code uses the typed preload bridge and validated IPC boundary. Keep database/filesystem access in the main process and financial authority in domain/database services.

## Data invariants

- Use integer cents and bounded integer quantities.
- Make checkout/payment/stock/receipt effects atomic. Repeated actions must not duplicate financial effects.
- Preserve historical prices and costs. Unknown costs remain unknown.
- Keep canonical persisted table IDs stable; B/J labels are presentation identities.
- Use reviewed additive schema migrations with recovery backups; never reset data to make a migration pass.
- QA uses memory databases or marked temporary profiles, never the operator profile.
- Preserve WAL, full synchronous durability, backup validation and the native recovery patch.
- Never commit live databases, backups, credentials, installer binaries or generated output.

## Validation

```powershell
npm test
node --test tests/updateClient.node.mjs
npm run build
npm run release:scan
```

Desktop delivery additionally checks fresh production state, a simulated business day, UI operations, installer contents, packaged SQLite recovery and installed offline/restart/reinstall behavior.

The older offscreen `capturePage` verifier can report `UnknownVizError` on HP Engage Go. Preserve and investigate failures; do not weaken assertions or production safeguards to obtain green checks. CDP UI and installed acceptance are separate checks. Physical touchscreen and printer acceptance require the actual hardware/operator.

## Naming and history

Formatting is pinned in `package-lock.json`. Use `npm run format` before committing and `npm run format:check` to verify it. Configuration lives in `.prettierrc.json` and `.editorconfig`.

Use PascalCase component files, descriptive camelCase TypeScript modules and descriptive kebab-case CLI scripts. Match surrounding conventions. Avoid phase numbers in new production entry points.

Use focused incremental commits after this initial consolidation. Do not routinely rewrite shared history. `main` feeds a real terminal: push only changes ready for that device, with particular care around migrations, permissions, signing and update behavior.
