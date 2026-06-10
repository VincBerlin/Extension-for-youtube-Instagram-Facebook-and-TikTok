import { describe, expect, it } from 'vitest'
import { normalizePublic } from './llmSettings'

describe('normalizePublic (settings storage round trip)', () => {
  it('round-trips the exact shape saveLlmSettings writes', () => {
    const stored = {
      provider: 'openrouter',
      model: 'openrouter/free',
      baseUrl: undefined,
      openRouterMode: 'free-cascade',
      rememberKey: true,
      configured: true,
      lastTestedAt: '2026-06-10T00:00:00.000Z',
    }
    expect(normalizePublic(stored)).toEqual({
      provider: 'openrouter',
      model: 'openrouter/free',
      baseUrl: undefined,
      openRouterMode: 'free-cascade',
      rememberKey: true,
      configured: true,
      lastTestedAt: '2026-06-10T00:00:00.000Z',
    })
  })

  it('round-trips a minimal configured gemini setup', () => {
    const stored = { provider: 'gemini', rememberKey: false, configured: true }
    const result = normalizePublic(stored)
    expect(result).not.toBeNull()
    expect(result?.provider).toBe('gemini')
    expect(result?.configured).toBe(true)
    expect(result?.rememberKey).toBe(false)
    expect(result?.openRouterMode).toBeUndefined()
  })

  it('rejects unknown providers', () => {
    expect(normalizePublic({ provider: 'evil', configured: true })).toBeNull()
  })

  it('rejects non-object input', () => {
    expect(normalizePublic(null)).toBeNull()
    expect(normalizePublic(undefined)).toBeNull()
    expect(normalizePublic('openai')).toBeNull()
  })

  it('coerces malformed optional fields instead of failing', () => {
    const result = normalizePublic({
      provider: 'openai',
      model: 42,
      baseUrl: {},
      openRouterMode: 'bogus',
      rememberKey: 'yes',
      configured: 1,
    })
    expect(result).toEqual({
      provider: 'openai',
      model: undefined,
      baseUrl: undefined,
      openRouterMode: undefined,
      rememberKey: false,
      configured: false,
      lastTestedAt: undefined,
    })
  })
})
