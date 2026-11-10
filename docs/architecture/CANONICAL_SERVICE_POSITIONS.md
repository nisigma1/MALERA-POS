# FOX service-position contract

The only operational codes are M1–M13 (Brenda), SH1–SH4 (Shanku), and T1–T10 (Terrasa): exactly 27 unique positions. B/J are not operational aliases. T11 and J11 are invalid.

`src/domain/definitions.ts` owns each code, area, order and physical sketch reference. Seeds and schema constraints use this definition; `src/presentation/floorPlan.ts` associates its physical references with coordinates traced from `docs/references/fox-original-floor-plan.png`. B01–B13/R01–R10/S01–S04 are internal sketch annotations, never table codes or stored order identifiers.

M13 is the diagonal indoor lower-left entrance table, MAIN, (173,803), 45°. T1 is the small two-seat terrace table nearest the indoor opening, TERRACE, (995,858). T2/T3/T4 are the left/centre/right terrace rounds; T5–T10 are the bottom rectangles from left to right. SH1–SH4 follow the bar seats from left to right.

Phase 9.1 restores the display and geometry regression from commit 35606d4. Legitimate 0.7.0-rc.1 databases already contain canonical table records; their schema rejects B/J. No data rename or new migration is required. A tampered schema or mixed-code database fails existing integrity/schema validation instead of silently merging identities. Historical receipt payloads and hashes remain immutable, including B/J labels stored by rc.1; all newly generated receipts use canonical codes.

The independent literal oracle in `tests/canonicalPositions.test.ts`, structural floor tests and installed UI acceptance protect the exact set, areas, physical identity, fresh DB, upgrades, order persistence, checkout, finance and backup history. Changing a display convention must never change these expectations without an explicit revision to this domain contract.
