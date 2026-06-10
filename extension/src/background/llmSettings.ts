import type { LlmProvider, LlmSettingsPublic, OpenRouterMode } from '@shared/types'
import { normalizeApiKey, isValidApiKey, INVALID_KEY_MESSAGE } from './apiKey'

const PUBLIC_KEY = 'llm_settings'
const SECRET_KEY = 'llm_api_key'

interface StoredPublicSettings {
  provider: LlmProvider
  model?: string
  baseUrl?: string
  openRouterMode?: OpenRouterMode
  rememberKey: boolean
  configured: boolean
  lastTestedAt?: string
}


function isValidProvider(value: unknown): value is LlmProvider {
  return (
    value === 'server-default' ||
    value === 'openrouter' ||
    value === 'openai' ||
    value === 'anthropic' ||
    value === 'gemini' ||
    value === 'openai-compatible'
  )
}

function isValidOrMode(value: unknown): value is OpenRouterMode {
  return value === 'free-router' || value === 'free-cascade' || value === 'custom-model'
}

export function normalizePublic(raw: unknown): StoredPublicSettings | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (!isValidProvider(r.provider)) return null
  return {
    provider: r.provider,
    model: typeof r.model === 'string' ? r.model : undefined,
    baseUrl: typeof r.baseUrl === 'string' ? r.baseUrl : undefined,
    openRouterMode: isValidOrMode(r.openRouterMode) ? r.openRouterMode : undefined,
    rememberKey: r.rememberKey === true,
    configured: r.configured === true,
    lastTestedAt: typeof r.lastTestedAt === 'string' ? r.lastTestedAt : undefined,
  }
}

// Pure: should the UI re-prompt for the key? True when the user finished
// setup for a BYOK provider but the secret itself is no longer readable
// (default rememberKey=false stores it in chrome.storage.session, which the
// browser clears on restart — while configured:true persists in local).
export function needsKeyReentry(
  settings: Pick<LlmSettingsPublic, 'configured' | 'provider'>,
  hasKey: boolean,
): boolean {
  return settings.configured && settings.provider !== 'server-default' && !hasKey
}

export async function getLlmSettings(): Promise<LlmSettingsPublic | null> {
  const stored = await chrome.storage.local.get(PUBLIC_KEY)
  const settings = normalizePublic(stored[PUBLIC_KEY])
  if (!settings) return null
  if (!settings.configured || settings.provider === 'server-default') return settings
  const key = await readApiKey(settings.rememberKey)
  return { ...settings, keyMissing: needsKeyReentry(settings, Boolean(key)) }
}

export async function saveLlmSettings(settings: LlmSettingsPublic, apiKey?: string): Promise<void> {
  // Validate the key BEFORE persisting anything — otherwise configured:true
  // lands in storage while the key write is rejected, desyncing the two.
  const normalizedKey = normalizeApiKey(apiKey)
  if (normalizedKey && !isValidApiKey(normalizedKey)) {
    throw new Error(INVALID_KEY_MESSAGE)
  }

  const publicData: StoredPublicSettings = {
    provider: settings.provider,
    model: settings.model,
    baseUrl: settings.baseUrl,
    openRouterMode: settings.openRouterMode,
    rememberKey: settings.rememberKey,
    configured: settings.configured,
    lastTestedAt: settings.lastTestedAt,
  }
  await chrome.storage.local.set({ [PUBLIC_KEY]: publicData })

  if (apiKey === undefined) return

  if (!normalizedKey) {
    await chrome.storage.local.remove(SECRET_KEY)
    await chrome.storage.session.remove(SECRET_KEY)
    return
  }

  if (settings.rememberKey) {
    await chrome.storage.local.set({ [SECRET_KEY]: normalizedKey })
    await chrome.storage.session.remove(SECRET_KEY)
  } else {
    await chrome.storage.session.set({ [SECRET_KEY]: normalizedKey })
    await chrome.storage.local.remove(SECRET_KEY)
  }
}

export async function deleteLlmSettings(): Promise<void> {
  await chrome.storage.local.remove([PUBLIC_KEY, SECRET_KEY])
  await chrome.storage.session.remove(SECRET_KEY)
}

async function readApiKey(rememberKey: boolean): Promise<string | undefined> {
  if (rememberKey) {
    const local = await chrome.storage.local.get(SECRET_KEY)
    const value = local[SECRET_KEY]
    if (typeof value === 'string' && value.length > 0) return value
  }
  const session = await chrome.storage.session.get(SECRET_KEY)
  const value = session[SECRET_KEY]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

export async function getRuntimeLlmHeaders(): Promise<Record<string, string>> {
  const settings = await getLlmSettings()
  if (!settings || !settings.configured) return {}
  if (settings.provider === 'server-default') return {}

  const apiKey = normalizeApiKey(await readApiKey(settings.rememberKey))
  if (!apiKey || !isValidApiKey(apiKey)) return {}

  const headers: Record<string, string> = {
    'X-LLM-Provider': settings.provider,
    'X-LLM-API-Key': apiKey,
  }
  if (settings.model) headers['X-LLM-Model'] = settings.model
  if (settings.baseUrl) headers['X-LLM-Base-URL'] = settings.baseUrl
  if (settings.openRouterMode) headers['X-LLM-OpenRouter-Mode'] = settings.openRouterMode
  return headers
}

export async function getApiKeyForTest(rememberKey: boolean): Promise<string | undefined> {
  return readApiKey(rememberKey)
}
