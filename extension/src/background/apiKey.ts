// Single source of truth for API-key normalization and validation.
// Used by the BYOK test path, the save path, and the runtime-header builder —
// a key that passes here is guaranteed to be a legal HTTP header value, so
// fetch can never throw "Invalid value" on it.

const ZERO_WIDTH = /[\u200B-\u200D\uFEFF]/g

// Strips decoration a copy-paste can pick up (surrounding/internal whitespace,
// zero-width characters, a "Bearer " prefix). Returns undefined when nothing
// usable remains.
export function normalizeApiKey(raw: string | undefined): string | undefined {
  if (!raw) return undefined
  const cleaned = raw
    .replace(ZERO_WIDTH, '')
    .trim()
    .replace(/^Bearer\s+/i, '')
    .replace(/\s+/g, '')
  return cleaned.length > 0 ? cleaned : undefined
}

// True when the key is printable ASCII (0x21-0x7E) — the safe subset for an
// HTTP header value. Anything else (smart quotes, umlauts, ellipsis from a
// truncated copy) must be rejected with an actionable message BEFORE fetch.
export function isValidApiKey(key: string): boolean {
  return /^[\x21-\x7E]+$/.test(key)
}

export const INVALID_KEY_MESSAGE =
  'API key contains invalid characters — re-copy it as plain text.'
