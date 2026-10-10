# Phase 7 — frozen baseline and change budget

Baseline: main d9135e5d9831c08c496c618ebd9bb90a08e38c8d, 0.6.0-rc.1, schema 4; 229/229 tests, npm ci/typecheck/build/secret scan and actual QA package/release verification PASS before changes. Identity remains com.foxkafeteri.pos / FOX Kafeteri.

| Change | Reason / observed risk | Subsystem | Regression risk | Evidence required |
|---|---|---|---|---|
| Explicit calculated ready/not-ready wording | Existing settings exposed counts and configured text, but no explicit operational state for handover | Settings presentation only | Wording must reflect existing computed boolean | Fresh → configured → missing price/tracking → recovered UI assertions |
| Strengthen isolated production verifier | Existing verifier omitted expense/item/attempt/default checks and left temporary DBs behind | Developer verification only | Never reuse or remove live paths | Exact 27/21/5, all transaction tables zero, defaults, integrity/FK, guarded temp cleanup |
| Cutover acceptance instrumentation | Phase 6 configuration setup used direct QA API calls; Phase 7 requires configuration and sale through UI controls | Developer-only fixtures/scripts | No production debug hooks or QA data shipped | Release compile/ASAR scan, UI-only mutation scenario, actual installed scenario |
| Four owner handover documents | Existing data-protection guide was technical English; daily operator guide included backup instructions | Documentation | Restore/deployment misunderstanding | Consistent Albanian steps/checklist and safe fresh-machine policy |
| 0.6.0-rc.2 | Smallest RC progression for cutover/handover acceptance | Metadata | No schema/identity/version mismatch | Full regression/package manifest |

No prices, costs, stock, names, active states or history in the current owner database are changed by Phase 7. Owner-requested local catalogue edits remain in that existing database and are not silently baked into the approved 21-product seed. No migrations, financial calculations, inventory logic, dependency versions or floor coordinates changed.
