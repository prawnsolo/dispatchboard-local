import assert from 'node:assert/strict'
import { MAX_VIEWS, parseViews, removeView, upsertView, type SheetView } from './saved-views.ts'

const v = (name: string, extra: Partial<SheetView> = {}): SheetView => ({ name, limitToDate: true, includeCapacity: false, technician: '', zone: '', ...extra })

assert.deepEqual(parseViews(null), [])
assert.deepEqual(parseViews('not json'), [])
assert.deepEqual(parseViews('{"a":1}'), [])
assert.equal(parseViews('[{"name":"  A  ","technician":"CHAD"},{"name":""},5]').length, 1)
assert.equal(parseViews('[{"name":"A","technician":"CHAD"}]')[0]!.technician, 'CHAD')
assert.equal(parseViews('[{"name":"A"}]')[0]!.limitToDate, true)

let views = upsertView([], v('Chad'))
views = upsertView(views, v('chad', { zone: '2' }))
assert.equal(views.length, 1)
assert.equal(views[0]!.zone, '2')
for (let i = 0; i < MAX_VIEWS + 3; i++) views = upsertView(views, v(`V${i}`))
assert.equal(views.length, MAX_VIEWS)
assert.equal(views.at(-1)!.name, `V${MAX_VIEWS + 2}`)
assert.equal(removeView(views, 'V5').length, MAX_VIEWS - 1)
assert.equal(upsertView(views, v('   ')).length, MAX_VIEWS)
console.log('saved-views.test.ts: ok')
