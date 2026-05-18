# BYOK — Bring Your Own LLM Key

Extract supports Bring-Your-Own-Key (BYOK) so the user pays the LLM
provider directly and our backend never sees the bill or the prompt
content beyond what is needed to forward the request. This doc explains
how the flow works end-to-end and what the user has to do.

## Why BYOK

- Costs scale with the user, not with our infra.
- The user keeps control of which model is called.
- The Extract backend never stores any user-provided API key.

## Supported providers

| Provider | Headers required | Notes |
| --- | --- | --- |
| OpenRouter | `X-LLM-Provider: openrouter`, `X-LLM-API-Key` | Default; supports free auto-cascade — see `OPENROUTER_FREE_CASCADE.md`. |
| OpenAI | `X-LLM-Provider: openai`, `X-LLM-API-Key` | Default model: `gpt-4o-mini`. |
| Anthropic | `X-LLM-Provider: anthropic`, `X-LLM-API-Key` | Default model: `claude-3-5-haiku-latest`. |
| Google Gemini | `X-LLM-Provider: gemini`, `X-LLM-API-Key` | Required when the video path needs audio capture (TikTok / Instagram / Facebook). |
| OpenAI-compatible | `X-LLM-Provider: openai-compatible`, `X-LLM-API-Key`, `X-LLM-Base-URL` | Base URL is SSRF-checked server-side before any call. |

## End-to-end flow

```
Side panel (LlmSetupModal)
        │
        │ chrome.runtime.sendMessage GET/SAVE_LLM_SETTINGS
        ▼
Background service worker (llmSettings.ts)
        │
        │ public settings → chrome.storage.local
        │ API key → chrome.storage.local (remember=true)
        │           chrome.storage.session (remember=false)
        ▼
Extraction request to /extract/stream
        │  X-LLM-Provider, X-LLM-Model, X-LLM-Base-URL,
        │  X-LLM-OpenRouter-Mode, X-LLM-API-Key
        ▼
Server (parseRuntimeLlmConfig → callProvider)
        │
        ▼
LLM provider (OpenRouter / OpenAI / …)
```

The API key only ever travels in an HTTPS header. It is **never**:

- written to a request body (so it cannot land in Supabase logs)
- forwarded to content scripts
- echoed back in error messages
- persisted on the server

## Storage rules

| Field | Location | Cleared on |
| --- | --- | --- |
| Provider, model, base URL, mode, configured, lastTestedAt | `chrome.storage.local["llm_settings"]` | User clicks **Remove** |
| API key when "Remember" is on | `chrome.storage.local["llm_api_key"]` | User clicks **Remove** or saves an empty key |
| API key when "Remember" is off | `chrome.storage.session["llm_api_key"]` | Browser session ends or user clicks **Remove** |

Switching "Remember" deletes the key from the other store immediately to
prevent the key from existing in two places.

## Server-side dispatch

`server/src/services/ai.ts` resolves runtime config by precedence:

1. Headers parsed in `parseRuntimeLlmConfig` — if they include a valid
   provider and key, BYOK is in effect.
2. Otherwise the server-default provider (`AI_PROVIDER` env var) is
   used.

Audio capture paths (TikTok / Instagram / Facebook) require Gemini,
because that is the only multimodal provider wired in. Switching BYOK to
OpenAI/Anthropic/OpenRouter while extracting from those platforms
returns a user-facing error pack rather than a generic 500.

## Test endpoint

`POST /llm/test` does a single small chat completion call against the
selected provider with the headers above and returns:

```json
{ "ok": true, "provider": "openrouter", "model": "openrouter/free", "mode": "free-cascade" }
```

or, on failure:

```json
{ "ok": false, "code": "INVALID_KEY", "message": "401 Unauthorized" }
```

Possible `code` values: `MISSING_KEY`, `INVALID_KEY`, `UNSAFE_BASE_URL`,
`UPSTREAM`, `NETWORK`, `BAD_RESPONSE`.

## What the user sees

1. First side-panel open after install → the **AI Setup** modal opens
   automatically.
2. OpenRouter is highlighted with a star and `free-cascade` is the
   selected mode.
3. The user pastes a key, clicks **Test connection**, then **Save**.
4. Subsequent extractions use the configured provider transparently.
5. A gear icon in the top bar reopens the modal for changes.

## What we never do

- Store API keys in Supabase or any other server-side database.
- Log API keys, headers containing them, or full request bodies.
- Send API keys to content scripts running on the video host page.
- Persist keys in `localStorage` (they live in `chrome.storage.*` only).
