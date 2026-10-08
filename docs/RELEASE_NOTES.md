# FOX Kafeteri 0.4.2 — deployment-test candidate

Windows x64 per-user NSIS installer, private release workflows, final checksums and manifest. Offline POS, cash-only checkout, numbered sales and inventory behavior are preserved.

Data remains in the existing FOX Kafeteri userData directory. Startup applies migrations 1–3 transactionally; reference seeds preserve existing configuration. Close FOX and back up the full data folder before upgrading. Uninstall retains business data.

Installer is UNSIGNED; Unknown Publisher/SmartScreen may appear. No approved logo file is available, so the default Electron application icon remains. No autoupdate, printing or fiscal integration. Second physical laptop and developer-free clean Windows machine acceptance must be completed before production deployment. Existing business data needs operator review, especially incomplete costs/stock and unusual prices.
