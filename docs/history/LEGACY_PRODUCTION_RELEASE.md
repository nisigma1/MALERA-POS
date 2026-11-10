> Historical reference. This record predates repository consolidation. Use [current installation](../release/INSTALLATION.md) and [automatic updates](../release/AUTOMATIC_UPDATES.md) for current delivery.

# FOX trusted Windows release

Target 0.5.0-rc.1; stable appId `com.foxkafeteri.pos`, product/userData identity FOX Kafeteri. Repository remains private. QA artifacts are explicitly UNSIGNED and channel QA; RC/production packaging requires legitimate trusted signing and an exact immutable `v<package version>` tag. Do not publish a production release automatically.

## Signing dependency

Current audit found no usable local CurrentUser/LocalMachine code-signing certificate and no configured GitHub signing secrets/service. **SIGNING CREDENTIAL REQUIRED.** Smart App Control/Code Integrity events 3033/3077/3118 show the previous unsigned installed executable failed the required Windows signing policy. This is factual signing-policy evidence, not an assertion about reputation or Mark-of-the-Web. Security settings must stay enabled; no self-signed production certificate, binary disguise or alternate execution bypass is acceptable.

`scripts/release/signing-config.mjs` supports provider `certificate` (builder CSC/WIN_CSC secrets or a legitimately installed certificate thumbprint) and `azure` (existing Trusted Signing account/profile and native Azure identity). Modern SHA-256 and a provider-documented RFC3161 endpoint are mandatory; no real provider endpoint is invented. SHA1 certificate **thumbprint selection** is distinct from the SHA-256 binary digest.

Required non-secret configuration: `FOX_SIGNING_PROVIDER`, `FOX_SIGNER_SUBJECT` (exact certificate subject), `FOX_SIGNING_TIMESTAMP`. Certificate mode: `CSC_LINK`/`WIN_CSC_LINK` and secret `CSC_KEY_PASSWORD`/`WIN_CSC_KEY_PASSWORD`, or `FOX_SIGNING_THUMBPRINT`. Azure mode: `FOX_AZURE_ENDPOINT`, `FOX_AZURE_ACCOUNT`, `FOX_AZURE_PROFILE`, plus provider-native Azure identity (`AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET` if this supported method is used). Use existing credentials/secrets; do not buy/create paid resources in this phase. Never commit private files or print credential values.

Builder requires signing for official artifacts and includes `.dll`/`.node` signing extensions. `verify-signatures.ps1` independently inspects all staged EXE/DLL/native binaries, requires valid timestamped signatures for trusted releases, validates FOX signer identity on own executables, and uses signtool `/pa /all` where available. Actual installed uninstaller must also pass signature verification before final signed acceptance. A builder console message alone is insufficient. See [electron-builder v26 signing](https://www.electron.build/v26/docs/features/code-signing/code-signing-win/).

## Release sequence

Committed clean source → npm ci → tests/typecheck/build → protection/crash/runtime regression → source secret/forbidden scan → package/sign → independently verify signatures → generate CycloneDX SBOM (production npm components plus Electron runtime) → hash final installer/SBOM → manifest v2 → verify ASAR/native x64/identity/data exclusion → actual installed acceptance → private draft RC.

No draft/tag is created while required acceptance remains incomplete. Version must match package/lockfile, installer, manifest, diagnostics and immutable tag. Signed RC/production requires exact tag; explicitly unsigned QA build records `tag:null` when untagged and cannot be promoted by renaming files or editing metadata. Signing changes the binary hash, so checksum generation always follows signing.

Official command: `npm run package:win` (missing signing fails closed). Explicit QA command: `npm run package:win -- --qa`. `npm run release:scan`, `npm run release:sbom -- release`, `scripts/release/verify-release.ps1` and independent signature verification are mandatory. Never move a published tag or replace an existing release's assets.

Manifest v2 records channel, version, appId, x64/platform, exact commit/tag/CI run, timestamp, schema4, actual signing/signer, final installer hash and SBOM hash. Release contents: installer/checksum, manifest, SBOM, signature evidence. No DB, WAL, logs, environment files, private keys or QA data. Build bundles contain no developer verification entrypoints or remote runtime dependencies; receipt/test fixtures stay outside production code.

## Dependency audit

Baseline: runtime npm audit has zero findings; full audit has eight moderate dev/build findings, all through `sprintf-js` denial-of-service precision handling (GHSA-hp3w-g68c-fv3c), propagated through roarr/global-agent/@electron/get/app-builder-lib/dmg-builder/squirrel/electron-builder. No high/critical findings. Not packaged/reachable in FOX runtime; build input is controlled. No safe same-line sprintf-js fix was available in the audited registry; npm proposed builder26.5.0 as a breaking solution despite current26.15.3. No forced fix/downgrade applied. Record/review these findings on each release; SBOM plus lockfile pin exact inputs. This does not claim vulnerabilities can never affect the build environment.

## Acceptance and operating limits

Use normal Windows security. Actual installers must pass fresh data (27 positions/21 products/no invented prices or QA transactions), old0.4.2 and QA→RC upgrade, open-order preservation, CASH/stock/reports/receipt invariants, single instance, uninstall/reinstall, backup/restore, offline and restart. Hosted clean Windows CI can test unsigned software but does not substitute for trusted signing/Smart App Control on the owner's laptop, physical thermal printer, physical second laptop or actual Windows reboot. No developer tools are runtime requirements; the test controller's tools are not application dependencies.

Retain complete installed/crash/large-data evidence and exact artifact hashes. If signing is absent, finish unrelated hardening, retain explicit QA artifacts and do not label them trusted production RC. Rollback after migration requires earlier installer plus compatible database backup. No auto-update, telemetry, cloud backup, roles, card UI or new POS features are introduced.
