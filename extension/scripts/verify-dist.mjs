#!/usr/bin/env node
// Pre-flight check for the production build. Run after `vite build` and before
// `zip-dist` so we never ship a broken or leaky package. Fails the process on
// the first problem so CI catches it.

import fs from 'node:fs'
import path from 'node:path'

const dist = path.resolve('dist')
const manifestPath = path.join(dist, 'manifest.json')

const failures = []
function fail(message) {
  failures.push(message)
  console.error(`X ${message}`)
}

if (!fs.existsSync(dist)) {
  console.error('X dist/ missing — run `npm run build` first')
  process.exit(1)
}
if (!fs.existsSync(manifestPath)) {
  console.error('X dist/manifest.json missing — vite/crxjs build did not emit a manifest')
  process.exit(1)
}

let manifest
try {
  manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
} catch (e) {
  console.error(`X dist/manifest.json is not valid JSON: ${e.message}`)
  process.exit(1)
}

if (manifest.manifest_version !== 3) fail('manifest_version must be 3')
if (!manifest.name) fail('manifest.name missing')
if (!manifest.version) fail('manifest.version missing')
if (!manifest.description) fail('manifest.description missing')
if (!manifest.background?.service_worker) fail('background.service_worker missing')
if (!manifest.side_panel?.default_path) fail('side_panel.default_path missing')

// Icons: require all three sizes Chrome uses
for (const size of ['16', '48', '128']) {
  const ref = manifest.icons?.[size]
  if (!ref) {
    fail(`icons.${size} missing`)
    continue
  }
  const iconPath = path.join(dist, ref)
  if (!fs.existsSync(iconPath)) fail(`icons.${size} → ${ref} not found in dist/`)
}

// Walk the dist tree looking for forbidden artefacts. .env files leak local
// secrets; .map files balloon the package and expose source for closed-source
// builds. Source maps can be re-enabled by removing this check if needed.
const allFiles = []
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full)
    else allFiles.push(path.relative(dist, full))
  }
}
walk(dist)

const FORBIDDEN_NAMES = ['.env', '.env.local', '.env.production', '.env.development']
const SECRET_NAME_HINTS = [/service[_-]role/i, /private[_-]key/i, /\.pem$/, /\.p12$/]

for (const file of allFiles) {
  const base = path.basename(file)
  if (FORBIDDEN_NAMES.includes(base) || base.startsWith('.env')) {
    fail(`Forbidden env file in dist: ${file}`)
  }
  if (SECRET_NAME_HINTS.some((re) => re.test(base))) {
    fail(`Suspicious secret-looking file in dist: ${file}`)
  }
}

// A production bundle must never reference a localhost API base — a store
// user has no server at localhost, so every extraction and the BYOK key test
// would fail. (Matches the http://-scheme form to avoid false positives from
// the bare word "localhost" inside vendored library code.)
//
// Known-benign exception: supabase auth-js ships the dead-code default
// constant GOTRUE_URL = 'http://localhost:9999' — never used because we
// always pass an explicit Supabase URL.
const LOCALHOST_ALLOWLIST = ['http://localhost:9999']
const LOCALHOST_PATTERNS = [/http:\/\/localhost[:/]/, /http:\/\/127\.0\.0\.1[:/]/]
for (const file of allFiles) {
  if (!file.endsWith('.js') && !file.endsWith('.html')) continue
  let content = fs.readFileSync(path.join(dist, file), 'utf8')
  for (const benign of LOCALHOST_ALLOWLIST) content = content.replaceAll(benign, '')
  for (const re of LOCALHOST_PATTERNS) {
    if (re.test(content)) {
      fail(`Localhost URL baked into bundle: ${file} matches ${re} — fix VITE_API_BASE in .env.production`)
      break
    }
  }
}

if (failures.length > 0) {
  console.error(`\n${failures.length} verification failure(s) — aborting release.`)
  process.exit(1)
}

console.log(`OK dist verification passed — ${manifest.name} v${manifest.version}, ${allFiles.length} files.`)
