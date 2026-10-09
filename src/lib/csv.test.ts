import assert from 'node:assert/strict'
import { csvCell, toCsv } from './csv.ts'

assert.equal(csvCell('plain'), 'plain')
assert.equal(csvCell('a,b'), '"a,b"')
assert.equal(csvCell('say "hi"'), '"say ""hi"""')
assert.equal(csvCell('=SUM(A1)'), "'=SUM(A1)")
assert.equal(csvCell('@cmd'), "'@cmd")
assert.equal(csvCell('-cmd'), "'-cmd")
assert.equal(csvCell('+1 540 555 0100'), '+1 540 555 0100')
assert.equal(csvCell('-5'), '-5')
assert.equal(csvCell(null), '')
assert.equal(toCsv(['A', 'B'], [[1, 'x,y']]), 'A,B\n1,"x,y"')
console.log('csv.test.ts: ok')
