---
id: FS-landing-page
title: Marketing landing page
status: Future Scope (not implemented)
priority: Low
owner: tbd
created: 2026-05-04
---

# FS-landing-page — Marketing landing page

## Status

**Future scope.** No code, no schema, no routes shipped. This note exists only
so the idea is captured and traceable for later planning.

## Summary

A standalone marketing site at the user-facing domain (e.g. the value
referenced by the server's `APP_URL` env var) that explains what the extension
does, links to the Chrome Web Store listing, and hosts the privacy policy,
terms of service and pricing page Stripe checkout sends users to.

## Why future scope

- The product currently ships exclusively as a Chrome extension. Users discover
  the extension via the Chrome Web Store; no marketing surface is needed to
  acquire users today.
- `APP_URL` is already used by `/stripe/checkout` for `success_url` and
  `cancel_url`. A static placeholder (or a single `/billing/success` page) is
  enough until paid signups justify a richer site.
- Building the site has zero runtime dependency on the extension or server
  beyond reading `APP_URL`, so it can be added independently when needed.

## Scope sketch (when revisited)

When this is picked up, the working assumptions are:

- **Stack**: a static-site generator (Next.js / Astro / Vite-React), deployed
  on Vercel or Cloudflare Pages. No DB, no auth — purely static content + a
  link to the Chrome Web Store and a Stripe-hosted pricing/checkout flow.
- **Pages**: `/` (hero + features), `/pricing` (Free vs Pro), `/privacy`,
  `/terms`, `/billing/success`, `/billing/cancel`, `/contact`.
- **Auth**: none required. All authenticated UX stays inside the extension.
- **Analytics**: privacy-first only (e.g. Plausible). No tracking pixels.

## What is *not* in scope

- A web app version of the extractor. The product is the extension; the
  landing page is marketing only.
- User dashboards, library access, or subscription management on the web. The
  extension's profile screen and Stripe's customer portal cover those needs.
- Any change to the extension itself or the server API.

## Triggers to revisit

Pick this back up when **any** of the following is true:

1. Paid signups exceed ~50 / month and a richer pricing/checkout page would
   measurably reduce drop-off.
2. The Chrome Web Store reviewer requires a hosted privacy policy URL beyond
   the current placeholder.
3. SEO acquisition becomes part of the growth plan.

Until then this remains documentation only.
