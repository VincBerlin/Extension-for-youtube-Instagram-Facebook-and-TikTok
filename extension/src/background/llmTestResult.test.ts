import { describe, expect, it } from 'vitest'
import { networkTestError, parseTestResponse } from './llmTestResult'

describe('networkTestError', () => {
  it('names the unreachable server URL', () => {
    const result = networkTestError('https://api.example.com', new TypeError('Failed to fetch'))
    expect(result.ok).toBe(false)
    expect(result.code).toBe('NETWORK')
    expect(result.message).toContain('https://api.example.com')
    expect(result.message).toContain('Failed to fetch')
  })

  it('works without an Error instance', () => {
    const result = networkTestError('http://localhost:3001', 'boom')
    expect(result.code).toBe('NETWORK')
    expect(result.message).toContain('http://localhost:3001')
  })
})

describe('parseTestResponse', () => {
  it('passes valid JSON through untouched', () => {
    expect(parseTestResponse('{"ok":true,"provider":"gemini","model":"gemini-2.5-flash"}')).toEqual({
      ok: true,
      provider: 'gemini',
      model: 'gemini-2.5-flash',
    })
  })

  it('passes structured error JSON through', () => {
    expect(parseTestResponse('{"ok":false,"code":"INVALID_API_KEY","message":"rejected"}')).toEqual({
      ok: false,
      code: 'INVALID_API_KEY',
      message: 'rejected',
    })
  })

  it('maps non-JSON bodies to BAD_RESPONSE with truncation', () => {
    const html = '<html>' + 'x'.repeat(500)
    const result = parseTestResponse(html) as { ok: boolean; code: string; message: string }
    expect(result.ok).toBe(false)
    expect(result.code).toBe('BAD_RESPONSE')
    expect(result.message.length).toBeLessThanOrEqual(200)
  })
})
