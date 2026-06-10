import { describe, expect, it } from 'vitest'
import { needsKeyReentry } from './llmSettings'

describe('needsKeyReentry', () => {
  it('flags a configured BYOK provider whose key is gone', () => {
    expect(needsKeyReentry({ configured: true, provider: 'gemini' }, false)).toBe(true)
    expect(needsKeyReentry({ configured: true, provider: 'openrouter' }, false)).toBe(true)
  })

  it('does not flag when the key is present', () => {
    expect(needsKeyReentry({ configured: true, provider: 'gemini' }, true)).toBe(false)
  })

  it('does not flag unconfigured settings', () => {
    expect(needsKeyReentry({ configured: false, provider: 'gemini' }, false)).toBe(false)
  })

  it('does not flag server-default (no user key involved)', () => {
    expect(needsKeyReentry({ configured: true, provider: 'server-default' }, false)).toBe(false)
  })
})
