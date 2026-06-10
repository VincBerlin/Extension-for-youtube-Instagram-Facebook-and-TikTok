import { describe, expect, it } from 'vitest'
import { isLlmSettingsChange } from './llmSettingsSync'

describe('isLlmSettingsChange', () => {
  it('detects a change to llm_settings in local storage', () => {
    expect(
      isLlmSettingsChange({ llm_settings: { newValue: { configured: true } } }, 'local'),
    ).toBe(true)
  })

  it('detects removal of llm_settings (newValue undefined)', () => {
    expect(
      isLlmSettingsChange({ llm_settings: { oldValue: { configured: true } } }, 'local'),
    ).toBe(true)
  })

  it('ignores changes in other storage areas', () => {
    expect(
      isLlmSettingsChange({ llm_settings: { newValue: {} } }, 'session'),
    ).toBe(false)
    expect(
      isLlmSettingsChange({ llm_settings: { newValue: {} } }, 'sync'),
    ).toBe(false)
  })

  it('ignores unrelated keys', () => {
    expect(isLlmSettingsChange({ supabase_token: { newValue: 'x' } }, 'local')).toBe(false)
    expect(isLlmSettingsChange({}, 'local')).toBe(false)
  })

  it('never reacts to the secret key itself', () => {
    // The secret lives under its own key; reacting to it would cause redundant
    // refresh round-trips (the public settings change in the same transaction).
    expect(isLlmSettingsChange({ llm_api_key: { newValue: 'sk-x' } }, 'local')).toBe(false)
  })
})
