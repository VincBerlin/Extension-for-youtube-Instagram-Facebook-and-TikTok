// LLM admin routes — credential testing and free-model discovery for BYOK.
//
// These endpoints do NOT require Supabase auth: they're the bootstrap path a
// user goes through before they have an account, and the credentials they're
// testing belong to them, not us. Rate-limit is the abuse control.

import { Router, type Request, type Response } from 'express'
import OpenAI from 'openai'
import Anthropic from '@anthropic-ai/sdk'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { parseRuntimeLlmConfig } from '../middleware/llmRuntime.js'
import {
  callOpenRouterChat,
  fetchOpenRouterFreeModels,
  scoreFreeModel,
  OpenRouterError,
} from '../services/openRouter.js'
import { assertPublicHttpUrl, assertResolvedPublicHost, UnsafeUrlError } from '../security/safeUrl.js'

export const llmRouter = Router()

interface TestErrorBody {
  ok: false
  code: 'INVALID_API_KEY' | 'PROVIDER_UNAVAILABLE' | 'BAD_REQUEST' | 'UNSAFE_BASE_URL' | 'UNKNOWN'
  message: string
}

interface TestOkBody {
  ok: true
  provider: string
  model: string
  mode?: string
}

const TEST_PROMPT = 'Return exactly this JSON, with no surrounding text: {"ok":true}'

llmRouter.post('/test', async (req: Request, res: Response<TestOkBody | TestErrorBody>) => {
  const cfg = parseRuntimeLlmConfig(req)
  if (!cfg || !cfg.apiKey) {
    return res.status(400).json({
      ok: false,
      code: 'BAD_REQUEST',
      message: 'X-LLM-Provider and X-LLM-API-Key headers are required.',
    })
  }

  try {
    if (cfg.provider === 'openai-compatible') {
      // User-supplied base URLs are an SSRF risk — block private/internal IPs
      // before we hand the URL to the OpenAI SDK.
      if (!cfg.baseUrl) {
        return res.status(400).json({
          ok: false,
          code: 'BAD_REQUEST',
          message: 'OpenAI-compatible provider requires X-LLM-Base-URL.',
        })
      }
      try {
        const parsed = assertPublicHttpUrl(cfg.baseUrl)
        await assertResolvedPublicHost(parsed)
      } catch (err) {
        if (err instanceof UnsafeUrlError) {
          return res.status(400).json({
            ok: false,
            code: 'UNSAFE_BASE_URL',
            message: err.message,
          })
        }
        throw err
      }
    }

    const model = cfg.model ?? defaultTestModel(cfg.provider)
    const ok = await runTestCall(cfg.provider, cfg.apiKey, model, cfg.baseUrl, cfg.openRouterMode)
    if (!ok) {
      return res.status(502).json({
        ok: false,
        code: 'PROVIDER_UNAVAILABLE',
        message: 'Provider responded but the test message did not return usable content.',
      })
    }
    return res.json({
      ok: true,
      provider: cfg.provider,
      model,
      ...(cfg.openRouterMode ? { mode: cfg.openRouterMode } : {}),
    })
  } catch (err) {
    return res.status(401).json(classifyTestError(err))
  }
})

llmRouter.get('/openrouter/free-models', async (req: Request, res: Response) => {
  const cfg = parseRuntimeLlmConfig(req)
  if (!cfg?.apiKey) {
    return res.status(400).json({ error: 'X-LLM-API-Key header required' })
  }
  try {
    const models = await fetchOpenRouterFreeModels(cfg.apiKey)
    const ranked = models
      .map((m) => ({ id: m.id, score: scoreFreeModel(m), context_length: m.context_length }))
      .sort((a, b) => b.score - a.score)
    return res.json({ models: ranked })
  } catch (err) {
    if (err instanceof OpenRouterError) {
      return res.status(err.status).json({ error: err.message })
    }
    return res.status(500).json({ error: (err as Error).message })
  }
})

function defaultTestModel(provider: string): string {
  switch (provider) {
    case 'gemini':    return 'gemini-2.0-flash'
    case 'openai':    return 'gpt-4o-mini'
    case 'anthropic': return 'claude-3-5-haiku-latest'
    case 'openrouter':
    case 'openai-compatible':
                       return 'openrouter/free'
    default:           return 'gpt-4o-mini'
  }
}

async function runTestCall(
  provider: string,
  apiKey: string,
  model: string,
  baseUrl: string | undefined,
  openRouterMode: string | undefined,
): Promise<boolean> {
  if (provider === 'gemini') {
    const genAI = new GoogleGenerativeAI(apiKey)
    const m = genAI.getGenerativeModel({ model })
    const result = await m.generateContent({
      contents: [{ role: 'user', parts: [{ text: TEST_PROMPT }] }],
      generationConfig: { temperature: 0, maxOutputTokens: 32, responseMimeType: 'application/json' },
    })
    return result.response.text().length > 0
  }
  if (provider === 'anthropic') {
    const anthropic = new Anthropic({ apiKey })
    const r = await anthropic.messages.create({
      model,
      max_tokens: 64,
      messages: [{ role: 'user', content: TEST_PROMPT }],
    })
    return r.content[0]?.type === 'text'
  }
  if (provider === 'openrouter') {
    // Always call directly here — even in free-cascade mode the test only
    // verifies the key works; the cascade only matters at extraction time.
    void openRouterMode
    const content = await callOpenRouterChat({
      apiKey,
      model,
      messages: [{ role: 'user', content: TEST_PROMPT }],
      responseFormat: 'json_object',
    })
    return content.length > 0
  }
  // openai + openai-compatible — same SDK shape; baseUrl set only for the
  // compatible variant.
  const openai = new OpenAI({ apiKey, ...(baseUrl ? { baseURL: baseUrl } : {}) })
  const r = await openai.chat.completions.create({
    model,
    messages: [{ role: 'user', content: TEST_PROMPT }],
    max_tokens: 64,
    temperature: 0,
  })
  return Boolean(r.choices[0]?.message.content)
}

function classifyTestError(err: unknown): TestErrorBody {
  const msg = (err as Error).message ?? 'Test failed'

  if (err instanceof OpenRouterError) {
    if (err.status === 401 || err.status === 403) {
      return { ok: false, code: 'INVALID_API_KEY', message: 'The API key was rejected by OpenRouter.' }
    }
    if (err.retryable) {
      return { ok: false, code: 'PROVIDER_UNAVAILABLE', message: msg }
    }
    return { ok: false, code: 'BAD_REQUEST', message: msg }
  }

  const lowered = msg.toLowerCase()
  if (
    lowered.includes('invalid api key') ||
    lowered.includes('incorrect api key') ||
    lowered.includes('unauthorized') ||
    lowered.includes('401') ||
    lowered.includes('403')
  ) {
    return { ok: false, code: 'INVALID_API_KEY', message: 'The API key was rejected by the selected provider.' }
  }
  if (lowered.includes('not found') || lowered.includes('404')) {
    return { ok: false, code: 'BAD_REQUEST', message: 'The selected model was not found for this provider.' }
  }
  return { ok: false, code: 'UNKNOWN', message: msg }
}
