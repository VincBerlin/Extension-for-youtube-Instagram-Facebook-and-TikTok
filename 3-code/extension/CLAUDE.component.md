# Extension

**Responsibility**: Chrome Extension (MV3) — platform detection, side panel UI, background service worker orchestration, live caption capture.

**Technology**: React 18, TypeScript, Vite, `@crxjs/vite-plugin`, Zustand, `@supabase/supabase-js`

**Source**: [`../../extension/`](../../extension/)

## Interfaces

- **HTTP** → server `/extract` (POST): background worker sends extraction requests with platform, mode, strategy, caption chunks, and Supabase JWT
- **HTTP** → server `/transcribe/youtube` (GET): pre-check transcript availability
- **chrome.runtime.sendMessage** (internal): content scripts → background → side panel
- **chrome.storage.local**: auth token persistence (`supabase_token`)

## Architecture Notes

- `background/index.ts` is the single orchestrator — all server calls and tab state live here
- Side panel never calls `fetch` directly; all server communication goes through `chrome.runtime.sendMessage` → background
- Content scripts are isolated per platform (`youtube.ts`, `tiktok.ts`, `instagram.ts`, `facebook.ts`)
- `tabStates` (in-memory Map in background) is lost on service worker restart — known limitation
- Two separate `onMessage` listeners in background: one for content scripts (sync), one for side panel (async, returns `true`)

## Requirements Addressed

_None linked yet — populate after `/SDLC-elicit` runs._

## Relevant Decisions

_None recorded yet — populate after `/SDLC-design` runs._
