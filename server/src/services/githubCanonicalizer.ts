/**
 * Centralized GitHub URL canonicalizer.
 *
 * Used by every layer of the GitHubResourceCandidate pipeline:
 *  - candidate extraction (`githubCandidates.ts`)
 *  - validation (`urlValidator.ts`)
 *  - AI post-processing (`ai.ts`)
 *
 * The single canonical form for a repo is:
 *   https://github.com/{owner}/{repo}
 * with `.git`, query, hash, and any deep-link suffix (`/tree/...`, `/blob/...`,
 * `/issues`, etc.) stripped. The original URL is preserved separately by the
 * caller when needed for deep links.
 *
 * RULES (these are why we have a single canonicalizer instead of inlining
 * regex everywhere):
 *  1. host must be github.com (or www.github.com / m.github.com — folded).
 *  2. owner = first path segment, must match GitHub's username regex.
 *  3. repo = second path segment, must match GitHub's repo regex.
 *  4. strip a trailing `.git` from the repo segment.
 *  5. strip query string and hash for the canonicalUrl (deep links go elsewhere).
 *  6. reject reserved owner-position paths (/topics, /features, /marketplace,
 *     /orgs, /users, /settings, /login, /search, ...). These are GitHub's own
 *     pages — never user repos. We never infer a missing owner.
 *  7. truncated visible text such as `github.com/owner/r…` produces an invalid
 *     repo segment because of the U+2026 ellipsis or trailing whitespace; we
 *     reject it instead of silently accepting it.
 */

const RESERVED_OWNER_SEGMENTS = new Set([
  'gist', 'sponsors', 'marketplace', 'topics', 'search', 'settings',
  'orgs', 'organizations', 'users', 'pricing', 'pulls', 'issues',
  'notifications', 'login', 'signup', 'about', 'security', 'features',
  'collections', 'events', 'enterprise', 'customer-stories', 'readme',
  'site', 'apps', 'codespaces', 'discussions', 'pricing', 'team',
])

const OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/
const REPO_RE = /^[A-Za-z0-9._-]+$/

export interface CanonicalGitHubUrl {
  canonicalUrl: string
  owner: string
  repo: string
}

/**
 * Returns the canonical form of a GitHub repo URL, or null if the URL is not
 * a recognisable repo URL. Never throws.
 *
 * Accepts:
 *  - https://github.com/owner/repo
 *  - https://github.com/owner/repo.git
 *  - https://github.com/owner/repo/tree/main
 *  - https://www.github.com/Owner/Repo?utm=foo#section
 *
 * Rejects:
 *  - https://github.com/topics/react       (reserved owner position)
 *  - https://github.com/owner               (no repo)
 *  - https://github.com/owner/r…           (truncated repo)
 *  - https://github.com/owner/repo with trailing whitespace inside segment
 */
export function canonicalizeGitHubUrl(url: string | null | undefined): CanonicalGitHubUrl | null {
  if (!url) return null
  let parsed: URL
  try {
    parsed = new URL(url.trim())
  } catch {
    return null
  }
  const host = parsed.hostname.replace(/^www\./, '').replace(/^m\./, '').toLowerCase()
  if (host !== 'github.com') return null

  const segs = parsed.pathname.split('/').filter(Boolean)
  if (segs.length < 2) return null

  const ownerRaw = segs[0]
  const repoRaw = segs[1].replace(/\.git$/i, '')

  if (RESERVED_OWNER_SEGMENTS.has(ownerRaw.toLowerCase())) return null
  if (!OWNER_RE.test(ownerRaw)) return null
  if (!REPO_RE.test(repoRaw)) return null

  // Defensive: GitHub usernames never end with `-` and never have consecutive
  // dashes. The base regex catches ends, this catches doubles.
  if (ownerRaw.includes('--')) return null
  // Repo segment must have at least one alnum (avoids `.` / `..`).
  if (!/[A-Za-z0-9]/.test(repoRaw)) return null
  // Reject obviously truncated tokens — the ellipsis character and ASCII "..."
  // both indicate copied-but-cut display text.
  if (repoRaw.includes('\u2026') || repoRaw.endsWith('...')) return null

  return {
    canonicalUrl: `https://github.com/${ownerRaw}/${repoRaw}`,
    owner: ownerRaw,
    repo: repoRaw,
  }
}

/**
 * True when the URL points at github.com (any subpath, valid or not). Used by
 * provenance logging and the AI prompt to decide whether to route a URL
 * through the candidate pipeline at all.
 */
export function isGitHubHost(url: string | null | undefined): boolean {
  if (!url) return false
  try {
    const u = new URL(url.trim())
    const host = u.hostname.replace(/^www\./, '').replace(/^m\./, '').toLowerCase()
    return host === 'github.com'
  } catch {
    return false
  }
}
