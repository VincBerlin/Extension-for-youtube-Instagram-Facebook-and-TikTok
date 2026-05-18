// SSRF guard. The server fetches URLs that the LLM or user produces (resource
// liveness checks, GitHub API hits, yt-dlp downloads) — without these guards
// an attacker can coerce us into hitting cloud metadata endpoints, internal
// services, or arbitrary protocols.
//
// Three exported entry points cover the call sites we have today:
//   assertPublicHttpUrl(raw)          — parse + scheme/host shape check
//   assertResolvedPublicHost(url)     — DNS resolve + private-range block
//   assertAllowedMediaPageUrl(raw, p) — yt-dlp page allowlist per platform
//
// Each one THROWS on failure. Callers must catch and convert to the right
// response (404/400/etc.) at their boundary; throwing is intentional so a
// missing call still produces a visible crash instead of a silent bypass.

import { lookup } from 'node:dns/promises'
import net from 'node:net'

export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UnsafeUrlError'
  }
}

// Hosts/schemes we never want to touch. Schemes other than http(s) can pull
// content via gopher/data/file/etc.; localhost short-circuits DNS; metadata
// service IPs are the classic AWS/GCP SSRF target.
const FORBIDDEN_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'ip6-localhost',
  'ip6-loopback',
  'metadata',
  'metadata.google.internal',
])

const FORBIDDEN_LITERAL_IPS = new Set([
  '169.254.169.254',  // AWS / Azure / GCP / DigitalOcean metadata
  '100.100.100.200',  // Alibaba Cloud metadata
  '0.0.0.0',
])

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split('.').map(Number)
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) {
    return true // unparseable → treat as private to be safe
  }
  const [a, b] = parts
  if (a === 10) return true                                  // 10.0.0.0/8
  if (a === 127) return true                                 // 127.0.0.0/8 loopback
  if (a === 0) return true                                   // 0.0.0.0/8
  if (a === 169 && b === 254) return true                    // 169.254.0.0/16 link-local
  if (a === 172 && b >= 16 && b <= 31) return true           // 172.16.0.0/12
  if (a === 192 && b === 168) return true                    // 192.168.0.0/16
  if (a === 100 && b >= 64 && b <= 127) return true          // 100.64.0.0/10 CGNAT
  if (a >= 224) return true                                  // multicast + reserved
  return false
}

function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase()
  if (lower === '::1' || lower === '::' ) return true        // loopback / unspecified
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true // fc00::/7 ULA
  if (lower.startsWith('fe80:') || lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) return true // fe80::/10 link-local
  if (lower.startsWith('ff')) return true                    // multicast
  // IPv4-mapped IPv6 (::ffff:a.b.c.d) — strip prefix and re-check
  const mapped = lower.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/)
  if (mapped) return isPrivateIPv4(mapped[1])
  return false
}

// Step 1: shape check. Parse the URL, enforce http(s), reject literal private
// hosts and IPs. Does NOT do DNS — callers should also run
// assertResolvedPublicHost before issuing the fetch.
export function assertPublicHttpUrl(rawUrl: string): URL {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    throw new UnsafeUrlError(`Unsafe URL (malformed): ${rawUrl}`)
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new UnsafeUrlError(`Unsafe URL scheme: ${parsed.protocol}`)
  }
  const host = parsed.hostname.toLowerCase()
  if (!host) throw new UnsafeUrlError('Unsafe URL (empty host)')
  if (FORBIDDEN_HOSTNAMES.has(host)) {
    throw new UnsafeUrlError(`Unsafe URL host: ${host}`)
  }
  if (FORBIDDEN_LITERAL_IPS.has(host)) {
    throw new UnsafeUrlError(`Unsafe URL host (metadata IP): ${host}`)
  }
  const ipFamily = net.isIP(host)
  if (ipFamily === 4 && isPrivateIPv4(host)) {
    throw new UnsafeUrlError(`Unsafe URL host (private IPv4): ${host}`)
  }
  if (ipFamily === 6 && isPrivateIPv6(host)) {
    throw new UnsafeUrlError(`Unsafe URL host (private IPv6): ${host}`)
  }
  return parsed
}

// Step 2: DNS resolution. A hostname can still resolve to a private IP, so
// this MUST be called after assertPublicHttpUrl and before fetch().
// Uses `all: true` to inspect every A/AAAA record.
export async function assertResolvedPublicHost(url: URL): Promise<void> {
  const host = url.hostname.toLowerCase()
  // Literal IPs were already checked synchronously.
  if (net.isIP(host)) return

  let addresses: Array<{ address: string; family: number }>
  try {
    addresses = await lookup(host, { all: true })
  } catch (err) {
    throw new UnsafeUrlError(`DNS lookup failed for ${host}: ${(err as Error).message}`)
  }
  if (addresses.length === 0) {
    throw new UnsafeUrlError(`DNS lookup returned no records for ${host}`)
  }
  for (const { address, family } of addresses) {
    if (FORBIDDEN_LITERAL_IPS.has(address)) {
      throw new UnsafeUrlError(`Host ${host} resolves to forbidden IP ${address}`)
    }
    if (family === 4 && isPrivateIPv4(address)) {
      throw new UnsafeUrlError(`Host ${host} resolves to private IPv4 ${address}`)
    }
    if (family === 6 && isPrivateIPv6(address)) {
      throw new UnsafeUrlError(`Host ${host} resolves to private IPv6 ${address}`)
    }
  }
}

// Hosts we knowingly hand to yt-dlp. Anything else is rejected outright — the
// LLM/UI must not be able to feed us arbitrary URLs and have them downloaded.
const ALLOWED_MEDIA_HOSTS: Record<string, string[]> = {
  youtube: ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be'],
  tiktok: ['tiktok.com', 'www.tiktok.com', 'vm.tiktok.com', 'm.tiktok.com'],
  instagram: ['instagram.com', 'www.instagram.com'],
  facebook: ['facebook.com', 'www.facebook.com', 'm.facebook.com', 'fb.watch'],
}

export function assertAllowedMediaPageUrl(rawUrl: string, platform: string): URL {
  const parsed = assertPublicHttpUrl(rawUrl)
  const allowed = ALLOWED_MEDIA_HOSTS[platform.toLowerCase()]
  if (!allowed) {
    throw new UnsafeUrlError(`Unknown media platform: ${platform}`)
  }
  const host = parsed.hostname.toLowerCase()
  if (!allowed.includes(host)) {
    throw new UnsafeUrlError(`Host ${host} not allowed for platform ${platform}`)
  }
  return parsed
}
