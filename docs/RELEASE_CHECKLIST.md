# Release Checklist — Extract Chrome Extension

This checklist mirrors the Definition of Done in
`DEV_AUFTRAG_RELEASE_FIXES_BYOK_OPENROUTER.md` and adds the smoke-test
steps a reviewer needs to walk through before submitting a build to the
Chrome Web Store.

## 1. Pre-flight (one-time per release branch)

- [ ] `extension/.env.production` (or the build environment) points
      `VITE_API_BASE` at the **deployed** server URL, not `localhost`.
- [ ] `server/.env.production` is loaded with the real `SUPABASE_URL`,
      `SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_*`, and `ALLOWED_ORIGINS`
      including the published `chrome-extension://<id>` value.
- [ ] No secret values are committed to the repository.
- [ ] `extension/src/manifest.ts` version bumped.
- [ ] `docs/PRIVACY_POLICY_DRAFT.md` has been published to a public URL
      and the URL has been pasted into the Web Store listing.

## 2. Build verification

```bash
cd extension
npm install
npm run release:zip
```

- [ ] Build exits with code 0.
- [ ] `verify:dist` passes (no `.env`, no source maps with secrets, no
      stray files).
- [ ] Resulting ZIP lives at the path printed by `zip-dist.mjs`.
- [ ] `manifest.json` is at the ZIP **root** (not nested under `dist/`).
- [ ] The ZIP contains the side panel HTML, the background service
      worker, the offscreen document and the four content scripts.
- [ ] The ZIP contains **no** `.env`, `.env.*`, source maps for the
      backend, or API key strings.

## 3. Server contract verification

- [ ] `cd server && npm run build` passes.
- [ ] CORS responds with the explicit `Access-Control-Allow-Origin`
      header for `chrome-extension://<id>` only — the wildcard `*` must
      not appear.
- [ ] `/extract` and `/extract/stream` return HTTP 429 with a
      `Retry-After` header when the daily quota is hit.
- [ ] `/llm/test` returns `{ ok: true, ... }` for a valid OpenRouter
      key with `X-LLM-Provider: openrouter`.
- [ ] `/llm/openrouter/free-models` returns a non-empty `models` array
      when called with a valid OpenRouter key.

## 4. SSRF guards

- [ ] `assertPublicHttpUrl` rejects `http://localhost`, `127.0.0.1`,
      `169.254.169.254`, RFC1918 ranges, and IPv6 loopback / link-local
      addresses.
- [ ] yt-dlp download path rejects unsafe URLs and falls back gracefully
      (returns `null` instead of throwing).
- [ ] `urlValidator.fetchWithTimeout` short-circuits to
      `{ kind: 'invalid' }` on private hosts.

## 5. BYOK smoke test (manual, in the browser)

Load `extension/dist` as an unpacked extension in Chrome.

- [ ] First open of the side panel shows the **AI Setup** modal.
- [ ] The OpenRouter card is highlighted as recommended and
      `free-cascade` is preselected.
- [ ] Pasting a valid OpenRouter key, clicking **Test connection**
      returns "✓ Connection works".
- [ ] **Save** dismisses the modal; clicking the gear icon re-opens it
      with the previous values pre-filled.
- [ ] Unchecking "Remember key" stores the key in
      `chrome.storage.session` only — close the browser, reopen, the key
      is gone (verifiable through DevTools → Application → Extension
      storage).
- [ ] Provider swap to OpenAI, Anthropic, Gemini, OpenAI-compatible
      each accept a valid key and reject an invalid one with a clear
      error message.
- [ ] `Remove` deletes the public settings and both secret entries.

## 6. Extraction smoke test

Repeat once per supported platform:

| Platform | Page | Expected |
| --- | --- | --- |
| YouTube | A public video with a transcript | Extract returns bullets within ~10 s, panel shows the AI Setup gear icon |
| YouTube | A video without a transcript | Extract still returns bullets via description / audio fallback |
| TikTok | Any FYP video | "Recording…" indicator, Extract returns bullets within ~20 s |
| Instagram Reels | Any Reel | Same as TikTok |
| Facebook Watch | Any video | Same as TikTok |

For each: signed-out, signed-in (free), and signed-in (pro or BYOK)
flows should all succeed once. Signed-out flow must enforce the daily
guest limit when exceeded.

## 7. Store-listing review

Before clicking submit, check the Web Store listing text against
`STORE_PERMISSION_JUSTIFICATIONS.md`:

- [ ] No claim of "unlimited usage" — the free tier has a daily limit.
- [ ] No claim of Pro/billing unless the Stripe integration is live in
      the deployed server build.
- [ ] No claim of "fully offline" — the LLM is called over HTTPS.
- [ ] No claim of "no data sent" — the user-selected LLM provider
      receives prompt content.
- [ ] Every permission listed in the manifest has a matching
      justification block in the Web Store form.

## 8. Post-submission

- [ ] Tag the release in git: `git tag v<version> && git push --tags`.
- [ ] Record the Web Store submission ID in the release notes.
- [ ] Open follow-up issues for any deferred items (e.g. additional
      OpenRouter providers, the `LlmSettingsView` standalone page).
