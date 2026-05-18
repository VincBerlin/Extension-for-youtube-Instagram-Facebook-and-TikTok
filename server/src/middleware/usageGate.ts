// Usage Gate. Every AI-burning request goes through this before we call the
// LLM. Limits live in this file (not the route) so the rules are visible in
// one place and changes don't ripple.
//
// Tier table:
//   Guest (no JWT)            — 3 extractions / 24h, keyed by IP.
//   Free user                 — 10 / 24h, keyed by userId.
//   Pro user                  — 200 / 24h, keyed by userId. Even Pro has an
//                               abuse cap so a leaked token can't bankrupt us.
//   BYOK (user-supplied key)  — 500 / 24h, keyed by userId. No central provider
//                               cost, but a stolen extension session could
//                               still spam our infra → keep an abuse limit.
//
// Each accepted request is recorded so the next call can count it. The two
// tables (`guest_extractions`, `user_extractions`) are defined in migration
// 002 and accessed via the service-role client only.
//
// Throws `UsageGateError` with `.status = 429` on limit exceeded — the route
// catches it and returns a structured JSON error. Throwing keeps the gate from
// being silently bypassed if a future caller forgets to check a return value.

import { createClient } from '@supabase/supabase-js'
import type { AuthRequest } from './auth.js'
import { requireEnv } from '../config/env.js'

const supabase = createClient(
  requireEnv('SUPABASE_URL'),
  requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
)

export class UsageGateError extends Error {
  status: number
  retryAfterSeconds: number
  constructor(message: string, retryAfterSeconds: number) {
    super(message)
    this.name = 'UsageGateError'
    this.status = 429
    this.retryAfterSeconds = retryAfterSeconds
  }
}

const DAY_MS = 24 * 60 * 60 * 1000

const LIMITS = {
  guest: 3,
  free: 10,
  pro: 200,
  byok: 500,
} as const

interface UsageGateInput {
  platform?: string
  strategy?: string
  estimatedInputChars?: number
  byok?: boolean
}

export async function enforceUsageGate(req: AuthRequest, input: UsageGateInput): Promise<void> {
  // Allow test environments to opt out so unit/integration suites don't have
  // to mock Supabase. Production deploys must NEVER set this.
  if (process.env.NODE_ENV === 'test' && process.env.DISABLE_USAGE_GATE === '1') {
    return
  }

  const since = new Date(Date.now() - DAY_MS).toISOString()

  if (!req.userId) {
    // Guest: rate-limit by IP. Express resolves `req.ip` from the first
    // X-Forwarded-For hop when `trust proxy` is set on the server — we don't
    // set it here, so this is the connecting peer. Good enough for an abuse
    // floor; tightening to forwarded IPs is a deploy-time decision.
    const ip = (req.ip ?? req.socket?.remoteAddress ?? 'unknown').toString()
    const { count, error } = await supabase
      .from('guest_extractions')
      .select('ip', { count: 'exact', head: true })
      .eq('ip', ip)
      .gte('extracted_at', since)
    if (error) {
      console.warn('[usageGate] guest count failed, failing open:', error.message)
      return
    }
    if ((count ?? 0) >= LIMITS.guest) {
      throw new UsageGateError(
        `Guest daily limit reached (${LIMITS.guest}/day). Sign in for a higher limit.`,
        DAY_MS / 1000,
      )
    }
    const { error: insertErr } = await supabase.from('guest_extractions').insert({ ip })
    if (insertErr) console.warn('[usageGate] guest insert failed:', insertErr.message)
    return
  }

  // Authenticated user. BYOK gets its own (higher) ceiling because they pay
  // for the provider — but we still cap it as an abuse signal.
  const limit = input.byok
    ? LIMITS.byok
    : req.userPlan === 'pro'
      ? LIMITS.pro
      : LIMITS.free

  const { count, error } = await supabase
    .from('user_extractions')
    .select('user_id', { count: 'exact', head: true })
    .eq('user_id', req.userId)
    .gte('extracted_at', since)
  if (error) {
    console.warn('[usageGate] user count failed, failing open:', error.message)
    return
  }
  if ((count ?? 0) >= limit) {
    const tierLabel = input.byok ? 'BYOK' : (req.userPlan === 'pro' ? 'Pro' : 'Free')
    throw new UsageGateError(
      `${tierLabel} daily limit reached (${limit}/day). Try again tomorrow.`,
      DAY_MS / 1000,
    )
  }
  const { error: insertErr } = await supabase
    .from('user_extractions')
    .insert({ user_id: req.userId })
  if (insertErr) console.warn('[usageGate] user insert failed:', insertErr.message)
}
