# Repository structure

The application keeps its existing renderer and Electron entry points. Tooling and documentation are grouped by purpose. Run all commands from the repository root; the public npm command names are unchanged.

```text
.github/workflows/     Windows CI, QA and release automation
build/                 Installer resources (not generated application output)
electron/
  main/                Desktop lifecycle, security and verification entry points
  preload/             Renderer bridge
  ipc/                 IPC handler registration
  database/            SQLite schema, repositories and business transactions
  receipts/            Receipt rendering, persistence and printer integration
src/
  app/                 Application shell, data hooks and draft context
  pages/               Main screens
  components/          UI components
  domain/              Business rules and shared domain types
  presentation/        Floor-plan geometry, table identity and display calculations
  types/               Renderer API types and global declarations
  assets/              Application images
  styles/              Stylesheets and design tokens
tests/                 Automated tests; shared helpers live in support/
scripts/
  build/               Electron bundling and patched native SQLite rebuild
  dev/                 Local development launcher
  qa/                  Test runner, verification and certification scenarios
  release/             Packaging, signing, supply-chain checks and installation
  fixtures/            TypeScript entry points bundled by QA scenarios
  windows/             Native dialog, window capture and SHM helpers
  lib/                 Shared tooling helpers
docs/                  Documentation index, guides, architecture, release and history
patches/               Native SQLite patch and provenance
```

## Working conventions

- Add business calculations and validation to `src/domain/`; keep database access in `electron/database/` and expose it through the IPC/preload boundary.
- Put a new script in the directory matching its purpose. Use `scripts/lib/` for helpers shared by several scripts.
- Script imports are relative to the script file. File paths passed to build tools or child processes are relative to the repository root.
- Prefer npm commands from `package.json` for everyday development. When moving a script, update its imports, child-process invocations, npm commands, TypeScript includes, tests, workflow commands and documentation together.
- Keep current operational instructions in `docs/guides/`, implementation contracts in `docs/architecture/`, delivery instructions in `docs/release/` and prior-phase records in `docs/history/`.

## Generated files and business data

`node_modules/`, `dist/`, `dist-electron/`, `work/`, `outputs/` and `release/` are generated and ignored by Git. `build/` contains tracked installer source resources. The owner's live data belongs in `%APPDATA%\FOX Kafeteri`, outside the checkout; QA uses isolated, marked temporary profiles.
