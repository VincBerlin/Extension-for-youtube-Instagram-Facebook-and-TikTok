import { Router } from 'express'
import { createClient } from '@supabase/supabase-js'
import { authMiddleware, type AuthRequest } from '../middleware/auth.js'
import { extractWithAI } from '../services/ai.js'
import { fetchYouTubeTranscript, joinCaptionChunks } from '../services/transcription.js'
import type { ExtractRequest } from '../../../shared/types.js'

export const extractRouter = Router()

extractRouter.use(authMiddleware)

// ─── Supabase client (service role — server-side only) ────────────────────────
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// ─── Guest rate limiting (persistent via Supabase) ────────────────────────────
const GUEST_LIMIT = 3
const GUEST_WINDOW_HOURS = 24

function getClientIp(req: AuthRequest): string {
  const forwarded = req.headers['x-forwarded-for']
  return (Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(',')[0]) ?? req.socket.remoteAddress ?? 'unknown'
}

async function checkAndRecordGuestExtraction(ip: string): Promise<{ allowed: boolean; remaining: number }> {
  const windowStart = new Date(Date.now() - GUEST_WINDOW_HOURS * 60 * 60 * 1000).toISOString()

  const { count } = await supabase
    .from('guest_extractions')
    .select('*', { count: 'exact', head: true })
    .eq('ip', ip)
    .gte('extracted_at', windowStart)

  const used = count ?? 0

  if (used >= GUEST_LIMIT) {
    return { allowed: false, remaining: 0 }
  }

  await supabase.from('guest_extractions').insert({ ip })
  return { allowed: true, remaining: GUEST_LIMIT - used - 1 }
}

extractRouter.post('/', async (req: AuthRequest, res) => {
  const body = req.body as ExtractRequest

  if (!body.url || !body.platform || !body.mode || !body.strategy) {
    return res.status(400).json({ error: 'Missing required fields' })
  }

  // Gate: enforce guest limit
  if (!req.userId) {
    const ip = getClientIp(req)
    const { allowed, remaining } = await checkAndRecordGuestExtraction(ip)
    if (!allowed) {
      return res.status(429).json({
        error: 'Guest limit reached',
        message: `Free extractions used up. Sign in to continue.`,
        limit: GUEST_LIMIT,
      })
    }
    console.log(`[extract] Guest extraction from ${ip} — ${remaining} remaining today`)
  }

  // Gate: enforce plan limits for authenticated free-tier users
  // Pro users have unlimited extractions
  if (req.userId && req.userPlan === 'free') {
    const FREE_DAILY_LIMIT = 10
    const windowStart = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    const { count } = await supabase
      .from('user_extractions')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', req.userId)
      .gte('extracted_at', windowStart)
    if ((count ?? 0) >= FREE_DAILY_LIMIT) {
      return res.status(429).json({
        error: 'Daily limit reached',
        message: `Free plan allows ${FREE_DAILY_LIMIT} extractions per day. Upgrade to Pro for unlimited access.`,
        plan: 'free',
        limit: FREE_DAILY_LIMIT,
      })
    }
  }

  let text: string

  if (body.strategy === 'instant') {
    // Try server-side transcript fetch first
    if (body.platform === 'youtube') {
      const videoId = extractYouTubeId(body.url)
      if (videoId) {
        const result = await fetchYouTubeTranscript(videoId)
        if (result) {
          text = result.text
        } else {
          // Fall back to transcript provided by content script
          text = body.transcript ?? body.metadata?.description ?? ''
        }
      } else {
        text = body.transcript ?? ''
      }
    } else {
      text = body.transcript ?? ''
    }
  } else {
    // Live: use accumulated caption chunks
    if (!body.captionChunks?.length) {
      return res.status(400).json({ error: 'No caption chunks provided for live extraction' })
    }
    const joined = joinCaptionChunks(body.captionChunks)
    text = joined.text
  }

  if (!text.trim()) {
    return res.status(422).json({ error: 'No extractable content found' })
  }

  const result = await extractWithAI({
    text,
    mode: body.mode,
    platform: body.platform,
    title: body.metadata?.title,
  })

  // Record extraction for authenticated users (async, non-blocking)
  if (req.userId) {
    supabase.from('user_extractions').insert({ user_id: req.userId }).then(() => {})
  }

  res.json(result)
})

function extractYouTubeId(url: string): string | null {
  try {
    const u = new URL(url)
    return u.searchParams.get('v') ?? u.pathname.split('/').pop() ?? null
  } catch {
    return null
  }
}
