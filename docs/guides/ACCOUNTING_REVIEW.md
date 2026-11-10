# Accounting review — unreleased changes after 0.4.2

Reports now expose each completed order's original item names, quantities, unit selling prices, historical unit purchase costs, line amounts and gross profit. Unknown historical costs remain unknown; changing the catalog does not rewrite past transactions. The report reconciles detail sums to the sale total and shows missing-cost units, line count, exposed revenue and the known partial cost separately from the unavailable complete cost/profit.

Both summary APIs now share the same authoritative reporting function. This fixes the generic summary's missing overflow protection for net-profit subtraction. Negative profit remains a real loss, not zero. Expenses mean only recorded expenses. The last-50 detailed list is explicitly distinguished from period totals covering every completed sale.

Seven new regression tests cover quantity/cost/profit reconciliation, missing-cost coverage, immutable historical labels and costs, real losses/recorded expenses, more than 50 sales, equality of summary APIs and unsafe net-profit subtraction. Existing 131 tests remain; total 138. Native Electron QA opens each historical order and verifies the item list at 1366×768, 1440×900 and 1920×1080, alongside checkout and actual restart.

Read-only operational audit found Çaj fruta mali priced at €454, eighteen products with tracking not configured and old transactions with missing historical costs. These are documented data issues; no price, tracking decision, order or historical payment was guessed or rewritten. The operator must specify the correct tea selling price and actual inventory decisions. Purchase cost €0.15 is distinct from its selling price. Existing order snapshots need separate review even after correcting the current product price.

SQLite backup and accounting evidence are retained in the parent workspace outputs/fox-accounting-review, outside source control. No new migration, checkout behavior, tax/fiscal rule, release tag or installer publication is introduced. The private draft 0.4.2 remains the prior verified release; these changes are in development source pending a new intentional release.
