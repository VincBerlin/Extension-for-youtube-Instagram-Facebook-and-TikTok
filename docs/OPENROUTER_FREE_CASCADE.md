# OpenRouter — Free auto-cascade

The default BYOK provider is OpenRouter, configured in free-cascade mode.
This doc explains the discovery, ranking and retry logic implemented in
`server/src/services/openRouter.ts`.

## Goal

Pick a free OpenRouter model that **works right now** for one extraction
request, with at most three attempts before giving up. Free models on
OpenRouter come and go — hard-coding a single id would break the moment
that id is rate-limited or retired.

## Discovery

```
GET https://openrouter.ai/api/v1/models
Authorization: Bearer <user key>
```

The response is filtered with `isFreeTextModel`:

- `pricing.prompt === "0"` (string compare — OpenRouter ships strings)
- input modalities include `text`
- output modalities include `text`

If the discovery call itself fails (rate-limited, network, parse error),
the cascade falls back to a small hard-coded seed list:

```ts
const SEED_FREE_MODELS = [
  'openrouter/free',
  'qwen/qwen3-coder:free',
  'z-ai/glm-4.5-air:free',
]
```

## Ranking

`scoreFreeModel(model)` returns a number; higher = tried first.

| Signal | Score |
| --- | --- |
| `id === 'openrouter/free'` | +1000 |
| `response_format` supported | +200 |
| `structured_outputs` supported | +200 |
| `context_length ≥ 200_000` | +150 |
| `context_length ≥ 128_000` | +100 |
| `context_length ≥ 32_000` | +50 |
| Each declared text modality | +25 |

The list is then sliced to `MAX_CASCADE_ATTEMPTS` (3).

## Attempt loop

```
for each of top-3 ranked free models:
    POST /chat/completions with model + prompt
    if 401 / 403 / 400 → STOP, don't retry (user error, not transient)
    if status in {402, 408, 425, 429, 500, 502, 503, 504} → continue
    if non-JSON response → continue
    else → return result
```

A hard 60-second timeout is enforced per attempt with `withTimeout(ms,
parent)` so that one stuck model cannot block the whole cascade.

## Header hygiene

Each call sets:

```
Authorization: Bearer <user key>
HTTP-Referer: <env OPENROUTER_REFERER or chrome-extension://>
X-Title: <env OPENROUTER_TITLE or "Extract">
```

These two extra headers identify the calling app to OpenRouter and are
required for some free-tier quotas.

## Failure surface

If all three attempts fail, the cascade throws `OpenRouterError` with
the last upstream status and body. The route handler maps that to a
user-friendly error pack so the side panel can show a retry hint
without exposing the raw provider response.

## When to switch off free-cascade

The modal offers two alternatives:

- **Free router** — one call to `openrouter/free`. Useful when the user
  trusts the OpenRouter router and prefers low latency over robustness.
- **Custom model** — the user specifies the OpenRouter model id. The
  cascade and discovery logic do not run.

Both modes still travel through the same OpenRouter chat completion
endpoint and share the SSRF / timeout / error-classification logic.
