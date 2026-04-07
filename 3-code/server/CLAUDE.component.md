# Server

**Responsibility**: Backend API — AI extraction pipeline, YouTube transcript fetch, Supabase JWT auth middleware, guest rate limiting.

**Technology**: Node.js, Express, TypeScript, `tsx` (dev), `@google/generative-ai`, `openai`, `@anthropic-ai/sdk`, `youtube-transcript`, `@supabase/supabase-js`

**Source**: [`../../server/`](../../server/)

## Interfaces

- **HTTP ← extension** `POST /extract`: receives extraction request, runs AI pipeline, returns `{ title, bullets }`
- **HTTP ← extension** `GET /transcribe/youtube?videoId=`: returns `{ available, text, source }`
- **HTTP ← any** `GET /health`: liveness check
- **HTTPS → AI provider**: Gemini / OpenAI / Anthropic (configurable via `AI_PROVIDER` env var)
- **HTTPS → Supabase**: JWT validation, `profiles` table read for plan gating

## Architecture Notes

- AI provider is fully configurable: `AI_PROVIDER=gemini|openai|anthropic`, `AI_MODEL=...` — all logic isolated in `src/services/ai.ts`
- Default provider: `gemini-2.0-flash` (free tier, ~1500 req/day)
- Guest rate limiting: in-memory Map (IP → count/resetAt), 3 extractions/24h — resets on server restart
- Auth middleware: guests pass through; authenticated users have `userId`/`userPlan` attached from Supabase JWT
- Dev script auto-loads `.env` via `--env-file` flag
- `rootDir` tsconfig issue with shared types is pre-existing — `tsx` handles it at runtime, `tsc --noEmit` shows a structural warning (not a type error)

## Requirements Addressed

_None linked yet — populate after `/SDLC-elicit` runs._

## Relevant Decisions

| Decision | Summary |
|----------|---------|
| AI provider = Gemini Flash | Default to `gemini-2.0-flash` for cost (free tier). Switchable via `AI_PROVIDER` env var without code changes. |
| Guest limit = 3/day in-memory | Simple IP-based counter. Resets on restart — acceptable for private beta, needs persistent store before public launch. |
