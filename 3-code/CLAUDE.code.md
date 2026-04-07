# Code Phase Instructions

This directory contains task tracking and component directories for the resource-extractor project.

## Phase Status

Code phase is active. Core scaffold is implemented. See `tasks.md` for pending tasks.

## Components

### Extension
- **Directory**: [`extension/`](extension/)
- **Technology**: React + TypeScript + Vite (MV3), `@crxjs/vite-plugin`, Zustand
- **Responsibility**: Chrome Extension — platform detection, side panel UI, background orchestration, live caption capture

### Server
- **Directory**: [`server/`](server/)
- **Technology**: Node.js + Express + TypeScript, Gemini Flash (configurable: gemini | openai | anthropic)
- **Responsibility**: Backend API — AI extraction pipeline, YouTube transcript fetch, auth middleware, guest rate limiting

### Shared
- **Directory**: [`shared/`](shared/)
- **Technology**: TypeScript (no build step)
- **Responsibility**: Single source of truth for all TypeScript types shared between extension and server

## Coding Conventions

- All shared TypeScript types live in `shared/types.ts` — never duplicate in extension or server
- Extension: import shared types via `@shared/*` path alias
- Server: import shared types via relative path `../../shared/types.js`
- Side effects (chrome APIs, fetch) belong in hooks and background worker — not React components
- No secrets in the extension — all AI/external calls go through the server
