import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { ExtractRequest } from '../../../shared/types.js'

process.env.SUPABASE_URL = process.env.SUPABASE_URL ?? 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? 'test-service-role-key'

async function getResolveExtractionInput() {
  return (await import('./extract.js')).resolveExtractionInput
}

const baseRequest: ExtractRequest = {
  url: 'https://www.tiktok.com/@creator/video/123',
  platform: 'tiktok',
  mode: 'knowledge',
  strategy: 'live',
  extractionScope: 'current_segment',
}

test('resolveExtractionInput: uses captured audio before remote fallback', async () => {
  let downloadCalled = false
  const resolveExtractionInput = await getResolveExtractionInput()
  const result = await resolveExtractionInput(
    { ...baseRequest, audioData: 'captured-audio', audioMimeType: 'audio/webm;codecs=opus' },
    'current_segment',
    async () => {
      downloadCalled = true
      return { base64: 'downloaded-audio', mimeType: 'audio/mp3' }
    },
  )

  assert.equal(downloadCalled, false)
  assert.ok(!('error' in result))
  assert.equal(result.audioData, 'captured-audio')
  assert.equal(result.audioMimeType, 'audio/webm;codecs=opus')
  assert.equal(result.extractionScope, 'current_segment')
})

test('resolveExtractionInput: falls back to server audio download when browser audio is missing', async () => {
  const resolveExtractionInput = await getResolveExtractionInput()
  const result = await resolveExtractionInput(baseRequest, 'current_segment', async (url) => {
    assert.equal(url, baseRequest.url)
    return { base64: 'downloaded-audio', mimeType: 'audio/mp3' }
  })

  assert.ok(!('error' in result))
  assert.equal(result.audioData, 'downloaded-audio')
  assert.equal(result.audioMimeType, 'audio/mp3')
  assert.equal(result.extractionScope, 'full_video')
})

test('resolveExtractionInput: falls back to caption chunks only after remote audio download fails', async () => {
  const resolveExtractionInput = await getResolveExtractionInput()
  const result = await resolveExtractionInput(
    { ...baseRequest, captionChunks: ['first caption', 'first caption', 'second caption'] },
    'current_segment',
    async () => null,
  )

  assert.ok(!('error' in result))
  assert.equal(result.text, 'first caption second caption')
  assert.equal(result.extractionScope, 'current_segment')
})

test('resolveExtractionInput: returns actionable extraction failure when no source is available', async () => {
  const resolveExtractionInput = await getResolveExtractionInput()
  const result = await resolveExtractionInput(baseRequest, 'current_segment', async () => null)

  assert.ok('error' in result)
  assert.equal(result.status, 422)
  assert.match(result.error, /private, geo-blocked, or require a login/)
})


test('resolveExtractionInput: rejects empty caption fallback after dedupe/join', async () => {
  const resolveExtractionInput = await getResolveExtractionInput()
  const result = await resolveExtractionInput(
    { ...baseRequest, captionChunks: ['   ', '   '] },
    'current_segment',
    async () => null,
  )

  assert.ok('error' in result)
  assert.equal(result.status, 422)
  assert.match(result.error, /No extractable caption text/)
})
