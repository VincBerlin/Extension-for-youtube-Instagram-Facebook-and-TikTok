export function extractYouTubeId(url: string): string | null {
  try {
    const u = new URL(url)

    if (u.hostname.includes('youtu.be')) {
      const candidate = u.pathname.split('/').filter(Boolean)[0]
      return candidate || null
    }

    const watchId = u.searchParams.get('v')
    if (watchId) return watchId

    const parts = u.pathname.split('/').filter(Boolean)
    const shortsIndex = parts.indexOf('shorts')
    if (shortsIndex >= 0 && parts[shortsIndex + 1]) {
      return parts[shortsIndex + 1]
    }

    return parts.at(-1) ?? null
  } catch {
    return null
  }
}
