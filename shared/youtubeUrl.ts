/**
 * Extract a canonical YouTube video id from every URL shape the extension and
 * server accept. Keep this helper in shared/ so transcript lookup, source
 * metadata, and server fallback routing cannot drift between packages.
 */
export function extractYouTubeId(url: string): string | null {
  try {
    const u = new URL(url)
    const hostname = u.hostname.replace(/^www\./, '').replace(/^m\./, '')

    if (hostname === 'youtu.be') {
      const candidate = firstPathSegment(u.pathname)
      return candidate ? sanitizeVideoId(candidate) : null
    }

    if (hostname !== 'youtube.com' && !hostname.endsWith('.youtube.com')) return null

    const watchId = u.searchParams.get('v')
    if (watchId) return sanitizeVideoId(watchId)

    const parts = u.pathname.split('/').filter(Boolean)
    const shortsIndex = parts.indexOf('shorts')
    if (shortsIndex >= 0 && parts[shortsIndex + 1]) {
      return sanitizeVideoId(parts[shortsIndex + 1])
    }

    const embedIndex = parts.indexOf('embed')
    if (embedIndex >= 0 && parts[embedIndex + 1]) {
      return sanitizeVideoId(parts[embedIndex + 1])
    }

    const liveIndex = parts.indexOf('live')
    if (liveIndex >= 0 && parts[liveIndex + 1]) {
      return sanitizeVideoId(parts[liveIndex + 1])
    }

    return null
  } catch {
    return null
  }
}

function firstPathSegment(pathname: string): string | null {
  return pathname.split('/').filter(Boolean)[0] ?? null
}

function sanitizeVideoId(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  // YouTube ids are currently 11 chars, but keep this tolerant so older/future
  // valid ids are not rejected. Strip only obvious path/query contamination.
  const clean = trimmed.split(/[/?#&]/, 1)[0]
  return clean || null
}
