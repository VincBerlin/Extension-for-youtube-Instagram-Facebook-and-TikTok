/**
 * URL liveness validation.
 *
 * For each Resource we run HEAD (fast) → fall back to a small GET when the
 * server doesn't support HEAD (405). Result is mapped to Resource.validation:
 *   'valid'      — final response status is 2xx
 *   'redirected' — followed one or more 3xx; final 2xx URL stored in final_url
 *   'invalid'    — terminal 4xx/5xx, DNS error, or refused connection
 *   'unchecked'  — timeout / network abort (we don't want to mark a maybe-live
 *                  resource as broken because the validator was too aggressive)
 *   'unverified' — repo-shaped GitHub URL that looks plausible but the
 *                  upstream API didn't confirm it (rate-limited, no token).
 *                  UI must render this with a visible "unverified" badge so
 *                  the user knows to double-check before trusting it.
 *
 * The check is best-effort: we cap concurrency and per-request timeout so it
 * never blocks an extraction by more than a few seconds total.
 */

import type { GitHubResourceCandidate, Resource } from '../../../shared/types.js'
import { canonicalizeGitHubUrl } from './githubCanonicalizer.js'

const TIMEOUT_MS = 4000
const CONCURRENCY = 8

const USER_AGENT = 'Mozilla/5.0 (compatible; ExtractBot/0.1; +https://example.com/bot)'

export async function validateResources(resources: Resource[]): Promise<Resource[]> {
  if (resources.length === 0) return resources

  const queue = [...resources]
  const out: Resource[] = new Array(resources.length)
  const indexMap = new Map<Resource, number>()
  resources.forEach((r, i) => indexMap.set(r, i))

  async function worker() {
    while (queue.length > 0) {
      const r = queue.shift()
      if (!r) return
      const idx = indexMap.get(r)!
      const generic = await validateOne(r)
      out[idx] = await applyGitHubValidation(generic)
    }
  }

  const workers = Array.from({ length: Math.min(CONCURRENCY, resources.length) }, () => worker())
  await Promise.all(workers)
  return out
}

async function validateOne(r: Resource): Promise<Resource> {
  // Trust empty / clearly broken URLs immediately
  if (!r.url || !/^https?:\/\//i.test(r.url)) {
    return { ...r, validation: 'invalid' }
  }

  // Try HEAD first (no body, fastest)
  const headRes = await fetchWithTimeout(r.url, { method: 'HEAD' })
  if (headRes.kind === 'response') {
    return classify(r, headRes.url, headRes.status, r.url)
  }

  // HEAD blocked / not allowed → tiny GET (Range: 0-1023) to confirm
  if (headRes.kind === 'method-not-allowed') {
    const getRes = await fetchWithTimeout(r.url, {
      method: 'GET',
      headers: { Range: 'bytes=0-1023' },
    })
    if (getRes.kind === 'response') {
      return classify(r, getRes.url, getRes.status, r.url)
    }
    if (getRes.kind === 'invalid') {
      return { ...r, validation: 'invalid' }
    }
    return { ...r, validation: 'unchecked' }
  }

  if (headRes.kind === 'invalid') {
    return { ...r, validation: 'invalid' }
  }
  // Timeout / network glitch → we don't know, leave unchecked
  return { ...r, validation: 'unchecked' }
}

function classify(r: Resource, finalUrl: string, status: number, originalUrl: string): Resource {
  if (status >= 200 && status < 300) {
    if (finalUrl !== originalUrl) {
      return { ...r, validation: 'redirected', final_url: finalUrl }
    }
    return { ...r, validation: 'valid' }
  }
  if (status >= 300 && status < 400) {
    return { ...r, validation: 'redirected', final_url: finalUrl }
  }
  return { ...r, validation: 'invalid' }
}

type FetchResult =
  | { kind: 'response'; status: number; url: string }
  | { kind: 'invalid' }
  | { kind: 'timeout' }
  | { kind: 'method-not-allowed' }

/**
 * Cross-check GitHub repo URLs against the GitHub REST API. The HEAD/GET
 * liveness check is unreliable for github.com because GitHub returns 200 for
 * many invalid paths (it serves a "page not found" HTML body with HTTP 200
 * to logged-in browsers). Hitting `api.github.com/repos/{owner}/{repo}`
 * gives a clean 200/404 signal, so we use it as the source of truth for
 * GitHub repo links specifically.
 *
 * Behaviour:
 *  - 200 → keep `valid` / `redirected`
 *  - 404 → mark `invalid` (the URL leads to a real 404 page)
 *  - rate-limited (403/429) → mark `unverified` so the UI can warn the user
 *  - non-repo paths (gist, sponsors, etc.) → leave generic validation in place
 */
async function applyGitHubValidation(r: Resource): Promise<Resource> {
  const repo = canonicalizeGitHubUrl(r.url)
  if (!repo) return r

  const headers: Record<string, string> = {
    'User-Agent': USER_AGENT,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  }
  const token = process.env.GITHUB_TOKEN
  if (token) headers.Authorization = `Bearer ${token}`

  try {
    const apiUrl = `https://api.github.com/repos/${repo.owner}/${repo.repo}`
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
    let res: Response
    try {
      res = await fetch(apiUrl, { method: 'GET', headers, signal: ctrl.signal })
    } finally {
      clearTimeout(timer)
    }
    let next: Resource = r
    if (res.status === 200) {
      next = (r.validation === 'invalid' || r.validation === 'unchecked')
        ? { ...r, validation: 'valid' }
        : r
    } else if (res.status === 404) {
      next = { ...r, validation: 'invalid' }
    } else if (res.status === 403 || res.status === 429) {
      next = { ...r, validation: 'unverified' }
    }
    console.log(
      '[GITHUB-LINK-DEBUG] validation |',
      'apiStatus:', res.status, '|',
      'verdict:', next.validation, '|',
      'owner:', repo.owner, '|',
      'repo:', repo.repo, '|',
      'url:', r.url,
    )
    return next
  } catch (err) {
    console.log(
      '[GITHUB-LINK-DEBUG] validation |',
      'apiStatus: error |',
      'verdict:', r.validation, '|',
      'owner:', repo.owner, '|',
      'repo:', repo.repo, '|',
      'url:', r.url, '|',
      'err:', (err as Error).message,
    )
    return r
  }
}

/**
 * Validate a list of GitHubResourceCandidate via the same GitHub REST API
 * call used by `applyGitHubValidation`, but operating directly on candidates.
 * Each candidate gets its `validationStatus` set; `resolvedUrl` is filled
 * when the API returned a redirect to a renamed repo. Best-effort: network
 * errors leave the candidate `unchecked`.
 */
export async function validateGitHubCandidates(
  candidates: GitHubResourceCandidate[],
): Promise<GitHubResourceCandidate[]> {
  if (candidates.length === 0) return candidates
  const queue = [...candidates]
  const out: GitHubResourceCandidate[] = new Array(candidates.length)
  const indexMap = new Map<GitHubResourceCandidate, number>()
  candidates.forEach((c, i) => indexMap.set(c, i))

  async function worker(): Promise<void> {
    while (queue.length > 0) {
      const c = queue.shift()
      if (!c) return
      const idx = indexMap.get(c)!
      out[idx] = await validateOneCandidate(c)
    }
  }

  const workers = Array.from(
    { length: Math.min(CONCURRENCY, candidates.length) },
    () => worker(),
  )
  await Promise.all(workers)
  return out
}

async function validateOneCandidate(
  c: GitHubResourceCandidate,
): Promise<GitHubResourceCandidate> {
  const headers: Record<string, string> = {
    'User-Agent': USER_AGENT,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  }
  const token = process.env.GITHUB_TOKEN
  if (token) headers.Authorization = `Bearer ${token}`

  try {
    const apiUrl = `https://api.github.com/repos/${c.owner}/${c.repo}`
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
    let res: Response
    try {
      res = await fetch(apiUrl, { method: 'GET', headers, signal: ctrl.signal })
    } finally {
      clearTimeout(timer)
    }
    if (res.status === 200) {
      // Look at the body for a renamed-repo redirect — the GitHub API
      // serves the *current* repo at the old URL but reveals the new
      // canonical name in `full_name`.
      let resolvedUrl: string | undefined
      try {
        const body = await res.json() as { full_name?: string }
        if (body.full_name && body.full_name.toLowerCase() !== `${c.owner}/${c.repo}`.toLowerCase()) {
          resolvedUrl = `https://github.com/${body.full_name}`
        }
      } catch {
        // Ignore body parse failures; status 200 alone is enough to mark valid.
      }
      console.log(
        '[GITHUB-LINK-DEBUG] candidate-validation |',
        'apiStatus: 200 | verdict: valid |',
        `id: ${c.id} | url: ${c.canonicalUrl}`,
      )
      return {
        ...c,
        validationStatus: resolvedUrl ? 'redirected' : 'valid',
        ...(resolvedUrl ? { resolvedUrl } : {}),
      }
    }
    if (res.status === 404) {
      console.log(
        '[GITHUB-LINK-DEBUG] candidate-validation |',
        'apiStatus: 404 | verdict: invalid |',
        `id: ${c.id} | url: ${c.canonicalUrl}`,
      )
      return { ...c, validationStatus: 'invalid' }
    }
    if (res.status === 403 || res.status === 429) {
      console.log(
        '[GITHUB-LINK-DEBUG] candidate-validation |',
        `apiStatus: ${res.status} | verdict: unverified |`,
        `id: ${c.id} | url: ${c.canonicalUrl}`,
      )
      return { ...c, validationStatus: 'unverified', validationError: 'rate_limited' }
    }
    return c
  } catch (err) {
    console.log(
      '[GITHUB-LINK-DEBUG] candidate-validation |',
      'apiStatus: error | verdict: unchecked |',
      `id: ${c.id} | url: ${c.canonicalUrl} | err: ${(err as Error).message}`,
    )
    return { ...c, validationError: (err as Error).message }
  }
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<FetchResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      ...init,
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'User-Agent': USER_AGENT, ...(init.headers as Record<string, string> | undefined ?? {}) },
    })
    if (res.status === 405 || res.status === 501) {
      return { kind: 'method-not-allowed' }
    }
    return { kind: 'response', status: res.status, url: res.url }
  } catch (err) {
    if ((err as Error).name === 'AbortError') return { kind: 'timeout' }
    // DNS failure / refused / TLS error → real signal that the URL is dead
    return { kind: 'invalid' }
  } finally {
    clearTimeout(timer)
  }
}
