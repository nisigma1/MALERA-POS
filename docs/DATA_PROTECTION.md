# FOX data protection

FOX owns `%APPDATA%\FOX Kafeteri\fox.sqlite`, independently of the installation folder. WAL/FULL synchronous, foreign keys ON and a 5-second busy timeout remain unchanged. A single main process owns operational writes. Never delete `fox.sqlite`, its WAL/SHM, the data identity file, recovery journal, or backup files to fix a startup problem.

## Manual backup

Under **Cilësimet → Të dhënat**, choose **Krijo backup** and a new `.sqlite` filename, preferably on external USB. SQLite's asynchronous backup API captures committed data consistently while WAL is active. FOX verifies full integrity, foreign keys, owned schema, metadata and SHA-256 before reporting success. Keep both the `.sqlite` and `.sqlite.json` sidecar. A missing sidecar/checksum is intentionally rejected. Existing files and application files cannot be overwritten by this action. Incomplete `.partial-*` files have no successful backup status and must not be used for recovery.

Backups contain the complete business database, including settings, open orders and receipt history; they contain no executable, logs or credentials. Protect USB/backups against loss and unauthorized access. FOX does not encrypt or upload them. A checksum detects damage, not ownership/authenticity against an attacker who can replace both files.

## Restore

Choose **Rikthe nga backup**. FOX checks checksum, full integrity, FOX table/index/trigger identity and compatible migration history. Foreign, truncated, newer-schema and incomplete files are rejected. Open orders and active print work block normal restore. Confirmation defaults to **Anulo**; only deliberate confirmation replaces data.

FOX stages a SQLite snapshot and legitimately migrates compatible older schema there before replacement. It creates a verified pre-restore backup of current data in `userData\backups`, pauses operations/printing, checkpoints and closes SQLite, then uses same-directory renames with a flushed recovery journal. Failure/interruption before completion restores the original file on startup. Successful reopen validation precedes the success report and actual app relaunch. Never open an older executable against a newer database without checking migration compatibility.

Restoration rolls business state back to the selected backup point. Later sales and receipts remain in the pre-restore safety backup, not the restored live history. Restored pending print intents can belong to work performed after the backup point; inspect paper/history and printer settings before resuming service. Physical exactly-once printing cannot be guaranteed by restoring an earlier database.

## Migrations and retention

Before an existing file database receives schema changes, startup makes a verified `FOX-before-vN-...sqlite` snapshot using SQLite's transactional VACUUM INTO mechanism. Backup failure prevents migration. Existing migration SQL v1–v4 is unchanged. Only the latest five verified owned automatic migration backups are retained; manual and pre-restore backups are never deleted by retention. Check disk capacity periodically.

## Startup failures and disaster recovery

Startup runs quick_check, foreign-key checks and owned schema validation. Existing empty, corrupt, foreign, newer or unreadable files fail closed. The persistent data identity marker detects a previously initialized database missing from the directory; FOX does not silently initialize a replacement. Old installations without that marker cannot prove a file was deleted before their first hardened launch.

For unreadable data, the blocking native recovery screen can choose a verified backup and requires confirmation. The closed original main/WAL/SHM files are preserved as `FOX-unreadable-preserved-...` evidence. Do not automatically repair or delete rows. Permission failures may prevent recovery too; preserve the folder and obtain support.

Uninstall removes application binaries/shortcuts and retains userData. Reinstall uses the same identity. For software rollback after a schema upgrade, retain the earlier installer **and** its compatible pre-migration backup. Test recovery on an isolated copy first.

The last verified manual backup and sanitized technical diagnostics are visible/copyable from Settings. Local error logs rotate at 256 KiB, up to five files, excluding arbitrary messages/arguments/financial data and secrets. Logs are never uploaded.

Go-live choices are a fresh production database or an explicitly reviewed existing database. Neither is selected or executed automatically; current user history is preserved. Costs remain optional for selling and unknown historical costs remain unknown.

SQLite mechanisms: [backup API](https://www.sqlite.org/backup.html), [VACUUM INTO](https://www.sqlite.org/lang_vacuum.html).
