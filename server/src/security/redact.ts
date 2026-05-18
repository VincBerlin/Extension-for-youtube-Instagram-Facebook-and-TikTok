// Log-redaction helpers. Anything we send to stdout/stderr is captured by the
// platform log pipeline (Render, Cloud Run, etc.), so we never want a raw API
// key or Authorization header to appear in logs even by accident.

// Common API-key shapes — long opaque strings. Keep this conservative; a
// false-positive that redacts a non-secret is fine, a false-negative that
// leaks one is not.
const SECRET_KEY_PATTERNS: RegExp[] = [
  /sk-[A-Za-z0-9_-]{10,}/g,              // OpenAI, Anthropic-ish
  /sk-ant-[A-Za-z0-9_-]{10,}/g,          // Anthropic explicit
  /AIza[A-Za-z0-9_-]{20,}/g,             // Google (Gemini, Maps, etc.)
  /Bearer\s+[A-Za-z0-9._~+/=-]{20,}/gi,  // generic bearer tokens
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, // JWTs
]

const SENSITIVE_KEY_NAMES = new Set([
  'authorization',
  'api_key',
  'apikey',
  'api-key',
  'access_token',
  'accesstoken',
  'refresh_token',
  'refreshtoken',
  'service_role_key',
  'serviceroleKey',
  'supabase_service_role_key',
  'x-llm-api-key',
  'cookie',
  'set-cookie',
])

const MASK = '<redacted>'

export function redactString(value: string): string {
  let out = value
  for (const re of SECRET_KEY_PATTERNS) {
    out = out.replace(re, MASK)
  }
  return out
}

// Returns a shallow clone with any keys matching SENSITIVE_KEY_NAMES masked.
// Recurses into plain objects and arrays. Leaves other types (Date, Buffer,
// Map, etc.) intact since they should never appear in log payloads we emit.
export function redactObject<T>(value: T): T {
  return walk(value) as T
}

function walk(value: unknown): unknown {
  if (value === null || value === undefined) return value
  if (typeof value === 'string') return redactString(value)
  if (typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(walk)
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_KEY_NAMES.has(k.toLowerCase())) {
      out[k] = MASK
    } else {
      out[k] = walk(v)
    }
  }
  return out
}

// Convenience for header objects (case-insensitive key compare).
export function redactHeaders(headers: Record<string, string | string[] | undefined>): Record<string, string | string[] | undefined> {
  const out: Record<string, string | string[] | undefined> = {}
  for (const [k, v] of Object.entries(headers)) {
    if (SENSITIVE_KEY_NAMES.has(k.toLowerCase())) {
      out[k] = MASK
    } else {
      out[k] = v
    }
  }
  return out
}
