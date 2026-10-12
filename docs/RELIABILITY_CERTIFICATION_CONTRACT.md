# Phase 10 reliability contract

The functional baseline is `05326bab63574328cde5e4d0c09e96d3b7e5d04e`, version 0.7.1-rc.2, schema 6, 418 tests. Its source, identities, owner data policy and accepted installer remain independently identifiable. Phase 10 adds no product feature, UI redesign, dependency or migration.

All destructive evidence uses marked `fox-qa-*` temporary profiles or isolated test databases. The owner database and owner backups are excluded. Failure hooks live under `tests/` and `scripts/`, outside the release allowlist. Real application lifecycle tests use hidden owned Electron windows and opt-in localhost inspector observations. No inspector is enabled in normal startup.

The reusable independent harness is `tests/support/reliability.ts`. Financial arithmetic uses an independent BigInt oracle. Canonical identities are a literal approved list. Each suite includes integrity/FK, order, receipt, cash, reservation and inventory assertions. Unknown historical costs stay NULL. The stock oracle reconciles business movements; integer stock scenarios require exact equality, without epsilon tolerance.

## Defects reproduced before corrections

1. Receipt metadata failure was swallowed inside a savepoint, allowing a completed sale without its immutable receipt. Phase 10 explicitly requires these durable records to commit together. Storage/outbox failure now propagates to the enclosing checkout transaction. Physical printer submission remains after commit and cannot undo a sale. Two old tests that asserted the earlier optional-document contract were updated to the stronger Phase 10 contract; neither was removed. All existing physical-print failure/retry tests remain.
2. REAL stock arithmetic accepted `MAX_SAFE_INTEGER - 1.5` or `(MAX_SAFE_INTEGER-2) + 1.5`, rounding an accepted physical quantity. Decimal arithmetic now computes and verifies representability before persistence. Quantity × cost must divide into whole exact cents. This preserves the existing fractional-stock model and rejects unrepresentable extremes, without changing schema.
3. Two individually valid cash entries could produce an unsafe session aggregate. The session's signed category totals and overall balance are checked as BigInt inside the same transaction. Unsafe effects roll back. Pre-cash-schema migration fixtures remain supported; operational connections still require the inspected current schema.
4. Sale-number allocation scanned every order because its query omitted the partial index predicate. On the interrupted 40,229-sale fixture the original plan was `SEARCH orders`; warmed samples were 18.68–27.85ms and the cold sample was 730.64ms. Adding `WHERE sale_number IS NOT NULL` uses the existing covering `unique_sale_number` index, with identical semantics: warmed samples 0.0081–0.0240ms and cold 1.082ms. No index or migration was added.

## Test infrastructure findings

The initial new harness used the wrong existing quantity method name, used top-level await in CJS, and attempted a reentrant row dump inside a SQLite UDF barrier. These were harness construction errors, corrected without changing product behavior. The before-commit barrier emits only its stage; the parent compares recovered state to the independently captured pre-transaction hash.

A preliminary full suite concurrently ran with the 100k simulation and Chromium lifecycle stress on the owner’s 8GB Windows laptop. Available physical memory fell to 149,120KB. The existing asynchronous 50-print test exceeded its 5-second unit deadline. Its deadline and assertions remain unchanged. Certification workloads are now sequential and the full-suite driver uses one worker, reducing resource contention without retries, sleeps or weaker assertions. This preliminary failure is retained as evidence; only the subsequent final fixed-source fivefold run can count as repeatability certification.

The 30-second Phase 9.3 test boundary applies to the genuine schema5 fixture + durable pre-migration backup + migration/health/history checks, not checkout. Prior final Windows measurements were fixture 1522.89ms, migration/backup 85.85ms, total 1636.91ms. The prior 10.75-second CI overrun was a file integration workload exceeding the generic 5-second unit deadline. Phase 10 must retain fresh measurements and not increase that boundary. Separately, the existing data-protection `whenIdle()` shutdown wait is capped at 30 seconds; controlled shutdown logs and exits on expiry rather than waiting indefinitely. It is not a mutation timeout and does not retry a sale.

## Gates

Baseline: npm ci, 418 tests, typecheck, build, production DB verifier and actual Windows package audit before modifications.

Candidate: deterministic 1000 financial scenarios, failure/commit-response matrices, actual process termination/recovery, bounded writer/storage contention, multi-period simulation, backup A/B torture with continued operation, input/calendar boundaries, actual hidden Electron lifecycle/resource tests, five consecutive full suites stopping at the first failure, all current Windows acceptance gates, and frozen 9.3 installer upgrade with pinned hash/commit.

New artifacts contain only technical metadata, synthetic QA data summaries, hashes, counts, timings and measurements. No raw customer records, databases, phone numbers, credentials or owner backups are committed/uploaded.

Trusted signing, physical thermal printer and a real second café laptop remain external pending items. They cannot substitute for any software gate. Certification is not a zero-bug claim.

## P10-07 — R1: all-history monetary capacity

Reproduction: complete a MAX_SAFE_INTEGER-cent CASH sale, close its cash session, then attempt a 1-cent sale in a new session. Independently, save MAX_SAFE_INTEGER in operating expenses and attempt another cent, or add a valued loss that takes the operating result below MIN_SAFE_INTEGER. All three new reproductions initially returned success, leaving the all-history report unable to return safe integer values.

Correction: validate aggregate revenue, known historical cost subtotal, quantity, effective expenses, known valued losses and complete profit/operating arithmetic inside the transaction before writes. Uncertainty counters remain separate; NULL costs are never presented as known zero. No persistent counter, new schema or migration was added. The in-memory aggregate cache is validated by existing append-only financial identities and SQLite data_version; it is promoted only after successful commit, sealed inside the write transaction, and discarded on a new database connection/restore. Existing immutable history constraints make those identities authoritative. Own-connection append changes, another operational writer, rollback, expense correction and absence of repeated history scans have permanent regressions. Targeted finance/checkout/boundary suite: 122/122 PASS; cache-specific suite: 5/5 PASS. One former read-overflow test now additionally verifies pre-persistence rejection and still retains the defensive legacy-read overflow assertion.

## Additional harness correction

The completed 100k data reached final cash reconciliation, which incorrectly compared SQLite integer zero with JavaScript negative zero using Object.is semantics. BigInt arithmetic now negates before converting to Number, yielding canonical zero. This was a false oracle failure, not a monetary discrepancy. The same committed dataset is reconciled again; the generator is not rerun to conceal a failure.
