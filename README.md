# FOX Kafeteri

Offline Windows x64 POS for FOX. Current application: **0.7.2-rc.4**, database schema **6**. This repository is private.

## Application

- Table floor plan with 27 service positions, persistent active orders and telephone reservations.
- Owner-facing labels: B1–B12 inside, J1–J11 outside, SH1–SH4 at the counter. J11 is the diagonal entrance position. Persisted canonical IDs remain M1–M13, T1–T10 and SH1–SH4.
- Cash-only checkout with an item summary, atomic sale finalization, stock deduction and protection against duplicate completion.
- Product prices, purchase costs, inventory supplies and recorded stock losses.
- Business reports: sales, recorded expenses, stock losses and operating profit. Profit = sales − historical product costs − recorded expenses − recorded stock losses. Unknown historical costs are never silently treated as zero; current catalog prices do not rewrite completed sales.
- Cash sessions, owner cash movements and reconciliation of expected and counted cash.
- Receipt printing, print history and reprinting; backup/restore and editable business name in Settings.

Amounts use integer cents. Completed sales, receipts and inventory audit records are protected in SQLite. Active orders and reservations do not themselves deduct stock or create revenue.

## Download and install

Download the Windows installer and matching checksum from the repository's [releases](https://github.com/nisigma1/fox-pos/releases). The current rc.4 artifact is an **unsigned QA release candidate**, not a signed production release. See [current GitHub delivery](docs/GITHUB_DELIVERY.md) for exact build provenance and limitations.

Business data is stored separately in `%APPDATA%\FOX Kafeteri`. Installers and this repository do not include the owner's live database, sales, stock, customers or backups. Make an application backup before upgrading. Do not delete the data folder to resolve an installation issue.

## Development

Windows x64, Node.js 22.12+ and npm are required. The existing verified toolchain uses Node 24.13.1 and Electron 44.5.1. Internet is needed to install dependencies; normal POS operation works offline.

```powershell
npm ci
npm run dev
```

Production build and source launch:

```powershell
npm run build
npm start
```

Checks:

```powershell
npm test
npm run typecheck
npm run build
```

Tests use Electron's Node runtime so the native SQLite ABI matches the application. QA scripts use isolated, marked temporary profiles and must never be pointed at the owner's production data.

For Windows packaging and deeper checks, use the scripts in `package.json`, [deployment instructions](docs/DEPLOYMENT.md), [receipt printing](docs/RECEIPT_PRINTING.md) and [data protection](docs/DATA_PROTECTION.md). The tracked Windows CI workflows cover tests, packaging and installed-app verification. Dependency versions are locked in `package-lock.json`; the native SQLite recovery patch and its provenance are tracked in `patches/`.

## Operator and owner guides

- [Operator quick guide](docs/OPERATOR_QUICK_GUIDE.md)
- [Owner setup](docs/OWNER_SETUP.md)
- [Reservations](docs/RESERVATIONS.md)
- [Cash, profit and accounting review](docs/ACCOUNTING_REVIEW.md)
- [Backup and disaster recovery](docs/DISASTER_RECOVERY.md)
- [Go-live checklist](docs/GO_LIVE_CHECKLIST.md)

[Earlier phase notes](docs/PHASE_HISTORY.md) are retained as history; they describe earlier versions and do not override the current application summary or release provenance above.
