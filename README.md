# MALERA POS

An offline touchscreen point-of-sale application for a single Windows x64 terminal. Built with Electron, React, TypeScript and SQLite.

The app manages a 27-position floor plan, persistent orders, cash checkout, stock, reservations, receipts, expenses and cash reconciliation. Money is stored in integer cents. Checkout effects are recorded transactionally.

**Status:** `0.7.2-rc.4`, database schema `7`, QA release candidate. Desktop builds are unsigned. Real prices, stock settings and a receipt printer must be configured before service.

## Start here

| Task                            | Guide                                                                       |
| ------------------------------- | --------------------------------------------------------------------------- |
| Run or change the code          | [Contributing](CONTRIBUTING.md)                                             |
| Understand the codebase         | [Architecture and directory map](docs/architecture/REPOSITORY_STRUCTURE.md) |
| Prepare the terminal            | [Owner setup](docs/guides/OWNER_SETUP.md)                                   |
| Use the app                     | [Operator guide](docs/guides/OPERATOR_QUICK_GUIDE.md)                       |
| Understand GitHub-to-PC updates | [Automatic updates](docs/release/AUTOMATIC_UPDATES.md)                      |
| Back up or recover data         | [Data protection](docs/guides/DATA_PROTECTION.md)                           |
| Find another guide              | [Documentation index](docs/README.md)                                       |

## Quick start

For work from another PC, follow [the two-PC workflow](docs/guides/TWO_PC_WORKFLOW.md). Each PC needs its own fresh clone; the Git helpers stop instead of overwriting unsaved or divergent work.

Use Windows x64 and the Node version in [`.nvmrc`](.nvmrc). Dependency installation also needs Python and Visual Studio C++ build tools: SQLite is compiled with the checked-in Windows recovery patch.

```powershell
npm ci
npm run dev
```

Validate and build:

```powershell
npm test
node --test tests/updateClient.node.mjs
npm run build
```

Tests use Electron's Node runtime to match the app's native SQLite ABI. Native PowerShell QA helpers require the local scripts to be permitted by the session's execution policy. Verification profiles are isolated from the operator database.

## Code map

```text
src/                  React renderer, domain rules, types, styles and assets
  app/                App shell and shared data hooks
  pages/              Tables, inventory, reports and settings screens
  components/         Feature folders: orders, inventory, receipts, etc.
  domain/             Money, quantities, readiness and business definitions
  presentation/       Floor geometry and owner-facing table identities
electron/             Desktop services
  main/               Lifecycle, security, logging and data protection
  preload/            Narrow renderer-to-main bridge
  ipc/                Validated request handlers
  database/           Schema, repositories and atomic business transactions
  receipts/           Receipt documents, jobs and Windows printing
  verification/       Isolated QA entry points and fixtures
scripts/              Development, build, QA, release and update tooling
tests/                Automated tests and independent financial assertions
docs/                 Guides, architecture, delivery and historical references
patches/              Native SQLite patch and provenance
build/                Tracked installer resources
.github/workflows/    CI and push-to-desktop delivery
```

Generated `dist/`, `dist-electron/`, `release/`, `work/`, `outputs/` and `node_modules/` are ignored and do not belong in commits.

## Branch and updates

`main` is the canonical branch. Pull it before working on another device. A push runs the **Desktop updates** workflow; only a passing build is published. Configured terminals download releases in the background and install on their next desktop launch while the app is closed, after a verified database backup. Pushing never changes a running sale.

See [automatic updates](docs/release/AUTOMATIC_UPDATES.md) for registration, status and the unsigned-channel trust model. Failed or unpublished builds leave the installed app in place.

## Data and compatibility

Live business data stays in `%APPDATA%\FOX Kafeteri`, outside the checkout and installer. The internal package name `fox-pos`, executable name and app ID `com.foxkafeteri.pos` remain stable for existing installations. MALERA is the product name; the legacy identifiers do not denote separate apps.

Do not rename/delete the data directory, change persisted table IDs, rewrite historical sale costs from current prices, or remove recovery checks as a cleanup shortcut. Read [contribution rules](CONTRIBUTING.md) before changing financial or storage behavior.

This repository begins with one consolidated source commit. Earlier history was archived outside the repository before consolidation. [Historical notes](docs/history/PHASE_HISTORY.md) provide context and do not override current guides or checks.

## Përgatitja e llogarive në terminalin DUO

Përditësimi e lë terminalin të përdorshëm derisa të konfigurohen PIN-et.
Për të aktivizuar llogaritë, raportet e turneve dhe kafenë në kg, krijo një
kopje rezervë përmes MALERA POS. Pastaj mbylle aplikacionin dhe, nga
llogaria e zakonshme e Windows-it në HP, ekzekuto `scripts/release/provision-duo-pins.ps1`
me Windows PowerShell. Fut PIN-et vetëm në kërkesat e maskuara në terminal.
Verifikuesit ruhen në profilin e Windows-it dhe mbrohen me DPAPI. Mbaje PIN-in
e pronarit privat. Punonjësi zgjedh llogarinë e vet para hyrjes dhe del nga
llogaria kur ia dorëzon terminalin turnit tjetër.

Te Stoku, furnizimi i përbashkët i kafesë futet në kg. Një kg jep 110 porcione.
Porositë e konfirmuara e zbresin stokun menjëherë. Raportet e turnit ia
atribuojnë artikujt e paguar përdoruesit që i ka konfirmuar. Pagesat e vjetra
pa përdorues mbeten në totalin e ditës pa emër punonjësi.
