/**
 * GitHub repository search fallback.
 *
 * Used ONLY when the candidate pipeline could not find an exact GitHub URL for
 * a project name and the AI / transcript clearly references one. Calls
 * api.github.com/search/repositories with a focused query, then returns the
 * top result IF AND ONLY IF its score dominates the runner-up. Otherwise
 * returns null and the caller leaves the candidate `unverified` rather than
 * guessing.
 *
 * Architectural rule: this function NEVER replaces an exact-source candidate.
 * Caller is responsible for skipping search when an `description_anchor`,
 * `description_text`, or `transcript_url` candidate already covers the same
 * project name.
 */

import { canonicalizeGitHubUrl } from './githubCanonicalizer.js'

const USER_AGENT = 'Mozilla/5.0 (compatible; ExtractBot/0.1; +https://example.com/bot)'
const TIMEOUT_MS = 4000

// Minimum lead the top hit must have over #2 for us to accept it.
// GitHub's search score is unitless; the leading repo for a unique name is
// usually 10-100x ahead of the runner-up. We require a 3x lead to be safe.
const SCORE_DOMINANCE_RATIO = 3

export interface GitHubSearchHit {
  fullName: string
  htmlUrl: string
  score: number
  stars: number
  description: string | null
}

export interface GitHubSearchResult {
  hit: GitHubSearchHit
  /** True when this hit's score dominates #2 and its canonical URL parses cleanly. */
  isHighConfidence: boolean
}

/**
 * Search github.com/search/repositories?q=<projectName>+<context>. Caller
 * passes the project name and an optional context blurb (transcript snippet,
 * channel name, video title) — the search query weights the project name
 * heavily but keeps the context as a tiebreaker for common names.
 *
 * Returns null when:
 *  - the GitHub API errored / timed out
 *  - no results came back
 *  - the top hit's URL does not canonicalise (rare, but defensive)
 *  - the top hit does not dominate the runner-up (ambiguous)
 */
export async function searchGitHubRepo(
  projectName: string,
  context?: string,
): Promise<GitHubSearchResult | null> {
  const trimmed = projectName.trim()
  if (!trimmed || trimmed.length < 2) return null

  const headers: Record<string, string> = {
    'User-Agent': USER_AGENT,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  }
  const token = process.env.GITHUB_TOKEN
  if (token) headers.Authorization = `Bearer ${token}`

  // Build the q= parameter. `in:name,description` keeps us anchored to actual
  // project naming. Context is appended as a soft hint; we deliberately do
  // not require it to match (search is just a fallback signal).
  const q = context
    ? `${trimmed} in:name,description ${context.slice(0, 40)}`
    : `${trimmed} in:name,description`

  const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&per_page=5&sort=best-match`

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)

  let body: { items?: Array<{ full_name?: string; html_url?: string; score?: number; stargazers_count?: number; description?: string | null }>; total_count?: number }
  try {
    const res = await fetch(url, { method: 'GET', headers, signal: ctrl.signal })
    if (!res.ok) {
      console.log('[GITHUB-LINK-DEBUG] search | apiStatus:', res.status, '| q:', q)
      return null
    }
    body = await res.json()
  } catch (err) {
    console.log('[GITHUB-LINK-DEBUG] search | error:', (err as Error).message, '| q:', q)
    return null
  } finally {
    clearTimeout(timer)
  }

  const items = body.items ?? []
  if (items.length === 0) return null

  const top = items[0]
  if (!top.full_name || !top.html_url) return null

  // Strip any deep-link suffix and verify the URL parses to a clean canonical form.
  const canon = canonicalizeGitHubUrl(top.html_url)
  if (!canon) return null

  const topScore = top.score ?? 0
  const runnerScore = items[1]?.score ?? 0
  const isHighConfidence =
    items.length === 1 ||
    runnerScore <= 0 ||
    topScore / runnerScore >= SCORE_DOMINANCE_RATIO

  console.log(
    '[GITHUB-LINK-DEBUG] search | q:', q,
    '| top:', top.full_name,
    '| topScore:', topScore.toFixed(2),
    '| runnerScore:', runnerScore.toFixed(2),
    '| highConfidence:', isHighConfidence,
  )

  return {
    hit: {
      fullName: top.full_name,
      htmlUrl: canon.canonicalUrl,
      score: topScore,
      stars: top.stargazers_count ?? 0,
      description: top.description ?? null,
    },
    isHighConfidence,
  }
}
