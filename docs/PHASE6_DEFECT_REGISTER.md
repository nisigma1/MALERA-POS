# Phase 6 defect register

Baseline: `112daa1ec8a43d7f7ae9b04672f09c90024ee5e6`, 0.5.0-rc.1, 226 tests. Baseline Electron screenshots and DOM measurements: `fox-qa-phase6-audit-R8MDz3`. Created before product edits.

| ID | Area | Severity | Actual / evidence | Expected / proposed correction | Regression risk |
|---|---|---|---|---|---|
| F6-01 | Money | P2 | UI uses €1.00, receipts use 1.00 €; screenshots and render.ts | One cents-based `1.00 €` convention; retain strict comma/dot input | Input roundtrip / negative values; test |
| F6-02 | Backup | P2 | Backup date and restore confirmation use locale defaults rather than fixed DD.MM.YYYY HH:mm | Reuse existing local date formatter | No change to stored UTC timestamps |
| F6-03 | Settings readiness | P2 | Counts buried at bottom with schema diagnostics; missing costs not distinguished from sale blockers; no threshold guidance | Compact owner setup summary before backup; separate blockers, warnings, out-of-stock; diagnostics expandable | Read-only calculation; test NULL / FALSE / zero and inactive products |
| F6-04 | Checkout scaling | P2 | At 150% effective viewport the heading is outside initial scroll position, dialog scrolls as a whole | Flex dialog with only item list scrolling; compact spacing at short heights, actions visible with long orders | Keyboard/Escape/confirmation unchanged; native screenshots and many-item test |
| F6-05 | Inventory / product states | P2 | NULL selling price shown as unexplained dash; disabled POS tooltip checks tracking before price and omits unknown/zero-stock reason | Explicit Pa çmim; align disabled reason with visible state | Display only; original sale rules preserved |
| F6-06 | Receipt wording | P3 | New receipt renderer exposes CASH rather than Para të gatshme | Translate payment in rendering only; immutable payload/history unchanged | Snapshot/render regression |

No P0/P1 defect observed in initial audit. These remain subject to full-day reconciliation and final installed acceptance. No floor-plan coordinates, migrations, checkout/stock accounting or historical data changes are proposed.

Follow-up screenshot review (before the corresponding fixes):

| ID | Area | Severity | Actual / evidence | Correction | Risk |
|---|---|---|---|---|---|
| F6-07 | Floor plan at 150% | P1 | Actual Electron 910×512 effective viewport: SH labels overlap and become truncated; `tables-910-1.5.png` | Preserve every coordinate; compact sidebar/workspace at small logical widths, scale labels/targets to container | Verify all 27 visible nonoverlapping button rectangles and usable order controls |
| F6-08 | New readiness panel | P3 | First verification screenshot shows missing panel padding | Apply same padding/margin as existing settings panels | Presentation only |
| F6-09 | Restore success | P2 | Executed native restore triggered a redundant diagnostics/catalog refresh during maintenance immediately before relaunch | Skip read refresh on successful restore; existing backup/error refresh preserved | Actual backup/restore/relaunch regression |

Implemented surgical corrections for F6-01–09. No financial or stock mismatch observed in the executed 120-sale simulation; expected revenue/CASH 35000 cents, tracked closing quantities 300 and 437. Five real SQLite close/reopen checks, separate-environment validated restore and continued sale passed. Final CI installer acceptance is recorded in the Phase 6 report; this register alone does not assert release completion.

Audit tooling corrections: CDP DOM `click()` does not focus an opener as a real pointer does; explicit focus is used for the focus-return assertion. Catalogue updates through QA-only direct API calls require screen navigation to re-read data, matching the actual operator edit flow. These were harness corrections, not weakened product assertions.

| ID | Area | Severity | Actual / evidence | Correction | Risk |
|---|---|---|---|---|---|
| F6-10 | Failed early startup | P1 | Windows run 38039512903, missing initialized DB: expected controlled exit 1, actual native Windows access violation 3221225477 (0xC0000005). Earlier product/UI/recovery gates passed. | Defer startup failure exit to next event-loop turn so Electron's ready callback can finish. No data-path or recovery changes. | Repeat native fail-closed matrix; exact exit 1 and unchanged/missing DB assertions remain mandatory. The early native-exit lifetime is the suspected cause, not a proven upstream diagnosis. |

Baseline command note: npm ci initially hit the running application's native-module lock; normal window close then npm ci succeeded. A release-verifier invocation mistakenly supplied a directory as its version argument; source tests/typecheck/build passed. Prior staged release is verified through the exact original successful CI artifact/manifest, not falsely marked by that invocation.
