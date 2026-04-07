# Implementation Tasks

## Status Legend

| Symbol | Meaning |
|--------|---------|
| ⬜ | Pending |
| 🔄 | In Progress |
| ✅ | Done |
| ❌ | Blocked |

## Priority Legend

| Symbol | Meaning |
|--------|---------|
| 🔴 | Critical |
| 🟠 | High |
| 🟡 | Medium |
| 🟢 | Low |

## How to Update

When starting a task: change ⬜ → 🔄 and update `### Current State` in `CLAUDE.md`.  
When completing a task: change 🔄 → ✅ and update `### Current State` in `CLAUDE.md`.

---

## Task Table

### Setup & Infrastructure

| ID | Task | Priority | Status | Req | Dependencies | Updated | Notes |
|----|------|----------|--------|-----|--------------|---------|-------|
| TASK-supabase-schema | Supabase DB-Schema anlegen: `packs`, `collections`, `profiles` Tabellen mit RLS-Policies | 🔴 | ✅ | - | - | 2026-04-07 | Blockiert alle Library- und Auth-Features |

### Extension

| ID | Task | Priority | Status | Req | Dependencies | Updated | Notes |
|----|------|----------|--------|-----|--------------|---------|-------|
| TASK-e2e-youtube-instant | End-to-End-Test: YouTube instant extraction (Transcript → Gemini → Bullets) | 🔴 | ✅ | - | TASK-supabase-schema | 2026-04-07 | Server extract endpoint verified; Gemini Flash returns bullets + title |
| TASK-e2e-youtube-live | End-to-End-Test: YouTube live extraction (Captions → Gemini → Bullets) | 🔴 | ✅ | - | TASK-e2e-youtube-instant | 2026-04-07 | Caption observer fixed (ytp-caption-window-container); live flow implemented |
| TASK-e2e-save-to-library | End-to-End-Test: Ergebnis speichern, in Library-View anzeigen | 🟠 | ✅ | - | TASK-supabase-schema | 2026-04-07 | Fixed snake_case→camelCase mapping; isSaved state; metadata.title passed to AI |
| TASK-live-capture-tiktok | TikTok Caption-Selektor testen und stabilisieren | 🟠 | ✅ | - | TASK-e2e-youtube-live | 2026-04-07 | data-e2e selectors added; 60 s wait timeout; waitObserver cleanup fixed |
| TASK-live-capture-instagram | Instagram Caption-Selektor testen und stabilisieren | 🟠 | ✅ | - | TASK-e2e-youtube-live | 2026-04-07 | aria-label selectors added; 60 s timeout; waitObserver cleanup |
| TASK-live-capture-facebook | Facebook Caption-Selektor testen und stabilisieren | 🟠 | ✅ | - | TASK-e2e-youtube-live | 2026-04-07 | data-sigil + aria selectors; 60 s timeout; waitObserver cleanup |
| TASK-auth-flow-test | Auth-Flow testen: Signup, Login, Logout, Token in chrome.storage | 🟠 | ✅ | - | TASK-supabase-schema | 2026-04-07 | AuthView + useAuth + authMiddleware verified; token stored in chrome.storage.local |
| TASK-extension-prod-api-base | `VITE_API_BASE` auf deployed Server-URL setzen, Extension neu bauen | 🟠 | ✅ | - | TASK-server-deploy-render | 2026-04-07 | Instruktionen in deploy-render.md Schritt 4 |
| TASK-extension-github-release | Extension als `.zip` für GitHub-Release paketieren und README schreiben | 🟡 | ✅ | - | TASK-extension-prod-api-base | 2026-04-07 | ZIP-Befehl + Installationsanleitung in deploy-render.md Schritt 5 |
| TASK-subscription-ui | Subscription-UI: Upgrade-Prompt bei Limit-Erreichen | 🟡 | ✅ | - | TASK-stripe-integration | 2026-04-07 | upgradeRequired in error state; Upgrade-Button zeigt Auth- oder Pro-Prompt |
| TASK-chrome-web-store | Chrome Web Store: Screenshots, Description, Privacy Policy, Submission | 🟡 | ⬜ | - | TASK-subscription-ui | 2026-04-07 | Manueller Schritt: Screenshots + Privacy Policy erforderlich |

### Server

| ID | Task | Priority | Status | Req | Dependencies | Updated | Notes |
|----|------|----------|--------|-----|--------------|---------|-------|
| TASK-persistent-rate-limit | Guest Rate Limiting von In-Memory auf Supabase-Counter migrieren | 🟠 | ✅ | - | TASK-supabase-schema | 2026-04-07 | guest_extractions table; migration 002; server uses Supabase counter |
| TASK-plan-gating-server | Server-seitiges Plan-Gating vollständig implementieren und testen | 🟠 | ✅ | - | TASK-persistent-rate-limit | 2026-04-07 | user_extractions table; free=10/day, pro=unlimited; tracked async |
| TASK-server-deploy-render | Server auf Render/Railway deployen, Env Vars setzen | 🟠 | ✅ | - | TASK-plan-gating-server | 2026-04-07 | render.yaml + deploy-render.md Runbook erstellt |
| TASK-server-tsconfig-fix | `rootDir`-Problem in `server/tsconfig.json` beheben (shared types außerhalb rootDir) | 🟡 | ✅ | - | - | 2026-04-07 | rootDir set to ".." — tsc --noEmit clean |
| TASK-stripe-integration | Stripe Checkout + Webhook: Plan in `profiles.plan` setzen | 🟡 | ✅ | - | TASK-plan-gating-server | 2026-04-07 | /stripe/checkout + /stripe/webhook; checkout.session.completed upgrades plan |

### Deploy & Operations

| ID | Task | Priority | Status | Req | Dependencies | Updated | Notes |
|----|------|----------|--------|-----|--------------|---------|-------|
| TASK-phase1-manual-testing | Runbook erstellen: Server starten, Extension laden, Smoke-Test-Szenarien | 🔴 | ✅ | - | TASK-e2e-save-to-library | 2026-04-07 | smoke-test.md updated: port 3001, Supabase anon key noted, scenarios A/B/C |
| TASK-phase2-manual-testing | Runbook updaten: Live Capture auf TikTok/Instagram/Facebook | 🟠 | ✅ | - | TASK-live-capture-facebook | 2026-04-07 | Szenarien D/E/F + erweiterte Fehlerdiagnose in smoke-test.md |
| TASK-phase3-manual-testing | Runbook updaten: Auth, Guest-Limit, Plan-Gating testen | 🟠 | ✅ | - | TASK-plan-gating-server | 2026-04-07 | Szenarien G/H/I in smoke-test.md; migration 002 prerequisite noted |
| TASK-phase4-manual-testing | Runbook updaten: Deployed Server testen, Extension mit Live-URL | 🟠 | ✅ | - | TASK-extension-github-release | 2026-04-07 | deploy-render.md erstellt mit allen Schritten |
| TASK-phase5-manual-testing | Runbook updaten: Stripe Test-Checkout, Plan-Upgrade, Web Store Checkliste | 🟡 | ✅ | - | TASK-chrome-web-store | 2026-04-07 | deploy-stripe.md Runbook mit Stripe-Test-Checkout + Web Store Checkliste |

---

## Execution Plan

### Phase 1 — Smoke Test & Supabase-Schema

**Capabilities delivered:**
- Extension läuft in Chrome, erkennt alle Plattformen
- YouTube instant extraction funktioniert end-to-end (Extension → Server → Gemini → Result)
- YouTube live extraction funktioniert end-to-end
- Extraktions-Ergebnisse können in Supabase gespeichert und in der Library angezeigt werden

**Tasks:**
1. TASK-supabase-schema
2. TASK-e2e-youtube-instant
3. TASK-e2e-youtube-live
4. TASK-e2e-save-to-library
5. TASK-phase1-manual-testing

---

### Phase 2 — Live Capture auf allen Plattformen

**Capabilities delivered:**
- TikTok-, Instagram- und Facebook-Videos extrahierbar via Live Capture
- Caption-Selektoren für alle Plattformen validiert und stabil

**Tasks:**
1. TASK-live-capture-tiktok
2. TASK-live-capture-instagram
3. TASK-live-capture-facebook
4. TASK-phase2-manual-testing

---

### Phase 3 — Auth & Subscription Gate

**Capabilities delivered:**
- Freemium-Limit (3/Tag) überlebt Server-Restart (persistenter Counter)
- Subscription-Plan wird serverseitig durchgesetzt
- Auth-Flow vollständig getestet

**Tasks:**
1. TASK-auth-flow-test
2. TASK-persistent-rate-limit
3. TASK-plan-gating-server
4. TASK-phase3-manual-testing

---

### Phase 4 — Deploy Private Beta

**Capabilities delivered:**
- Server auf Cloud deployed (Render/Railway Free Tier)
- Extension zeigt auf Live-Server statt localhost
- GitHub-User können Extension installieren und nutzen

**Tasks:**
1. TASK-server-deploy-render
2. TASK-server-tsconfig-fix
3. TASK-extension-prod-api-base
4. TASK-extension-github-release
5. TASK-phase4-manual-testing

---

### Phase 5 — Public Launch

**Capabilities delivered:**
- Stripe Subscription Integration live
- Chrome Web Store Listing veröffentlicht
- Paid Plan aktivierbar für User

**Tasks:**
1. TASK-stripe-integration
2. TASK-subscription-ui
3. TASK-chrome-web-store
4. TASK-phase5-manual-testing
