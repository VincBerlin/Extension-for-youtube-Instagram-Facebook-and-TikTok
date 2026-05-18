// OpenRouter integration. Three entry points:
//
//   callOpenRouterChat        — one shot, given a model.
//   fetchOpenRouterFreeModels — list free-tier models (pricing.prompt=="0").
//   callOpenRouterCascade     — try up to 3 free models in ranked order until
//                                one returns valid output.
//
// The cascade is the value-add for BYOK users on the free tier: OpenRouter's
// individual free endpoints throttle aggressively, so a single call to
// `openrouter/free` will frequently 429. By ranking the available free models
// and retrying on transient failures we get a usable success rate without
// burning the user's budget on paid models.
//
// Free-model discovery is preferred. A short seed list is only used when the
// /models endpoint is unavailable (rate-limited, network outage) — it must
// not become a stale hardcoded list anyone has to keep updated.

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1'

const REFERER = process.env.APP_PUBLIC_URL ?? 'https://extract.local'
const TITLE = process.env.APP_NAME ?? 'Video Resource Extractor'

const REQUEST_TIMEOUT_MS = 60_000
const MAX_CASCADE_ATTEMPTS = 3

const SEED_FREE_MODELS: ReadonlyArray<string> = [
  'openrouter/free',
  'qwen/qwen3-coder:free',
  'z-ai/glm-4.5-air:free',
]

export interface OpenRouterModelArchitecture {
  input_modalities?: string[]
  output_modalities?: string[]
}

export interface OpenRouterModel {
  id: string
  name?: string
  pricing?: { prompt?: string; completion?: string }
  context_length?: number
  supported_parameters?: string[]
  architecture?: OpenRouterModelArchitecture
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface CallOpenRouterChatInput {
  apiKey: string
  model: string
  messages: ChatMessage[]
  responseFormat?: 'json_object'
  signal?: AbortSignal
}

export class OpenRouterError extends Error {
  status: number
  body: string
  retryable: boolean
  constructor(status: number, body: string, retryable: boolean) {
    super(`OpenRouter ${status}: ${body.slice(0, 200)}`)
    this.name = 'OpenRouterError'
    this.status = status
    this.body = body
    this.retryable = retryable
  }
}

function isRetryableStatus(status: number): boolean {
  // Spec rule: retry on rate-limit, credit/billing issues, provider blips.
  // 401/403 mean bad key → don't retry; 400 means bad payload → don't retry.
  return status === 402 || status === 408 || status === 425 || status === 429 ||
    status === 500 || status === 502 || status === 503 || status === 504
}

function authHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'HTTP-Referer': REFERER,
    'X-Title': TITLE,
  }
}

function withTimeout(ms: number, parent?: AbortSignal): { signal: AbortSignal; cancel: () => void } {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(new Error('OpenRouter request timeout')), ms)
  const onParentAbort = () => ctrl.abort(parent?.reason)
  if (parent) {
    if (parent.aborted) ctrl.abort(parent.reason)
    else parent.addEventListener('abort', onParentAbort, { once: true })
  }
  return {
    signal: ctrl.signal,
    cancel: () => {
      clearTimeout(timer)
      if (parent) parent.removeEventListener('abort', onParentAbort)
    },
  }
}

export async function callOpenRouterChat(input: CallOpenRouterChatInput): Promise<string> {
  const { apiKey, model, messages, responseFormat, signal } = input
  const { signal: aborter, cancel } = withTimeout(REQUEST_TIMEOUT_MS, signal)
  try {
    const res = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: authHeaders(apiKey),
      signal: aborter,
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.15,
        ...(responseFormat ? { response_format: { type: responseFormat } } : {}),
      }),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new OpenRouterError(res.status, text, isRetryableStatus(res.status))
    }
    const data = await res.json() as {
      choices?: Array<{ message?: { content?: string } }>
    }
    const content = data.choices?.[0]?.message?.content
    if (typeof content !== 'string' || content.length === 0) {
      throw new OpenRouterError(502, 'OpenRouter returned no content', true)
    }
    return content
  } finally {
    cancel()
  }
}

export async function fetchOpenRouterFreeModels(apiKey: string): Promise<OpenRouterModel[]> {
  const { signal, cancel } = withTimeout(REQUEST_TIMEOUT_MS)
  try {
    const res = await fetch(`${OPENROUTER_BASE_URL}/models`, {
      method: 'GET',
      headers: authHeaders(apiKey),
      signal,
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new OpenRouterError(res.status, text, isRetryableStatus(res.status))
    }
    const data = await res.json() as { data?: OpenRouterModel[] }
    const all = data.data ?? []
    return all.filter(isFreeTextModel)
  } finally {
    cancel()
  }
}

function isFreeTextModel(m: OpenRouterModel): boolean {
  const promptPrice = m.pricing?.prompt
  const completionPrice = m.pricing?.completion
  if (promptPrice !== '0' || completionPrice !== '0') return false
  const inputModes = m.architecture?.input_modalities ?? []
  const outputModes = m.architecture?.output_modalities ?? []
  if (inputModes.length && !inputModes.includes('text')) return false
  if (outputModes.length && !outputModes.includes('text')) return false
  return true
}

export function scoreFreeModel(model: OpenRouterModel): number {
  let score = 0
  if (model.id === 'openrouter/free') score += 1000
  if (model.supported_parameters?.includes('response_format')) score += 200
  if (model.supported_parameters?.includes('structured_outputs')) score += 200

  const ctx = model.context_length ?? 0
  if (ctx >= 200_000) score += 150
  else if (ctx >= 128_000) score += 100
  else if (ctx >= 32_000) score += 50

  if (model.architecture?.input_modalities?.includes('text')) score += 25
  if (model.architecture?.output_modalities?.includes('text')) score += 25
  return score
}

export interface CallOpenRouterCascadeInput {
  apiKey: string
  messages: ChatMessage[]
  responseFormat?: 'json_object'
  maxAttempts?: number
  signal?: AbortSignal
}

export interface CallOpenRouterCascadeResult {
  content: string
  modelUsed: string
  attempts: string[]
}

export async function callOpenRouterCascade(
  input: CallOpenRouterCascadeInput,
): Promise<CallOpenRouterCascadeResult> {
  const { apiKey, messages, responseFormat, signal } = input
  const max = Math.min(input.maxAttempts ?? MAX_CASCADE_ATTEMPTS, MAX_CASCADE_ATTEMPTS)

  // Try discovery first. If it fails we use the seed list — the cascade is
  // best-effort and we must never bubble a model-list error up as the user's
  // extraction error.
  let ranked: string[]
  try {
    const free = await fetchOpenRouterFreeModels(apiKey)
    ranked = free
      .map((m) => ({ id: m.id, score: scoreFreeModel(m) }))
      .sort((a, b) => b.score - a.score)
      .map((x) => x.id)
    if (ranked.length === 0) ranked = [...SEED_FREE_MODELS]
  } catch (err) {
    console.warn('[openRouter] free-model discovery failed, using seed list:', (err as Error).message)
    ranked = [...SEED_FREE_MODELS]
  }

  const attempts: string[] = []
  let lastErr: unknown
  for (const model of ranked.slice(0, max)) {
    attempts.push(model)
    try {
      const content = await callOpenRouterChat({
        apiKey,
        model,
        messages,
        responseFormat,
        signal,
      })
      return { content, modelUsed: model, attempts }
    } catch (err) {
      lastErr = err
      const retryable = err instanceof OpenRouterError ? err.retryable : true
      if (!retryable) {
        // Auth / bad-payload errors — pointless to try the next model.
        throw err
      }
      // Soft failure → try the next ranked model.
      console.warn(`[openRouter] ${model} failed (${(err as Error).message}); cascading to next`)
    }
  }
  throw lastErr ?? new OpenRouterError(503, 'All cascade attempts failed', false)
}
