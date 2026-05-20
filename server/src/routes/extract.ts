import { Router } from 'express'
import { authMiddleware, type AuthRequest } from '../middleware/auth.js'
import { enforceUsageGate, UsageGateError } from '../middleware/usageGate.js'
import { parseRuntimeLlmConfig } from '../middleware/llmRuntime.js'
import { extractWithAI, extractWithAIStream, type ExtractOutput } from '../services/ai.js'
import { fetchYouTubeTranscript, joinCaptionChunks, downloadAudioFromPageUrl } from '../services/transcription.js'
import { validateResources } from '../services/urlValidator.js'
import { extractYouTubeId } from '../utils/youtube.js'
import type { AttachedLink, ExtractionPackV2, ExtractionScope, ExtractRequest, Resource } from '../../../shared/types.js'

export const extractRouter = Router()

extractRouter.use(authMiddleware)


function hasNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function hasRequiredExtractFields(body: ExtractRequest): boolean {
  return hasNonEmptyString(body.url)
    && hasNonEmptyString(body.platform)
    && hasNonEmptyString(body.mode)
    && hasNonEmptyString(body.strategy)
}


extractRouter.post('/', async (req: AuthRequest, res) => {
  const body = req.body as ExtractRequest
  console.log('[EXTRACT-DEBUG] server/extract: POST / | platform:', body.platform, '| mode:', body.mode, '| strategy:', body.strategy, '| transcriptLen:', body.transcript?.length ?? 0, '| hasAudio:', !!body.audioData, '| url:', body.url)

  if (!hasRequiredExtractFields(body)) {
    console.warn('[EXTRACT-DEBUG] server/extract: 400 — missing required fields')
    return res.status(400).json({ error: 'Missing required fields' })
  }

  const runtimeLlm = parseRuntimeLlmConfig(req)

  try {
    await enforceUsageGate(req, {
      platform: body.platform,
      strategy: body.strategy,
      estimatedInputChars: body.transcript?.length ?? 0,
      byok: Boolean(runtimeLlm?.apiKey),
    })
  } catch (err) {
    if (err instanceof UsageGateError) {
      res.setHeader('Retry-After', String(err.retryAfterSeconds))
      return res.status(err.status).json({ error: err.message })
    }
    throw err
  }

  // Default scope when client omits it: YouTube → full_video, live → current_segment
  const scope = body.extractionScope ?? (body.platform === 'youtube' ? 'full_video' : 'current_segment')

  const content = await resolveExtractionInput(body, scope)
  if ('error' in content) {
    return res.status(content.status).json({ error: content.error })
  }

  const result = await extractWithAI(
    {
      text: content.text,
      audioData: content.audioData,
      audioMimeType: content.audioMimeType,
      mode: body.mode,
      platform: body.platform,
      title: body.metadata?.title,
      sessionContext: body.sessionContext,
      extractionScope: content.extractionScope,
      youtubeSource: body.youtubeSource,
      extractionLanguage: body.extractionLanguage,
    },
    runtimeLlm,
  )

  res.json(await withValidatedResources(result))
})


type DownloadAudio = typeof downloadAudioFromPageUrl

type ExtractionInputResolution =
  | {
      text?: string
      audioData?: string
      audioMimeType?: string
      extractionScope: ExtractionScope
    }
  | {
      error: string
      status: number
    }

/**
 * Single extraction-content resolver shared by JSON and streaming routes.
 * Keeping platform fallback order in one place prevents endpoint-specific drift
 * (for example, the streaming route forgetting the server-side yt-dlp fallback).
 */
export async function resolveExtractionInput(
  body: ExtractRequest,
  defaultScope: ExtractionScope,
  downloadAudio: DownloadAudio = downloadAudioFromPageUrl,
): Promise<ExtractionInputResolution> {
  if (body.platform === 'youtube') {
    const text = await resolveYouTubeText(body)
    if (text === null) {
      return {
        status: 400,
        error: 'No captions captured. Enable subtitles on the video and let it play, then pause.',
      }
    }
    if (!text.trim()) {
      return { status: 422, error: 'No extractable content found for this video.' }
    }
    return { text, extractionScope: defaultScope }
  }

  // Tier 1: tab-captured audio blob (fast — available when tabCapture worked).
  if (body.audioData) {
    console.log(`[extract] tier-1 tabCapture audio for ${body.platform}`)
    return {
      audioData: body.audioData,
      audioMimeType: body.audioMimeType,
      extractionScope: defaultScope,
    }
  }

  // Tier 2: server-side download. This is the authoritative fallback for public
  // TikTok/Instagram/Facebook URLs when browser audio capture is unavailable.
  console.log(`[extract] tier-2 yt-dlp for ${body.platform}: ${body.url}`)
  const downloaded = await downloadAudio(body.url, body.platform)
  if (downloaded) {
    return {
      audioData: downloaded.base64,
      audioMimeType: downloaded.mimeType,
      // yt-dlp downloads the whole public video, so the analysis is full-video.
      extractionScope: 'full_video',
    }
  }

  // Tier 3: caption chunks (legacy / last resort).
  if (body.captionChunks?.length) {
    console.log(`[extract] tier-3 captions for ${body.platform}`)
    const captionText = joinCaptionChunks(body.captionChunks).text
    if (!captionText.trim()) {
      return { status: 422, error: 'No extractable caption text found for this video.' }
    }
    return {
      text: captionText,
      extractionScope: defaultScope,
    }
  }

  return {
    status: 422,
    error: 'Could not extract content from this video. It may be private, geo-blocked, or require a login.',
  }
}

/**
 * Run the URL liveness check on the resources returned by the LLM and return
 * a copy of `result` with the validated resources merged into `result.v2`.
 * Best-effort: a validator failure leaves the resources untouched.
 */
async function withValidatedResources(result: ExtractOutput): Promise<ExtractOutput> {
  if (!result.v2?.resources?.length) return result
  try {
    const validated = await validateResources(result.v2.resources)
    const propagated = propagateValidationToAttached(result.v2, validated)
    return { ...result, v2: propagated }
  } catch (err) {
    console.warn('[extract] URL validation failed, leaving resources unchecked:', (err as Error).message)
    return result
  }
}

/**
 * After validation, copy each resource's validation/final_url onto every
 * AttachedLink that references the same URL — both inside key_takeaway_links
 * and inside sections[].related_links. Also update unassigned_resources by
 * URL so the fallback list shows the same status.
 */
export function propagateValidationToAttached(v2: ExtractionPackV2, validated: Resource[]): ExtractionPackV2 {
  const byUrl = new Map<string, Resource>()
  for (const r of validated) byUrl.set(r.url, r)

  const updateAttached = (l: AttachedLink): AttachedLink => {
    const r = byUrl.get(l.url)
    if (!r) return l
    return r.validation ? { ...l, url_status: r.validation } : l
  }

  const key_takeaway_links = v2.key_takeaway_links?.map((arr) => arr.map(updateAttached))

  const sections = v2.sections.map((s) =>
    s.related_links ? { ...s, related_links: s.related_links.map(updateAttached) } : s,
  )

  const unassigned_resources = v2.unassigned_resources
    ? v2.unassigned_resources.map((r) => byUrl.get(r.url) ?? r)
    : v2.unassigned_resources

  return {
    ...v2,
    resources: validated,
    ...(key_takeaway_links ? { key_takeaway_links } : {}),
    sections,
    ...(unassigned_resources ? { unassigned_resources } : {}),
  }
}

// Resolve YouTube transcript text. Prefers the client-provided transcript when present
// (avoids a redundant youtube-transcript fetch — the extension already pre-fetches it
// via /transcribe/youtube and via in-page caption tracks). Falls back to a server-side
// fetch only when the client could not provide one.
// Returns null when strategy is 'live' but no captionChunks are provided (HTTP 400).
async function resolveYouTubeText(body: ExtractRequest): Promise<string | null> {
  if (body.strategy === 'live') {
    if (!body.captionChunks?.length) return null
    return joinCaptionChunks(body.captionChunks).text
  }

  if (body.transcript && body.transcript.trim().length > 30) {
    return body.transcript
  }

  const videoId = extractYouTubeId(body.url)
  if (videoId) {
    const result = await fetchYouTubeTranscript(videoId)
    if (result?.text) return result.text
  }
  return body.transcript ?? body.metadata?.description ?? ''
}

// ─── Streaming extraction (SSE) ───────────────────────────────────────────────

extractRouter.post('/stream', async (req: AuthRequest, res) => {
  const body = req.body as ExtractRequest
  console.log('[EXTRACT-DEBUG] server/extract: POST /stream | platform:', body.platform, '| mode:', body.mode, '| strategy:', body.strategy, '| transcriptLen:', body.transcript?.length ?? 0, '| hasAudio:', !!body.audioData, '| url:', body.url)

  if (!hasRequiredExtractFields(body)) {
    console.warn('[EXTRACT-DEBUG] server/extract: /stream 400 — missing required fields')
    return res.status(400).json({ error: 'Missing required fields' })
  }

  const runtimeLlm = parseRuntimeLlmConfig(req)

  // Run the usage gate BEFORE we open the SSE stream so a rejection comes back
  // as a plain JSON 429 (clients use a fetch-based wrapper that surfaces 429
  // cleanly; once we flush SSE headers the response is committed and JSON
  // status codes can't be set).
  try {
    await enforceUsageGate(req, {
      platform: body.platform,
      strategy: body.strategy,
      estimatedInputChars: body.transcript?.length ?? 0,
      byok: Boolean(runtimeLlm?.apiKey),
    })
  } catch (err) {
    if (err instanceof UsageGateError) {
      res.setHeader('Retry-After', String(err.retryAfterSeconds))
      return res.status(err.status).json({ error: err.message })
    }
    throw err
  }

  // Prepare SSE headers
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()

  const send = (type: string, payload: Record<string, unknown>) => {
    console.log('[EXTRACT-DEBUG] server/extract: SSE send |', type, '|', Object.keys(payload).join(','))
    res.write(`data: ${JSON.stringify({ type, ...payload })}\n\n`)
  }

  try {
    // Default scope when client omits it: YouTube → full_video, live → current_segment
    const scope = body.extractionScope ?? (body.platform === 'youtube' ? 'full_video' : 'current_segment')

    const content = await resolveExtractionInput(body, scope)
    if ('error' in content) {
      send('error', { message: content.error })
      return res.end()
    }

    const text = content.text ?? ''
    const audioData = content.audioData
    const audioMimeType = content.audioMimeType


    console.log('[EXTRACT-DEBUG] server/extract: calling extractWithAIStream | textLen:', text.length, '| hasAudio:', !!audioData, '| scope:', content.extractionScope, '| language:', body.extractionLanguage ?? 'auto', '| byok:', Boolean(runtimeLlm?.apiKey))
    const rawResult = await extractWithAIStream(
      {
        text: text || undefined,
        audioData,
        audioMimeType,
        mode: body.mode,
        platform: body.platform,
        title: body.metadata?.title,
        sessionContext: body.sessionContext,
        extractionScope: content.extractionScope,
        youtubeSource: body.youtubeSource,
        extractionLanguage: body.extractionLanguage,
      },
      (chunk) => send('chunk', { text: chunk }),
      runtimeLlm,
    )
    console.log('[EXTRACT-DEBUG] server/extract: extractWithAIStream returned | bullets:', rawResult.bullets?.length ?? 0, '| hasV2:', !!rawResult.v2, '| title:', rawResult.title?.slice(0, 60))

    // Send `done` IMMEDIATELY with the raw result so the side panel can render
    // the full analysis without waiting for HEAD/GET URL liveness checks. Then
    // run validation in parallel and emit a follow-up `validated` event so the
    // UI can update resource statuses without blocking the first paint.
    send('done', {
      data: {
        title: rawResult.title,
        summary: rawResult.summary,
        keywords: rawResult.keywords,
        key_takeaways: rawResult.bullets,
        important_links: rawResult.links,
        quick_facts: rawResult.quick_facts,
        v2: rawResult.v2,
      },
    })

    if (rawResult.v2?.resources?.length) {
      try {
        send('progress', { percent: 95, statusText: 'Verifying links…' })
        const validated = await validateResources(rawResult.v2.resources)
        const propagated = propagateValidationToAttached(rawResult.v2, validated)
        send('validated', {
          resources: validated,
          key_takeaway_links: propagated.key_takeaway_links ?? [],
          sections: propagated.sections,
          unassigned_resources: propagated.unassigned_resources ?? [],
        })
      } catch (err) {
        console.warn('[extract/stream] URL validation failed:', (err as Error).message)
      }
    }

  } catch (err) {
    console.error('[EXTRACT-DEBUG] server/extract: /stream caught error:', err instanceof Error ? err.message : err)
    send('error', { message: err instanceof Error ? err.message : 'Extraction failed' })
  }

  res.end()
})
