# FOX non-fiscal receipt printing

The sale commits before Windows receives a print request. Printer failure cannot undo payment, stock deduction, sale numbering or table release. Reports always read completed financial sales. This subsystem does not fiscalize, calculate VAT, open a cash drawer, print kitchen tickets or auto-update FOX.

## Operator setup

Install the manufacturer's Windows driver for the 80mm thermal printer. Open **Cilësimet → Kuponët**, refresh printers, select the exact intended printer and save. Defaults are no printer and automatic printing OFF. Run **Testo printerin**, check actual paper, Albanian ë/Ë/ç/Ç, € and alignment, then enable automatic printing. A submitted test is required before automatic printing can be enabled. Windows submission alone does not prove paper output. FOX never chooses a default/PDF/other printer implicitly.

Settings live in SQLite `settings`; paper width is fixed at 80mm and one copy per request. No driver internals are operator controls. A changed/removed printer fails explicitly. Re-selecting a different printer requires its own successful submission test.

## Durable receipt and outbox

Additive migration v4 leaves v1–v3 unchanged and adds `receipt_documents`, `receipt_print_jobs`, `receipt_print_attempts`, `receipt_generation_errors` and two receipt settings. No financial rows or catalog values are backfilled. New checkout creates a v1 immutable NON_FISCAL document from CLOSED order-item snapshots, checked integer-cent totals, stored payment history, sale number, original completion time and table. Business display name is captured when the document is first generated. The fixed construction order of the v1 JSON and stable item row order define its canonical encoding; SHA-256 checks its exact bytes whenever loaded.

Documents cannot update/delete and require a CLOSED sale. Payload excludes purchase costs, profit, internal IDs and fiscal identifiers. Legacy receipts are generated lazily on explicit copy from actual historical items/payment. Legacy missing payment stays unknown; CARD stays historical CARD. Business metadata available at first generation is captured; historical metadata that was not stored is not invented. Future layouts must add another schema renderer and retain the v1 renderer rather than silently changing historical output.

Inside the existing checkout transaction, an enabled configured printer creates one logical original PENDING intent. Partial indexes prevent duplicate originals and overlapping active jobs for a sale. Print metadata uses a nested savepoint; a receipt-integrity error is recorded without reopening/undoing the sale. Normal printer availability is never queried inside checkout. Main wakes the worker only after checkout returns committed.

## Queue and recovery

One main-process worker uses enqueue-time FIFO, including retried jobs, one submission at a time. Each claim durably marks SUBMITTING and appends a numbered attempt before calling the adapter. No renderer can call raw print or supply a financial payload.

| State | Meaning and action |
|---|---|
| PENDING | Durable, not submitted; resumed at startup |
| SUBMITTING | Current attempt; previous-process attempts become UNKNOWN on startup |
| SUBMITTED | Electron/Windows accepted; physical paper unconfirmed |
| FAILED | Known failure before acceptance; intentional retry of an original allowed |
| UNKNOWN | Interrupted/timeout/uncertain acceptance; no automatic retry, intentional KOPJE only |
| CANCELLED | Reserved terminal representation; no operator cancellation command added |

Retries requeue the same original job and append attempts; copies create idempotent token-based jobs against the same immutable document, prominently marked KOPJE. Neither action calls checkout. Active job coalescing and UI locks prevent rapid duplicate requests. Completed request tokens remain idempotent. Known failed originals can retry only their exact captured device; a different printer uses an intentional copy. Failures appear across navigation, and report sale details provide status/recovery/copy. Success is non-blocking; wording says sent, never physically printed.

Submission is bounded at 30 seconds. Uncertain delivery becomes UNKNOWN. Before quit, the worker stops and aborts/destroys its hidden renderer. Unfinished attempts remain durable and become UNKNOWN next startup. This is deliberately at-most-once automatic original submission after uncertainty; exactly-once physical paper cannot be guaranteed by the Windows callback.

## Windows adapter and 80mm profile

Use built-in Electron `getPrintersAsync()` and silent `webContents.print()` with the exact system device name. No printer-native dependencies were added. The hidden renderer has sandbox/context isolation, no Node/preload, denied permissions/navigation/windows/webviews, a dedicated nonpersistent session, CSP default-src none, escaped text and no remote resources. Every attempt destroys its renderer and removes abort listeners.

The centralized profile is 80mm paper with conservative 72mm content and 4mm side padding. Black text, local Arial, wrapping item names, clear totals and conspicuous **KUPON JO-FISKAL / Ky dokument nuk e zëvendëson kuponin fiskal.** Dedicated receipt CSS is independent of screen CSS.

The adapter requests an explicit custom page in microns (80,000 width), measured content-height plus tail space, margins none, empty browser header/footer, one copy. It does not combine custom pageSize with usePrinterDefaultPageSize. See [Electron print and printer discovery API](https://www.electronjs.org/docs/latest/api/web-contents#contentsprintoptions-callback).

Real Windows Microsoft PDF QA accepted the same adapter and produced output, with readable Albanian glyphs and escaped attack strings. This driver returned a Letter sheet despite the custom request; it is software spooler evidence, not roll-size compatibility. A dedicated Chromium layout PDF measures approximately 80mm. The real thermal driver's supported page/profile and cutter still require physical validation; change only the centralized profile/adapter if needed.

## Verification and packaging

`npm test`, `npm run typecheck`, `npm run build`, `npm run verify:checkout`, `npm run verify:runtime` remain required. `node scripts/qa/verify-receipt-crashes.mjs` tests real isolated process termination before submission and during an in-flight attempt. `node scripts/qa/verify-receipts.mjs <target-json>` runs actual hidden Electron/preload/UI, real Windows spooler and layout/security checks with an explicitly created disposable QA PDF printer. Synthetic data stays in marked fox-qa-* temporary directories.

`node scripts/qa/verify-installed.mjs <old-installer> <phase5-installer> <target-json>` tests the actual installer upgrade with preserved open/closed sales, settings, stock, legacy copy, new auto receipt, restart, uninstall and reinstall. The optional target JSON must point to an explicitly owned `FOX QA Receipt ...` printer; it is never shipped. QA-only entrypoints are stripped from the release bundle.

Use the private manual **Windows QA installer** workflow to build immutable run artifacts for an explicit prerelease; it does not tag or publish a release. Local unsigned installer builds may be blocked by Windows Smart App Control. Capture policy events and never disable security or disguise/rewrite a blocked binary to get around policy.

## Physical acceptance — pending

Actual 80mm hardware must verify driver installation, FOX discovery, exact selection/test, ë/ç/€, 80mm alignment, long names, 20+ lines, original auto receipt, cutter if driver supports it, disconnected-printer sale survival, reconnection/retry, UNKNOWN copy, historical copy, FOX restart and Windows restart. Retain actual paper/photos and status evidence. PDF/mocks cannot substitute. Second physical laptop acceptance is separately pending.
