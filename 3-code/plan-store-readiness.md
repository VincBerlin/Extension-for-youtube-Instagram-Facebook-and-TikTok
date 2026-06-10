# Plan: BYOK Fix + Chrome Web Store Readiness

Status: EXECUTED (2026-06-10) on branch `feat/store-readiness` · Source: multi-agent audit (19 agents, 4 dimensions, adversarially verified findings)

Task status: ✅ T-101..T-105, T-201..T-203, T-301, T-401..T-404, T-501..T-504 (16 commits).
Remaining: ⬜ T-302 (blocked on GAP-1: deployed server URL), manual steps — Render deploy,
privacy-policy hosting (T-403 text done), `.env.production` URL, manual QA script, CWS submission.

## Goal

1. Fix the reported bug: entering a BYOK API key produces an error and the extension becomes unusable. After this plan, a fresh-install user enters a key, tests it, saves, and extracts — no loop, no lockout, actionable errors.
2. Make the extension submittable to the Chrome Web Store: compliant manifest/permissions, prominent audio disclosure, hosted privacy policy, production build pointing at a deployed HTTPS server.
3. Fix the build/deploy pipeline so the server boots on Render and the release zip cannot ship a localhost URL.
4. Fix verified robustness bugs (MV3 service-worker lifetime, stuck UI states).

## Non-Goals

- No new features (no new extraction modes, platforms, or UI redesign).
- No Stripe/billing changes.
- No server-side AI prompt changes beyond error-shape fixes.
- Actual Web Store submission (screenshots, dashboard forms) stays a manual step (TASK-chrome-web-store) — this plan only produces everything that step needs.
- Renaming the extension ("Extract" is generic — recorded as a recommendation, not a task).

## Root Cause of the Reported Bug (verified, file:line evidence)

Three compounding defects produce "enter API key → error → unusable":

1. **Setup-modal state desync** — `App.tsx:55` holds a *separate* `useLlmSettings()` instance from the modal's (`LlmSetupModal.tsx:128`). After a successful save, App's stale `configured=false` reopens the modal on every Extract click; with `allowDismiss=false` (`App.tsx:660`) and an empty key field gating Save (`LlmSetupModal.tsx:415`), the user is trapped in a loop. Recovery only by closing/reopening the panel.
2. **First-run lockout** — Save is hard-gated on a successful live `POST /llm/test` round-trip (`LlmSetupModal.tsx:204-226,415`); with no dismiss path, *any* unreachable server permanently locks the whole panel behind the modal.
3. **API base / port drift** — committed default `localhost:3000` (`background/index.ts:27`) vs server default `3001` (`server/src/index.ts:9`); docs say 3000; tracked `extension/.env.production` pins `localhost:3001` and silently overrides `.env` in *every* build (both `dev` and `build` scripts run `vite build` in production mode). Any mismatch → `ERR_CONNECTION_REFUSED` → raw "Failed to fetch" inside the locked modal.

Refuted during verification (do NOT fix): "30s alarm restarts capture and wipes the audio buffer" — Chrome rejects re-capture of an actively captured tab, so the buffer survives; the alarm tick is a harmless retry.

## Preconditions and Known Gaps

- **GAP-1 (decision needed): deployed server URL.** `.env.production` needs the real Render URL. Until the server is deployed, T-301 uses a placeholder + build guard. Deploy order: T-201/T-203 first, then deploy, then T-301.
- **GAP-2 (decision recorded): audio-consent model.** Recommendation adopted in T-401: one-time consent dialog before first capture + persistent recording indicator (keeps the "buffer ready from first play" UX). Alternative (defer capture to first Extract click) would match the documented constraint but lose pre-click context.
- **GAP-3: server-bugs audit dimension incomplete.** The dedicated server bug-sweep agent failed (spend limit). T-502 closes this gap. extract.ts/auth/usageGate findings here come from the BYOK-flow agent only.
- Local toolchain: Node ≥ 20.6 (for `--env-file`), `tsx` present in server devDependencies. Extension has **no test infrastructure yet**; T-101 introduces vitest for pure logic only.
- Working tree has uncommitted changes (port flip, package.json scripts) and 3 untracked hack scripts — handled by T-201; do not commit the current working tree as-is.

## Requirements

| REQ | Statement |
|---|---|
| REQ-BYOK-1 | After test+save, the very next Extract works without the setup modal reappearing. |
| REQ-BYOK-2 | An unreachable server never locks the panel; network errors show an actionable message naming the server URL. |
| REQ-BYOK-3 | Pasted keys with whitespace/zero-width/non-ASCII chars are sanitized or rejected with a clear message — never a raw fetch TypeError. |
| REQ-BYOK-4 | After browser restart with a session-only key, the UI re-prompts for the key with an explanation; the server never silently runs with an empty key. |
| REQ-BYOK-5 | One canonical port (3001) in code, docs, and env examples. |
| REQ-DEPLOY-1 | `npm start` boots without a `.env` file (Render dashboard env vars); `npm run dev` watches sources. |
| REQ-DEPLOY-2 | The release pipeline fails if the bundle contains a localhost/http URL as API base. |
| REQ-STORE-1 | Production build points at the deployed HTTPS server. |
| REQ-STORE-2 | Audio capture starts only after one-time prominent disclosure + consent; a visible indicator shows while recording. Privacy text matches actual behavior. |
| REQ-STORE-3 | Privacy policy hosted at a public URL; permissions minimal (`activeTab` removed) with written justifications for the rest. |
| REQ-ROBUST-1 | No silent extraction aborts: every started extraction ends in COMPLETE or ERROR. |
| REQ-ROBUST-2 | Audio capture, flush, stop, and session context survive MV3 service-worker restarts. |
| REQ-ROBUST-3 | Expired Supabase JWT does not fail extraction permanently (refresh or single retry). |
| REQ-QUAL-1 | No hardcoded German strings in background; no console noise in production bundle; no JWT stored in Pack.userId; caches bounded. |

## Task List

Execution order: Phase 1 → 2 → 3 can run partly parallel; Phase 4/5 after. Each task is independently committable and revertable.

---

### Phase 1 — BYOK bug fix (the reported error)

**T-101 — Sync LLM settings between App and setup modal**
- REQ: REQ-BYOK-1
- Files: `extension/src/sidepanel/App.tsx` (~55, 95-98, 657-661), `extension/src/sidepanel/components/LlmSetupModal.tsx`, `extension/src/sidepanel/hooks/useLlmSettings.ts`
- Change: pass `onSaved={() => void refresh()}` from App (the hook already exports `refresh`); additionally add a `chrome.storage.onChanged` listener for the `llm_settings` key inside `useLlmSettings` so *all* instances converge (covers Remove/Delete too).
- Tests: introduce vitest in `extension/` (pure-logic only, no DOM): unit-test the settings-normalization round trip; manual QA script below.
- Acceptance evidence: fresh panel session → enter key → Test ok → Save → click Extract → extraction starts, modal does NOT reappear. `npm run type-check` clean.

**T-102 — De-trap the first-run modal + actionable network errors**
- REQ: REQ-BYOK-2
- Files: `extension/src/sidepanel/components/LlmSetupModal.tsx` (204-226, 260-266, 406-415), `extension/src/background/index.ts` (1141-1194), `extension/src/sidepanel/i18n.ts`
- Change: (a) always render a close/Cancel path — dismissing without config keeps Extract gated (Extract click reopens modal) instead of trapping the user; (b) distinguish error classes in the background test handler: fetch-level failure → `code: 'NETWORK'` with message "Cannot reach extraction server at <API_BASE>"; server 401 → "API key rejected by <provider>"; (c) allow "Save anyway" when the failure class is NETWORK (key may be valid; server may be temporarily down) — with visible warning.
- Tests: vitest unit test for the error-classification function (extract it as a pure function).
- Acceptance evidence: with server stopped, modal shows the server-URL message, can be dismissed, "Save anyway" persists settings; with wrong key against live server, shows key-rejected message and blocks save.

**T-103 — API-key charset sanitation/validation**
- REQ: REQ-BYOK-3
- Files: `extension/src/background/llmSettings.ts:17-22`, duplicate in `extension/src/background/index.ts:1156-1161` (deduplicate into one shared util, e.g. `extension/src/background/normalizeApiKey.ts`)
- Change: strip all Unicode whitespace + zero-width chars (U+200B-U+200D, U+FEFF) anywhere in the string; after stripping, reject values failing `/^[\x21-\x7E]+$/` with explicit message "API key contains invalid characters — re-copy it as plain text" *before* any fetch. Fix the modal placeholder `sk-…` (U+2026) to plain `sk-...`.
- Tests: vitest unit tests: trims, Bearer-strip, zero-width strip, smart-quote rejection, empty → undefined.
- Acceptance evidence: pasting a key containing U+200B passes test successfully; pasting a key with `«»` shows the explicit charset message, no fetch TypeError.

**T-104 — Session-key loss must not silently break extraction**
- REQ: REQ-BYOK-4
- Files: `extension/src/background/llmSettings.ts` (54-57, 105-121), `extension/src/background/index.ts` (GET_LLM_SETTINGS handler), `extension/src/sidepanel/App.tsx` (95-98), `server/src/services/ai.ts` (78-87)
- Change: extension — `getLlmSettings` returns `keyMissing: true` when `configured && provider !== 'server-default'` but `readApiKey()` is empty; App reopens setup with i18n message "Your key was stored for this session only — please re-enter it." Server — when resolving server-default with no env key, throw a clear 400 "no API key configured on server; supply X-LLM-API-Key" instead of calling the provider with `apiKey: ''`.
- Tests: server node:test for the resolve guard; extension vitest for the keyMissing derivation.
- Acceptance evidence: configure with "Remember key" unchecked → restart Chrome → open panel → setup reopens with the explanation message (not a provider auth error mid-extraction).

**T-105 — Canonical port 3001 everywhere**
- REQ: REQ-BYOK-5
- Files: `extension/src/background/index.ts:27` (commit the pending 3000→3001 flip), `extension/CLAUDE.md:21`, root `CLAUDE.md` (PORT line), `extension/.env.example`, `server/.env.example` (if present)
- Tests: none (docs/constants); grep gate: `grep -rn "localhost:3000" --include="*.md" --include="*.ts" extension server CLAUDE.md` → 0 hits.
- Acceptance evidence: grep output empty; fresh-clone instructions in CLAUDE.md work against default server.

---

### Phase 2 — Server build/deploy repair

**T-201 — Remove build-hack scripts, restore clean pipeline**
- REQ: REQ-DEPLOY-1
- Files: `server/package.json` (scripts), DELETE `server/fix-build.js`, `server/fix-imports.js`, `server/load-env.js`; `server/tsconfig.json` (optionally add `"exclude": ["**/*.test.ts"]`)
- Change: scripts → `{ "dev": "tsx watch --env-file=.env src/index.ts", "build": "tsc", "start": "node dist/server/src/index.js", "start:local": "node --env-file=.env dist/server/src/index.js", "test": "tsx --test src/**/*.test.ts" }`. The `dist/server/src` layout is canonical tsc output for `rootDir: ".."` — verified correct; the hack scripts solved a non-problem (fix-build.js:69 rewrites a pattern that never occurs; load-env.js keeps quotes in values and `process.chdir`s globally).
- Tests: `cd server && npm run build && node dist/server/src/index.js` boots with env vars passed inline (no `.env`): `PORT=3001 SUPABASE_URL=x SUPABASE_SERVICE_ROLE_KEY=x node dist/server/src/index.js`.
- Acceptance evidence: boot log "Server running on http://localhost:3001" without any `.env` file present; `npm run dev` reloads on source edit; hack scripts gone from tree.
- Note: revert `server/src/index.ts` whitespace-only diff while here.

**T-202 — CORS rejections must not 500**
- REQ: REQ-BYOK-2 (server side)
- Files: `server/src/index.ts:38-49`
- Change: in the CORS origin callback use `callback(null, false)` for disallowed origins instead of `callback(new Error(...))` (Error → Express 500 + stack; `false` → clean response without CORS headers). Add an Express error-handler middleware as final safety net returning JSON.
- Tests: server node:test — request with disallowed Origin gets non-500.
- Acceptance evidence: `curl -H "Origin: chrome-extension://aaaa..." :3001/health` → not a stack trace.

**T-203 — render.yaml correctness**
- REQ: REQ-DEPLOY-1
- Files: `4-deploy/scripts/render.yaml`, `4-deploy/runbooks/deploy-render.md`
- Change: `startCommand: npm start` now works (after T-201); add `ALLOWED_EXTENSION_IDS` (sync: false) and `ALLOWED_ORIGINS` env entries; either move render.yaml to repo root or keep the runbook copy-step explicit.
- Acceptance evidence: Render deploy from a clean branch boots and `GET /health` returns `{ok:true}` (manual, after user triggers deploy).

---

### Phase 3 — Production build hygiene (store blocker)

**T-301 — Production API base + build guards**
- REQ: REQ-STORE-1, REQ-DEPLOY-2
- Files: `extension/.env.production`, `extension/src/background/index.ts:27`, `extension/vite.config.ts`, `extension/scripts/verify-dist.mjs`, `extension/package.json` (dev script)
- Change: (a) `.env.production` → deployed HTTPS URL (GAP-1; placeholder until deploy, guarded); (b) remove the localhost fallback in `background/index.ts` — fail loudly (throw at boot in production builds) or default to the production URL; (c) vite.config: in production mode, assert `VITE_API_BASE` is set and not localhost/http, else fail the build; (d) verify-dist.mjs: scan the service-worker bundle for `http://localhost` / non-https API base and fail; (e) change `"dev"` to `vite build --watch --mode development` so `.env` works in dev and `.env.production` only affects real builds.
- Tests: run `npm run build` with localhost in `.env.production` → build FAILS; with https URL → passes and `grep -r "localhost" dist/assets/` empty.
- Acceptance evidence: failed-build output captured for the localhost case; `npm run release:zip` green only with https URL.

**T-302 — Add API origin to host_permissions**
- REQ: REQ-STORE-1, REQ-BYOK-2
- Files: `extension/src/manifest.ts`
- Change: add the production API origin to `host_permissions` (avoids CORS preflight fragility for X-LLM-* headers); dev builds may include localhost via a mode-conditional manifest entry.
- Acceptance evidence: extraction + key test succeed from a packed build against the deployed server with `ALLOWED_EXTENSION_IDS` locked down.

---

### Phase 4 — Web Store compliance

**T-401 — Audio consent + recording indicator**
- REQ: REQ-STORE-2
- Files: `extension/src/background/index.ts` (startAudioCapture call sites: 875-877, 1002-1004, 1036-1038, 1043-1053, 1255-1257), `extension/src/sidepanel/` (new consent dialog component), `extension/src/sidepanel/hooks/usePlatformListener.ts:48-50`, `extension/src/sidepanel/App.tsx:608-616`, `extension/src/sidepanel/i18n.ts:115`, `shared/types.ts`
- Change: (a) gate ALL `startAudioCapture` paths on a persisted `audio_consent_granted` flag (chrome.storage.local); first time a live platform is detected with the panel open, show a prominent consent dialog ("This extension records the tab's audio while a video plays so your Extract click can analyze it; audio is sent to the server only when you click Extract"); (b) wire the existing-but-dead `EXTRACTION_RECORDING` message: emit from the background on capture start, clear on stop — the existing 'recording' UI branch becomes reachable as a persistent indicator; (c) fix the false i18n string ("Click Extract to start recording audio.").
- Tests: manual QA: deny → no capture ever starts (verify via offscreen doc absence); accept → indicator visible during playback.
- Acceptance evidence: screen recording / QA checklist of both paths; privacy draft text matches behavior (T-403).

**T-402 — Permissions minimization + tab filtering**
- REQ: REQ-STORE-3
- Files: `extension/src/manifest.ts:9`, `extension/src/background/index.ts:899-912`
- Change: remove `activeTab` (verified unused); early-return in `tabs.onUpdated`/`onActivated` for URLs not matching the 4 supported platforms before any state handling; draft written dashboard justifications for `tabs`, `tabCapture`, `scripting`, `identity`, `alarms`, `offscreen` (file: `4-deploy/runbooks/cws-permission-justifications.md`).
- Acceptance evidence: `grep -rn activeTab extension/src` → 0; breakpoint test: navigating a non-video site does not reach `handleTabChange` body.

**T-403 — Privacy policy: correct + host**
- REQ: REQ-STORE-2, REQ-STORE-3
- Files: `docs/PRIVACY_POLICY_DRAFT.md`
- Change: rewrite the false claims (audio buffering happens while video plays after consent, not only on Extract); enumerate transmitted data (URLs, titles, transcripts, audio, account id, BYOK key in headers); then host at a public HTTPS URL (user action — Render static site or GitHub Pages; record final URL in `4-deploy/runbooks/`).
- Acceptance evidence: hosted URL returns the corrected policy; text cross-checked against T-401 behavior.

**T-404 — i18n background strings + prod logging**
- REQ: REQ-QUAL-1
- Files: `extension/src/background/index.ts` (1301, 1354, 1547, 1647, 1764 — all hardcoded German), `extension/src/sidepanel/hooks/usePlatformListener.ts`, `extension/src/sidepanel/i18n.ts`, `shared/types.ts` (statusKey), `extension/vite.config.ts`
- Change: background sends `statusKey` (e.g. `'readingTranscript'`) instead of `statusText`; panel resolves via i18n. Add `esbuild: { drop: [] , pure: ['console.log','console.warn','console.debug'] }` for production builds (keep `console.error`).
- Tests: type-check; manual: EN locale shows English progress text.
- Acceptance evidence: EN panel shows no German strings during extraction; prod bundle contains no `[EXTRACT-DEBUG]` strings (`grep` on dist).

---

### Phase 5 — MV3 robustness + cleanup

**T-501 — Service-worker-restart-proof state**
- REQ: REQ-ROBUST-2
- Files: `extension/src/background/index.ts` (76, 745-808, 993, 1027-1032, 1057-1061, 1238, 1264-1277)
- Change: (a) replace in-memory `offscreenReady` with `await chrome.offscreen.hasDocument()` in `flushAudio`/`stopAudioCapture` (keep flag as fast-path cache); (b) persist `sidePanelOpen` in `chrome.storage.session` (set on SIDEPANEL_OPENED, cleared on SIDEPANEL_CLOSED) and read it in VIDEO_RESUMED + alarm handlers; (c) restore persisted session in both fallback paths (`GET_CURRENT_PLATFORM` miss, `handleStartExtraction` miss) via `loadSessionFromStorage` like `handleTabChange` already does; (d) clear the `extractionPoll` alarm + `extraction_poll_tab_id` in SIDEPANEL_CLOSED.
- Tests: manual QA with forced SW termination (chrome://serviceworker-internals): flush returns buffered audio after restart; close panel stops recorder; follow-up Extract keeps sessionContext.
- Acceptance evidence: QA checklist results for all four sub-cases.

**T-502 — Server bug sweep (closes GAP-3) + stuck-UI terminal messages**
- REQ: REQ-ROBUST-1
- Files: `extension/src/background/index.ts` (1071, 1316-1319, 1505), server routes/middleware per sweep outcome
- Change: (a) every abort path after a progress event sends `EXTRACTION_ERROR` (or CANCELLED) — double-click guard notifies "analysis already running" and checks the flag BEFORE flushing audio; wrap the `handleStartExtraction` call with `.catch` → EXTRACTION_ERROR; (b) run the missing server audit (extract.ts validation, auth middleware, usageGate, redact coverage, safeUrl completeness) and fix what it finds (file follow-up tasks if large).
- Tests: server: `npm test` green; extension: manual double-click + mid-fetch navigation QA.
- Acceptance evidence: UI never stays in 'extracting' >timeout in the QA scenarios; server test suite output.

**T-503 — Data hygiene: JWT leak, cache growth, JWT expiry**
- REQ: REQ-ROBUST-3, REQ-QUAL-1
- Files: `extension/src/background/index.ts` (143-150, 211-215, 1620-1627, 1793-1799), `extension/src/sidepanel/hooks/useAuth.ts`, `extension/src/sidepanel/App.tsx` (241-307)
- Change: (a) stop writing the raw JWT into `Pack.userId` — store the actual user id alongside `supabase_token` and use that; (b) LRU-cap analysis caches (keep newest ~50, timestamp in entry, prune on write) and log quota errors instead of `catch {}`; (c) JWT expiry: persist `expires_at` + refresh token (or on 401, ask the panel to refresh and retry once); (d) fix duplicate-save PK violation: `upsert(..., { onConflict: 'id' })` or seed savedIds from the loaded library.
- Tests: vitest for the LRU prune function; manual: save → reopen panel → save again → no `packs_pkey` error.
- Acceptance evidence: stored pack inspected — `userId` is a UUID, not a JWT; duplicate save succeeds idempotently.

**T-504 — Dead code + doc truth**
- REQ: REQ-QUAL-1
- Files: `extension/src/background/index.ts` (LIVE_CAPTURE_CHUNK handler 1009-1014; captionChunks decision 1242-1252), `extension/CLAUDE.md`, root `CLAUDE.md`
- Change: delete the `LIVE_CAPTURE_CHUNK` handler; either wire `captionChunks` into the live extraction payload or delete the accumulation; update `extension/CLAUDE.md` ("Extraction fires automatically on pause" → button-triggered) and root CLAUDE.md (port, Superglue references are stale — extraction goes through first-party `/extract/stream`).
- Acceptance evidence: grep shows no orphaned message types (every type in shared/types.ts has ≥1 sender + ≥1 handler or is removed); docs match implementation.

---

## Verification Matrix (run after each phase)

| Gate | Command |
|---|---|
| Types extension | `cd extension && npm run type-check` |
| Types server | `cd server && npx tsc --noEmit` |
| Server tests | `cd server && npm test` |
| Extension unit | `cd extension && npx vitest run` (after T-101) |
| Build extension | `cd extension && npm run build` (must fail on localhost API base after T-301) |
| Release gate | `cd extension && npm run release:zip` |
| No stale port | `grep -rn "localhost:3000" extension server *.md` → empty |
| Boot w/o .env | `cd server && npm run build && PORT=3001 SUPABASE_URL=x SUPABASE_SERVICE_ROLE_KEY=x node dist/server/src/index.js` |

## Manual QA Script (BYOK happy + unhappy path)

1. Fresh unpacked install, server running → panel opens → setup modal → paste valid Gemini key → Test ok → Save → Extract on a YouTube video → result appears, modal never reappears (T-101).
2. Stop server → reopen panel fresh profile → modal shows "Cannot reach extraction server at <URL>", dismissable, Save-anyway works (T-102).
3. Paste key with smart quotes → explicit charset error, no raw fetch error (T-103).
4. Configure with Remember unchecked → full Chrome restart → panel explains session-key loss and re-prompts (T-104).
5. TikTok video: consent dialog on first use; recording indicator while playing; Extract returns audio-based result (T-401, T-501).

## Risks and Rollback

- **Each task = one commit** on a feature branch (`feat/store-readiness`); rollback = revert the single commit. No task rewrites shared data shapes except T-404's `statusKey` (extension-internal message, panel and background ship together in one bundle — no cross-version skew possible).
- **T-102 (Save-anyway)** risks users saving broken keys → mitigated: warning state + keys still verified at first extraction with a clear error path now existing.
- **T-201** touches the deploy path; risk of breaking the developer's current local flow → mitigated: `start:local` preserves `--env-file` behavior; verify boot before deleting hack scripts.
- **T-301** intentionally breaks `npm run build` until a real URL exists → sequencing: deploy server (T-201/T-203) first; until then the guard exits with a clear message, which is the desired failure mode.
- **T-401** changes capture timing semantics (consent gate) → if users deny, live platforms degrade to no-audio fallback — already an existing server path; documented in the consent dialog.
- **T-501(b)** `storage.session` requires Chrome 102+ — fine for MV3 side-panel baseline (114+).
- Spend-limit note: subagent capacity exhausted during audit; T-502's server sweep should run when capacity is available or be done manually.
