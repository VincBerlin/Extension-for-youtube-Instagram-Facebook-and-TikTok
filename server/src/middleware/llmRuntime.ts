// Parses the X-LLM-* headers a BYOK extension call sends. The API key rides
// in headers (never in the JSON body) so it stays out of access logs / request
// echoes / Supabase request_payload columns.
//
// The body's `req.llm` carries the non-secret shape; this middleware merges
// the secret apiKey from headers onto that shape and exposes it as
// `req.runtimeLlm` for routes to read.
//
// If no X-LLM-Provider header is present we return null — the extract route
// then falls through to the server default (AI_PROVIDER env var).

import type { Request, Response, NextFunction } from 'express'
import type { LlmProvider, OpenRouterMode, RuntimeLlmConfig } from '../../../shared/types.js'

export interface RuntimeLlmHeaders extends RuntimeLlmConfig {
  /** Plaintext API key — never log, never persist, never echo. */
  apiKey?: string
}

declare module 'express-serve-static-core' {
  interface Request {
    runtimeLlm?: RuntimeLlmHeaders | null
  }
}

const VALID_PROVIDERS: ReadonlySet<LlmProvider> = new Set<LlmProvider>([
  'server-default',
  'openrouter',
  'openai',
  'anthropic',
  'gemini',
  'openai-compatible',
])

const VALID_OR_MODES: ReadonlySet<OpenRouterMode> = new Set<OpenRouterMode>([
  'free-router',
  'free-cascade',
  'custom-model',
])

export function parseRuntimeLlmConfig(req: Request): RuntimeLlmHeaders | null {
  const provider = req.header('X-LLM-Provider')?.trim()
  if (!provider) return null
  if (!VALID_PROVIDERS.has(provider as LlmProvider)) {
    // Unknown provider — treat as "no runtime config", route falls back to
    // server default. We deliberately don't 400 here: a stale/buggy extension
    // shouldn't take down extractions for the user.
    return null
  }

  const mode = req.header('X-LLM-OpenRouter-Mode')?.trim()
  const openRouterMode = mode && VALID_OR_MODES.has(mode as OpenRouterMode)
    ? (mode as OpenRouterMode)
    : undefined

  const apiKey = req.header('X-LLM-API-Key')?.trim() || undefined
  const model = req.header('X-LLM-Model')?.trim() || undefined
  const baseUrl = req.header('X-LLM-Base-URL')?.trim() || undefined

  return {
    provider: provider as LlmProvider,
    apiKey,
    model,
    baseUrl,
    openRouterMode,
  }
}

// Express middleware variant — attaches `req.runtimeLlm`. Routes can either
// call `parseRuntimeLlmConfig(req)` directly or read `req.runtimeLlm`.
export function llmRuntimeMiddleware(req: Request, _res: Response, next: NextFunction) {
  req.runtimeLlm = parseRuntimeLlmConfig(req)
  next()
}
