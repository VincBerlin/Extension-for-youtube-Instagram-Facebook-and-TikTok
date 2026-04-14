import { Router } from 'express'
import { createClient } from '@supabase/supabase-js'
import { authMiddleware, type AuthRequest } from '../middleware/auth.js'
import { extractWithAI, extractWithAIStream } from '../services/ai.js'
import { fetchYouTubeTranscript, joinCaptionChunks, downloadAudioFromPageUrl } from '../services/transcription.js'
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
      })
      return res.json(result)
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
      })
      return res.json(result)
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
      })
      return res.json(result)
    }

    return res.status(422).json({
      error: 'Could not extract content from this video. It may be private, geo-blocked, or require a login.',
    })
  }

  // ── YouTube ───────────────────────────────────────────────────────────────
  let text: string

  if (body.strategy === 'instant') {
    const videoId = extractYouTubeId(body.url)
    if (videoId) {
      const result = await fetchYouTubeTranscript(videoId)
      text = result ? result.text : (body.transcript ?? body.metadata?.description ?? '')
    } else {
      text = body.transcript ?? ''
    }
  } else {
    if (!body.captionChunks?.length) {
      return res.status(400).json({ error: 'No captions captured. Enable subtitles on the video and let it play, then pause.' })
    }
    text = joinCaptionChunks(body.captionChunks).text
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
  })

  res.json(result)
})

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
      if (body.strategy === 'instant') {
        const videoId = extractYouTubeId(body.url)
        if (videoId) {
          const result = await fetchYouTubeTranscript(videoId)
          text = result ? result.text : (body.transcript ?? body.metadata?.description ?? '')
        } else {
          text = body.transcript ?? ''
        }
      } else {
        text = body.captionChunks?.length ? joinCaptionChunks(body.captionChunks).text : ''
      }
      if (!text.trim()) {
        send('error', { message: 'No extractable content found for this video.' })
        return res.end()
      }
    }

    const result = await extractWithAIStream(
      {
        text: text || undefined,
        audioData,
        audioMimeType,
        mode: body.mode,
        platform: body.platform,
        title: body.metadata?.title,
        sessionContext: body.sessionContext,
      },
      (chunk) => send('chunk', { text: chunk }),
    )

    send('done', {
      data: {
        title: result.title,
        summary: result.summary,
        key_takeaways: result.bullets,
        important_links: result.links,
      },
    })

  } catch (err) {
    send('error', { message: err instanceof Error ? err.message : 'Extraction failed' })
  }

  res.end()
})

function extractYouTubeId(url: string): string | null {
  try {
    const u = new URL(url)
    return u.searchParams.get('v') ?? u.pathname.split('/').pop() ?? null
  } catch {
    return null
  }
}
