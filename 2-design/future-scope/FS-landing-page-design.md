---
id: FS-landing-page-design
title: Landing page — design notes
status: Future Scope (not implemented)
related: 1-spec/future-scope/FS-landing-page.md
created: 2026-05-04
---

# FS-landing-page-design — Design notes for a future marketing site

> Reference only. No design system, components, or routes have been built.
> See [`1-spec/future-scope/FS-landing-page.md`](../../1-spec/future-scope/FS-landing-page.md)
> for the spec-side rationale and triggers.

## Visual language

Reuse the extension's black-and-white palette from
`extension/src/sidepanel/App.module.css` so the marketing surface matches the
product:

- Background: pure black (`#000`) / pure white (`#fff`) with the same dark/light
  toggle.
- Accent: the existing green (`--success`, `#22C55E`) reserved for the primary
  CTA button — "Add to Chrome".
- Type: Plus Jakarta Sans (already used in `sidepanel/index.html`).

## Information architecture

| Path | Purpose | Notes |
|------|---------|-------|
| `/` | Hero + 3-feature value prop + CTA | Single fold, no carousel. |
| `/pricing` | Free vs Pro table | Stripe-hosted checkout via existing `/stripe/checkout` route. |
| `/privacy` | Privacy policy | Required by Chrome Web Store. |
| `/terms` | Terms of service | Required for paid plan. |
| `/billing/success` | Stripe `success_url` | Already referenced by `APP_URL` env. |
| `/billing/cancel` | Stripe `cancel_url` | Already referenced by `APP_URL` env. |
| `/contact` | Mailto + simple form | No backend needed. |

## Integration points

- **Chrome Web Store**: hard-coded URL on the primary CTA. Once the listing is
  live, replace the placeholder.
- **Stripe**: no new code on the website — checkout is initiated *from the
  extension* via the server. The site only needs to render the post-redirect
  success/cancel pages.
- **Server**: no change required. `APP_URL` already points to wherever this
  site is hosted.
- **Extension**: no change required. The "Sign in" / profile flow stays inside
  the side panel.

## Why no implementation now

- Landing page work is decoupled from the V2 upgrade currently shipping.
- Adding a web frontend would expand the deploy surface (a third hosting
  target alongside the extension and the Render server) for marketing value
  that isn't yet measured.
- The placeholder pages reachable via `APP_URL` are enough to satisfy Stripe
  redirect URLs and Chrome Web Store listing requirements at the current
  scale.

## Open questions for when this is picked up

- SSG vs hybrid (Next.js + ISR for blog posts later)?
- Marketing copy ownership — does the founder write or does this get
  outsourced?
- Whether the privacy policy lives on the site or is hosted via a third-party
  policy generator.

These do not need answers yet — capturing here so the scope is not relitigated
from scratch.
