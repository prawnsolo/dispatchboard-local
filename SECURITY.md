# Security notes: DispatchBoard (Local)

Rule: customer information does not leave this computer unless a person turns on
a network feature on purpose.

## What leaves the PC, and when

| Feature | Default | What is sent | Where |
| --- | --- | --- | --- |
| Allow network geocoding | Off until allowed once, then automatic (Census, then Google on a miss) | Street, city, state, zip only. Names, phones, gate codes and place tags are stripped first (`address-clean.ts`) | US Census; Google (only with your key); Nominatim |
| Check drive times | Off (needs the above + key) | Job coordinates and addresses | Google Routes |
| Map tiles | Always | Map viewport tile requests (no names, no addresses) | tiles.openfreemap.org |

Everything else (jobs, sites, notes, checklists) stays in SQLite on this PC.

## Controls in the build

- Webview CSP: no inline script, `connect-src` limited to IPC, OpenFreeMap tiles, and Google Routes. `base-uri 'self'`, `form-action 'none'`, `object-src 'none'`.
- Tauri commands are allowlisted in `src-tauri/build.rs` and granted one by one in `capabilities/default.json`. A new command is denied until added in both places.
- Geocoder requests go through Rust (`geo.rs`): https only, host and path pinned per provider, no redirects, 15 s timeout, 2 MB cap, URLs never logged.
- Google API key lives in Windows Credential Manager (`secret.rs`). Old plaintext key files are migrated and wiped.
- `PRAGMA user_version` guards against an older build opening a newer database.
- Daily and manual local backups (`backups/`, newest 14). Same sensitivity as the live database.
- Import accepts files up to 5 MB.
- Fixtures must be synthetic: `npm run check:fixtures` runs in CI and in `.githooks/pre-commit`.

## Known and accepted

- **Unsigned installer.** Windows SmartScreen will warn. Signing needs a code-signing certificate.
- **`xlsx@0.18.5`** has two advisories (prototype pollution, ReDoS) and no fix on the npm registry. Fixed builds are published only on the SheetJS CDN (`https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`). Mitigations here: import only files exported from Pegasus, 5 MB cap.
- **`maplibre-gl` advisory** (HTML sanitizer bypass) is not reachable: popups use `setDOMContent`, never HTML strings. Upgrade to 6.x when the map code is next touched.
- **`rsa` (RUSTSEC-2023-0071)** appears in `Cargo.lock` through an unused sqlx MySQL driver. It is not in the Windows build graph.
- **Backups and the database are not encrypted at rest.** They rely on Windows account protection and, ideally, BitLocker on the PC.
- **Google key restrictions** are set in Google Cloud, not here: restrict the key to Geocoding API and Routes API and set a daily quota cap.
