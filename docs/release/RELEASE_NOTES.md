# FOX Kafeteri 0.5.0-rc.1 — release candidate hardening

Safe SQLite manual backup/validated restore, pre-migration safety backups and recovery after interrupted replacement. Startup fails closed for unhealthy existing data; diagnostics, bounded local logging, renderer recovery and tighter IPC/local-asset controls added. Existing CASH checkout, stock, reports, floor positions and durable non-fiscal receipt behavior remain unchanged. Schema remains v4; old migration SQL is unchanged.

Stable application/userData identity and uninstall preservation. Manifest v2, CycloneDX SBOM, final hashes, secret/data exclusion scans and trusted-signing gates added. Official RC requires valid timestamped trusted signatures and installed acceptance. Current signing credential is unavailable; any explicitly generated QA artifact remains UNSIGNED and cannot be promoted to production by relabeling.

Physical thermal printer, second physical laptop, actual Windows reboot and trusted-signing acceptance remain separate evidence requirements. No auto-update, fiscalization, cloud sync or payment-method additions. Current owner data is preserved; fresh production database selection requires an intentional separate decision.
