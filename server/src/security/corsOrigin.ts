// CORS origin policy, extracted as a pure function so it can be unit-tested
// and so the cors middleware can answer with `callback(null, false)` instead
// of `callback(new Error(...))` — an Error there becomes an Express 500 with
// a stack trace, while `false` cleanly omits the CORS headers and lets the
// browser block the response.
//
// Policy:
//   - No Origin header (curl, server-to-server, same-origin): allowed.
//   - chrome-extension://<32 a-p letters>: allowed if the id is on the
//     allowlist; with an EMPTY allowlist every extension origin is allowed
//     (local dev with unpacked builds — set ALLOWED_EXTENSION_IDS in prod).
//   - Other origins: allowed only when explicitly listed in extraOrigins.

const EXTENSION_ORIGIN = /^chrome-extension:\/\/([a-p]{32})$/

export function isOriginAllowed(
  origin: string | undefined,
  allowedExtensionIds: readonly string[],
  extraOrigins: readonly string[],
): boolean {
  if (!origin) return true

  const match = origin.match(EXTENSION_ORIGIN)
  if (match) {
    if (allowedExtensionIds.length === 0) return true
    return allowedExtensionIds.includes(match[1])
  }

  return extraOrigins.includes(origin)
}
