import { test } from 'node:test'
import assert from 'node:assert/strict'
import { canonicalizeGitHubUrl, isGitHubHost } from './githubCanonicalizer.js'

test('canonicalize: plain repo URL', () => {
  const r = canonicalizeGitHubUrl('https://github.com/jackedwards/power-design')
  assert.ok(r)
  assert.equal(r.canonicalUrl, 'https://github.com/jackedwards/power-design')
  assert.equal(r.owner, 'jackedwards')
  assert.equal(r.repo, 'power-design')
})

test('canonicalize: strips .git suffix', () => {
  const r = canonicalizeGitHubUrl('https://github.com/owner/repo.git')
  assert.ok(r)
  assert.equal(r.canonicalUrl, 'https://github.com/owner/repo')
})

test('canonicalize: strips deep path (tree/blob/issues)', () => {
  const a = canonicalizeGitHubUrl('https://github.com/owner/repo/tree/main/src')
  const b = canonicalizeGitHubUrl('https://github.com/owner/repo/blob/main/file.ts')
  const c = canonicalizeGitHubUrl('https://github.com/owner/repo/issues/42')
  assert.equal(a?.canonicalUrl, 'https://github.com/owner/repo')
  assert.equal(b?.canonicalUrl, 'https://github.com/owner/repo')
  assert.equal(c?.canonicalUrl, 'https://github.com/owner/repo')
})

test('canonicalize: strips query and hash', () => {
  const r = canonicalizeGitHubUrl('https://github.com/owner/repo?utm=foo#section')
  assert.equal(r?.canonicalUrl, 'https://github.com/owner/repo')
})

test('canonicalize: folds www. and m. subdomains', () => {
  const w = canonicalizeGitHubUrl('https://www.github.com/owner/repo')
  const m = canonicalizeGitHubUrl('https://m.github.com/owner/repo')
  assert.equal(w?.canonicalUrl, 'https://github.com/owner/repo')
  assert.equal(m?.canonicalUrl, 'https://github.com/owner/repo')
})

test('canonicalize: rejects reserved owner segments', () => {
  for (const seg of ['topics', 'features', 'marketplace', 'orgs', 'users', 'settings', 'login', 'search']) {
    assert.equal(canonicalizeGitHubUrl(`https://github.com/${seg}/react`), null, seg)
  }
})

test('canonicalize: rejects gist host paths via reserved owner', () => {
  // gist sits in the owner position when the URL is github.com/gist/...
  assert.equal(canonicalizeGitHubUrl('https://github.com/gist/owner'), null)
})

test('canonicalize: rejects no-repo URLs', () => {
  assert.equal(canonicalizeGitHubUrl('https://github.com/owner'), null)
  assert.equal(canonicalizeGitHubUrl('https://github.com/'), null)
  assert.equal(canonicalizeGitHubUrl('https://github.com'), null)
})

test('canonicalize: rejects truncated repo (ellipsis or trailing dots)', () => {
  // This is the exact failure mode for jackedwards/power-design — display
  // text was truncated and the AI copied the truncated form.
  assert.equal(canonicalizeGitHubUrl('https://github.com/owner/r\u2026'), null)
  assert.equal(canonicalizeGitHubUrl('https://github.com/owner/repo...'), null)
})

test('canonicalize: rejects double-dash owner', () => {
  assert.equal(canonicalizeGitHubUrl('https://github.com/foo--bar/repo'), null)
})

test('canonicalize: rejects non-github hosts', () => {
  assert.equal(canonicalizeGitHubUrl('https://gitlab.com/owner/repo'), null)
  assert.equal(canonicalizeGitHubUrl('https://bitbucket.org/owner/repo'), null)
  assert.equal(canonicalizeGitHubUrl('https://example.com/owner/repo'), null)
})

test('canonicalize: tolerates whitespace around URL', () => {
  const r = canonicalizeGitHubUrl('  https://github.com/owner/repo  ')
  assert.equal(r?.canonicalUrl, 'https://github.com/owner/repo')
})

test('canonicalize: rejects null / empty / unparseable', () => {
  assert.equal(canonicalizeGitHubUrl(null), null)
  assert.equal(canonicalizeGitHubUrl(''), null)
  assert.equal(canonicalizeGitHubUrl('not-a-url'), null)
})

test('isGitHubHost: matches www / m / bare', () => {
  assert.equal(isGitHubHost('https://github.com/anything'), true)
  assert.equal(isGitHubHost('https://www.github.com/anything'), true)
  assert.equal(isGitHubHost('https://m.github.com/anything'), true)
})

test('isGitHubHost: rejects non-github hosts', () => {
  assert.equal(isGitHubHost('https://gitlab.com/anything'), false)
  assert.equal(isGitHubHost('https://example.com'), false)
  assert.equal(isGitHubHost('not-a-url'), false)
  assert.equal(isGitHubHost(null), false)
  assert.equal(isGitHubHost(undefined), false)
})
