/**
 * Live smoke: the yard address must geocode to ZIP 22407 via Census.
 *
 *   npx tsx scripts/smoke-yard-geocode.mts
 *
 * Runs the app's own `geocodeWithCensus` (Node fetch, no CORS). The desktop app
 * makes the identical GET from Rust (`geo_http_get`); the Rust path has its own
 * live test: `cargo test --release --lib geo:: -- --include-ignored` in src-tauri
 * (run by the Windows workflow). Census rejects some datacenter IPs with an HTML
 * "Request Rejected" page; run from an office/home network if that happens.
 */
import { geocodeWithCensus } from '../src/lib/geocode.ts'

const match = await geocodeWithCensus('1600 Beulah Salisbury Dr', 'Fredericksburg VA')
console.log(JSON.stringify(match))
if (!match || !/22407$/.test(match.matchedAddress)) {
  console.error('FAIL: yard did not geocode to 22407')
  process.exit(1)
}
console.log('ok: yard → 22407')
