# FOX Kafeteri — Phase 4.2 release candidate

Private Windows x64 installer engineering: see [deployment](../release/DEPLOYMENT.md) and [release checklist](../release/RELEASE_CHECKLIST.md). Build `npm run package:win`, verify `./scripts/release/verify-release.ps1`; install the resulting NSIS executable. The source checkout is for development only. No printing, fiscalization or automatic updater is included.

Local Windows POS with Tavolinat, Inventari, Raportet and Cilësimet. FOX currently accepts **CASH ONLY**. The operator confirms the order summary and “Para të gatshme”; there is no payment-method selector.

## Current production rules

The renderer calls completeOrder({orderId, expectedRevision?}). The backend rejects any paymentMethod property, including stale CARD commands, and always persists CASH for new completed sales. One SQLite IMMEDIATE transaction validates the order revision, snapshot total, tracking configuration and stock; deducts tracked inventory; appends SALE movements; persists payment and an internal sale number; closes the order; and releases the table. Duplicate completion and any failure leave no additional sale, number or deduction.

Migration v3 adds a unique persisted sale_number, deterministically backfilling existing CLOSED orders by closed_at and UUID as tie-breaker. It changes only the new presentation field. v1/v2 are unchanged. UUIDs remain internal. This is an internal sale number, not a fiscal receipt number.

Legacy CARD and missing-payment records remain readable and financially unchanged. Reports include every completed sale, show CASH as the primary payment metric, and show a compact historical/unclassified reconciliation notice only when applicable. The normal table shows #000123 and DD.MM.YYYY HH:mm in the system's local timezone. Unknown historical cost remains unknown; later product configuration never invents old COGS or profit.

Inventory tracking has three distinct meanings: Po (TRUE) validates/deducts known stock, Jo (FALSE) sells without unit-stock validation or SALE movements, and Pa konfiguruar (NULL) blocks new ordering and checkout of existing lines until an operator chooses Po or Jo. Po with unknown balance is separately labeled Stok pa vendosur; known zero is Pa stok. Active priced products require an explicit tracking choice on save. Disabling tracking preserves prior balances, thresholds and movements.

## Verification safety

Run npm test, npm run typecheck, npm run build, npm run verify:runtime and npm run verify:checkout. Tests open memory databases or fox-* temporary directories; the test runtime refuses other disk paths before SQLite opens them. Electron verification requires a marked fox-qa-* directory under the system temporary directory, distinct from normal userData, even when only a verification flag is supplied. The scripts create these owned directories automatically and retain evidence there. Tests clean up only directories they create. The ad hoc manual host now creates the same guarded QA directory.

The confirmed 27-position floor plan and existing POS shell remain unchanged. QA uses native Electron input in hidden isolated windows, plus real process restart. It covers cash-only enforcement, legacy reconciliation, Po/Jo/NULL correction, atomic rollback, double confirmation, order snapshots, all 27 positions and 1366×768, 1440×900, 1920×1080 plus 4K checkout. The release audit is in the parent workspace's outputs/fox-phase4-1-production-hardening.md. No Phase 5 feature, reset, cleanup, receipt or fiscalization is implemented.

## Setup

Prerequisites: Windows x64, Node.js 22.12+ (tested on 24.13.1), npm. Internet is needed to install development packages and Electron binaries, never for normal application operation.

```powershell
npm ci
npm run dev
npm test
npm run typecheck
npm run build
npm start
```

`npm start` launches the production build after `npm run build`. The development command builds main/preload once and serves React with Vite; restart it after changing Electron code. Vite selects an available loopback port starting at 5173. No cloud service, external API, CDN or remote font is used. `postinstall` installs Electron's binary and rebuilds SQLite's Electron ABI before installation completes. `npm run rebuild:native` is available after an Electron upgrade. Tests execute Vitest under Electron's Node runtime, using the same native module ABI; no alternating rebuild for host Node is necessary. A lockfile pins the installed dependency versions.

## Architecture

- `electron/main`: application lifecycle, security and background runtime verification.
- `electron/database`: one SQLite connection, migrations, deterministic seeds, read repositories and transactional configuration/order operations.
- `electron/ipc` and `electron/preload`: explicit typed reads, product update, inventory supply active-order commands and cash-only completion. No SQL, filesystem or generic IPC is exposed. Payloads are validated in the main process.
- `src/domain`: shared types, authoritative seeds/labels, exact euro-to-cent conversion, configuration validation and truthful stock/value calculations.
- `src/app`, `src/pages`, `src/components`, `src/styles`: one React shell, section state navigation and local CSS.
- `tests`: isolated database and domain tests.

Renderer sandboxing, context isolation and disabled Node integration are explicit. IPC is restricted to the application's main frame; list/summary reads reject arguments, order reads validate one table ID, and writes require exactly one validated payload. Navigation, new windows, permissions and remote network requests are blocked. Vite's loopback server is permitted only in development.

## Local data

Production data is `path.join(app.getPath('userData'), 'fox.sqlite')`; it is never stored beside source or inside the installed application. The exact directory follows Electron's Windows application-data conventions for the current user. SQLite enables foreign keys, a 5-second busy timeout, WAL and FULL synchronous writes. Database initialization errors stop startup and leave existing data intact. Normal shutdown closes the single connection.

Migration 1 creates `cafe_tables`, `categories`, `products`, `orders`, `order_items`, `inventory_balances`, `inventory_movements`, `expenses`, `settings`, plus `schema_migrations`. Migrations run once inside transactions. Seeding also runs transactionally and inserts only missing deterministic IDs, preserving configured data. Newer unsupported schema versions stop startup.

There are exactly 27 positions: M1–M13 (Brenda), SH1–SH4 (Shanku), T1–T10 (Terrasa). Database constraints reject extra codes and mismatched areas. There are five categories and 21 supplied product names. Prices, purchase costs, inventory quantity, tracking rules and low-stock thresholds start NULL. Null is unconfigured, not zero. No expenses or transactions are seeded.

Money uses integer cents. A partial unique index prevents multiple OPEN orders per table. Order items retain product name, price and nullable cost snapshots. CLOSED orders and their items are immutable. Inventory movements are append-only, and a partial unique index permits only one aggregated SALE movement per product per order. Order completion performs all financial, payment, sale-number, inventory and table writes in one main-process transaction.

No new migration was needed for Phase 2; the original migration and seeds are unchanged. Product editing preserves IDs and historical snapshots. Empty price inputs save NULL; decimal euro inputs accept a dot or comma and at most two decimal places. Tracking remains nullable until configured; disabling tracking preserves existing stock and threshold data without applying low-stock logic.

Supply requires an active product with tracking explicitly enabled and a finite positive quantity. The first supply establishes the initial balance with the user-entered quantity; the UI states this explicitly rather than claiming unknown stock was zero. Later supplies add to the known balance. Each supply and balance update is one immediate SQLite transaction. The movement ID is a UUID submission token: identical retries return success without a second movement, while changed payloads with the same token are rejected. Initial establishment is documented in the existing movement note field. No purchase-cost changes are made by supply entry.

Inventory value is shown only when all relevant tracking, stock and cost data are complete and the total can be represented in integer cents. No universal stock threshold is assumed. Search and category filters are immediate; inactive products remain visible and editable. The catalog scrolls independently so the main action and filters remain available. Native modal side panels manage keyboard focus and retain visible footer actions. The shared CSS tokens, sidebar and top bar are local; the clock uses the computer's local time with Albanian month names.

Reports query only CLOSED orders; expenses are queried separately. An empty database produces zero totals. Unknown item cost propagates to unknown cost/profit rather than invented profit. Average order value is unconfigured when there are no sales; otherwise displayed in cents rounded to the nearest cent. Inventory quantities permit fractional values for later stock rules without assuming a coffee recipe.

## Verification and scope

`npm run verify:runtime` runs the actual built Electron application with hidden offscreen rendering and a unique database under a marked temporary `fox-qa-runtime-*` directory. It checks the preload bridge, renderer isolation, all four screens and side panels at 1366×768, 1440×900 and 1920×1080, overflow/overlap/text bounds, product-save validation, supply submission, search/filters, and error/retry behavior. Screenshots and a result JSON remain in that ignored directory. Only the isolated verification database receives example test prices and supply quantities. It never touches production data. Database tests use memory or unique temporary directories.

The current floor plan, cash checkout, inventory deduction and dated reports are implemented. Printing, fiscalization, authentication, reservations, recipes, cloud sync and installer/update packaging remain out of scope. Production seeds invent no prices, quantities or transactions. Older phase notes below describe historical work and do not override the current production rules above.

## Phase 2.5 quality gate

The existing screens share color, spacing, type, focus and disabled-state tokens. Inventory uses a compact summary and aligned numeric columns; product editing groups product details, prices and stock, with read-only calculated profit. Supply shows the entered product, quantity and resulting balance before confirmation. At Phase 2.5 the table board was read-only; Phase 3 adds the workspace below. Settings remains read-only.

An invalid draft threshold cannot block saving when tracking is disabled. In that case the previously stored threshold and stock are preserved. Validation focuses the first invalid field. No migration, seed, dependency, money-parser or inventory transaction change was needed.

Runtime verification also exercises real Escape and Tab keys, focus return, validation focus, disabled-threshold preservation, initial/additional supply summaries, zero prices/stock versus unknown values, and all existing table-status labels. It records dimensions, numeric alignment and computed text contrast, including disabled controls, in its result JSON. The 44 domain/database tests remain unchanged. The quality-gate report and selected screenshots are in the parent workspace's outputs directory.

## Phase 3 active orders

Selecting a table only reads SQLite. Adding its first active, priced product creates an OPEN order, snapshots name/selling price/nullable purchase cost, and makes the table ACTIVE in one immediate transaction. Identical snapshots merge; changed snapshots create another line. Quantity controls retain the existing snapshot. Minus stops at one; explicit removal of the final item cancels the draft and frees the table. Disabled, RESERVED and AWAITING_PAYMENT positions cannot accept order commands. A configured zero selling price is valid; NULL prices are visibly blocked.

All successful commands persist immediately and return a canonical order DTO with backend-computed integer-cent totals. React stores view state, serializes pending commands and prevents repeated/conflicting clicks. The board uses a single aggregate query. A 424px workspace sits beside it, prioritizes current order rows, and keeps the total visible. Its body has one scroll area; narrow boards scroll independently so every position remains reachable. Escape deselects and returns focus.

No new migration, seed or dependency change was needed. Active orders do not change inventory or completed-order reports. `npm test` passes 71 tests (44 existing, 27 new). `npm run verify:runtime` runs isolated hidden Electron UI checks and then starts a second real Electron process against the same database, comparing order rows, all snapshots, quantities, totals, table status, inventory and reports. Both runs cover 1366×768, 1440×900 and 1920×1080. The Phase 3 verification report and evidence are in the parent workspace's outputs directory.

## Phase 3.5 hardening

Inventory now labels the count of products with both prices explicitly as “Çmime të plota (blerje + shitje)”. The editor shows a nonblocking review cue for a valid price of €100 or more; this is a typo advisory, not a business limit. Nullable tracking remains an explicit Po/Jo selection, preserving stock and threshold when disabled.

Active positions use an info accent; selection uses the separate amber accent, including hover. Categories form a segmented group, unpriced products remain disabled with an explicit explanation, and quantity/removal controls are 40px. The content-sized order panel keeps its backend total visible; “Shto produkte” reaches the catalog within its single body scroll. Empty categories explain why no active products appear.

Verification passes 72 tests (all previous 71 plus one inventory-summary regression), typecheck, production build and isolated Electron UI/restart checks. Operator-style native mouse/keyboard checks additionally cover rapid table/product input and final-item cancellation followed by another real process restart. Production data is checked read-only against the pre-edit snapshot. No migration, seed, order transaction, IPC contract or dependency changed.

The actual physical floor-plan reference is unavailable. The grouped 27-position board remains; no physical coordinates have been invented. The Phase 3.5 report in the parent outputs directory records the evidence and readiness assessment. Checkout, payments, stock deduction and receipt printing remain unimplemented.

## Phase 3.6 pre-checkout workspace

The workspace now places categories and a three-column product catalog before the current order. The redundant Shto produkte jump is removed. A compact Tavolinat header leaves more operating height; the selected-table panel fills that height with one scrolling body and fixed header/total footer. Order names use the existing 16px token, quantities/removal retain 40px controls, and product prices align at the bottom of each button. Selecting a different table resets only the panel scroll to its product catalog.

Untouched tables show Pa porosi and a neutral dash, with truthful first-product guidance. Persisted zero-price orders still show a real €0.00 total. Loading, pending, failed, empty and persisted footer states are distinct; successful mutations continue to use the authoritative backend DTO.

All 72 baseline unit tests are preserved. Actual Electron verification additionally checks catalog-first hierarchy, no redundant action, neutral empty state, full-height panel, visible categories/first product/first order row/total at all three desktop sizes, cross-zone rapid switching and scroll reset. Native mouse/keyboard checks run in a separate database and include navigation, price snapshots, real process restart and final-item cancellation. No schema, seed, business service, IPC contract, dependency, inventory or reports change is required.

The actual FOX structural floor-plan reference is still missing. Phase 3.6 explicitly requires NOT READY FOR PHASE 4 in this case. Its real mapping and spatial recognition remain unimplemented, and the existing grouped board is only a fallback. See outputs/fox-phase3-6-final-pos-ux.md in the parent workspace for the factual gate report. No checkout or other Phase 4 behavior was implemented.

## Phase 3.6B original floor-plan structural preview

The original reference has now been supplied and preserved in `docs/references/fox-original-floor-plan.png`. Tavolinat reconstructs its walls, bar, sofas, restroom, openings, diagonal position and terrace as local SVG geometry. All 27 physical positions are present: 13 indoor, 4 bar stools and 10 terrace tables, including the small terrace table near the doorway and six rectangles along the front edge.

The sketch contains no canonical table codes. B01–B13, S01–S04 and R01–R10 are explicitly temporary review annotations, not service codes or clickable POS targets. All M/SH/T physical associations remain unconfirmed. `src/presentation/floorPlan.ts` contains deterministic physical coordinates and the intentionally empty, code-keyed `FLOOR_PLAN_BY_CODE` crosswalk; its completeness check returns false. Existing canonical buttons and order workflows remain usable below the preview. Never populate the crosswalk from the AI mockup or a guessed numbering convention.

75 tests pass, including three structural/ambiguity checks. Typecheck, build, isolated Electron regression/restart verification and native input checks pass. The preview displays all 27 annotations at the three requested desktop sizes. Production data remains unchanged. See the parent workspace's `outputs/fox-phase3-6b-real-floor-plan.md` and `outputs/fox-real-floor-plan-identification.svg`. The interactive canonical floor plan remains incomplete pending owner identification: NOT READY FOR PHASE 4.

## Latest visual correction

The user subsequently rejected the technical preview and supplied `codex-clipboard-94c40ec2-1a63-477c-9cc3-f151160287b9.png`, explicitly requesting that appearance. Its labeled visual arrangement now drives the live presentation: 13 M, four SH and ten T codes, each rendered as an accessible native button over a local SVG scene. The earlier B/S/R preview and fallback grid have been removed from Tavolinat. The original unlabeled sketch is retained for provenance; this latest arrangement follows the newly requested visual reference and does not establish a surveyed code-to-position correspondence for the original sketch.

The Tavolinat workspace uses a dark palette, warm wood/floor vectors, bar/sofa/restroom/door geometry and local decorative product vectors. Actual product configuration and order totals remain authoritative. ACTIVE uses blue; SELECTED uses an amber ring. Order actions, inventory, reports, database schema and IPC remain unchanged. No checkout/payment action is added. All 27 targets remain at least 40px and visible without overlaps at 1366×768, 1440×900 and 1920×1080. Verification: 75 tests, typecheck, build, actual Electron regression/restart, contrast checks and native mouse checks. The latest report is `outputs/fox-visual-fix.md` in the parent workspace.

## Reference composition and dashboard polish

The subsequent request to match `codex-clipboard-5ffa2eb0-8776-4df1-9470-5ccb561f3a4b.png` adds the reference's full-width bottom composition: inventory preview with category/search controls and known stock values, six report-summary cards, and functional navigation shortcuts. The chart areas display honest empty/unavailable states because the current API exposes totals without hourly/category sales breakdowns. Product-management shortcuts use the existing Inventory screen. Unimplemented checkout, staff, backup and authentication actions are not exposed.

Local generated transparent assets in `src/assets` provide photographic drinks and an overhead wood-table/chair group. The floor structure and canonical interactive buttons remain SVG/HTML, not a screenshot background. Presentation coordinates remain keyed by code. Initial M5 selection reads its existing order without creating a draft; closing the panel still deselects it. Dashboard summaries are read-only and isolated from order writes. The original business logic, stock balances, report service and schema are unchanged. See the parent `outputs/fox-reference-ui.md` for verification and final captures.

## Hamburger navigation correction

## Phase 3.6C current release gate

Operational hardening is complete: text-first catalog, flat vector presentation, stronger order-row hierarchy, separated deletion and consistent FOX shell across modules. All 75 tests and actual Electron/native restart checks pass. The original sketch contains no canonical labels: all 27 physical associations remain AMBIGUOUS. A complete code count now explicitly does not establish physical confirmation. The live coordinates are provisional and carry a confirmation notice; the misleading unlabeled diagonal decoration is removed, without inventing its code. Original terrace/diagonal corrections remain blocked by missing owner numbering. No Phase 4 implementation. Current verdict: NOT READY FOR PHASE 4. See parent outputs/fox-phase3-6c-release-audit.md and the pre-edit physical mapping audit.

Superseded navigation detail: the subsequent owner request restores all four sections in the sidebar as well as the hamburger. Readability now uses vector round-table geometry, larger typography, unwrapped active amounts and a 3840×2160 layout. The TERRASA overlay is removed and production starts maximized. See parent `outputs/fox-sharp-ui.md`. The owner has reasserted the original unlabeled sketch; its code correspondence is pending clarification, and the current labeled-reference layout is not claimed to match that sketch.

The latest user request removes the bottom Inventory, Reports and Settings previews. Their full existing screens now open from the top-left hamburger menu; Tavolinat stays in the sidebar. The floor plan and current-order panel use the freed screen height. Escape closes the popup and restores trigger focus without deselecting the order; clicking outside closes it. Closing an order restores focus to its actual floor button.

Verification: 75 tests, typecheck and production build pass. Actual Electron order/restart checks pass at 1366×768, 1440×900 and 1920×1080 with all 27 positions visible and no overflow. Native mouse/keyboard checks verify all three menu destinations, outside click and Escape focus. Production database audit confirms all ten tables unchanged. See the parent workspace's `outputs/fox-hamburger-menu.md` and `outputs/fox-hamburger-qa`.
