#!/usr/bin/env node
/**
 * Fails when a tracked fixture could hold real customer data.
 *
 * Why: Pegasus/ADD exports carry customer names, home addresses, account and WO
 * numbers. Those never belong in git (history keeps them forever). This guard is
 * an allowlist, not a blocklist: a fixture passes only if it is plainly fake.
 *
 *   node scripts/check-fixtures-synthetic.mjs          # checks tracked files
 *
 * Wired into CI (.github/workflows/fixtures-guard.yml) and .githooks/pre-commit.
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'

const FAKE_NAME = /^(SAMPLE (CUSTOMER|BUSINESS|CREDIT LIST)\b|M\d\d STORAGE SAMPLE BUSINESS\b|DEMO\b|TEST\b|EXAMPLE\b|NEW OWNER$)/i
const FAKE_STREET = /\b(SAMPLE|TESTING|FIXTURE|EXAMPLE|DEMO|MOCK|PLACEHOLDER)\b/i
const BANNED_EXT = /\.(xls|xlsx|xlsm|sqlite|sqlite3|db|bak|b64|part\d+)$/i
const PHONE = /\(?\b\d{3}\)?[-. ]\d{3}[-. ]\d{4}\b/
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i
// Phone/email-shaped strings allowed because they are obviously fake.
const FAKE_CONTACT = /(\b555[-. ]|[-. ]555[-. ]|example\.(com|org|net)|@test\.|noreply)/i

const tracked = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
  .split('\0')
  .filter(Boolean)
  .filter((f) => fs.existsSync(f))

const problems = []
const fail = (file, msg) => problems.push(`${file}: ${msg}`)

/** Minimal RFC 4180 parser (quotes, doubled quotes, newlines inside quotes). */
function parseCsv(text) {
  const rows = []
  let row = []
  let cell = ''
  let q = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (q) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"'
        i++
      } else if (c === '"') q = false
      else cell += c
    } else if (c === '"') q = true
    else if (c === ',') {
      row.push(cell)
      cell = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(cell)
      cell = ''
      rows.push(row)
      row = []
    } else cell += c
  }
  if (cell !== '' || row.length) {
    row.push(cell)
    rows.push(row)
  }
  return rows.filter((r) => r.some((x) => x.trim() !== ''))
}

for (const f of tracked) {
  if (BANNED_EXT.test(f)) fail(f, 'spreadsheet, database, or encoded export files are not allowed in git. Keep real exports outside the repo.')
}

// Repo-wide: a real phone number or email in any tracked text file is a leak.
const SKIP_SCAN = /(package-lock\.json|Cargo\.lock|\.(png|jpe?g|ico|gif|svg|woff2?|lock))$/i
for (const f of tracked.filter((x) => !SKIP_SCAN.test(x) && !BANNED_EXT.test(x))) {
  let text
  try {
    text = fs.readFileSync(f, 'utf8')
  } catch {
    continue
  }
  if (text.includes('\0')) continue
  for (const m of text.match(new RegExp(PHONE, 'g')) ?? []) if (!FAKE_CONTACT.test(m)) fail(f, `phone-shaped value "${m}"`)
  for (const m of text.match(new RegExp(EMAIL, 'g')) ?? []) {
    if (!FAKE_CONTACT.test(m) && !/^[\w.-]+@(\d|[a-z-]+\/)/i.test(m) && !/@(\d+x|[\d.]+$)/.test(m)) fail(f, `email-shaped value "${m}"`)
  }
}

for (const f of tracked.filter((x) => x.startsWith('fixtures/') && /\.(csv|tsv|txt|json)$/i.test(x))) {
  const text = fs.readFileSync(f, 'utf8')
  if (!f.endsWith('.csv')) continue
  const [header, ...data] = parseCsv(text)
  if (!header) continue
  const col = (name) => header.findIndex((h) => h.trim().toLowerCase() === name.toLowerCase())
  const nameIdx = col('Customer Name')
  const addrIdx = col('Service Address')
  data.forEach((r, i) => {
    const line = i + 2
    if (nameIdx >= 0) {
      const name = (r[nameIdx] ?? '').trim()
      if (name && !FAKE_NAME.test(name)) fail(f, `row ${line}: Customer Name is not synthetic (must start SAMPLE CUSTOMER / SAMPLE BUSINESS / DEMO / TEST)`)
    }
    if (addrIdx >= 0) {
      const addr = (r[addrIdx] ?? '').trim()
      if (addr) {
        const parts = addr.split('/')
        const first = (parts[0] ?? '').trim()
        const street = (parts[1] ?? '').trim()
        if (first && !FAKE_NAME.test(first)) fail(f, `row ${line}: Service Address name part is not synthetic`)
        if (street && /^\d/.test(street) && !FAKE_STREET.test(street)) fail(f, `row ${line}: street is not synthetic (use SAMPLE/TESTING/FIXTURE/EXAMPLE/DEMO/MOCK/PLACEHOLDER words)`)
      }
    }
  })
}

if (problems.length) {
  console.error('Fixture guard failed. Real customer data must not be committed:\n')
  for (const p of problems) console.error('  ' + p)
  console.error('\nReplace the data with synthetic values, or move the file outside the repo.')
  process.exit(1)
}
console.log(`Fixture guard ok: ${tracked.length} tracked files checked, fixtures are synthetic.`)
