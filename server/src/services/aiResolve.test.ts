import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveRuntime, MissingApiKeyError } from './ai.js'

test('resolveRuntime uses BYOK credentials when provided', () => {
  const resolved = resolveRuntime({
    provider: 'openrouter',
    apiKey: 'sk-or-test',
    openRouterMode: 'free-cascade',
  })
  assert.equal(resolved.byok, true)
  assert.equal(resolved.provider, 'openrouter')
  assert.equal(resolved.apiKey, 'sk-or-test')
})

test('resolveRuntime throws MissingApiKeyError when no env key is configured', () => {
  const KEYS = ['GEMINI_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY'] as const
  const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]))
  for (const k of KEYS) delete process.env[k]
  try {
    assert.throws(() => resolveRuntime(null), MissingApiKeyError)
    assert.throws(() => resolveRuntime(null), /no API key configured/i)
  } finally {
    for (const k of KEYS) {
      if (saved[k] !== undefined) process.env[k] = saved[k]
    }
  }
})

test('resolveRuntime falls back to the env key when present', () => {
  const saved = process.env.GEMINI_API_KEY
  process.env.GEMINI_API_KEY = 'env-key'
  try {
    const resolved = resolveRuntime(null)
    assert.equal(resolved.byok, false)
    assert.equal(resolved.apiKey, 'env-key')
  } finally {
    if (saved === undefined) delete process.env.GEMINI_API_KEY
    else process.env.GEMINI_API_KEY = saved
  }
})
