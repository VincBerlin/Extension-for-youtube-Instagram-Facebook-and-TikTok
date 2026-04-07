# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A pro-level media intelligence Chrome Extension that turns videos and short-form media into action-ready, structured outputs stored in a reusable personal library. Extracts only high-signal content: tips, techniques, tools, resources, decision criteria.

**Not** a generic summarizer — a precision extraction tool.

### Current State

The project is in the **Code phase**. All 5 phases complete. 21/22 tasks done (1 remaining: TASK-chrome-web-store — manual step). Extension (MV3 + Side Panel), Express server on port 3001, Supabase auth/schema, all platform content scripts (YouTube/TikTok/Instagram/Facebook), Gemini Flash extraction, persistent rate limiting (Supabase), plan gating (free=10/day, pro=unlimited), Stripe checkout+webhook, subscription upgrade UI, Render deployment config, Chrome Web Store runbook. Both extension and server TypeScript clean (0 errors). Server compiles to `dist/server/src/`.

## Tech Stack

- **Chrome Extension**: Manifest V3, Side Panel API, `@crxjs/vite-plugin`
- **Frontend**: React + TypeScript + Vite, CSS Modules, Zustand
- **Backend**: Node.js/Express + TypeScript (`tsx` for dev), Gemini Flash (configurable: gemini | openai | anthropic)
- **Auth + DB**: Supabase (auth, postgres)

## Common Commands

```bash
# Extension
cd extension && npm install
npm run dev        # Vite watch build → extension/dist/
npm run build      # Production build
npm run type-check # tsc --noEmit

# Server
cd server && npm install
npm run dev        # auto-loads .env, starts tsx watcher
npm run build      # tsc → server/dist/

# Load in Chrome: chrome://extensions → Developer mode → Load unpacked → extension/dist/
```

## Server Environment Variables

```
# AI Provider (default: gemini)
AI_PROVIDER=gemini          # gemini | openai | anthropic
AI_MODEL=gemini-2.0-flash   # optional, overrides default model per provider

GEMINI_API_KEY=             # free at aistudio.google.com
OPENAI_API_KEY=             # only if AI_PROVIDER=openai
ANTHROPIC_API_KEY=          # only if AI_PROVIDER=anthropic

SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
PORT=3000                   # optional, defaults to 3000
```

## Architecture

### Three packages

```
shared/types.ts          # Single source of truth for all TypeScript types
extension/               # Chrome Extension (MV3)
server/                  # Backend API — holds all secrets
```

The `shared/` types are imported by both `extension/` and `server/`. The extension `tsconfig.json` maps `@shared/*` → `../shared/*`.

### Message flow

```
Content Script → background/index.ts → chrome.runtime.sendMessage → Side Panel
Side Panel → chrome.runtime.sendMessage → background/index.ts → fetch(server)
```

The background service worker is the **single orchestrator**: it detects platforms, scores signal strength, routes to instant vs live strategy, and proxies extraction requests to the server using the Supabase JWT from `chrome.storage.local`.

Key message types:
- `YOUTUBE_SIGNAL` — content script → background, carries `YouTubeSignal` after DOM settles
- `LIVE_CAPTURE_CHUNK` — content script → background, caption text accumulates in `tabStates`
- `GET_CURRENT_PLATFORM` — side panel → background (async, returns `TabState | null`)
- `START_EXTRACTION` — side panel → background (carries `tabId` + `mode`), triggers server call
- `PLATFORM_DETECTED` / `EXTRACTION_PROGRESS` / `EXTRACTION_COMPLETE` / `EXTRACTION_ERROR` — background → side panel

**Dev note**: `API_BASE` is hardcoded as `http://localhost:3000` in `background/index.ts` — change this before any non-local deployment.

### Platform routing (background/index.ts)

- YouTube: score signal (`hasTranscript` = 3pts, `hasDescription` = 1pt, `hasChapters` = 1pt) → score ≥ 3 = `instant`, else `live`
- TikTok / Instagram / Facebook: always `live`, no scoring

Signal comes from `YOUTUBE_SIGNAL` message sent by the YouTube content script after DOM settles.

`live` extraction never starts automatically — only after user clicks Extract, which sends `START_LIVE_CAPTURE` to the content script.

### Side panel state (store/index.ts)

Zustand store with four domains:
- `platformState` — current tab's platform/url/title/strategy (synced from background via `usePlatformListener`)
- `extraction` — status/percent/result/error
- `packs` / `collections` — library data loaded from Supabase via `useLibrary`
- `view` — `'main' | 'memory' | 'auth'` controls top-level panel routing

Auth session token is persisted to `chrome.storage.local` under the key `supabase_token` so the background worker can include it in server requests.

### Server API routes

- `POST /extract` — main extraction pipeline (see below)
- `GET /transcribe/youtube?videoId=xxx` — pre-check transcript availability; returns `{ available, text, source }`
- `GET /health` — liveness check

### Server extraction pipeline (server/src/routes/extract.ts)

1. Validate Supabase JWT via `authMiddleware` — guests pass through (no token); authenticated users have `userId`/`userPlan` attached. Plan is fetched from the `profiles` Supabase table (column: `plan`).
2. For `instant`: fetch YouTube transcript server-side → fall back to client-provided transcript/description
3. For `live`: join + deduplicate caption chunks
4. Call `extractWithAI()` with mode-specific system prompt
5. Return `{ title, bullets }`

### Extraction output contract

Enforced in `server/src/services/ai.ts` system prompt — never in the frontend:
- Bullet points only, no prose
- Max 2 sentences per bullet
- High-signal only, no filler

Each `OutcomeMode` maps to a distinct extraction instruction in `MODE_INSTRUCTIONS`:
- `knowledge` — key concepts, mental models, insights
- `build-pack` — actionable steps, code snippets, repo links, tools
- `decision-pack` — tradeoffs, rules of thumb, decision criteria
- `coach-notes` — drills, technique cues, progressions
- `tools` — every tool/app/service mentioned with a one-line description
- `stack` — languages, frameworks, databases, hosting, third-party services

## Core Data Model

All types in `shared/types.ts`:

```ts
type Platform = 'youtube' | 'tiktok' | 'instagram' | 'facebook' | 'unknown'
type OutcomeMode = 'build-pack' | 'decision-pack' | 'coach-notes' | 'tools' | 'stack' | 'knowledge'
type ExtractionStrategy = 'instant' | 'live'
type ExtractionStatus = 'idle' | 'detecting' | 'extracting' | 'complete' | 'error'
```

## Key Constraints

- **No secrets in the extension** — all AI/transcription calls go through the server
- **Live capture only on explicit user action** — `START_LIVE_CAPTURE` sent only after Extract click
- Platform logic (content scripts) stays isolated from UI components
- Side effects (chrome APIs, fetch) live in hooks and the background worker — not in React components
- Plan gating enforced server-side; UI reads `plan` from Supabase for display only

## What's Stubbed / Not Yet Implemented

- ~~`server/src/services/transcription.ts` — `fetchYouTubeTranscript()` is a stub; needs `youtube-transcript` package~~ ✅ implemented
- Guest rate limiting in `server/src/routes/extract.ts` — flagged with TODO, needs a counter store
- ~~Extension icons — `public/icon16.png`, `public/icon48.png`, `public/icon128.png` missing~~ ✅ generated via `extension/scripts/generate-icons.mjs`
- `extension/src/sidepanel/services/` directory — planned for API client wrappers, not yet created

## SDLC Workflow

This project uses the `ai-sdlc-scaffold` structure with four phase folders:

```
1-spec/    → CLAUDE.spec.md, requirements, user stories, decisions
2-design/  → CLAUDE.design.md
3-code/    → CLAUDE.code.md, tasks.md  ← live task queue (pending/in-progress/done)
4-deploy/  → CLAUDE.deploy.md
```

Update `3-code/tasks.md` when starting or completing tasks (⬜ → 🔄 → ✅). Global slash commands:

```
/SDLC-init               # Initialize spec/design/code/deploy structure
/SDLC-elicit             # Requirements gathering
/SDLC-design             # Architecture & design phase
/SDLC-implementation-plan # Break work into tasks
/SDLC-execute-next-task  # Execute next pending task
/SDLC-status             # Show current phase and queue
/SDLC-fix                # Debug and fix issues
/SDLC-decompose          # Decompose a feature into tasks
```
