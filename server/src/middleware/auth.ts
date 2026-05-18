import type { Request, Response, NextFunction } from 'express'
import { createClient } from '@supabase/supabase-js'
import { requireEnv } from '../config/env.js'

const supabase = createClient(
  requireEnv('SUPABASE_URL'),
  requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
)

export interface AuthRequest extends Request {
  userId?: string
  userPlan?: string
}

/**
 * Validates a Supabase JWT from the Authorization header.
 * Attaches userId and userPlan to the request.
 * Allows guest requests through (userId will be undefined).
 */
export async function authMiddleware(req: AuthRequest, res: Response, next: NextFunction) {
  const token = req.headers.authorization?.replace('Bearer ', '')

  if (!token) {
    // Guest — limited access enforced in route handlers
    return next()
  }

  const { data, error } = await supabase.auth.getUser(token)

  if (error || !data.user) {
    return res.status(401).json({ error: 'Invalid token' })
  }

  req.userId = data.user.id

  // Fetch plan from profiles
  const { data: profile } = await supabase
    .from('profiles')
    .select('plan')
    .eq('id', data.user.id)
    .single()

  req.userPlan = profile?.plan ?? 'free'

  next()
}
