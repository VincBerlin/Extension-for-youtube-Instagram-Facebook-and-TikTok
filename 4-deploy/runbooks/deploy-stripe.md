# Runbook: Stripe + Chrome Web Store (Phase 5)

## Prerequisites

- Render deployment live (see `deploy-render.md`)
- Stripe account (stripe.com)
- Chrome Developer account (developer.chrome.com/webstore)

---

## 1. Stripe Setup

### Create Product and Price

1. Stripe Dashboard → **Products** → **Add product**
   - Name: `Extract Pro`
   - Pricing: Recurring, e.g. $9/month
   - Copy the **Price ID** (starts with `price_`)

### Set Environment Variables on Render

Add to your Render service:

| Variable | Value |
|----------|-------|
| `STRIPE_SECRET_KEY` | `sk_live_...` (use `sk_test_...` for testing) |
| `STRIPE_PRO_PRICE_ID` | `price_...` |
| `APP_URL` | `https://your-service.onrender.com` |

### Create Webhook

1. Stripe Dashboard → **Developers** → **Webhooks** → **Add endpoint**
2. URL: `https://your-service.onrender.com/stripe/webhook`
3. Events to listen for:
   - `checkout.session.completed`
   - `customer.subscription.deleted`
4. Copy **Signing Secret** (`whsec_...`) → add as `STRIPE_WEBHOOK_SECRET` on Render

---

## 2. Test Stripe Flow

1. Use Stripe test mode (`sk_test_...` key)
2. Trigger upgrade from extension (hit daily limit → click "Upgrade to Pro")
3. Use test card: `4242 4242 4242 4242`, any expiry, any CVC
4. After checkout: check Supabase `profiles` table — `plan` should be `pro`
5. Verify: user can now extract beyond daily limit

---

## 3. Chrome Web Store Submission

### Required Assets

- [ ] **Icons**: 128x128 PNG (already in `extension/public/icon128.png`)
- [ ] **Screenshots**: 1280x800 or 640x400, showing the extension in action (min 1, max 5)
- [ ] **Promotional tile**: 440x280 PNG (optional but recommended)
- [ ] **Privacy Policy**: hosted URL (required)

### Privacy Policy Template

Host a simple privacy policy page that includes:
- What data is collected (URL, video transcript — sent to your server)
- No data sold to third parties
- Supabase handles auth data
- Contact email for data requests

### Submission Steps

1. Go to Chrome Web Store Developer Dashboard
2. **Add new item** → upload `resource-extractor-extension.zip` (from `deploy-render.md` step 5)
3. Fill in:
   - **Name**: Extract (or your chosen name)
   - **Short description** (132 chars max): "Turn YouTube videos into structured bullet-point knowledge packs. Instant extraction from transcripts or live captions."
   - **Detailed description**: explain all 6 extraction modes
   - **Category**: Productivity
   - **Privacy practices**: declare permissions (tabs, storage, sidePanel, host permissions)
4. Upload screenshots and icons
5. Submit for review (typically 1–7 days)

---

## 4. Post-Launch Checklist

- [ ] Stripe live mode keys set (replace test keys)
- [ ] Webhook verified in Stripe Dashboard (green checkmark)
- [ ] Extension version submitted to Chrome Web Store
- [ ] Smoke test: full extraction → save → library view
- [ ] Smoke test: guest limit → sign in → extract → upgrade prompt
- [ ] Monitor server logs on Render for errors
