// Pure helpers for the TEST_LLM_PROVIDER flow — extracted for unit tests.
//
// The setup modal shows these messages verbatim, so they must be actionable:
// a fetch-level failure names the server URL (the user can check whether the
// server is running / the build points at the right host) instead of the raw
// browser string "Failed to fetch".

export interface LlmTestFailure {
  ok: false
  code: 'NETWORK' | 'BAD_RESPONSE'
  message: string
}

export function networkTestError(apiBase: string, err: unknown): LlmTestFailure {
  const detail = err instanceof Error && err.message ? ` (${err.message})` : ''
  return {
    ok: false,
    code: 'NETWORK',
    message: `Cannot reach extraction server at ${apiBase}${detail}`,
  }
}

export function parseTestResponse(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return {
      ok: false,
      code: 'BAD_RESPONSE',
      message: text.slice(0, 200),
    } satisfies LlmTestFailure
  }
}
