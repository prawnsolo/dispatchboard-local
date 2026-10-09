import assert from 'node:assert/strict'
import { planBulk } from './bulk-edit.ts'

const rows = [
  { id: 1, is_capacity_block: 0 },
  { id: 2, is_capacity_block: 0 },
  { id: 3, is_capacity_block: 1 },
]
const all = new Set([1, 2, 3])

let p = planBulk(rows, all, 'technician_name', 'ELI MASTON')
assert.ok(p.ok)
if (p.ok) assert.deepEqual(p.ids, [1, 2, 3])

// Zone is not editable on a capacity block: skipped, not failed.
p = planBulk(rows, all, 'zone_code', 'Z2')
assert.ok(p.ok)
if (p.ok) {
  assert.deepEqual(p.ids, [1, 2])
  assert.equal(p.skipped, 1)
}

// Bad date is refused with the cell parser's message.
p = planBulk(rows, all, 'schedule_date', 'tomorrow-ish')
assert.equal(p.ok, false)

// Nothing picked.
assert.equal(planBulk(rows, new Set(), 'technician_name', 'X').ok, false)
// Picked only rows that cannot take the field.
assert.equal(planBulk(rows, new Set([3]), 'zone_code', 'Z2').ok, false)
console.log('bulk-edit.test.ts: ok')
