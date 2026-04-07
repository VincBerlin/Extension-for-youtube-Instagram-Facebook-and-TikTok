# Runbook: Smoke Test (Phase 1 + Phase 2 + Phase 3)

## Voraussetzungen

- Supabase-Projekt angelegt und Schema migriert (siehe unten)
- `server/.env` befüllt (`GEMINI_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`)
- `extension/.env` befüllt:
  - `VITE_API_BASE=http://localhost:3001`
  - `VITE_SUPABASE_URL=https://<your-project>.supabase.co`
  - `VITE_SUPABASE_ANON_KEY=<your-anon-key>` (Supabase Dashboard → Project Settings → API → `anon` key)
- Node.js ≥ 20 installiert

---

## 1. Supabase-Schema anlegen

1. Supabase Dashboard öffnen → **SQL Editor** → **New query**
2. Inhalt von `4-deploy/scripts/001_initial_schema.sql` einfügen
3. **Run** klicken
4. Prüfen: Unter **Table Editor** müssen `profiles`, `packs`, `resources`, `collections`, `collection_items` sichtbar sein

---

## 2. Server starten

```bash
cd server
npm run dev
# Erwartet: "Server running on http://localhost:3001"
```

Health check:
```bash
curl http://localhost:3001/health
# Erwartet: {"ok":true}
```

---

## 3. Extension in Chrome laden

```bash
cd extension
npm run dev
# Baut nach extension/dist/
```

1. Chrome öffnen → `chrome://extensions`
2. **Developer mode** aktivieren
3. **Load unpacked** → `extension/dist/` auswählen
4. Extension sollte erscheinen (Icon in Toolbar)

---

## 4. Smoke-Test-Szenarien

### Szenario A: YouTube Instant Extraction

1. YouTube-Video mit Transcript öffnen (z.B. ein langes Tech-Tutorial)
2. Extension-Icon klicken → Side Panel öffnet sich
3. Platform-Badge muss `youtube` + `instant` zeigen
4. Mode auf `knowledge` lassen → **Extract** klicken
5. **Erwartet**: Bullet Points erscheinen nach 3–10 Sekunden
6. Server-Log prüfen: `[ai] provider=gemini model=gemini-2.0-flash mode=knowledge`

### Szenario B: YouTube Live Extraction

1. YouTube-Video ohne Transcript öffnen (oder kurzes Video)
2. Platform-Badge muss `youtube` + `live` zeigen
3. Untertitel im Video aktivieren
4. **Extract** klicken
5. **Erwartet**: Extraction startet, Captions werden gesammelt, Bullets erscheinen

### Szenario C: Ergebnis speichern (Auth erforderlich)

1. Nach erfolgreicher Extraktion → **Save** klicken
2. Wenn nicht eingeloggt → Auth-View öffnet sich
3. Mit Supabase-Account einloggen
4. **Save** nochmal klicken
5. **Erwartet**: Pack in Supabase `packs`-Tabelle sichtbar
6. Library-Icon klicken → gespeicherter Pack erscheint in der Liste

### Szenario D: TikTok Live Capture

1. TikTok-Video öffnen (tiktok.com)
2. Extension-Icon klicken → Side Panel öffnet sich
3. Platform-Badge muss `tiktok` + `live` zeigen
4. Im TikTok-Video Untertitel/Captions aktivieren (CC-Button im Player)
5. **Extract** klicken
6. **Erwartet**: Captions werden gesammelt, Bullets erscheinen nach 15–30 Sekunden
7. Wenn keine Captions erkannt → Caption-Container im DevTools prüfen; `[data-e2e="video-caption"]` suchen

### Szenario E: Instagram Reels Live Capture

1. Instagram Reels-Video öffnen (instagram.com/reels/...)
2. Platform-Badge muss `instagram` + `live` zeigen
3. Auto-Captions im Video aktivieren (falls vorhanden)
4. **Extract** klicken
5. **Erwartet**: Captions werden gesammelt, Bullets erscheinen
6. Wenn keine Captions → `[aria-label*="caption"]` im DevTools prüfen

### Szenario F: Facebook Video Live Capture

1. Facebook-Video öffnen (facebook.com/watch/...)
2. Platform-Badge muss `facebook` + `live` zeigen
3. Captions im Video aktivieren (CC-Button)
4. **Extract** klicken
5. **Erwartet**: Captions werden gesammelt, Bullets erscheinen
6. Wenn keine Captions → `[data-sigil="caption"]` im DevTools prüfen

### Szenario G: Guest Rate Limiting

1. Ohne Anmeldung (ausgeloggt) 3 Extraktionen durchführen
2. Beim 4. Versuch: **Erwartet**: HTTP 429, Fehlermeldung "Free extractions used up. Sign in to continue."
3. Rate-Limit überlebt Server-Restart (persistent in Supabase `guest_extractions` Tabelle)

### Szenario H: Authenticated Free Plan Limit

1. Als `free`-User eingeloggt: 10 Extraktionen durchführen (ohne zu speichern)
2. Beim 11. Versuch: **Erwartet**: HTTP 429, Fehlermeldung über Daily-Limit
3. Supabase `user_extractions` Tabelle prüfen: 10 Einträge vorhanden

### Szenario I: Auth Flow

1. Side Panel öffnen → Nicht eingeloggt → User-Icon klicken
2. **Erwartet**: Auth-View mit Sign-in / Sign-up Form
3. Mit Supabase-Credentials einloggen
4. **Erwartet**: User-Icon zeigt "Sign out" (Logged-in state), Session-Token in `chrome.storage.local` unter `supabase_token`
5. Sign Out → Token gelöscht, User null

> **Voraussetzung**: Migration `002_guest_rate_limit.sql` in Supabase SQL Editor angewendet

---

## 5. Fehlerdiagnose

| Problem | Mögliche Ursache |
|---------|-----------------|
| "Guest limit reached" | 3 Extraktionen/Tag verbraucht — neuen Browser-Tab oder andere IP nutzen |
| "Server error: 500" | Server-Log prüfen; meist fehlender API-Key oder Supabase-Verbindungsfehler |
| Platform-Badge zeigt `unknown` | URL-Matching prüfen; Extension neu laden nach Code-Änderungen |
| Bullets erscheinen nicht | Gemini-API-Key prüfen; Kontingent in Google AI Studio prüfen |
| Side Panel öffnet nicht | Chrome-Version ≥ 114 erforderlich (Side Panel API) |
| TikTok/Instagram/Facebook: keine Captions erkannt | Caption-Container per DevTools prüfen; `[data-e2e]`, `[aria-label]` Attribute suchen; Extension-Version in `chrome://extensions` prüfen (reload nötig nach Build) |
| Auth-View öffnet sich beim Speichern | Erwartet — einloggen, dann nochmal Save klicken |
| `VITE_SUPABASE_ANON_KEY` fehlt | Supabase Dashboard → Project Settings → API → anon/public key kopieren → `extension/.env` |
