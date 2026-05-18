/**
 * GitHubResourceCandidate builder.
 *
 * Builds the deterministic candidate list passed to Gemini in place of letting
 * the AI invent GitHub URLs. Sources are gathered in priority order; the first
 * source that produces a given {owner, repo} wins. Lower-priority sources only
 * contribute new repos, never overwrite an exact source.
 *
 * Priority (highest → lowest):
 *   1. description_anchor       — `<a href>` from description DOM (already decoded)
 *   2. description_redirect     — folded into anchors at extraction time
 *   3. description_text         — raw URL scanned from description body
 *   4. transcript_url           — raw URL scanned from transcript text
 *   5. transcript_mention       — `owner/repo` mentioned in transcript without URL
 *   6. github_search            — server-side search fallback (githubSearch.ts)
 *   7. ai_inferred              — AI suggested URL not present in any source
 *
 * Stable IDs `gh_1`...`gh_N` are assigned in priority order. IDs are only
 * stable within a single extraction call.
 */

import {
  type ConfidenceLevel,
  type GitHubResourceCandidate,
  type GitHubCandidateSource,
  type YouTubeSourceBundle,
} from '../../../shared/types.js'
import { canonicalizeGitHubUrl, isGitHubHost } from './githubCanonicalizer.js'

export interface BuildCandidatesInput {
  youtubeSource?: YouTubeSourceBundle
  transcript?: string
}

const URL_RE = /\bhttps?:\/\/(?:www\.|m\.)?github\.com\/[A-Za-z0-9._\-\/]+/gi

// Standalone "owner/repo" mention regex. Owner: GitHub username pattern.
// Repo: alnum + `._-`. Surrounded by word boundaries so prose like
// "components/Button" or "src/main" does not match — we anchor on
// `github.com` first, then on the standalone form.
const STANDALONE_REPO_RE = /\b([A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)\/([A-Za-z0-9._-]+)\b/g

const CONFIDENCE_BY_SOURCE: Record<GitHubCandidateSource, ConfidenceLevel> = {
  description_anchor: 'high',
  description_redirect: 'high',
  description_text: 'high',
  transcript_url: 'high',
  transcript_mention: 'medium',
  github_search: 'medium',
  ai_inferred: 'low',
}

interface RawCandidate {
  source: GitHubCandidateSource
  originalUrl: string
  title?: string
  sourceText?: string
  timestamp?: string
  surroundingText?: string
}

/**
 * Walk the configured sources in priority order and return one candidate per
 * canonical {owner, repo}. Validation is NOT performed here — call
 * `validateCandidates()` afterwards.
 */
export function buildGitHubCandidates(input: BuildCandidatesInput): GitHubResourceCandidate[] {
  const raws: RawCandidate[] = []

  // 1. Description anchors (highest-truth source — exact href YouTube was sending).
  const yt = input.youtubeSource
  if (yt) {
    for (const url of yt.descriptionAnchorUrls ?? []) {
      if (!isGitHubHost(url)) continue
      const meta = anchorMetadataFromBundle(url, yt)
      raws.push({
        source: 'description_anchor',
        originalUrl: url,
        ...(meta.title ? { title: meta.title } : {}),
        sourceText: 'YouTube description anchor',
        ...(meta.timestamp ? { timestamp: meta.timestamp } : {}),
      })
    }

    // 3. Description text — only adds URLs that anchors missed (private playlists, edits).
    for (const link of yt.descriptionLinks ?? []) {
      if (!isGitHubHost(link.url)) continue
      raws.push({
        source: 'description_text',
        originalUrl: link.url,
        ...(link.title ? { title: link.title } : {}),
        sourceText: 'YouTube description text',
        ...(link.timestamp ? { timestamp: link.timestamp } : {}),
      })
    }
  }

  // 4. Transcript URLs — when the creator pastes a link in the spoken text /
  //    captions / on-screen text. Only counts when canonicalises cleanly.
  if (input.transcript) {
    const urlRanges: Array<{ start: number; end: number }> = []
    for (const m of input.transcript.matchAll(URL_RE)) {
      const url = m[0]
      const start = m.index ?? 0
      urlRanges.push({ start, end: start + url.length })
      raws.push({
        source: 'transcript_url',
        originalUrl: url,
        sourceText: extractContext(input.transcript, start, url.length),
      })
    }

    // 5. Transcript mentions — `owner/repo` without `github.com` prefix.
    //    These are validation-required (high false-positive rate) so they are
    //    queued at lower confidence; the validator will mark them invalid if
    //    the API says 404. Mentions whose match position lies INSIDE a URL we
    //    already captured (e.g. `com/owner` inside `github.com/owner/repo`)
    //    are skipped — they would produce phantom candidates like
    //    `https://github.com/com/owner`.
    for (const m of input.transcript.matchAll(STANDALONE_REPO_RE)) {
      const owner = m[1]
      const repo = m[2]
      const start = m.index ?? 0
      const end = start + m[0].length
      const overlaps = urlRanges.some((r) => start < r.end && end > r.start)
      if (overlaps) continue
      const candidateUrl = `https://github.com/${owner}/${repo}`
      raws.push({
        source: 'transcript_mention',
        originalUrl: candidateUrl,
        sourceText: extractContext(input.transcript, start, m[0].length),
      })
    }
  }

  return collapseToCandidates(raws)
}

/**
 * Collapse the raw source list to one candidate per canonical {owner, repo}.
 * The first occurrence (highest priority) is kept; later sources only fill in
 * `surroundingText` / `timestamp` when the winner has none.
 */
function collapseToCandidates(raws: RawCandidate[]): GitHubResourceCandidate[] {
  const byCanonical = new Map<string, GitHubResourceCandidate>()
  let counter = 1

  for (const raw of raws) {
    const canon = canonicalizeGitHubUrl(raw.originalUrl)
    if (!canon) continue
    const existing = byCanonical.get(canon.canonicalUrl)
    if (existing) {
      // Backfill optional metadata from a lower-priority source if the winner
      // had none — better a transcript timestamp than nothing.
      if (!existing.timestamp && raw.timestamp) existing.timestamp = raw.timestamp
      if (!existing.surroundingText && raw.surroundingText) existing.surroundingText = raw.surroundingText
      continue
    }

    const candidate: GitHubResourceCandidate = {
      id: `gh_${counter++}`,
      title: raw.title ?? `${canon.owner}/${canon.repo}`,
      originalUrl: raw.originalUrl,
      canonicalUrl: canon.canonicalUrl,
      owner: canon.owner,
      repo: canon.repo,
      source: raw.source,
      ...(raw.sourceText ? { sourceText: raw.sourceText } : {}),
      ...(raw.timestamp ? { timestamp: raw.timestamp } : {}),
      ...(raw.surroundingText ? { surroundingText: raw.surroundingText } : {}),
      confidenceBeforeValidation: CONFIDENCE_BY_SOURCE[raw.source],
      validationStatus: 'unchecked',
    }
    byCanonical.set(canon.canonicalUrl, candidate)
  }

  return [...byCanonical.values()]
}

/**
 * Promote an AI-suggested URL into a candidate (priority 7). Used by
 * post-processing when the AI emits a github URL we did not extract from any
 * source — the candidate must validate before it can be shown.
 */
export function appendAiInferredCandidate(
  existing: GitHubResourceCandidate[],
  url: string,
  title?: string,
): GitHubResourceCandidate | null {
  const canon = canonicalizeGitHubUrl(url)
  if (!canon) return null
  const dup = existing.find((c) => c.canonicalUrl === canon.canonicalUrl)
  if (dup) return dup

  const id = `gh_${existing.length + 1}`
  const candidate: GitHubResourceCandidate = {
    id,
    title: title ?? `${canon.owner}/${canon.repo}`,
    originalUrl: url,
    canonicalUrl: canon.canonicalUrl,
    owner: canon.owner,
    repo: canon.repo,
    source: 'ai_inferred',
    confidenceBeforeValidation: CONFIDENCE_BY_SOURCE.ai_inferred,
    validationStatus: 'unchecked',
  }
  existing.push(candidate)
  return candidate
}

function extractContext(text: string, index: number, length: number): string {
  const start = Math.max(0, index - 60)
  const end = Math.min(text.length, index + length + 60)
  return text.slice(start, end).replace(/\s+/g, ' ').trim()
}

/**
 * Map a description anchor URL to its DescriptionLink (for title + timestamp)
 * when a matching one was parsed from the text. Anchors without a text-link
 * counterpart return empty metadata — the canonicalizer fills the title from
 * `{owner}/{repo}` later.
 */
function anchorMetadataFromBundle(
  url: string,
  yt: YouTubeSourceBundle,
): { title?: string; timestamp?: string } {
  const link = yt.descriptionLinks?.find((l) => l.url === url)
  if (!link) return {}
  return {
    ...(link.title ? { title: link.title } : {}),
    ...(link.timestamp ? { timestamp: link.timestamp } : {}),
  }
}
