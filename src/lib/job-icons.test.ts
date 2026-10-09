import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { recordsFromBytes } from './add.ts'
import { ICON_BODIES } from './icon-paths.ts'
import { contrastRatio, glyphToneFor, jobIcon, locationAppliances, luminance, parseCssColor } from './job-icons.ts'

const a = (activity_1: string, extra: Record<string, string> = {}) => jobIcon({ activity_1, ...extra })

assert.equal(a('TANK INSTALL (UG)').icon, 'tank-ug')
assert.equal(a('TANK INSTALL (AG)').icon, 'tank')
assert.equal(a('TANK SWAP OUT').icon, 'tank')
assert.equal(a('TANK PICK UP').icon, 'truck')
assert.equal(a('LOCK TANK').icon, 'lock')
assert.equal(a('GAS  CHECK').icon, 'flame-check')
assert.equal(a('REGULATOR (HOOK UP)').icon, 'gauge')
assert.equal(a('LEAK CHECK (OUTSIDE)').icon, 'wind')
assert.equal(a('TANK REPAIR').icon, 'hammer')
assert.equal(a('INSTALL TANK MONITOR').icon, 'radio')
assert.equal(a('APPLIANCE (CONVERT)').icon, 'cooking-pot')
assert.equal(a('PTO').icon, 'tree-palm')
assert.equal(a('Holiday').icon, 'calendar-off')
assert.equal(a('Training').icon, 'graduation-cap')
assert.equal(jobIcon({ activity_1: '', activity_2: 'CATHODIC TEST' }).icon, 'zap')

// Fireplace rule: only maintenance or cleaning calls become gas logs.
assert.equal(a('PREV MAINT LP EQUIP/ CLEAN, CHECK & ADJU', { location_definition: 'COOKING, GAS LOGS' }).icon, 'gas-logs')
assert.equal(a('PREV MAINT LP EQUIP/ CLEAN, CHECK & ADJU', { activity_note: 'clean the fireplace' }).icon, 'gas-logs')
assert.equal(a('PREV MAINT', { location_definition: 'COOKING, DRYER' }).icon, 'wrench')
assert.equal(a('TANK INSTALL (AG)', { location_definition: 'FIREPLACE, GENERATOR' }).icon, 'tank')
assert.equal(a('GAS CHECK', { location_definition: 'GAS LOGS' }).icon, 'flame-check')

// Unknown call reasons fall back to the wrench and say so.
assert.deepEqual(
  { icon: a('SOMETHING NEW').icon, known: a('SOMETHING NEW').known },
  { icon: 'wrench', known: false },
)

assert.deepEqual(locationAppliances('COOKING, gas logs,, DRYER, cooking'), ['Cooking', 'Gas Logs', 'Dryer'])
assert.deepEqual(locationAppliances(null), [])

// Every icon the resolver can return has drawing data.
for (const name of ['tank', 'tank-ug', 'truck', 'lock', 'flame-check', 'gauge', 'radio', 'zap', 'pipe', 'cooking-pot', 'sprout', 'users', 'wrench', 'gas-logs', 'tree-palm', 'calendar-off', 'graduation-cap']) {
  assert.ok(name in ICON_BODIES, `missing icon ${name}`)
}

// Every activity in the synthetic export maps to a real icon, not the fallback.
const fixture = path.resolve(import.meta.dirname, '../../fixtures/add-export-sample.csv')
const rows = recordsFromBytes(fs.readFileSync(fixture))
for (const row of rows) {
  const info = jobIcon({
    activity_1: row.activity1,
    activity_2: row.activity2,
    activity_3: row.activity3,
    location_definition: row.locationDefinition,
    activity_note: row.activityNote,
  })
  assert.ok(info.known, `no icon rule for activity "${row.activity1}"`)
}

// Glyph tone: white on dark fills, near-black on light fills, at least 3:1 either way.
for (const fill of ['#B45309', '#1D4ED8', '#059669', '#DC2626', '#EA580C', '#C2410C', '#7C3AED', '#0F766E', '#6D28D9', '#CA8A04', '#0E7490', '#0369A1', '#57534E', '#334155', '#64748b', 'hsl(40 55% 38%)', '#fde68a']) {
  const rgb = parseCssColor(fill)
  assert.ok(rgb, fill)
  const l = luminance(rgb)
  const tone = glyphToneFor(fill)
  const ratio = tone === 'light' ? contrastRatio(1, l) : contrastRatio(0.02, l)
  assert.ok(ratio >= 3, `${fill} glyph ${tone} only ${ratio.toFixed(2)}:1`)
}

console.log('job-icons.test.ts: ok')
