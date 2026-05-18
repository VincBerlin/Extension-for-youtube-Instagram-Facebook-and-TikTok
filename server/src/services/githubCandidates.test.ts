import { test } from 'node:test'
import assert from 'node:assert/strict'
import { appendAiInferredCandidate, buildGitHubCandidates } from './githubCandidates.js'
import type { YouTubeSourceBundle } from '../../../shared/types.js'

function bundle(overrides: Partial<YouTubeSourceBundle> = {}): YouTubeSourceBundle {
  return {
    videoId: 'abc',
    videoUrl: 'https://youtube.com/watch?v=abc',
    title: 'Test',
    transcriptText: '',
    transcriptAvailable: false,
    descriptionText: '',
    descriptionAvailable: true,
    descriptionLinks: [],
    timestampedResources: [],
    descriptionAnchorUrls: [],
    extractionSourceCoverage: [],
    ...overrides,
  }
}

test('buildCandidates: anchor-only source produces description_anchor candidate', () => {
  const cs = buildGitHubCandidates({
    youtubeSource: bundle({
      descriptionAnchorUrls: ['https://github.com/owner/repo'],
    }),
  })
  assert.equal(cs.length, 1)
  assert.equal(cs[0].source, 'description_anchor')
  assert.equal(cs[0].canonicalUrl, 'https://github.com/owner/repo')
  assert.equal(cs[0].id, 'gh_1')
})

test('buildCandidates: priority — anchor wins over description text and transcript', () => {
  const cs = buildGitHubCandidates({
    youtubeSource: bundle({
      descriptionAnchorUrls: ['https://github.com/owner/repo'],
      descriptionLinks: [{ url: 'https://github.com/owner/repo', title: 'Owner Repo' }],
    }),
    transcript: 'Check it out at https://github.com/owner/repo for the source.',
  })
  // Same canonical URL — only one candidate, source must be the highest priority (anchor).
  assert.equal(cs.length, 1)
  assert.equal(cs[0].source, 'description_anchor')
})

test('buildCandidates: dedupes by canonical URL across deep paths', () => {
  const cs = buildGitHubCandidates({
    youtubeSource: bundle({
      descriptionAnchorUrls: [
        'https://github.com/owner/repo',
        'https://github.com/owner/repo/tree/main',
        'https://github.com/owner/repo.git',
      ],
    }),
  })
  assert.equal(cs.length, 1)
  assert.equal(cs[0].canonicalUrl, 'https://github.com/owner/repo')
})

test('buildCandidates: rejects non-github anchors', () => {
  const cs = buildGitHubCandidates({
    youtubeSource: bundle({
      descriptionAnchorUrls: ['https://example.com/owner/repo', 'https://gitlab.com/foo/bar'],
    }),
  })
  assert.equal(cs.length, 0)
})

test('buildCandidates: transcript URL becomes transcript_url with high confidence', () => {
  const cs = buildGitHubCandidates({
    transcript: 'go to https://github.com/foo/bar to clone it',
  })
  assert.equal(cs.length, 1)
  assert.equal(cs[0].source, 'transcript_url')
  assert.equal(cs[0].confidenceBeforeValidation, 'high')
})

test('buildCandidates: transcript mention (owner/repo without URL) becomes medium confidence', () => {
  const cs = buildGitHubCandidates({
    transcript: 'this uses foo/bar as the boilerplate',
  })
  // Will produce a transcript_mention candidate.
  const mention = cs.find((c) => c.source === 'transcript_mention')
  assert.ok(mention)
  assert.equal(mention.canonicalUrl, 'https://github.com/foo/bar')
  assert.equal(mention.confidenceBeforeValidation, 'medium')
})

test('buildCandidates: truncated description URL is rejected by canonicaliser', () => {
  const cs = buildGitHubCandidates({
    youtubeSource: bundle({
      descriptionAnchorUrls: ['https://github.com/owner/r\u2026'],
    }),
  })
  assert.equal(cs.length, 0)
})

test('buildCandidates: stable ids in priority order (gh_1, gh_2, ...)', () => {
  const cs = buildGitHubCandidates({
    youtubeSource: bundle({
      descriptionAnchorUrls: ['https://github.com/a/one', 'https://github.com/b/two'],
    }),
    transcript: 'and https://github.com/c/three',
  })
  assert.deepEqual(
    cs.map((c) => c.id),
    ['gh_1', 'gh_2', 'gh_3'],
  )
})

test('buildCandidates: backfills timestamp from lower-priority source when winner has none', () => {
  const cs = buildGitHubCandidates({
    youtubeSource: bundle({
      descriptionAnchorUrls: ['https://github.com/owner/repo'],
      descriptionLinks: [
        { url: 'https://github.com/owner/repo', title: 'Repo', timestamp: '00:18' },
      ],
    }),
  })
  assert.equal(cs.length, 1)
  assert.equal(cs[0].timestamp, '00:18')
})

test('appendAiInferredCandidate: adds new candidate with ai_inferred source and low confidence', () => {
  const list = buildGitHubCandidates({
    youtubeSource: bundle({ descriptionAnchorUrls: ['https://github.com/a/one'] }),
  })
  const c = appendAiInferredCandidate(list, 'https://github.com/b/two', 'Two')
  assert.ok(c)
  assert.equal(c.source, 'ai_inferred')
  assert.equal(c.confidenceBeforeValidation, 'low')
  assert.equal(c.id, 'gh_2')
  assert.equal(list.length, 2)
})

test('appendAiInferredCandidate: returns existing candidate when canonical URL already present', () => {
  const list = buildGitHubCandidates({
    youtubeSource: bundle({ descriptionAnchorUrls: ['https://github.com/a/one'] }),
  })
  const c = appendAiInferredCandidate(list, 'https://github.com/a/one/tree/main', 'Same Repo')
  assert.ok(c)
  assert.equal(c.source, 'description_anchor')
  assert.equal(list.length, 1)
})

test('appendAiInferredCandidate: rejects truncated URL', () => {
  const list: ReturnType<typeof buildGitHubCandidates> = []
  const c = appendAiInferredCandidate(list, 'https://github.com/owner/r\u2026')
  assert.equal(c, null)
  assert.equal(list.length, 0)
})
