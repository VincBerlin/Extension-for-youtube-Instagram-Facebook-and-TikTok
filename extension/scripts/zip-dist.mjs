#!/usr/bin/env node
// Produces extension/release/<name>-v<version>.zip with manifest.json at the
// archive root — the shape the Chrome Web Store requires. Uses the system
// `zip` binary (present on macOS, Linux, and standard CI images) so we don't
// need to add an archiver dependency.

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const dist = path.resolve('dist')
const releaseDir = path.resolve('release')
const manifestPath = path.join(dist, 'manifest.json')

if (!fs.existsSync(manifestPath)) {
  console.error('X dist/manifest.json missing — run `npm run build` first.')
  process.exit(1)
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
const name = String(manifest.name ?? 'extension').toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
const version = String(manifest.version ?? '0.0.0')
const zipName = `${name}-v${version}.zip`
const zipPath = path.join(releaseDir, zipName)

fs.mkdirSync(releaseDir, { recursive: true })

// Overwrite any prior ZIP for this exact version so we never ship stale bytes.
if (fs.existsSync(zipPath)) fs.rmSync(zipPath)

try {
  // -r recursive, -q quiet, -X strip extra attrs (smaller, deterministic).
  // Run from inside dist so paths inside the archive are relative — that puts
  // manifest.json at the ZIP root, which the Web Store requires. We also
  // exclude macOS/Windows filesystem noise that would otherwise ship.
  execFileSync(
    'zip',
    ['-r', '-q', '-X', zipPath, '.', '-x', '*.DS_Store', '-x', 'Thumbs.db', '-x', '*/.DS_Store'],
    {
      cwd: dist,
      stdio: ['ignore', 'inherit', 'inherit'],
    },
  )
} catch (err) {
  console.error(`X zip failed: ${err.message}`)
  process.exit(1)
}

const sizeBytes = fs.statSync(zipPath).size
const sizeKb = (sizeBytes / 1024).toFixed(1)
console.log(`OK ${path.relative(process.cwd(), zipPath)} (${sizeKb} KB)`)
