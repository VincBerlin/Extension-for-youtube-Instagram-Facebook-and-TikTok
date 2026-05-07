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
 *
 * The check is best-effort: we cap concurrency and per-request timeout so it
 * never blocks an extraction by more than a few seconds total.
 */

import type { Resource } from '../../../shared/types.js'

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
      out[idx] = await validateOne(r)
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
