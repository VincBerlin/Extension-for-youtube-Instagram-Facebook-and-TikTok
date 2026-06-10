import { useCallback, useEffect, useState } from 'react'
import type { LlmProvider, LlmSettingsPublic, OpenRouterMode } from '@shared/types'
import { isLlmSettingsChange } from './llmSettingsSync'

export interface TestProviderInput {
  provider: LlmProvider
  apiKey: string
  model?: string
  baseUrl?: string
  openRouterMode?: OpenRouterMode
}

export interface TestProviderResult {
  ok: boolean
  provider?: LlmProvider
  model?: string
  mode?: OpenRouterMode
  code?: string
  message?: string
}

export interface FreeModelsResult {
  ok: boolean
  models?: Array<{ id: string; context_length?: number; supportsStructuredOutput?: boolean }>
  error?: string
}

function send<T>(message: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendMessage(message, (response: T) => {
        const err = chrome.runtime.lastError
        if (err) {
          reject(new Error(err.message ?? 'sendMessage failed'))
          return
        }
        resolve(response)
      })
    } catch (err) {
      reject(err)
    }
  })
}

export function useLlmSettings() {
  const [settings, setSettings] = useState<LlmSettingsPublic | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    const result = await send<LlmSettingsPublic | null>({ type: 'GET_LLM_SETTINGS' })
    setSettings(result)
    setLoading(false)
    return result
  }, [])

  useEffect(() => {
    refresh().catch(() => setLoading(false))
  }, [refresh])

  // Keep ALL hook instances in sync: the modal and App each own one, and a
  // save in the modal must be visible to App immediately — otherwise App's
  // stale `configured: false` re-opens the setup modal on the next Extract.
  useEffect(() => {
    const listener = (
      changes: { [key: string]: chrome.storage.StorageChange },
      areaName: string,
    ) => {
      if (isLlmSettingsChange(changes, areaName)) {
        refresh().catch(() => { /* next manual refresh recovers */ })
      }
    }
    chrome.storage.onChanged.addListener(listener)
    return () => chrome.storage.onChanged.removeListener(listener)
  }, [refresh])

  const save = useCallback(
    async (next: LlmSettingsPublic, apiKey?: string) => {
      const result = await send<{ ok: boolean; error?: string }>({
        type: 'SAVE_LLM_SETTINGS',
        settings: next,
        apiKey,
      })
      if (result?.ok) {
        setSettings(next)
      }
      return result
    },
    [],
  )

  const remove = useCallback(async () => {
    const result = await send<{ ok: boolean; error?: string }>({ type: 'DELETE_LLM_SETTINGS' })
    if (result?.ok) setSettings(null)
    return result
  }, [])

  const test = useCallback(async (input: TestProviderInput): Promise<TestProviderResult> => {
    const payload: Record<string, unknown> = {
      provider: input.provider,
      apiKey: input.apiKey,
    }
    if (input.model) payload.model = input.model
    if (input.baseUrl) payload.baseUrl = input.baseUrl
    if (input.openRouterMode) payload.openRouterMode = input.openRouterMode
    return send<TestProviderResult>({ type: 'TEST_LLM_PROVIDER', payload })
  }, [])

  const refreshFreeModels = useCallback(async (apiKey?: string): Promise<FreeModelsResult> => {
    return send<FreeModelsResult>({ type: 'REFRESH_OPENROUTER_FREE_MODELS', apiKey })
  }, [])

  return { settings, loading, refresh, save, remove, test, refreshFreeModels }
}
