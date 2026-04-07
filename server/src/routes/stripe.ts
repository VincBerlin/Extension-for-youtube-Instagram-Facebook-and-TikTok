import { Router, type Request, type Response } from 'express'
// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any
const StripeLib: any = require('stripe')
import { createClient } from '@supabase/supabase-js'
import { authMiddleware, type AuthRequest } from '../middleware/auth.js'

export const stripeRouter = Router()

// Lazy Stripe client — only instantiated when STRIPE_SECRET_KEY is set
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getStripe(): any {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) throw new Error('STRIPE_SECRET_KEY is not configured')
  return new (StripeLib as any)(key, { apiVersion: '2025-03-31.basil' })
}

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const PRO_PRICE_ID = process.env.STRIPE_PRO_PRICE_ID ?? ''

// ─── POST /stripe/checkout ────────────────────────────────────────────────────
// Creates a Stripe Checkout session for Pro plan upgrade.
// Requires authenticated user.

stripeRouter.post('/checkout', authMiddleware, async (req: AuthRequest, res: Response) => {
  if (!req.userId) {
    return res.status(401).json({ error: 'Authentication required to upgrade' })
  }

  if (!PRO_PRICE_ID || !process.env.STRIPE_SECRET_KEY) {
    return res.status(500).json({ error: 'Stripe not configured' })
  }

  const session = await getStripe().checkout.sessions.create({
    mode: 'subscription',
    line_items: [{ price: PRO_PRICE_ID, quantity: 1 }],
    success_url: `${process.env.APP_URL ?? 'https://your-app.com'}/upgrade-success`,
    cancel_url: `${process.env.APP_URL ?? 'https://your-app.com'}/upgrade-cancel`,
    client_reference_id: req.userId,
    metadata: { user_id: req.userId },
  })

  res.json({ url: session.url })
})

// ─── POST /stripe/webhook ─────────────────────────────────────────────────────
// Receives Stripe events and updates profiles.plan.
// Stripe sends raw body — must be registered BEFORE express.json() middleware.

stripeRouter.post(
  '/webhook',
  // Note: express.raw() is applied in index.ts for this route only
  async (req: Request, res: Response) => {
    const sig = req.headers['stripe-signature'] as string
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET ?? ''

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let event: any

    if (!process.env.STRIPE_SECRET_KEY) {
      return res.status(500).json({ error: 'Stripe not configured' })
    }

    try {
      event = getStripe().webhooks.constructEvent(req.body, sig, webhookSecret)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Webhook signature verification failed'
      console.error(`[stripe] Webhook error: ${message}`)
      return res.status(400).json({ error: message })
    }

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object
        const userId = session.metadata?.user_id ?? session.client_reference_id
        if (userId) {
          await supabase.from('profiles').update({ plan: 'pro' }).eq('id', userId)
          console.log(`[stripe] Upgraded user ${userId} to pro`)
        }
        break
      }

      case 'customer.subscription.deleted': {
        // Subscription cancelled — downgrade to free
        const subscription = event.data.object
        const customerId = subscription.customer as string
        // Look up user by Stripe customer ID stored in metadata
        const { data: profile } = await supabase
          .from('profiles')
          .select('id')
          .eq('stripe_customer_id', customerId)
          .single()
        if (profile) {
          await supabase.from('profiles').update({ plan: 'free' }).eq('id', profile.id)
          console.log(`[stripe] Downgraded customer ${customerId} to free`)
        }
        break
      }
    }

    res.json({ received: true })
  }
)
