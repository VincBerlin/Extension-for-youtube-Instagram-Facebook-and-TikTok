import { describe, expect, it } from 'vitest'
import { BG_MESSAGES, resolveBgMessage } from './bgMessages'

describe('background message table', () => {
  it('en and de cover the identical key set with non-empty strings', () => {
    const enKeys = Object.keys(BG_MESSAGES.en).sort()
    const deKeys = Object.keys(BG_MESSAGES.de).sort()
    expect(deKeys).toEqual(enKeys)
    for (const lang of ['en', 'de'] as const) {
      for (const [key, value] of Object.entries(BG_MESSAGES[lang])) {
        expect(value.length, `${lang}.${key}`).toBeGreaterThan(0)
      }
    }
  })

  it('resolves de when the stored language is de', () => {
    expect(resolveBgMessage('analyzingContent', 'de')).toBe('Analysiere Inhalt…')
  })

  it('falls back to en for unknown/missing language values', () => {
    expect(resolveBgMessage('analyzingContent', undefined)).toBe('Analyzing content…')
    expect(resolveBgMessage('analyzingContent', 'fr')).toBe('Analyzing content…')
  })
})
