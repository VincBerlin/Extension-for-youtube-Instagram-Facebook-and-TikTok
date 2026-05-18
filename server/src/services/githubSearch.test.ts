import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { searchGitHubRepo } from './githubSearch.js'

const realFetch = global.fetch

function mockFetch(response: unknown, init: { ok?: boolean; status?: number } = {}) {
  global.fetch = (async () =>
    new Response(JSON.stringify(response), {
      status: init.status ?? 200,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch
}

beforeEach(() => {
  global.fetch = realFetch
})

afterEach(() => {
  global.fetch = realFetch
})

test('search: dominant top hit returns highConfidence=true', async () => {
  mockFetch({
    items: [
      { full_name: 'owner/repo', html_url: 'https://github.com/owner/repo', score: 100, stargazers_count: 1000, description: 'Top hit' },
      { full_name: 'owner/other', html_url: 'https://github.com/owner/other', score: 5, stargazers_count: 10, description: 'Distant' },
    ],
  })
  const r = await searchGitHubRepo('repo')
  assert.ok(r)
  assert.equal(r.hit.fullName, 'owner/repo')
  assert.equal(r.isHighConfidence, true)
})

test('search: ambiguous results (close scores) → highConfidence=false', async () => {
  mockFetch({
    items: [
      { full_name: 'owner/alpha', html_url: 'https://github.com/owner/alpha', score: 10, stargazers_count: 5, description: '' },
      { full_name: 'owner/beta', html_url: 'https://github.com/owner/beta', score: 9, stargazers_count: 4, description: '' },
    ],
  })
  const r = await searchGitHubRepo('alpha')
  assert.ok(r)
  assert.equal(r.isHighConfidence, false)
})

test('search: only one result → highConfidence=true', async () => {
  mockFetch({
    items: [
      { full_name: 'lone/repo', html_url: 'https://github.com/lone/repo', score: 12, stargazers_count: 3, description: '' },
    ],
  })
  const r = await searchGitHubRepo('lone')
  assert.ok(r)
  assert.equal(r.isHighConfidence, true)
})

test('search: empty results return null', async () => {
  mockFetch({ items: [] })
  const r = await searchGitHubRepo('does-not-matter')
  assert.equal(r, null)
})

test('search: top hit URL that fails canonicaliser returns null', async () => {
  mockFetch({
    items: [
      { full_name: 'topics/react', html_url: 'https://github.com/topics/react', score: 100, stargazers_count: 0, description: '' },
    ],
  })
  const r = await searchGitHubRepo('react')
  assert.equal(r, null)
})

test('search: API error returns null', async () => {
  global.fetch = (async () => new Response('rate limited', { status: 403 })) as typeof fetch
  const r = await searchGitHubRepo('anything')
  assert.equal(r, null)
})

test('search: project name shorter than 2 chars returns null without hitting API', async () => {
  global.fetch = (async () => {
    throw new Error('should not be called')
  }) as typeof fetch
  const a = await searchGitHubRepo('')
  const b = await searchGitHubRepo('a')
  assert.equal(a, null)
  assert.equal(b, null)
})

test('search: runner score 0 with non-zero top → highConfidence=true', async () => {
  mockFetch({
    items: [
      { full_name: 'owner/repo', html_url: 'https://github.com/owner/repo', score: 5, stargazers_count: 1, description: '' },
      { full_name: 'owner/other', html_url: 'https://github.com/owner/other', score: 0, stargazers_count: 0, description: '' },
    ],
  })
  const r = await searchGitHubRepo('repo')
  assert.ok(r)
  assert.equal(r.isHighConfidence, true)
})
