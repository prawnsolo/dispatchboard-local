# Local vs cloud DispatchBoard — parity plan

**As of:** 2026-09-30 (America/New_York) — Stages 1–5 are feature-complete on SQLite. Stage 6 (hardening) is recorded here: **code signing is not done** (no certificate in the repo; SmartScreen will still warn), and **no sync bridge** to Supabase or Tiger Tools unless Jose reopens that in writing. Installer version **0.2.0**. Theme tokens are shared with the office app (`src/styles/tokens.css`). Header chrome follows the office two-row shell (text brand only; no Tiger logo).  
**Audience:** Jose (product) + Chief of Staff (orchestration)  
**Apps:**

| App | Where | Data |
|---|---|---|
| **Office (cloud)** | `src/` → https://dispatchboard-rho.vercel.app | Supabase `tpcdleuuuselmrxhgurd` |
| **Tiger Tools (cloud)** | `apps/tiger-tools/` → https://tiger-tools.vercel.app | Same Supabase |
| **Local (this plan)** | `apps/local-dispatchboard/` → Windows `.exe` / Tauri | SQLite on that PC only |

---

## 1. Goal

Make **DispatchBoard (Local)** useful for the same day-to-day office dispatch loop Jose already does in the cloud app — import ADD, see the board, schedule, map, fix addresses — while **customer rows never leave the PC**.

Parity means **operator workflow parity**, not “wire Local to Supabase.” Pointing Local at the live project would defeat the reason Local exists.

---

## 2. Non-goals (stay cloud-only unless Jose explicitly reopens)

| Item | Why it stays out of Local |
|---|---|
| Supabase Auth / `profiles` / RLS / Demo role | Single-user desktop; no shared tenants |
| Edge Functions (`apply-add-import`, `admin-delete`) | No server |
| Private Storage (`add-imports`, `job-note-photos`) | Cloud blobs; optional later = local folders only |
| Live multi-user board | Needs shared DB |
| Tiger Tools reading Local SQLite | Field PWA is online-first against Supabase |
| Settings wipes that hit cloud | Local already has **Wipe local database** |
| Code signing / SmartScreen silence | **Not done.** No certificate in this repo. The Windows installer stays unsigned and SmartScreen will still warn. Buying a cert is a separate ops decision. |
| Full Google Maps JS basemap | Office keeps MapLibre; Local should too |

**Bridge decision (Stage 6): no sync bridge is built.**

Local does not read or write Supabase, and Tiger Tools does not read Local SQLite. That stays true unless Jose reopens a bridge in writing.

Ideas that were discussed and are still not started:

- One-way **export** from Local → CSV / ADD-shaped file for someone else (Sheet already downloads the rows on screen as CSV; that is not a cloud bridge)
- Optional **sync bridge** Local ↔ Supabase (high stakes; needs Tiger PII approval)
- Local “read-only mirror” of cloud for demos (still cloud data on disk)

---

## 3. Product principles (carry forward from Local stage 1)

1. **No phone-home by default.** Network only when Jose opts in (e.g. Census geocode, optional Google key he pastes, the five-day forecast, which sends only the yard's rounded coordinates to api.weather.gov).  
2. **Import never deletes.** Match WO / capacity keys; update-matched is opt-in.  
3. **Text chrome only** until Tiger branding is approved (logo stays under `assets/_pending`).  
4. **Reuse office `src/lib/import/*` semantics** (headers, parse, fingerprint) so ADD files behave the same.  
5. **Ship via Windows NSIS** (existing Actions workflow). Each parity stage that changes UI should keep `desktop:build` green.  
6. **Yard** stays Fredericksburg coords from office `yard.ts` when Map lands.

---

## 4. Parity matrix

Legend: ✅ in Local today · 🟡 partial · ⬜ not in Local · ☁️ cloud-only (out of Local scope)

### 4.1 Shell & trust

| Capability | Cloud office | Local today | Target |
|---|---|---|---|
| Sign in / roles | ✅ | ☁️ | Stay out |
| Theme Auto/Light/Dark | ✅ | ✅ same office tokens (brand, slate, app/surface/chrome). Auto follows this PC. Settings only; header stays text | Keep `src/styles/tokens.css` |
| Header chrome | ✅ two rows: hamburger + single-line brand + nav pills; second row is date, search, and on Map the filters + nearby control. Theme, templates, and mismatch rules sit in the hamburger | ✅ same two rows. Text brand “DispatchBoard” plus a charcoal **Local** pill (no logo, no lockup). Nav pills: Map, Calendar, Jobs, Sheet, Backlog, Import. New job is on that row. Planning (templates + mismatch rules), theme, clear schedule, and wipe stay in the hamburger. Map’s second row adds Filters and Nearby; drive times, Geocode, and Unmapped sit on the map | Keep text brand |
| Hamburger Settings | ✅ | ✅ theme, path, clear schedule, wipe, Planning | Keep |
| Windows installer | — | ✅ | Keep |
| Unsigned SmartScreen | — | 🟡 unsigned on purpose | **Signing is not done.** No cert in the repo. SmartScreen will still warn. |

### 4.2 Import

| Capability | Cloud | Local | Target stage |
|---|---|---|---|
| ADD `.xls` / `.xlsx` / CSV, 18 columns | ✅ | ✅ | Done (1) |
| Preview counts / WO vs capacity | ✅ | ✅ | Done |
| Apply new-only + update-matched | ✅ | ✅ | Done |
| Fingerprint / no duplicate matches | ✅ | ✅ | Done |
| Diff vs live (unchanged/new/changed) | ✅ | 🟡 simpler preview | **1.5** richer preview |
| Auto-geocode after Apply | ✅ Census (+ Google leftover) | ✅ Census → site pin → Google if a key is on this PC | Done (3b) |
| Unmapped Fix modal | ✅ | ✅ edit address, retry Census then Google if keyed, pin-save | Done (3b) |
| Import history / Storage / Clear history | ✅ | ☁️ / wipe DB | Skip history; keep wipe |
| Staleness / last-import pill | ✅ | ✅ last-apply on Import | Done (1.5) |

### 4.3 Jobs & editing

| Capability | Cloud | Local | Target stage |
|---|---|---|---|
| Jobs table + date + search | ✅ Sheet + cards | ✅ table | Done |
| Job drawer (detail) | ✅ | ✅ | Done (1.5) |
| Office edit any planning fields | ✅ | ✅ | Done (1.5) |
| Phone on detail | ✅ | ⬜ (not in ADD cols; later) | Later if a column exists |
| Account # on face + detail | ✅ | ✅ drawer + table | Done (1.5) |
| New job / tentative create | ✅ | ✅ | Done (1.5) |
| Undo after schedule edit | ✅ | ✅ drag undo ~10s | Done (2) |
| Live Sheet spreadsheet | ✅ | ✅ edit planning cells, CSV download; capacity toggle default off | Done (5) |
| Notes + photos | ✅ Storage | 🟡 notes text on the job (drawer and Sheet). Photo files not stored | Optional **5b** deferred. Notes text already saves on the job |
| Checklist / ⚑ / Templates | ✅ | ✅ | Done (4) |
| Trip 2 parent | ✅ | ⬜ | Deferred. Local jobs have no parent column; not added in Stage 4 |

### 4.4 Calendar

| Capability | Cloud | Local | Target stage |
|---|---|---|---|
| Day-grouped list | — | ✅ replaced by grids | Done (2) |
| Desktop Time grid (tech columns, 07–23) | ✅ | ✅ | Done (2) |
| Week × technician grid | ✅ | ✅ | Done (2) |
| Drag tentative / Move | ✅ | ✅ no-WO only | Done (2) |
| WO drag lock (drawer still edits) | ✅ | ✅ | Done (2) |
| Capacity blocks | ✅ | ✅ on grid, not dragged | Done (2) |
| Mobile DayStrip | ✅ | N/A desktop-first | Skip or thin later |

### 4.5 Map & location

| Capability | Cloud | Local | Target stage |
|---|---|---|---|
| MapLibre + OpenFreeMap | ✅ | ✅ | Done (3). Tiles load when the Map tab is open |
| Census geocode → site pin → Unmapped | ✅ | ✅ opt-in | Done (3) |
| Store lat/lng on jobs/sites | ✅ | ✅ + `geocode_cache` | Done (3) |
| Yard pin | ✅ | ✅ Fredericksburg | Done (3) |
| Proximity / Nearby (haversine) | ✅ | ✅ dims out-of-radius pins | Done (3) |
| Nominatim fallback | ✅ | ✅ Nearby only, with OSM credit | Done (3) |
| Google geocode fallback | ✅ optional | ✅ paste-key on this PC; Census miss only; opt-in and key | Done (3b) |
| Check drive times (>30 min) | ✅ one-tech/one-day | ✅ one tech + one day; key and network geocoding required | Done (4) |
| Unmapped pin-save | ✅ | ✅ job and optional site | Done (3) |

### 4.6 Planning helpers

| Capability | Cloud | Local | Target stage |
|---|---|---|---|
| Mismatch rules CRUD + flag on import | ✅ | ✅ advisory ≠, not a hard stop | Done (4) |
| Backlog CRUD + promote | ✅ | ✅ SQLite `backlog_items`; Promote writes a tentative job and `promoted_job_id` | Done (5) |
| Best days → Schedule here | ✅ | ✅ Nearby ranking; Schedule here / New job here | Done (5) |
| Clear scheduled jobs | ✅ | ✅ type `CLEAR`; dated jobs incl. capacity | Done (2) |
| Admin Delete Imports / Database | ✅ | Wipe local ≈ DB | Done enough |

### 4.7 Field / multi-device

| Capability | Cloud | Local | Target |
|---|---|---|---|
| Tiger Tools My Day / Board / Backlog | ✅ | ☁️ | Out of scope |
| Shared live updates | ✅ | ☁️ | Out of scope |

---

## 5. Schema growth (Local SQLite)

Stage 1 tables: `jobs`, `sites` (no lat/lng, no mismatch, no checklist).

| Stage | Add |
|---|---|
| **1.5** | Optional `jobs.updated_at`; keep edits in existing columns |
| **2** | No new tables required for grid; ensure begin/end/tech/date editable |
| **3** | `jobs.lat`, `jobs.lng`, `jobs.geocode_source`; `sites.lat`/`lng`/`pin_source`; local `geocode_cache` table |
| **4** | `mismatch_rules`; `jobs.mismatch_flag` / `mismatch_note`; `templates` + `template_checklist_items` + `job_checklist_items`; `drive_time_cache` |
| **5** | `backlog_items` (type, status, `promoted_job_id`, lat/lng). Notes stay on `jobs.activity_note`. Photo files were not added |

Migrations: versioned SQL in the Tauri/SQLite bootstrap (same spirit as Supabase migrations, local only).

---

## 6. Build stages (ordered)

Ship one stage per PR against `apps/local-dispatchboard/**`. Re-run Windows workflow; keep artifact name **DispatchBoard-Local-Windows-setup**. The post-parity installer is **0.2.0** so it is distinguishable from Stage 1’s `0.1.0`. It is still unsigned.

### Stage 1 — Foundation (✅ shipped, PR #48)

Import + SQLite + Jobs table + Calendar/Map stubs + Windows `.exe`.

### Stage 1.5 — Job drawer + edit + import polish (✅ shipped)

**Why first:** Turns the table into something Jose can correct without re-importing.

- Click row → drawer: customer, account, address parts, tech, date, times, activities, instructions, notes text (no photos yet)  
- Persist via SQLite UPDATE  
- New job button (tentative, no WO)  
- Import: last-apply time + clearer new/changed counts  
- Settings hamburger: theme, wipe DB, DB path reveal  

**Done when:** Edit a sample job, restart app, change persists; create a tentative job visible on Jobs.

### Stage 2 — Calendar that can dispatch (✅ shipped)

**Why next:** Matches the office “plan the day” loop.

- Desktop **Time grid** (port / adapt `ResourceDayGrid` ideas to Local data)  
- Week × technician view  
- Drag tentative + no-WO; WO rows edit via drawer only (same rule as office)  
- Undo toast (in-memory stack, ~10s)  
- Settings: Clear scheduled jobs (keep backlog when backlog exists; until then clear dated jobs only)  
- Shared date chip (today America/New_York)

**Done when:** Jose can drag a tentative job to another tech/day and see it on Time grid after restart.

### Stage 3 — Map + geocode (opt-in network) (✅ shipped)

**Why:** Cloud Map is the other half of dispatch.

- MapLibre + OpenFreeMap in the Tauri webview (tiles load when the Map tab is open)
- After Apply: Census chain when network geocoding is allowed (public Census API). Optional Google is Stage 3b.
- Unmapped list + Fix / pin-save (job and optional site)
- Yard pin (Fredericksburg, same coordinates as office `yard.ts`)
- Nearby search (haversine; Nominatim only after a Census miss, with OSM credit)
- Schema: lat/lng + `geocode_cache`
- Settings toggle **Allow network geocoding**, default off

**Done when:** Sample ADD import yields mapped pins; Unmapped jobs can be fixed; Nearby dims out-of-radius jobs.

### Stage 3b — Optional Google (paste key) (✅ shipped)

- Settings field for a Google Maps API key (Geocoding now; the same key can enable Routes later) stored in the OS app config directory on this PC (`google-maps-api-key.json` next to the SQLite file). Not in the repo. Not a `VITE_` value in the installer.
- Google only after a Census miss and no usable site pin, and only when network geocoding is already allowed and a key is present (same order as office).
- No key: Census → site pin → unmapped, unchanged.
- Drive-time check uses that same key in Stage 4. No key: the control stays off.

**Done when:** Settings can save and remove a key on this PC; with network geocoding on and a key present, a Census miss with no site pin can resolve through Google; with no key, Google is not called.  

### Stage 4 — Mismatch + templates + drive-time (✅ shipped)

- Mismatch rules CRUD on the Planning tab (SQLite); evaluate on Apply; advisory ≠ on calendar cards, the jobs list, and map pins. Not a hard stop.
- Templates + checklist items; apply from New job and the job drawer; ⚑ on calendar, jobs, and map when a required item is unchecked.
- Seeded GAS CHECK ↔ CLEANING rule and Tank Install Trip 1 / Trip 2 with required Excavator (Dan) scheduled. Trip 2 does not store a parent job.
- Optional Check drive times on Map (one technician + the shared date) when the pasted Google key is present and network geocoding is allowed. One Routes `computeRoutes` call; legs cached in SQLite; warn over 30 min. No cloud Edge Function.

**Done when:** Seed GAS CHECK ↔ CLEANING style rule flags on import; Tank Install–style template applies checklist.

### Stage 5 — Sheet, backlog, polish (✅ shipped)

- Live Sheet tab. Editable planning cells write SQLite and refresh Jobs, Calendar, and Map. Capacity rows stay off unless Include capacity is on. Download CSV is the rows on screen.
- Backlog CRUD for tank pickup, lockout, monitor swap, and meter site. Promote creates a tentative job (no work order), sets status to promoted, and stores `promoted_job_id`. Open items with coordinates draw on the Map.
- Best days ranks Nearby results. Schedule here uses the calendar move for a tentative job and the drawer save for a work order. New job here opens the existing New job form with the day, technician, and nearby address filled in.
- Header is two rows: brand text and view pills, then the shared date and search. Still no Tiger Fuel logo. A later chrome pass matches the office density: single-line brand, charcoal Local pill, Planning in the hamburger, and Map filters/nearby on row 2.
- **5b** photo files under the app data directory were not added. Note text already saves on the job.

**Done when:** `npm run build` and `npm run test:add` cover a sheet cell edit and a backlog promote.

### Stage 6 — Hardening

Local parity Stages 1–5 are feature-complete on SQLite. Stage 6 does not add product features.

| Item | Status |
|---|---|
| Code signing / SmartScreen silence | **Not done.** No signing certificate is in this repo. `tauri.conf.json` does not set `certificateThumbprint` or `signCommand`, so the Windows NSIS workflow stays unsigned. SmartScreen will still warn (More info → Run anyway). A future hook is written in `apps/local-dispatchboard/README.md` and in `.github/workflows/local-dispatchboard-windows.yml`. Do not invent or commit a cert. |
| Automated smoke | **Done.** `npm run test:add` and `npm run test:local` (same suite) cover import counts (61 / 47 / 14), a drawer-style update, schedule move and undo, a geocode-cache write with a mocked Census lookup, a mismatch flag on Apply, a template checklist, a Sheet cell edit, and a backlog promote. No live Census or Google. `npm run build` typechecks the frontend. |
| Docs | **Done.** This file, `apps/local-dispatchboard/README.md` (install + Stages 1–5 overview, Google key path, wipe vs clear scheduled), and the Local row in `docs/HANDOFF.md`. |
| Sync bridge to Supabase / Tiger Tools | **Not built.** Do not start one unless Jose reopens that in writing. |

**Done when:** the docs say the signed installer is not available and the bridge is not built, and `npm run build` plus `npm run test:local` pass.

---

## 7. What “functions like the cloud” means in practice

Jose can say Local matches the cloud office app for **solo dispatch on one PC** when Stages **1.5–5** are done:

1. Import ADD without cloud  
2. Fix jobs in a drawer or on the Sheet  
3. Schedule on Time grid / week, including Best days → Schedule here  
4. See pins, Unmapped, and open backlog pins  
5. Get mismatch flags and basic templates  
6. Keep standing work on the backlog and promote it to a tentative job  

He still will **not** have: field techs on Tiger Tools against this DB, multi-user Auth, photo files, or Edge-powered admin wipes. That is intentional.

---

## 8. Suggested next action

The Local parity chain is finished for product features. Stages 1–5 run on SQLite on one PC. Installer version **0.2.0** is the distinguishable unsigned build.

- **Signed installer:** not available. No certificate is in the repo. SmartScreen will still warn. Buying or installing a code-signing certificate is outside this repo.
- **Sync bridge:** not built. Local does not talk to Supabase or Tiger Tools. Do not open that work unless Jose writes it down.

---

## 9. Doc upkeep

- This file is the Local build queue (parallel to `NEXT_BUILD_CHECKLIST.md` for cloud).  
- After each Local stage merges, flip the matrix rows and bump **As of**.  
- Link from `apps/local-dispatchboard/README.md` and `docs/HANDOFF.md`.
