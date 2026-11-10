# Phase 9.3 functional baseline contract

The certification candidate is 0.7.1-rc.2 / schema 6. The request named rc.1, but the separately authorized report simplification was already committed and accepted as rc.2 before certification started (`fb265027b0a27c53c9ff2a87745bfe7a8aa1db60`, Windows run 38233421122). Certification itself must not change runtime behavior or increment this version for tests/evidence alone.

## Operational identities and physical mapping

The approved set is exactly M1â€“M13, SH1â€“SH4, T1â€“T10. `src/domain/definitions.ts` is the authoritative runtime definition. Database seeding, canonical DB validation, and the presentation map consume it. `src/presentation/floorPlan.ts` contains geometry only. B01â€“B13 / S01â€“S04 / R01â€“R10 are internal physical review annotations, never operational table codes, order identifiers or reservation references. Certification expectations are explicitly copied from the owner's contract, not generated from this implementation.

The physical reference is `docs/references/fox-original-floor-plan.png`, with the previously confirmed numbering. M13 is the diagonal indoor lower-left position; T1 is the small terrace table alongside the indoor opening. SH1â€“SH4 and T5â€“T10 run left to right. T2â€“T4 are the upper round terrace row. Coordinates belong exclusively to presentation.

## Actual reservation semantics

`table_reservations` stores UUID intent/identity, canonical table FK, customer name, optional phone, scheduled UTC ISO instant, guests, optional note, BOOKED/ARRIVED/CANCELLED, created_at and resolved_at. There is no updated_at or supported edit API: detail rows are immutable. Corrections use explicit cancellation and a new booking identity. No table-changing edit is supported.

BOOKED â†’ ARRIVED or BOOKED â†’ CANCELLED is the complete lifecycle. A retry of the same resolved action does not touch a subsequent order/booking. Creation immediately holds a FREE enabled table; one BOOKED hold is permitted per table. Past creation is rejected. Existing holds do not auto-expire; the form/documentation explicitly requires arrival/cancellation. An overdue hold can be resolved at any time and is not an OPEN order. No automatic time-triggered state is being invented in certification.

Arrival resolves the hold and frees the table without creating an order. A separately selected product opens an order, makes ACTIVE authoritative, and retains the ARRIVED historical metadata. Checkout uses the existing CASH/inventory/financial lifecycle. SELECTED is renderer context (`aria-pressed`), not a stored financial state.

## Integrity and privacy boundary

Typed/constrained IPC exposes reserve/arrive/cancel; workspace reads return current booking details. The backend validates unknown keys, canonical table existence, UUID intent, bounded trimmed contact text, guest integer and canonical ISO time. SQL is parameterized. Transactions use IMMEDIATE; the DB enforces a table FK, one-booked partial index, free-table insert guard, immutable details and retained resolution history.

Migration 6 is additive reservation infrastructure and guards. It does not update historical business rows. File upgrades validate the old DB and create a verified pre-migration backup. Reservation contacts belong to the local operational DB and coherent backups; they must not appear in unrelated sales receipts, finance/inventory/cash summaries, diagnostics, routine logs, filenames or packaged assets. Tests use synthetic contacts only. Logs sanitize arbitrary error text/type; no reservation request payload is logged.

## Certification oracles and evidence

- `tests/baselineCertification.test.ts`: independent exact-set/physical anchors, zero fresh history, integer-cent finance oracle, reservation isolation, duplicate intents, unsupported edit rejection, time/input boundaries, receipt/log privacy, coherent mixed backup/restore and exact schema5â†’6 historical row hashes.
- `scripts/qa/verify-reservation-atomicity.mjs`: marked isolated temp profiles, process termination before commit at a transaction barrier and after commit; no owner data.
- `scripts/qa/certify-reservations.mjs` with `FOX_CERTIFY_BASELINE=1`: real Electron and installed NSIS parity, six canonical bookings, rapid IPC/navigation, keyboard/modal behavior, contact sink/package scans, committed-process crash and native coherent backup/restore.
- Production DB verifier independently asserts the approved set and zero reservation/finance/receipt/transaction history.
- Full regression suites run three consecutive times with stop-on-first-failure; artifact, runtime, finance, migration, security and Windows upgrade gates remain enabled.

The initial keyboard probe treated the offscreen native viewport's cycle boundary as an interactive background target. The corrected oracle explicitly rejects any interactive background focus, verifies modal inertness and requires Tab to return into the dialog. Enter instrumentation must include the native carriage-return text event, not just raw key state. These deterministic driver corrections are not runtime fixes and do not conceal a flaky product failure.

Direct IPC probes also require a view-cache refresh before taking operator-facing screenshots; the normal React mutation handler already refreshes that state. The new privacy scanner must normalize ASAR paths using the host's native separator before `statFile`/`extractFile`. The first installed certification stopped deterministically at that scanner API misuse, not at a leaked contact; the corrected scanner was reproduced locally against 115 packaged text assets before restarting final certification. These test-harness findings are retained in the final evidence record.

Windows run 38268258088 stopped on the existing schema5 file-migration integration test: 10.75 seconds exceeded Vitest's generic 5-second deadline, with no data assertion failure. Its fixture creation and migration/safety-backup phases are now timed separately and retained as technical evidence. That one durable-file test has a bounded 30-second integration deadline; every original integrity assertion remains. There is no claimed 5-second migration performance SLA and no change to runtime fsync/durability. The final suite must still pass three consecutive times without retries; cold-disk/migration latency belongs in Phase 10's reliability characterization.

## Freeze rule

Only the exact commit and installer hash named in the successful `outputs/fox-phase9-3-freeze-manifest.json` are frozen. The final certificate is `outputs/fox-phase9-3-functional-baseline-certification.md`. Until Phase 11, no new features are permitted. Phase 10 may reproduce/fix defects, add reliability tests, and strengthen existing safety/invariants only. A trusted signing certificate, physical thermal printer and second cafÃ© laptop must be reported as pending until actually verified; software certification does not imply those hardware/external checks passed.
