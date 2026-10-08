import assert from 'node:assert/strict'
import {
  normalizePastedGoogleKey,
  readViteGoogleMapsApiKey,
  testGoogleMapsApiKey,
  VITE_GOOGLE_MAPS_API_KEY,
} from './google-key.ts'

assert.equal(normalizePastedGoogleKey('  abc_123  '), 'abc_123')
assert.equal(normalizePastedGoogleKey('has space'), null)
assert.equal(normalizePastedGoogleKey(''), null)

assert.equal(readViteGoogleMapsApiKey({ [VITE_GOOGLE_MAPS_API_KEY]: 'env-key-value' }), 'env-key-value')
assert.equal(readViteGoogleMapsApiKey({ [VITE_GOOGLE_MAPS_API_KEY]: '  ' }), null)
assert.equal(readViteGoogleMapsApiKey({}), null)

const originalFetch = globalThis.fetch
try {
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        status: 'OK',
        results: [
          {
            formatted_address: 'White House',
            geometry: { location: { lat: 38.9, lng: -77.0 } },
          },
        ],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )
  const ok = await testGoogleMapsApiKey('AIzaSyTestKeyThatLooksLongEnough123456')
  assert.equal(ok.ok, true)
  assert.match(ok.message, /Valid/)

  globalThis.fetch = async () =>
    new Response(JSON.stringify({ status: 'REQUEST_DENIED', error_message: 'API key not valid' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  const bad = await testGoogleMapsApiKey('AIzaSyTestKeyThatLooksLongEnough123456')
  assert.equal(bad.ok, false)
  assert.match(bad.message, /Invalid|blocked|denied/i)

  const empty = await testGoogleMapsApiKey('   ')
  assert.equal(empty.ok, false)
} finally {
  globalThis.fetch = originalFetch
}

console.log('google-key.test.ts: ok')
