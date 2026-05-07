import { Router } from 'express'
import { createClient } from '@supabase/supabase-js'
import { authMiddleware, type AuthRequest } from '../middleware/auth.js'
import { extractWithAI, extractWithAIStream, type ExtractOutput } from '../services/ai.js'
import { fetchYouTubeTranscript, joinCaptionChunks, downloadAudioFromPageUrl } from '../services/transcription.js'
import { validateResources } from '../services/urlValidator.js'
import { extractYouTubeId } from '../utils/youtube.js'
import type { ExtractRequest } from '../../../shared/types.js'

export const extractRouter = Router()

extractRouter.use(authMiddleware)

// ─── Supabase client (service role — server-side only) ────────────────────────
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)


extractRouter.post('/', async (req: AuthRequest, res) => {
  const body = req.body as ExtractRequest

  if (!body.url || !body.platform || !body.mode || !body.strategy) {
    return res.status(400).json({ error: 'Missing required fields' })
  }

  // NOTE: rate limits disabled for local testing

  // Default scope when client omits it: YouTube → full_video, live → current_segment
  const scope = body.extractionScope ?? (body.platform === 'youtube' ? 'full_video' : 'current_segment')

  // ── Non-YouTube: TikTok / Instagram / Facebook ───────────────────────────
  if (body.platform !== 'youtube') {

    // Tier 1: tab-captured audio blob (fast — available when tabCapture worked)
    if (body.audioData) {
      console.log(`[extract] tier-1 tabCapture audio for ${body.platform}`)
      const result = await extractWithAI({
        audioData: body.audioData,
        audioMimeType: body.audioMimeType,
        mode: body.mode,
        platform: body.platform,
        title: body.metadata?.title,
        sessionContext: body.sessionContext,
        extractionScope: scope,
      })
      return res.json(await withValidatedResources(result))
    }

    // Tier 2: yt-dlp server-side download → Gemini audio analysis
    // Works for all public TikTok, Instagram Reels, and Facebook Reels.
    console.log(`[extract] tier-2 yt-dlp for ${body.platform}: ${body.url}`)
    const downloaded = await downloadAudioFromPageUrl(body.url)
    if (downloaded) {
      const result = await extractWithAI({
        audioData: downloaded.base64,
        audioMimeType: downloaded.mimeType,
        mode: body.mode,
        platform: body.platform,
        title: body.metadata?.title,
        sessionContext: body.sessionContext,
        // yt-dlp gives us the entire video audio, so the analysis covers the full video
        extractionScope: 'full_video',
      })
      return res.json(await withValidatedResources(result))
    }

    // Tier 3: caption chunks (legacy / last resort)
    if (body.captionChunks?.length) {
      console.log(`[extract] tier-3 captions for ${body.platform}`)
      const text = joinCaptionChunks(body.captionChunks).text
      const result = await extractWithAI({
        text,
        mode: body.mode,
        platform: body.platform,
        title: body.metadata?.title,
        sessionContext: body.sessionContext,
        extractionScope: scope,
      })
      return res.json(await withValidatedResources(result))
    }

    return res.status(422).json({
      error: 'Could not extract content from this video. It may be private, geo-blocked, or require a login.',
    })
  }

  // ── YouTube ───────────────────────────────────────────────────────────────
  const text = await resolveYouTubeText(body)
  if (text === null) {
    return res.status(400).json({ error: 'No captions captured. Enable subtitles on the video and let it play, then pause.' })
  }
  if (!text.trim()) {
    return res.status(422).json({ error: 'No extractable content found for this video.' })
  }

  const result = await extractWithAI({
    text,
    mode: body.mode,
    platform: body.platform,
    title: body.metadata?.title,
    sessionContext: body.sessionContext,
    extractionScope: scope,
  })

  res.json(await withValidatedResources(result))
})

/**
 * Run the URL liveness check on the resources returned by the LLM and return
 * a copy of `result` with the validated resources merged into `result.v2`.
 * Best-effort: a validator failure leaves the resources untouched.
 */
async function withValidatedResources(result: ExtractOutput): Promise<ExtractOutput> {
  if (!result.v2?.resources?.length) return result
  try {
    const validated = await validateResources(result.v2.resources)
    return { ...result, v2: { ...result.v2, resources: validated } }
  } catch (err) {
    console.warn('[extract] URL validation failed, leaving resources unchecked:', (err as Error).message)
    return result
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

  if (!body.url || !body.platform || !body.mode || !body.strategy) {
    return res.status(400).json({ error: 'Missing required fields' })
  }

  // NOTE: rate limits disabled for local testing

  // Prepare SSE headers
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()

  const send = (type: string, payload: Record<string, unknown>) => {
    res.write(`data: ${JSON.stringify({ type, ...payload })}\n\n`)
  }

  try {
    // Default scope when client omits it: YouTube → full_video, live → current_segment
    const scope = body.extractionScope ?? (body.platform === 'youtube' ? 'full_video' : 'current_segment')

    // Prepare input content
    let text = ''
    let audioData: string | undefined
    let audioMimeType: string | undefined

    if (body.platform !== 'youtube') {
      if (body.audioData) {
        audioData = body.audioData
        audioMimeType = body.audioMimeType
      } else if (body.captionChunks?.length) {
        text = joinCaptionChunks(body.captionChunks).text
      } else {
        send('error', { message: 'No content available for extraction.' })
        return res.end()
      }
    } else {
      const resolved = await resolveYouTubeText(body)
      if (resolved === null || !resolved.trim()) {
        send('error', { message: 'No extractable content found for this video.' })
        return res.end()
      }
      text = resolved
    }

    const rawResult = await extractWithAIStream(
      {
        text: text || undefined,
        audioData,
        audioMimeType,
        mode: body.mode,
        platform: body.platform,
        title: body.metadata?.title,
        sessionContext: body.sessionContext,
        extractionScope: scope,
      },
      (chunk) => send('chunk', { text: chunk }),
    )

    send('progress', { percent: 90, statusText: 'Verifying links…' })
    const result = await withValidatedResources(rawResult)

    send('done', {
      data: {
        title: result.title,
        summary: result.summary,
        keywords: result.keywords,
        key_takeaways: result.bullets,
        important_links: result.links,
        quick_facts: result.quick_facts,
        v2: result.v2,
      },
    })

  } catch (err) {
    send('error', { message: err instanceof Error ? err.message : 'Extraction failed' })
  }

  res.end()
})
