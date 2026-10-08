# DispatchBoard (Local)

Single-user desktop app for the office dispatch loop on one PC. Version **0.2.1**. Jobs, sites, backlog, checklists, and the geocode cache live in a SQLite file on that machine.

This is separate from the office web app (`src/`) and from Tiger Tools (`apps/tiger-tools/`). It does not sign in, does not call Supabase, and does not call Vercel. There is **no sync bridge** to those apps. Do not add one unless Jose asks for it in writing.

## What it does (Stages 1–5)

| Stage | What you can do |
|---|---|
| 1 | Import an ADD `.xls`, `.xlsx`, or CSV (18 columns). Preview row, work-order, and capacity counts. Apply inserts new rows and can update matches. Apply never deletes jobs. |
| 1.5 | Job drawer: edit planning fields, create a tentative job (no work order), last-apply time. Settings: theme, database path, wipe. |
| 2 | Calendar time grid and week × technician. Drag tentative jobs and other rows with no work order. Undo for about 10 seconds. **Clear scheduled jobs** (type `CLEAR`) deletes dated jobs, including capacity, and leaves undated jobs and the backlog. Shared date chip (today, America/New_York). |
| 3 | Map (MapLibre + OpenFreeMap). Opt-in Census geocoding, Unmapped fix, Fredericksburg yard pin, Nearby. Network geocoding stays off until you allow it. |
| 3b | Optional Google Geocoding after a Census miss. Paste your own key in Settings. The key stays on this PC. |
| 4 | Mismatch rules (advisory ≠ on Apply), checklist templates (⚑ while a required item is unchecked), optional Check drive times when a Google key is saved. |
| 5 | Live Sheet (cell edits write SQLite), backlog with Promote, Best days → Schedule here, two-row header. No Tiger Fuel logo. |

Stage 6 is hardening (this README, the parity doc, and `npm run test:local`). **Code signing is not done.** The Windows installer is still unsigned, so SmartScreen will still warn.

## Network stays off until you allow it

The app does not call Supabase, Vercel, or analytics. It does not download a font (the UI uses Inter if the PC already has it, then the system sans stack). Import reads a file you pick and writes SQLite. It does not upload the workbook.

**Census, Nominatim, and Google are off by default.** Settings has **Allow network geocoding**. Until that is on, Apply does not send addresses anywhere, and Nearby search stays disabled. The first time you check “Geocode after apply”, or the first time you open Map, the app asks before any Census call.

When you allow it:

- **US Census Bureau geocoder** (`https://geocoding.geo.census.gov/geocoder`) receives the street address. That is a public network call. The job row stays in SQLite on this PC.
- **Google Geocoding** runs after Census has no match **or** Census fails to answer (timeout, WAF HTML rejection, HTTP error), when the job has no saved site pin, and you have pasted your own Maps API key in Settings. With no key, Google is not called.
- **OpenStreetMap Nominatim** is used only by Nearby, and only after Census returns no match for that search. The map then shows © OpenStreetMap contributors.

Opening the **Map** tab loads basemap tiles from OpenFreeMap so pins can be drawn. That tile request happens when the tab is open. It is separate from the geocoding toggle. The basemap is not Google Maps.

The desktop window is titled **DispatchBoard (Local)**. The header is that text title plus view pills, then a date and search row. There is no Tiger Fuel logo.

Stage 3 adds the map (MapLibre + OpenFreeMap), opt-in Census geocoding after Apply, an Unmapped fix (edit the address, retry geocoding, or save a lat/lng pin on the job and optionally the site), Nearby search with a straight-line radius, and the Fredericksburg yard pin. Stage 3b adds an optional Google Geocoding fallback after a Census miss, using a key you paste in Settings. That key stays on this PC. Stage 4 adds mismatch rules, checklist templates, and an optional Check drive times on the Map tab. Stage 5 adds a live Sheet, backlog (tank pickup, lockout, monitor swap, meter site) with Promote, Best days on Nearby, and the two-row header. Calendar from stage 2 is unchanged aside from the ≠ and ⚑ marks on job blocks.

## Parity with the office app

The queue for matching the office dispatch loop while customer rows stay on this PC is [`docs/LOCAL_VS_CLOUD_PARITY.md`](docs/LOCAL_VS_CLOUD_PARITY.md). Stages 1 through 5 are feature-complete on SQLite. Stage 6 records the hardening decisions: the installer is unsigned, and there is no sync bridge.

## Install the Windows .exe

Day-to-day use on a Windows PC (including `542-noriegaj`) does not need Node, Rust, or `npm run desktop`.

The installer is an **unsigned** NSIS `.exe` built by GitHub Actions (`windows-latest`). **Code signing is not done.** There is no signing certificate in this repo, and none is baked into the workflow. SmartScreen will still warn (“Windows protected your PC”). Choose **More info**, then **Run anyway**.

A future signing hook, only after a certificate exists outside the repo:

- In `src-tauri/tauri.conf.json`, under `bundle.windows`, set `certificateThumbprint`, `digestAlgorithm` (`sha256`), and `timestampUrl`. Tauri then calls `signtool` on Windows.
- Or set `bundle.windows.signCommand` to a custom signer. The command must include `%1`, which Tauri replaces with the file path (used for tools such as `osslsigncode` or an Azure sign command).

Leave both unset for the current unsigned build. Do not commit a certificate, a thumbprint from a real cert, or a signing password. The GitHub workflow comment repeats this hook and does not enable it.

1. Open the pull request checks, or Actions → **Local DispatchBoard Windows**, and pick the latest successful run for this branch.
2. Download the artifact **DispatchBoard-Local-Windows-setup**.
3. Unzip it and run the `*-setup.exe` inside (the file name includes the version, for example `DispatchBoard (Local)_0.2.1_x64-setup.exe`).
4. The installer is for the current Windows user. It does not need an administrator password. It adds a Start menu shortcut named **DispatchBoard (Local)**.
5. Open **DispatchBoard (Local)**.

Windows 10 and 11 usually already have the Microsoft Edge **WebView2** runtime. If it is missing, the installer downloads a bootstrapper and installs it (that step needs internet once). After that, the app still does not call Supabase or Vercel. Census geocoding stays off until you allow it inside the app. Google Geocoding stays off unless you also paste your own API key in Settings. That key is saved on this PC and is not inside the installer.

Jobs stay in SQLite at:

`%APPDATA%\com.tigerfuel.dispatchboard.local\dispatchboard.db`

A pasted Google Maps API key, if you save one, goes into Windows Credential Manager for your Windows user (entry `DispatchBoard Local`), not into a file. Builds before 0.3 kept it in `google-maps-api-key.json` in that same folder; the app moves it into Credential Manager on first launch and wipes the file.

Backups: **Settings → Back up now**, and automatically about once a day while the app is open. Copies go to `%APPDATA%\com.tigerfuel.dispatchboard.local\backups\` (newest 14 kept). They contain customer data, so they stay on this PC and are not deleted by **Wipe local database**.

For Vite-only (`npm run dev` without the desktop shell), copy `.env.example` to `.env.local` and set `VITE_GOOGLE_MAPS_API_KEY`. The key saved in Settings wins when both exist. Never commit `.env.local` or a real key.

Paste the database path into File Explorer. Settings and the Import screen print the same path. Quit the app before deleting the folder if you want to remove the file. **Wipe local database** in Settings (also on Import) clears jobs, checklists, sites, backlog items, the geocode cache, and cached drive times. Mismatch rules and templates stay. It does not delete the saved key or the backups folder. **Remove key** in Settings removes the key.

`npm run desktop:build` is the same NSIS build the workflow runs. It has to run on Windows. This Linux repo does not emit the `.exe`.

## Run

From the repo root:

```bash
npm install
npm run desktop
```

`npm run desktop` is Tauri 2. It starts Vite at `http://127.0.0.1:1420` and compiles the Rust shell with `cargo` (`src-tauri`). The window that opens is the app.

You need:

- Node.js 22+
- Rust stable (`rustc`, `cargo`), 1.88 or newer — Tauri calls cargo; you do not have to invoke it yourself
- Linux packages: `libwebkit2gtk-4.1-dev`, `libgtk-3-dev`, `libssl-dev`, `libayatana-appindicator3-dev`, `librsvg2-dev`, `patchelf`

```bash
sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev libssl-dev \
  libayatana-appindicator3-dev librsvg2-dev patchelf
```

Other scripts:

```bash
npm run dev            # Vite only. The page has no database until the Tauri window is running.
npm run build          # typecheck + frontend bundle
npm run desktop:build  # Windows NSIS installer (cargo + frontend). Run on Windows or via GitHub Actions.
npm run test:add       # Stage 1–5 unit tests plus the chained smoke (no live Census or Google)
npm run test:local     # same command as test:add
```

From the repo root, the same desktop command is:

```bash
npm run dev:local-dispatchboard
```

A blank window under a virtual display is often fixed with:

```bash
WEBKIT_DISABLE_COMPOSITING_MODE=1 npm run desktop
```

## Data path

The SQL plugin opens `sqlite:dispatchboard.db` in the OS app config directory for identifier `com.tigerfuel.dispatchboard.local`. The Import screen prints the resolved path from the running window. Defaults:

| OS | File |
|---|---|
| Linux | `~/.config/com.tigerfuel.dispatchboard.local/dispatchboard.db` |
| macOS | `~/Library/Application Support/com.tigerfuel.dispatchboard.local/dispatchboard.db` |
| Windows | `%APPDATA%\com.tigerfuel.dispatchboard.local\dispatchboard.db` |

The optional Google key is stored in Windows Credential Manager, only after you paste a key in Settings. It is not in the git repo, not in a file, and not baked into the Windows installer.

Tables: `jobs` (one row per work order or capacity block), `sites` (one row per customer number + service location), `geocode_cache` (address key → lat/lng, so the same address is not sent twice), `mismatch_rules`, `templates`, `template_checklist_items`, `job_checklist_items`, `drive_time_cache` (one technician + one day), and `backlog_items` (standing work ADD import never writes). Jobs store `lat`, `lng`, `geocode_source` (`census`, `site_pin`, `manual`, `google`, `none`), `geocode_address_key`, `mismatch_flag`, `mismatch_note`, and `template_id`. Sites store `lat`, `lng`, and `pin_source` (`manual` when you save a pin on the site). Backlog rows store a type (`tank_pickup`, `lockout`, `monitor_swap`, `meter_site`), status (`open`, `promoted`, `complete`, `cancelled`), and `promoted_job_id` after Promote. SQLite may also create `dispatchboard.db-wal` and `dispatchboard.db-shm` beside the file. **Wipe local database** clears jobs, checklist items, sites, backlog items, `geocode_cache`, and `drive_time_cache`. It does not delete mismatch rules, templates, the saved key, or the `backups` folder.

## Import

1. Open **Import**.
2. Choose a local `.xls`, `.xlsx`, or `.csv` whose headers match the 18 ADD columns below, in this order.
3. Check the preview row count (data rows, work orders, capacity blocks).
4. **Apply to local database**.
5. Optional: **Geocode after apply**. Leave it off to write SQLite only. The first time you turn it on, Apply asks you to allow network geocoding before any Census call. The result then shows how many jobs were geocoded, how many are still unmapped, and how many Census and Google calls ran.

The chain is Census, then a saved site pin, then Google if a key is saved on this PC, then unmapped. Capacity blocks are skipped. A Census or Google HTTP failure is counted and not stored as “no match”, so Map can retry it. A real empty Census match is cached. A real empty Google match is cached as tried, so that address is not sent to Google again. With no key, Google is not called.

Matching:

- Work order (WO number not `0`): match `wo_number`. New numbers are inserted.
- Capacity (WO number `0`): match technician + schedule date + begin time + call reason 1.
- **Update matched work orders** is on by default and overwrites those mapped columns. Turn it off to skip matches and only add new rows.
- Apply never deletes jobs. Re-importing the same file does not duplicate matched rows.
- After a successful apply, Import shows how many rows were new, updated, or left unchanged, and the local time of that apply. That timestamp stays on this PC (the app’s own storage). It is not uploaded.

Sites are upserted from non-capacity rows that have a customer number. A blank service location is stored as `0`.

Mismatch rules run on Apply. A hit sets ≠ on that job and writes a short note. It does not reject the row. Capacity blocks are not flagged. The database starts with one active example: call reason **GAS CHECK** and activity note containing **CLEANING**. Edit or delete it on **Planning**. Turn a rule off and the next Apply stops using it. Rows that were skipped because **Update matched work orders** was off keep the flag they already had.

Check the parser and the Stage 1–5 critical paths against an in-memory database (no desktop window, no live Census or Google):

```bash
npm run test:local
```

`npm run test:add` is the same suite. It expects the office fixture counts: **61** data rows, **47** work orders, **14** capacity blocks. The smoke then walks a drawer-style update, a schedule move and undo, a mocked Census write into `geocode_cache`, a mismatch flag on Apply, a template checklist, a Sheet cell edit, and a backlog promote. It also checks that **Clear scheduled jobs** keeps an undated job and the backlog row, and that **Wipe local database** removes jobs and backlog while mismatch rules and templates stay.

### Supported columns

Same header names as the office PDR list in `src/lib/import/headers.ts`. Cell rules follow `src/lib/import/parse.ts` (Excel serial dates, day-fraction times, `/` address split, WO `0` = capacity). Mismatch flags are not evaluated here.

| ADD column | Stored as |
|---|---|
| Technician | `jobs.technician_name` (part of the capacity key) |
| Customer # | `jobs.customer_number`, `sites.customer_number` |
| Customer Name | `jobs.customer_name`, `sites.customer_name` |
| Service Zone | `jobs.service_zone`; the code before ` - ` is `zone_code` |
| Service City/Town | `jobs.city`, `sites.city` |
| Service Location # | `jobs.service_location_number`, `sites.service_location_number` |
| WO Number | `jobs.wo_number`; `0` clears the WO and sets `is_capacity_block` |
| Schedule Date | `jobs.schedule_date` (`YYYY-MM-DD`) |
| Scheduled Begin Time | `jobs.begin_time` (`HH:MM:SS`) |
| Scheduled Completion Time | `jobs.end_time` (`HH:MM:SS`) |
| Call Reason 1/ Activity | `jobs.activity_1` |
| Call Reason 2 | `jobs.activity_2` |
| Call Reason 3 | `jobs.activity_3` |
| Service Address | split on `/` into name, street, descriptor, city/state/zip; full text in `address_raw` |
| Service Instructions | `jobs.service_instructions` |
| Service Location Definition | `jobs.location_definition` |
| Call/Activity Note | `jobs.activity_note` |
| ACCOUNT_NUM | `jobs.account_num`, `sites.account_num` |

Not stored from the ADD file: backlog, photo files, Pegasus status. Note text is the activity note. Mismatch flags are computed on Apply from `mismatch_rules`, not from an ADD column. Latitude and longitude are filled after apply when network geocoding is allowed, or when you save a pin. Checklist items are copied from a template, not from the workbook.

A blank WO that is not the number `0` has no match key, so a later apply inserts another row. ADD exports use either `0` or a work order number.

## Header

The first row is the menu, the text title **DispatchBoard (Local)**, and the view pills (Map, Calendar, Jobs, Sheet, Backlog, Planning, Import). The second row is the shared date chip and a search box. Search filters Jobs, Sheet, Map, and Backlog. There is no logo.

## Jobs, Sheet, Backlog, Calendar, Map

**Jobs** is a table filtered by the shared date chip and the header search (customer, account, customer number, WO, technician, address, city, zone, primary activity). The chip starts on today in America/New_York and is the same day Calendar, Sheet, and Map use. **All dates** on this screen lists every stored job without moving the chip; choosing a day, or moving the chip, returns the list to that day.

Click a row to open the job drawer. **Save** writes the planning fields with a SQLite `UPDATE` and refreshes the list. **Cancel**, **Close**, or Escape discards edits (it asks first when something changed). Work order number is shown and not edited. Capacity rows (ADD work order `0`) edit the schedule fields only: label, technician, date, begin, end, and activity 1. Activity 1 stays part of the capacity match key.

**New job** inserts a tentative row: no work order, not a capacity block. Fill in customer, address, technician, date, times, and activities, then Save. The row shows up in Jobs and matches search and date filters. A later ADD apply will not treat that blank work order as a match. A template chosen on that form is copied onto the job when you save. The activity hint on a template (for example `TANK INSTALL (UG)`) suggests that template. Check items in the drawer after the job exists. A required item that is still unchecked shows ⚑ on the jobs list, the calendar block, and the map pin.

**Sheet** is a spreadsheet of the same jobs. Leave a cell to write that planning field to SQLite. Jobs, Calendar, and Map refresh from that write. **Include capacity** is off until you turn it on. Capacity cells edit the label, technician, date, times, and activity. Work order numbers are shown and not edited. **Download CSV** saves the rows on screen. **This date** follows the shared chip; turn it off to list every date that matches the header search.

**Backlog** is standing work that ADD import does not touch: tank pickup, lockout, monitor swap, and meter site. Create, edit, or delete items here. **Promote to job** inserts a tentative job (no work order) with the office activity code for that type, copies a matching template checklist when one exists, sets the item to promoted, and stores `promoted_job_id`. Promoting the same open item twice is rejected. Latitude and longitude, when you type them, show the open item on the Map (violet pins). Turn **Open backlog** off on the Map to hide them.

**Planning** holds mismatch rules and templates. Create, edit, or delete them there. The seeded Tank Install Trip 1 and Trip 2 templates each include required **Excavator (Dan) scheduled**. Trip 2 does not link to a parent job. Apply a template again from the drawer; labels already on the job are not copied twice.

**Calendar** is a desktop board for the shared date.

- **Time grid** (default) is one day. Columns are technicians who have work that week (empty columns stay so you can drop onto them). Hours run 07:00–23:00. A job block spans begin to end. Overlapping jobs in one column sit side by side. A red line marks the current minute when the chip is today in America/New_York.
- **By technician** is the week that contains the chip: technicians as rows, Monday–Sunday as columns. The selected day is marked. Arrows on this view step a week; the date chip and the Time grid arrows step a day.
- Capacity blocks are on the grid (hatched). They are not dragged.
- Tentative jobs and any other row with no work order can be dragged. On the time grid a drop sets technician, date, and time (15-minute snap, duration kept). On the week grid a drop sets technician and date and keeps the times. A drop onto another day moves the shared date chip, so Time grid and Jobs follow that day.
- A row with a work order does not drag. Open it and change the schedule in the job drawer.
- A successful drag shows an Undo toast for about 10 seconds. Up to three moves stay on the stack. Undo writes the previous technician, date, and times back to SQLite and returns the date chip to that day.
- ≠ is an advisory mismatch from the last Apply that wrote that row. ⚑ means a required checklist item is still unchecked. Open the job to read the mismatch note or check the item.

**Map** uses the same date chip. Search on this screen uses the same fields as Jobs. **All dates** shows every non-capacity job without moving the chip.

- Pins are jobs that already have latitude and longitude. Capacity blocks are not drawn.
- The yard pin is always visible: Tiger Fuel yard / office, 1600 Beulah Salisbury Dr, Fredericksburg, VA, at 38.284478, −77.4529472 (same point as the office app).
- Jobs without a pin are listed under **Unmapped**. **Fix** edits the street and city/state/ZIP, retries geocoding (only if network geocoding is allowed), or saves a latitude/longitude on the job. Retry is Census first. If Census misses and there is no saved site pin, and a Google key is saved on this PC, that address is sent to Google Geocoding. **Also save this pin on the site** stores it for that customer number and service location so a later Census miss can use it before Google. **Drop pin on map** lets you click the basemap; you still confirm Save pin.
- **Nearby** geocodes a typed address (Census, then Nominatim if Census has nothing) and dims pins outside the straight-line radius (~30 mph, same idea as the office app, not routed drive time). A Nominatim match shows © OpenStreetMap. Nearby does not call Google. **Best days** ranks upcoming days that already have work inside that radius (closest day first), plus undated jobs and open backlog with coordinates. **Schedule here** asks before it writes: a tentative job moves the same way a calendar drag does (Undo for about 10 seconds); a work order saves the date and technician the same way as the drawer. **New job here**, when no job is selected, opens New job with that day, technician, and the nearby address filled in. You still Save before it is stored.
- **Geocode unmapped** runs the same Census-then-Google chain on the jobs in the current date and search filter. Google is skipped when no key is saved.
- **Technician** filters the pins to one person. **Check drive times** is enabled only for that one technician, the shared date (not All dates), a saved Google key, and Allow network geocoding. One click sends the yard plus that day’s mapped stops to Google Routes (`routes.googleapis.com`, `computeRoutes`). Legs are cached in `drive_time_cache` until the schedule fingerprint changes. A leg over 30 minutes is marked. Refresh computes again. With no key, or with network geocoding off, the button stays disabled and the reason is written under it. This does not call a cloud function. Nearby stays straight-line, not routed.

## Settings

The menu button next to the title opens **Settings**.

- Database path on this PC, plus job, site, and backlog counts
- **Clear scheduled jobs**. Type `CLEAR` to confirm. This deletes jobs that have a schedule date, including capacity blocks. Jobs with no date stay. Sites stay. Backlog items stay. If a promoted item pointed at a dated job, the link is cleared and the item stays promoted.
- **Allow network geocoding**. Off by default. Stored on this PC with the other local settings. When on, Census (and Nominatim for Nearby) may run. Google still stays off until a key is saved.
- **Google Maps API key**. Optional. Paste a key you created in Google Cloud Console with the Geocoding API enabled. Enable the Routes API on the same key to use Check drive times. The key is saved in Windows Credential Manager. It is not a `VITE_` build variable and it is not inside the installer. Remove key clears it. With no key, Apply and Unmapped stay Census → site pin → unmapped, and Check drive times stays off.
- **Planning**. Opens the Planning tab for mismatch rules and templates. Those rows stay when you wipe jobs.
- **Wipe local database** (same action as on Import). This deletes every job, every site, every backlog item, and the geocode cache. It is separate from Clear scheduled jobs.
- Appearance: **Auto**, **Light**, or **Dark**. Auto follows the computer. The choice stays on this PC.

There is no sign-in.

## Wipe the local database

Quit is not required for the in-app wipe.

1. Open **Settings**, or open **Import**.
2. **Wipe local database** and confirm.

That deletes every `jobs` row, every checklist item, every `sites` row, every `backlog_items` row, every `geocode_cache` row, and every `drive_time_cache` row, and leaves the empty file in place. Mismatch rules and templates stay. The office app is not touched.

To remove the file itself, quit the app first, then delete the path shown in Settings, including the WAL/SHM sidecars. On Linux:

```bash
rm -rf ~/.config/com.tigerfuel.dispatchboard.local
```

## What this is not

- Not a second copy of the office board. Do not point it at Tiger customer data in Supabase.
- Not Tiger Tools. There is no sync bridge from this SQLite file to Supabase or to Tiger Tools.
- Not a signed installer. SmartScreen will still warn until a certificate exists outside this repo.
- Not a substitute for the office web app. Contributors can still run `npm run desktop` while developing. The Windows `.exe` is the install for day-to-day use.

## Where this came from

This repo was split out of `prawnsolo/dispatchboard` (the office web app plus Local) on 2026-10-08. Local is the main build from here on. The Supabase web app stays in the original repo. Real customer data was scrubbed from that repo's history before the split; this repo starts clean and its CI rejects anything that looks like a real export (`npm run check:fixtures`).

First-time setup on a new clone:

```
git config core.hooksPath .githooks
npm ci
npm run test:local
```
