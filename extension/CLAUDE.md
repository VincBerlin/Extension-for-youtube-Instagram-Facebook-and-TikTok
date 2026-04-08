# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> See `/Users/vincentschnetzer/Documents/AI/Extension/CLAUDE.md` for full project context (architecture, server, shared types, SDLC workflow).

## Commands

```bash
npm run dev        # Vite watch build → dist/ (load this folder as unpacked extension)
npm run build      # Production build
npm run type-check # tsc --noEmit (no tests exist yet)
```

Reload the extension in Chrome after each build: `chrome://extensions` → click the refresh icon on the card.

## Environment

Create `extension/.env` with:
```
VITE_API_BASE=http://localhost:3000
```

`VITE_API_BASE` is read in `background/index.ts` via `import.meta.env.VITE_API_BASE`. If port 3000 is occupied by another app, set a different port here and in `server/.env` (`PORT=xxxx`).

## Source layout

```
src/
  manifest.ts          # Typed MV3 manifest (via @crxjs/vite-plugin defineManifest)
  background/index.ts  # Service worker — single orchestrator, pause-triggered extraction
  offscreen/           # Offscreen Document — audio capture via MediaRecorder
    index.html / index.ts
  content/             # One script per platform (youtube/tiktok/instagram/facebook)
                       # Each: MutationObserver for video elements, pause/play events
  sidepanel/
    main.tsx           # React entry
    App.tsx            # Top-level view router (main / library / auth)
    store/index.ts     # Zustand store — all UI state incl. theme, session, latestPack
    hooks/
      useAuth.ts              # Supabase session → store.user + chrome.storage.local
      usePlatformListener.ts  # background messages → store (handles SESSION_UPDATE etc.)
      useLibrary.ts           # Supabase packs/collections → store
    components/
      ResultCard.tsx          # Extraction result with bullets, links, folder picker
      memory/MemoryView.tsx   # Library: recent packs + collections tabs
      ThemeToggle.tsx         # Dark/light toggle
      NewFolderModal.tsx      # Create collection modal
      ...                     # PlatformBadge, OutcomeModeSelector, ExtractionProgress
public/                # icon16/48/128.png
```

`@shared/*` resolves to `../shared/*` — types are defined there, never duplicated here.

## Key architectural constraints

- **No `fetch` in the side panel.** All server calls go through `background/index.ts`.
- **Side-effects only in hooks and background.** React components read from Zustand store only.
- **Extraction fires automatically on pause.** Content scripts emit `VIDEO_PAUSED` with debounce (600ms); background handles it — no manual trigger needed.
- **Audio pipeline**: background calls `chrome.tabCapture.getMediaStreamId` → sends `streamId` to offscreen document → `getUserMedia` → `MediaRecorder` (WebM/Opus, 3s timeslices) → `FLUSH_AUDIO` on pause returns base64 blob.
- **Auth token lives in `chrome.storage.local`** under key `supabase_token`. Background reads it before every `/extract` request.

## MV3 gotchas

- `chrome.runtime.onMessage` can only have one `return true` per listener. Two separate `addListener` calls in `background/index.ts` — one for content-script messages, one for side-panel messages (returns `true` for `GET_CURRENT_PLATFORM` / `GET_SESSION`).
- The service worker can be terminated at any time. `tabStates` (in-memory Map) will be lost on restart — the `GET_CURRENT_PLATFORM` handler synthesizes state from the live tab URL as a fallback.
- The offscreen document requires `tabCapture` + `offscreen` permissions in the manifest. It is created lazily on first audio capture and reused.
- `crx()` handles content-script and service-worker bundling automatically. The offscreen HTML is added as a manual rollup input in `vite.config.ts`.
- `fpActive` CSS class in `ResultCard.module.css` is applied via string concatenation — not via CSS Modules object syntax — to avoid the compound selector limitation.
