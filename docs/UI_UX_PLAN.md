# UI, UX and function plan

Status: draft for Pilot to pick from. Nothing here is built yet except the preview mode (section 0).

Sources: a pass with the Impeccable detector on the app running against the synthetic fixture (61 sample jobs, 5 techs), screenshots in light and dark, and a read of the current components.

## 0. How we look at the app without real data

`npm run dev:preview` starts the UI in a plain browser with an in-memory SQLite database seeded from `fixtures/add-export-sample.csv`. The dates are shifted so the first fixture day is today, and the pins are scattered around Fredericksburg. It stubs the desktop commands, makes no network calls, and lives in `dev/preview/`, outside `src/`, so it never reaches the installer. Screenshots and Impeccable runs use this mode only.

## 1. What the detector found on filled screens

| Finding | Where | What it means |
|---|---|---|
| Side-tab accent border, 10 hits | Calendar job cards | The 4px colored left edge is the only thing that says what kind of job a card is. It is also the most recognizable tell of generated UI. The icon system in section 2 replaces it. |
| Card inside card, 5 hits | Calendar | Boots chip and capacity labels sit in a bordered box inside a bordered card. Flatten one level. |
| Repeating stripes | Capacity blocks (PTO, Training) | Diagonal hatching is decoration. A flat muted fill with a leave or training icon says the same thing with less noise. |
| Low contrast | Map hint and error text, disabled Find / Drive times / Geocode | Text under 4.5:1. Fix the tokens, not each place. |
| Line length | Import, Sheet note, Backlog | Help text runs 200+ characters wide. Cap at about 70ch. |
| 0px vertical padding, 6 hits | Jobs table | Date chips and badges with no vertical inset. |
| Likely false positives | Header blur contrast, collapsed "Supported columns" | Ignore unless a screenshot shows a real problem. |

What the screenshots add that no detector catches: map pins are same-size colored dots, so you have to click one to learn what the job is. Calendar cards carry the activity as small uppercase text that truncates ("PREV MAINT LP EQUIP/ CLEAN, CHECK & ..."). On a busy day you cannot scan either view.

## 2. Job-type icons (new, highest value for scanning)

Goal: read the day from across the room. A dispatcher should see "two tank installs, three gas checks, one fireplace clean" on the map and the calendar without opening anything.

### 2.1 Mapping, from the values that actually exist in the export

Activity names come from `Call Reason 1/ Activity`. Matching is by pattern on the first non-empty of reasons 1 to 3, same as `colors.ts` does for color today.

| Activity pattern | Icon | Notes |
|---|---|---|
| TANK INSTALL (UG), TANK INSTALL (AG), TANK SWAP OUT | Propane tank (custom) | Horizontal cylinder on two feet, dome on top. UG gets a small down arrow badge, AG none. Swap shows the tank only. |
| TANK PICK UP | Truck | Distinct from install so pickups do not read as new tanks. |
| LOCK TANK | Padlock | |
| GAS CHECK | Flame with a check mark | Small flame outline. This is the most common job, so it must be the cleanest glyph. |
| REGULATOR (HOOK UP, REPAIR) | Gauge | |
| APPLIANCE (CONVERT, CONNECT, SERVICE, INSTALL) | Cooking pot | Convert gets a swap badge. |
| PREV MAINT, any CLEAN | Wrench with sparkle, or gas logs when the rule in 2.2 matches | |
| Fireplace or gas log cleaning | Gas logs (custom) | Two stacked logs with a small flame. See 2.2. |
| INSTALL TANK MONITOR | Radio waves | |
| CATHODIC TEST | Zap | |
| PIPE HOUSE LP (INSIDE, OUTSIDE) | Pipe elbow (custom) | Inside and outside share the glyph. |
| LAWN GROUNDS MAINT | Sprout | |
| HELPER | Two people | |
| PTO | Palm tree | Capacity block. |
| Holiday | Calendar with a slash | Capacity block. |
| Training | Graduation cap | Capacity block. |
| anything else | Wrench | Never blank. The hash color still applies. |

Four glyphs are custom (tank, gas logs, pipe elbow, flame with check). Everything else comes from Lucide, which is MIT, tree-shakable, and drawn on one 24px grid with a 1.75 stroke. The custom four are drawn on that same grid and stroke so they sit together.

### 2.2 The gas log question

In the sample export, FIREPLACE and GAS LOGS live in `Service Location Definition`, which describes what is at the house. They show up on 14 jobs, spread across tank installs, regulator hookups, gas checks, a lock tank and a lawn visit. So the location field cannot choose the main icon, or every house with a fireplace would look like a fireplace job.

Rule:

1. The main icon comes from the activity.
2. A job gets the gas log icon as its main icon only when the activity is a maintenance or cleaning call (PREV MAINT, anything with CLEAN) and either the location definition lists FIREPLACE or GAS LOGS, or the call note mentions fireplace or gas logs.
3. Every other job that has FIREPLACE or GAS LOGS at the location gets a small secondary appliance glyph in the Jobs list, the Sheet and the pin popup, never on the pin itself.

The sample data has no fireplace cleaning calls, so I cannot verify rule 2 against the real call reason name. That is the open question for Pilot.

### 2.3 Where icons appear

- **Map pins.** Keep the colored disc and its state ring (dashed amber for tentative, slate for locked). Add the white glyph inside the disc, 14px inside a 24px pin. Implemented as a symbol layer over the existing circle layer, with glyphs rendered once to canvas and registered with `map.addImage` as SDF so they tint with the pin color. Below zoom 11 the icons drop out and pins return to plain dots so a county-wide view stays clean. Dark mode uses a dark glyph on pale discs where the pin color is too light for white.
- **Map toolbar.** A row of icon chips filters by type. Click the tank to show only tank jobs. This also acts as the legend, so the separate color legend can go.
- **Calendar cards.** The 4px left border goes. A 20px tinted icon chip sits left of the customer name, and the activity label sits under it. When a card is shorter than 40px, show the icon and customer only. Tentative cards keep the dashed border.
- **Capacity blocks.** Flat muted fill, leave or training icon, no stripes.
- **Jobs list and Sheet.** Icon in the Activity cell, then the text. Appliance glyphs from the location definition follow as small muted chips.
- **Backlog.** Same icon by backlog type, so a dragged item looks the same before and after it lands.

### 2.4 Rules that keep it honest

- Never color alone. Icon plus color plus text label in lists, icon plus color plus tooltip on pins.
- Every icon has an `aria-label` equal to the activity name.
- Glyph against its disc must hit 3:1. The amber and yellow activity colors take a dark glyph.
- The mapping lives in one file, `src/lib/job-icons.ts`, with a unit test that runs every activity string in the fixture through it and fails on any that fall to the wrench fallback unexpectedly. Adding a call reason later is one line.
- Pilot can override a pattern's icon in a small table in Settings, Display. Not v1.

## 3. UI list (from the earlier pass, with new items marked)

- U1 Red only for the primary action and the active tab. Today red also marks the date, Today, and links.
- U2 Calmer layout: one toolbar row per screen, more space between groups, fewer borders.
- U3 Consistent controls (shadcn/ui or the same primitives hand-built): buttons, inputs, selects, tabs.
- U4 Inter or Geist with tabular numbers for times, WO numbers and counts.
- U5 One icon set across the app. Now covered by section 2.
- U6 Soft borders, one shadow level, consistent radii.
- U7 Real empty states with one clear next action.
- U8 Plain-language errors with a Details toggle for the technical text.
- U9 Status colors with a legend. Now covered by the Map toolbar chips in section 2.
- U10 (new) Replace the side-tab card border and the stripes, per section 1.
- U11 (new) Fix the contrast tokens once: muted text, disabled buttons, the red error text on tinted backgrounds.
- U12 (new) Cap help text at 70ch.

## 4. UX list

- X1 Show the date picker and search only on screens where they apply. Import and Sheet do not need the day stepper.
- X2 Slim the Map toolbar: Find, radius and Nearby behind a More menu.
- X3 Remove the obsolete geocoding popup. It still opens on the Map even though lookups are automatic now.
- X4 Keyboard shortcuts and a Ctrl+K command palette.
- X5 Undo toasts after moves and edits.
- X6 Remember window size and position.
- X7 A Today view: who is out, what is unmapped, what is flagged, in one glance.
- X8 First-run screen that walks through import.
- X9 (new) Preview mode data is today-anchored, so screenshots always open on a populated day.

## 5. Function list

- F1 Restore from backup. Backups exist and prune, but there is no way back in the UI.
- F2 Failed-address review list with a confidence label per match.
- F3 Re-import diff: what changed since the last ADD export.
- F4 Print or PDF day sheet per technician.
- F5 Overbook warnings on the calendar.
- F6 Saved filters.
- F7 Bulk edit in the Sheet.
- F8 Drag from Backlog onto the calendar.
- F9 CSV export of any view.
- F10 Job edit history.

## 6. Suggested order

1. Preview mode and detector fixes: U10, U11, U12, X3. Small, visible, low risk.
2. Icon system, section 2. The change that most improves daily use.
3. U1 to U4, X1, X2. The "less amateur" pass.
4. F1. It protects the data the rest of this depends on.
5. Everything else by Pilot's pick.

## 7. Open question

What is the call reason called in ADD when a tech cleans a fireplace or gas logs? The icon rule in 2.2 needs the real string, or confirmation that it is logged as PREV MAINT with the fireplace noted in the location or the call note.
