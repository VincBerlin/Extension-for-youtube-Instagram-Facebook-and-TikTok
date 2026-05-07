import type {
  Platform,
  ExtractionStrategy,
  YouTubeSignal,
  PlatformDetectedMessage,
  YouTubeSignalMessage,
  AudioDataMessage,
  OutcomeMode,
  QuickFacts,
  RelatedLink,
  VideoSession,
  Pack,
  ExtractionPackV2,
  CurrentAnalysisMessage,
} from '@shared/types'
import { detectMode } from '@shared/types'
const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? 'http://localhost:3000'

// ─── Platform & strategy helpers ──────────────────────────────────────────────

function detectPlatform(url: string): Platform {
  try {
    const { hostname } = new URL(url)
    if (hostname.includes('youtube.com') || hostname.includes('youtu.be')) return 'youtube'
    if (hostname.includes('tiktok.com')) return 'tiktok'
    if (hostname.includes('instagram.com')) return 'instagram'
    if (hostname.includes('facebook.com')) return 'facebook'
  } catch { /* ignore */ }
  return 'unknown'
}

function resolveStrategy(platform: Platform): ExtractionStrategy {
  return platform === 'youtube' ? 'instant' : 'live'
}

// ─── Tab state ────────────────────────────────────────────────────────────────

interface TabState {
  platform: Platform
  url: string
  title: string
  signal?: YouTubeSignal
  strategy: ExtractionStrategy
  captionChunks: string[]
  session: VideoSession | null
  extracting: boolean
  audioRetryHintShown: boolean
  liveTimer: ReturnType<typeof setInterval> | null
  youtubeAutoExtracted: boolean
  isPlaying: boolean                // true while video is actively playing
  isRecording: boolean              // true while audio recording is active
  extractionId: string | null
  lastTranscriptTimestamp: number   // video seconds covered by last extraction
  tabId: number | null              // stored so alarm handler can reach this tab after SW restart
  skipKeyedCache?: boolean          // set when user forces a fresh re-analyze
}

const tabStates = new Map<number, TabState>()
let selectedMode: OutcomeMode = 'knowledge'
let sidePanelOpen = false

// ─── Session persistence (chrome.storage.local) ───────────────────────────────

async function saveSessionToStorage(
  url: string,
  session: VideoSession,
  extractionId?: string | null,
  tabId?: number,
  lastTranscriptTimestamp?: number,
) {
  try {
    const stored = await chrome.storage.local.get('sessions')
    const sessions = (stored.sessions ?? {}) as Record<string, unknown>
    sessions[url] = {
      session,
      extractionId: extractionId ?? null,
      tabId: tabId ?? null,
      lastTranscriptTimestamp: lastTranscriptTimestamp ?? 0,
    }
    await chrome.storage.local.set({ sessions, active_video_url: url })
  } catch { /* ignore */ }
}

async function loadSessionFromStorage(url: string): Promise<{ session: VideoSession | null; extractionId: string | null; tabId: number | null; lastTranscriptTimestamp: number }> {
  try {
    const stored = await chrome.storage.local.get('sessions')
    const entry = ((stored.sessions ?? {}) as Record<string, { session: VideoSession; extractionId?: string; tabId?: number; lastTranscriptTimestamp?: number }>)[url]
    return {
      session: entry?.session ?? null,
      extractionId: entry?.extractionId ?? null,
      tabId: entry?.tabId ?? null,
      lastTranscriptTimestamp: entry?.lastTranscriptTimestamp ?? 0,
    }
  } catch {
    return { session: null, extractionId: null, tabId: null, lastTranscriptTimestamp: 0 }
  }
}

// ─── Analysis cache (per video URL) + current analysis ───────────────────────
//
// Cache the full Pack per video URL so:
//   1. A repeat Extract on the same video shows instantly (no re-fetch / no re-LLM call)
//   2. Switching tabs / URLs / closing the side panel does NOT lose the result
//
// Two storage keys:
//   - `analysis:{url}` → cached Pack for that video (long-lived)
//   - `current_analysis` → { url, pack } most recently shown (used to hydrate side panel on open)

const ANALYSIS_KEY_PREFIX = 'analysis:'
const ANALYSIS_KEYED_PREFIX = 'analysis-keyed:'
const CURRENT_ANALYSIS_KEY = 'current_analysis'

async function loadCachedAnalysis(url: string): Promise<Pack | null> {
  try {
    const key = ANALYSIS_KEY_PREFIX + url
    const stored = await chrome.storage.local.get(key)
    const pack = stored[key] as Pack | undefined
    return pack ?? null
  } catch {
    return null
  }
}

async function saveCachedAnalysis(url: string, pack: Pack): Promise<void> {
  try {
    await chrome.storage.local.set({
      [ANALYSIS_KEY_PREFIX + url]: pack,
      [CURRENT_ANALYSIS_KEY]: { url, pack },
    })
  } catch { /* ignore */ }
}

async function clearCachedAnalysis(url: string): Promise<void> {
  try {
    await chrome.storage.local.remove([ANALYSIS_KEY_PREFIX + url, CURRENT_ANALYSIS_KEY])
  } catch { /* ignore */ }
}

// Content-aware extraction cache. The key combines url + mode + scope + a hash
// of the input content so that re-running Extract on the same video with the
// same mode and an unchanged transcript skips the LLM call entirely. Mode/scope
// changes or transcript drift produce different keys and miss the cache.
async function sha1Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(text))
  const bytes = new Uint8Array(buf)
  let hex = ''
  for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, '0')
  return hex
}

async function buildExtractionCacheKey(parts: {
  url: string
  mode: string
  scope: string
  contentHash: string
}): Promise<string> {
  return sha1Hex(`${parts.url}|${parts.mode}|${parts.scope}|${parts.contentHash}`)
}

// Hash the input content cheaply. For audio (potentially MBs of base64) we mix
// length + a short prefix/suffix so we don't pay full-buffer SHA cost.
async function hashContent(content: { transcript?: string; audio?: string }): Promise<string> {
  if (content.transcript && content.transcript.length > 0) {
    return sha1Hex(content.transcript)
  }
  if (content.audio && content.audio.length > 0) {
    const a = content.audio
    const sample = `${a.length}|${a.slice(0, 256)}|${a.slice(-256)}`
    return sha1Hex(sample)
  }
  return 'empty'
}

async function loadKeyedAnalysis(cacheKey: string): Promise<Pack | null> {
  try {
    const k = ANALYSIS_KEYED_PREFIX + cacheKey
    const stored = await chrome.storage.local.get(k)
    return (stored[k] as Pack | undefined) ?? null
  } catch {
    return null
  }
}

async function saveKeyedAnalysis(cacheKey: string, pack: Pack): Promise<void> {
  try {
    await chrome.storage.local.set({ [ANALYSIS_KEYED_PREFIX + cacheKey]: pack })
  } catch { /* ignore */ }
}

async function loadCurrentAnalysis(): Promise<{ url: string; pack: Pack } | null> {
  try {
    const stored = await chrome.storage.local.get(CURRENT_ANALYSIS_KEY)
    return (stored[CURRENT_ANALYSIS_KEY] as { url: string; pack: Pack } | undefined) ?? null
  } catch {
    return null
  }
}

function broadcastCurrentAnalysis(url: string, pack: Pack | null) {
  const msg: CurrentAnalysisMessage = { type: 'CURRENT_ANALYSIS', url, pack }
  chrome.runtime.sendMessage(msg).catch(() => {})
}

// ─── YouTube transcript ────────────────────────────────────────────────────────
// All fetching runs in the SERVICE WORKER (host_permissions bypass CORS for
// youtube.com). Two approaches tried in order:
//   1. ytInitialPlayerResponse caption URL (sync executeScript — no async inside)
//   2. Direct timedtext API with json3 format (fallback, no auth needed)

function parseJson3Events(
  events: Array<{ tStartMs?: number; segs?: Array<{ utf8: string }> }>,
  currentTime: number,
): string {
  const parts: string[] = []
  for (const ev of events) {
    if (!ev.segs) continue
    const startSec = (ev.tStartMs ?? 0) / 1000
    if (currentTime > 0 && startSec > currentTime) continue
    for (const seg of ev.segs) {
      const t = seg.utf8.replace(/\n/g, ' ').trim()
      if (t) parts.push(t)
    }
  }
  return parts.join(' ').replace(/\s+/g, ' ').trim()
}


// Fetch a YouTube caption track from INSIDE the YouTube tab (MAIN world).
// Service worker fetches of timedtext URLs return empty HTML — YouTube requires
// a browser-tab origin with valid cookies. executeScript + MAIN world provides both.
//
// Root cause of fmt=json3 not appearing: YouTube HTML embeds the baseUrl with
// \\u0026 (double-escaped), so after JSON.parse the string contains literal \u0026
// characters instead of '&'. new URL() then can't parse the query string, and
// searchParams.set('fmt','json3') adds it as a new param on a garbled URL.
// Fix: normalize \u0026 → & BEFORE calling new URL().
async function fetchTranscriptInPage(
  tabId: number,
  rawCaptionUrl: string,
  videoId: string,
  languageCode: string,
): Promise<string | null> {
  type PageResult = {
    transcript: string
    status: number
    contentType: string
    rawLength: number
    preview: string
    error: string | null
    finalUrl: string
    urlLabel: string
  }

  let result: chrome.scripting.InjectionResult<PageResult>[]
  try {
    result = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: (rawUrl: string, vid: string, lang: string): Promise<PageResult> => {

        // ── Build the authoritative JSON3 transcript URL ──────────────────────
        function buildJson3TranscriptUrl(raw: string): string {
          // Decode ALL literal \uXXXX sequences produced by YouTube's double-escaped HTML/JSON.
          // After JSON.parse, e.g. literal \u0026 (6 chars: \,u,0,0,2,6) appears instead of &.
          // Avoid new URL() — it may throw on edge-case YouTube param values.
          var normalized = raw.replace(/\\u([\da-fA-F]{4})/g, function(_, hex) {
            return String.fromCharCode(parseInt(hex, 16))
          })
          var qi = normalized.indexOf('?')
          if (qi === -1) return normalized + '?fmt=json3'
          var base = normalized.substring(0, qi)
          var params = normalized.substring(qi + 1).split('&').filter(function(p) { return !p.startsWith('fmt=') && p.length > 0 })
          params.push('fmt=json3')
          return base + '?' + params.join('&')
        }

        const candidates: Array<{ label: string; url: string }> = []

        try {
          candidates.push({ label: 'baseUrl', url: buildJson3TranscriptUrl(rawUrl) })
        } catch (e) { console.warn('[page-main] buildJson3TranscriptUrl error:', String(e), '| raw prefix:', rawUrl.substring(0, 80)) }

        // Clean public timedtext fallbacks (no session-signed params needed)
        candidates.push({ label: 'clean', url: `https://www.youtube.com/api/timedtext?v=${vid}&lang=${lang}&fmt=json3` })
        candidates.push({ label: 'clean-asr', url: `https://www.youtube.com/api/timedtext?v=${vid}&lang=${lang}&kind=asr&fmt=json3` })

        // ── Try each candidate until one returns non-HTML content ─────────────
        function tryNext(i: number): Promise<PageResult> {
          if (i >= candidates.length) {
            return Promise.resolve({ transcript: '', status: 0, contentType: '', rawLength: 0, preview: '', error: 'all-candidates-failed', finalUrl: '', urlLabel: 'none' })
          }
          const { label, url } = candidates[i]
          return fetch(url, { credentials: 'include' })
            .then((res) => res.text().then((text): PageResult | Promise<PageResult> => {
              const ct = res.headers.get('content-type') ?? ''
              if (res.ok && text.trim() && !ct.includes('html')) {
                return { transcript: text, status: res.status, contentType: ct, rawLength: text.length, preview: text.substring(0, 300), error: null, finalUrl: url, urlLabel: label }
              }
              return tryNext(i + 1)
            }))
            .catch(() => tryNext(i + 1))
        }

        return tryNext(0)
      },
      args: [rawCaptionUrl, videoId, languageCode],
    })
  } catch (e) {
    console.warn('[bg] step3 executeScript error:', e)
    return null
  }

  const r = result?.[0]?.result
  if (!r) { console.warn('[bg] step3 no result from executeScript'); return null }

  console.log('[bg] step3 transcript url raw:', rawCaptionUrl.substring(0, 120))
  console.log('[bg] step3 transcript url final:', r.finalUrl.substring(0, 120))
  console.log('[bg] step3 transcript has fmt=json3:', r.finalUrl.includes('fmt=json3'))
  console.log('[bg] step3 page fetch mode: main-world | label:', r.urlLabel)
  console.log('[bg] step3 transcript response status:', r.status)
  console.log('[bg] step3 transcript content-type:', r.contentType)
  console.log('[bg] step3 transcript raw length:', r.rawLength)
  console.log('[bg] step3 transcript preview:', r.preview)

  if (r.error || !r.transcript.trim()) {
    console.warn('[bg] step3 transcript empty body | error:', r.error)
    return null
  }

  const raw = r.transcript
  const trimmed = raw.trimStart()

  if (trimmed.startsWith('{')) {
    console.log('[bg] step3 transcript parse mode: json3')
    try {
      const data = JSON.parse(raw) as { events?: Array<{ tStartMs?: number; segs?: Array<{ utf8: string }> }> }
      const transcript = parseJson3Events(data.events ?? [], 0)
      console.log('[bg] step3 transcript length:', transcript.length)
      return transcript.length > 30 ? transcript : null
    } catch (e) { console.warn('[bg] step3 json parse failed:', e); return null }
  }

  if (trimmed.startsWith('<') && raw.includes('<text')) {
    console.log('[bg] step3 transcript parse mode: xml')
    const parts: string[] = []
    const re = /<text[^>]*>([\s\S]*?)<\/text>/g
    let m: RegExpExecArray | null
    while ((m = re.exec(raw)) !== null) {
      const t = m[1]
        .replace(/&#(\d+);/g, (_: string, n: string) => String.fromCharCode(parseInt(n)))
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
        .replace(/\n/g, ' ').trim()
      if (t) parts.push(t)
    }
    const transcript = parts.join(' ').replace(/\s+/g, ' ').trim()
    console.log('[bg] step3 transcript length:', transcript.length)
    return transcript.length > 30 ? transcript : null
  }

  console.warn('[bg] step3 transcript parse mode: unknown format | preview:', trimmed.substring(0, 80))
  return null
}

// ── Service-worker direct caption fetch ───────────────────────────────────────
// Avoids executeScript/MAIN-world fetch — YouTube overrides window.fetch in the
// page context, which causes all timedtext fetches to return HTML regardless of URL.

function buildJson3Url(raw: string): string | null {
  try {
    const normalized = raw.replace(/\\u([\da-fA-F]{4})/g, (_, hex) =>
      String.fromCharCode(parseInt(hex, 16))
    )
    const qi = normalized.indexOf('?')
    if (qi === -1) return normalized + '?fmt=json3'
    const base = normalized.substring(0, qi)
    const params = normalized.substring(qi + 1).split('&').filter(p => !p.startsWith('fmt=') && p.length > 0)
    params.push('fmt=json3')
    return base + '?' + params.join('&')
  } catch {
    return null
  }
}

async function fetchCaptionText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      credentials: 'include',
      headers: {
        'Accept': 'application/json, text/xml, */*',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
      },
    })
    const ct = res.headers.get('content-type') ?? ''
    if (!res.ok || ct.includes('html')) {
      console.log('[bg] fetchCaptionText skip | status:', res.status, '| ct:', ct, '| url:', url.substring(0, 80))
      return null
    }
    const text = await res.text()
    if (!text.trim()) return null

    const trimmed = text.trimStart()
    if (trimmed.startsWith('{')) {
      try {
        const data = JSON.parse(text) as { events?: Array<{ tStartMs?: number; segs?: Array<{ utf8: string }> }> }
        const transcript = parseJson3Events(data.events ?? [], 0)
        return transcript.length > 30 ? transcript : null
      } catch { return null }
    }
    if (trimmed.startsWith('<') && text.includes('<text')) {
      const parts: string[] = []
      const re = /<text[^>]*>([\s\S]*?)<\/text>/g
      let m: RegExpExecArray | null
      while ((m = re.exec(text)) !== null) {
        const t = m[1]
          .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(parseInt(n)))
          .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
          .replace(/\n/g, ' ').trim()
        if (t) parts.push(t)
      }
      const transcript = parts.join(' ').replace(/\s+/g, ' ').trim()
      return transcript.length > 30 ? transcript : null
    }
    console.warn('[bg] fetchCaptionText: unknown format | preview:', trimmed.substring(0, 80))
    return null
  } catch (e) {
    console.warn('[bg] fetchCaptionText error:', e)
    return null
  }
}

async function fetchTranscriptFromSW(rawBaseUrl: string, videoId: string, lang: string): Promise<string | null> {
  const signedUrl = buildJson3Url(rawBaseUrl)
  console.log('[bg] fetchTranscriptFromSW | signedUrl:', signedUrl?.substring(0, 100) ?? 'null')

  const candidates: Array<{ label: string; url: string }> = []
  if (signedUrl) candidates.push({ label: 'signed', url: signedUrl })
  candidates.push({ label: 'clean', url: `https://www.youtube.com/api/timedtext?v=${videoId}&lang=${lang}&fmt=json3` })
  candidates.push({ label: 'clean-asr', url: `https://www.youtube.com/api/timedtext?v=${videoId}&lang=${lang}&kind=asr&fmt=json3` })

  for (const { label, url } of candidates) {
    const transcript = await fetchCaptionText(url)
    if (transcript) {
      console.log('[bg] fetchTranscriptFromSW success | label:', label, '| len:', transcript.length)
      return transcript
    }
  }
  return null
}

// Fetch YouTube page HTML in the service worker to extract captionTracks.
async function fetchTranscriptFromHTML(videoId: string, tabId: number): Promise<string | null> {
  const url = `https://www.youtube.com/watch?v=${videoId}`
  console.log('[bg] step2 html fetch | url:', url)
  try {
    const res = await fetch(url, {
      credentials: 'include',
      headers: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
      },
    })
    if (!res.ok) { console.warn('[bg] step2 html: fetch status:', res.status); return null }
    const html = await res.text()
    console.log('[bg] step2 html: page length:', html.length)

    const captionIdx = html.indexOf('"captionTracks":')
    console.log('[bg] step2 html: captionTracks found:', captionIdx !== -1)
    if (captionIdx === -1) return null

    const arrStart = html.indexOf('[', captionIdx)
    if (arrStart === -1) return null

    // String-aware depth tracker — handles `{` / `}` inside JSON string values correctly
    let depth = 0
    let arrEnd = -1
    let inString = false
    let escape = false
    for (let i = arrStart; i < Math.min(arrStart + 100000, html.length); i++) {
      const c = html[i]
      if (escape) { escape = false; continue }
      if (c === '\\' && inString) { escape = true; continue }
      if (c === '"') { inString = !inString; continue }
      if (inString) continue
      if (c === '[' || c === '{') depth++
      else if (c === ']' || c === '}') { depth--; if (depth === 0) { arrEnd = i; break } }
    }
    if (arrEnd === -1) { console.warn('[bg] step2 html: could not close captionTracks array'); return null }

    const tracks = JSON.parse(html.substring(arrStart, arrEnd + 1)) as Array<{ baseUrl?: string; languageCode?: string }>
    console.log('[bg] step2 html: captionTracks count:', tracks.length)

    const track = tracks.find(t => t.languageCode?.startsWith('en')) ?? tracks[0]
    if (!track?.baseUrl) { console.log('[bg] step2 html: no usable track'); return null }

    const lang = track.languageCode ?? 'en'
    console.log('[bg] step2 html: lang:', lang, '| baseUrl prefix:', track.baseUrl.substring(0, 100))
    // Extract videoId from the baseUrl (the HTML was fetched for this exact videoId)
    let vid = videoId
    try { vid = new URL(track.baseUrl).searchParams.get('v') ?? videoId } catch { /* keep videoId */ }

    // Try direct SW fetch first (avoids YouTube's window.fetch override in MAIN world)
    const swResult = await fetchTranscriptFromSW(track.baseUrl, vid, lang)
    if (swResult) return swResult
    // Fallback: page context (in case SW fetch is blocked for some reason)
    return fetchTranscriptInPage(tabId, track.baseUrl, vid, lang)
  } catch (e) {
    console.warn('[bg] step2 html error:', e)
    return null
  }
}

async function fetchTranscriptFromTab(tabId: number): Promise<{ transcript: string; currentTime: number } | null> {
  try {
    const tab = await chrome.tabs.get(tabId).catch(() => null)
    if (!tab?.url) return null
    const currentUrl = tab.url
    const videoId = new URL(currentUrl).searchParams.get('v')
    console.log('[bg] youtube extract start | currentUrl:', currentUrl, '| currentVideoId:', videoId)
    if (!videoId) return null

    // Get current playback position
    const timeResult = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: () => (document.querySelector('video') as HTMLVideoElement | null)?.currentTime ?? 0,
    }).catch(() => null)
    const currentTime = (timeResult?.[0]?.result as number | undefined) ?? 0

    // ── Step 0: Server-side transcript fetch (most reliable — avoids all browser cookie issues) ─
    // The Express server uses the youtube-transcript library which works server-side without
    // cookie restrictions. YouTube's timedtext API blocks fetches from extensions regardless
    // of origin (returns text/html with status 200), but server-side fetches bypass this.
    try {
      const serverRes = await fetch(`${API_BASE}/transcribe/youtube?videoId=${encodeURIComponent(videoId)}`, {
        headers: { 'Accept': 'application/json' },
      })
      if (serverRes.ok) {
        const data = await serverRes.json() as { available?: boolean; text?: string }
        if (data.available && data.text && data.text.length > 30) {
          console.log('[bg] step0 server transcript success | len:', data.text.length)
          return { transcript: data.text, currentTime }
        }
        console.log('[bg] step0 server transcript: not available or empty')
      } else {
        console.log('[bg] step0 server transcript: status', serverRes.status)
      }
    } catch (e) {
      console.warn('[bg] step0 server transcript error (server not running?):', (e as Error).message)
    }

    // ── Step 1: ytInitialPlayerResponse (fast path — works when SPA is settled) ─
    const scriptResult = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: () => {
        const ipr = (window as unknown as Record<string, unknown>)['ytInitialPlayerResponse'] as {
          videoDetails?: { videoId?: string }
          captions?: { playerCaptionsTracklistRenderer?: { captionTracks?: Array<{ baseUrl?: string; languageCode?: string }> } }
        } | undefined
        const tracks = ipr?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? []
        const iprVideoId = ipr?.videoDetails?.videoId ?? ''
        const track = tracks.find(t => t.languageCode?.startsWith('en')) ?? tracks[0]
        return { captionUrl: track?.baseUrl ?? '', iprVideoId, trackCount: tracks.length }
      },
    }).catch((e) => { console.warn('[bg] step1 executeScript error:', e); return null })

    const pageData = scriptResult?.[0]?.result as { captionUrl: string; iprVideoId: string; trackCount: number } | null
    console.log('[bg] step1 ytIPR | trackCount:', pageData?.trackCount, '| iprVideoId:', pageData?.iprVideoId, '| match:', pageData?.iprVideoId === videoId)

    if (pageData?.captionUrl && pageData.iprVideoId === videoId) {
      // Fetch transcript inside the tab's page context (service worker fetch is blocked by YouTube)
      const transcript = await fetchTranscriptInPage(tabId, pageData.captionUrl, videoId, 'en')
      if (transcript) {
        console.log('[bg] step1 success | transcript length:', transcript.length)
        return { transcript, currentTime }
      }
    }

    // ── Step 2: HTML page fetch — gets captionUrl for the exact videoId, bypasses SPA staleness
    // The actual transcript fetch also runs inside the page via executeScript
    const htmlTranscript = await fetchTranscriptFromHTML(videoId, tabId)
    if (htmlTranscript) {
      console.log('[bg] step2 success | transcript length:', htmlTranscript.length)
      return { transcript: htmlTranscript, currentTime }
    }

    // ── Step 3: InnerTube API — get captionUrl via POST, fetch transcript in page ─
    try {
      const playerRes = await fetch(
        'https://www.youtube.com/youtubei/v1/player',
        {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            'X-YouTube-Client-Name': '1',
            'X-YouTube-Client-Version': '2.20231121.08.00',
          },
          body: JSON.stringify({
            videoId,
            context: {
              client: {
                hl: 'en', gl: 'US',
                clientName: 'WEB',
                clientVersion: '2.20231121.08.00',
                userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
              },
            },
          }),
        },
      )
      if (playerRes.ok) {
        const pd = await playerRes.json() as {
          captions?: { playerCaptionsTracklistRenderer?: { captionTracks?: Array<{ baseUrl?: string; languageCode?: string }> } }
        }
        const tracks = pd?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? []
        console.log('[bg] step3 innertube | trackCount:', tracks.length)
        const track = tracks.find(t => t.languageCode?.startsWith('en')) ?? tracks[0]
        if (track?.baseUrl) {
          const lang = track.languageCode ?? 'en'
          const transcript = await fetchTranscriptFromSW(track.baseUrl, videoId, lang)
            ?? await fetchTranscriptInPage(tabId, track.baseUrl, videoId, lang)
          if (transcript) {
            console.log('[bg] step3 innertube success | transcript length:', transcript.length)
            return { transcript, currentTime }
          }
        }
      } else {
        console.warn('[bg] step3 innertube: non-ok status:', playerRes.status)
      }
    } catch (e) { console.warn('[bg] step3 innertube error:', e) }

    // ── Step 4: DOM TextTrack captions from content script ────────────────────
    const contentData = await new Promise<{ transcript: string; currentTime: number } | null>((resolve) => {
      chrome.tabs.sendMessage(tabId, { type: 'FETCH_TRANSCRIPT' }, (response) => {
        if (chrome.runtime.lastError || !response) { resolve(null); return }
        resolve(response as { transcript: string; currentTime: number })
      })
    })
    const liveCaption = contentData?.transcript ?? ''
    console.log('[bg] step4 texttrack length:', liveCaption.length)
    if (liveCaption.length > 30) return { transcript: liveCaption, currentTime }

    console.warn('[bg] youtube final mode: transcript-failed (all steps exhausted)')
    return { transcript: '', currentTime }
  } catch (e) {
    console.error('[bg] fetchTranscriptFromTab error:', e)
    return null
  }
}

// ─── Offscreen document ───────────────────────────────────────────────────────

let offscreenReady = false

async function ensureOffscreen() {
  if (offscreenReady) return
  const existing = await chrome.offscreen.hasDocument()
  if (!existing) {
    await chrome.offscreen.createDocument({
      url: chrome.runtime.getURL('src/offscreen/index.html'),
      reasons: [chrome.offscreen.Reason.USER_MEDIA],
      justification: 'Record tab audio for button-triggered extraction',
    })
  }
  offscreenReady = true
}

// closeOffscreen is available if needed in the future
// async function closeOffscreen() { ... }

// ─── Audio capture management ─────────────────────────────────────────────────

async function startAudioCapture(tabId: number) {
  // Hard block: YouTube must NEVER have its audio captured (would mute the tab)
  const tabState = tabStates.get(tabId)
  if (tabState?.platform === 'youtube') {
    console.warn('[bg] startAudioCapture: blocked for YouTube tab', tabId)
    return
  }
  try {
    const streamId = await new Promise<string>((resolve, reject) => {
      chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }, (id) => {
        if (chrome.runtime.lastError) reject(chrome.runtime.lastError)
        else resolve(id)
      })
    })
    // Re-check after async gap — tab may have navigated to YouTube while waiting
    const currentState = tabStates.get(tabId)
    if (currentState?.platform === 'youtube') {
      console.warn('[bg] startAudioCapture: aborting — tab navigated to YouTube', tabId)
      return
    }
    await ensureOffscreen()
    await chrome.runtime.sendMessage({ type: 'START_AUDIO_CAPTURE', streamId })
  } catch (err) {
    console.warn('[bg] audio capture start failed:', err)
  }
}

async function stopAudioCapture() {
  try {
    if (offscreenReady) {
      await chrome.runtime.sendMessage({ type: 'STOP_AUDIO_CAPTURE' })
    }
  } catch { /* ignore */ }
}

async function flushAudio(): Promise<AudioDataMessage | null> {
  if (!offscreenReady) return null
  try {
    const response = await chrome.runtime.sendMessage({ type: 'FLUSH_AUDIO' })
    return response ?? null
  } catch {
    return null
  }
}

// ─── Side panel open/close tracking ──────────────────────────────────────────

chrome.action.onClicked.addListener((tab) => {
  if (tab.id == null) return
  sidePanelOpen = true
  chrome.sidePanel.open({ tabId: tab.id })
})

// ─── Tab monitoring ───────────────────────────────────────────────────────────

function makeTabState(platform: Platform, url: string, title: string, overrides: Partial<TabState> = {}): TabState {
  return {
    platform,
    url,
    title,
    strategy: resolveStrategy(platform),
    captionChunks: [],
    session: null,
    extracting: false,
    audioRetryHintShown: false,
    liveTimer: null,
    youtubeAutoExtracted: false,
    isPlaying: false,
    isRecording: false,
    extractionId: null,
    lastTranscriptTimestamp: 0,
    tabId: null,
    ...overrides,
  }
}

async function handleTabChange(tabId: number, url: string, title: string) {
  const platform = detectPlatform(url)
  const prev = tabStates.get(tabId)

  // Preserve state if same URL — tab switch must not interrupt extraction
  if (prev && prev.url === url) {
    broadcastPlatformDetected(tabId, prev)
    return
  }

  // Clear timers from previous state
  if (prev) {
    if (prev.liveTimer) { clearInterval(prev.liveTimer); prev.liveTimer = null }
    if (prev.platform !== 'youtube' && platform !== prev.platform) stopAudioCapture()
    // Stop extractionPoll alarm when this tab navigates away from a playing page.
    // Do NOT clear on a mere tab switch — other tabs are irrelevant to the alarm.
    chrome.storage.local.get(['extraction_poll_tab_id'], (result) => {
      if (result.extraction_poll_tab_id === tabId) {
        chrome.alarms.clear('extractionPoll')
        chrome.storage.local.remove(['extraction_poll_tab_id', 'active_video_url'])
      }
    })
  }

  // Try to restore session from storage (preserves across SW restarts and tab switches)
  const { session } = await loadSessionFromStorage(url)

  const state = makeTabState(platform, url, title, { session, tabId })
  tabStates.set(tabId, state)

  if (platform !== 'unknown') selectedMode = detectMode(title)

  broadcastPlatformDetected(tabId, state)

  if (sidePanelOpen && platform !== 'youtube' && platform !== 'unknown') {
    startAudioCapture(tabId)
  }
}

function broadcastPlatformDetected(_tabId: number, state: TabState) {
  const msg: PlatformDetectedMessage = {
    type: 'PLATFORM_DETECTED',
    platform: state.platform,
    url: state.url,
    title: state.title,
    strategy: state.strategy,
    signal: state.signal,
    detectedMode: detectMode(state.title),
  }
  chrome.runtime.sendMessage(msg).catch(() => {})

  // Hydrate side panel with cached analysis for this URL (or null if no cache).
  // This is what keeps the extraction visible across tab/URL switches and SW restarts.
  if (state.url) {
    loadCachedAnalysis(state.url).then((pack) => broadcastCurrentAnalysis(state.url, pack))
  }
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // Handle both full page loads and SPA navigation (pushState URL changes)
  if (changeInfo.status !== 'complete' && !changeInfo.url) return
  if (!tab.url) return
  // title may be empty during SPA navigation — use existing stored title as fallback
  const existingTitle = tabStates.get(tabId)?.title ?? ''
  handleTabChange(tabId, tab.url, tab.title || existingTitle)
})

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  const tab = await chrome.tabs.get(tabId)
  if (!tab.url || !tab.title) return
  handleTabChange(tabId, tab.url, tab.title)
})

chrome.tabs.onRemoved.addListener((tabId) => {
  tabStates.delete(tabId)
})

// ─── Messages from content scripts ────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender) => {
  const tabId = sender.tab?.id
  if (tabId == null) return

  if (message.type === 'YOUTUBE_SIGNAL') {
    const msg = message as YouTubeSignalMessage
    // Create state if SW was restarted and lost in-memory state
    if (!tabStates.has(tabId) && sender.tab?.url) {
      const platform = detectPlatform(sender.tab.url)
      if (platform !== 'unknown') {
        tabStates.set(tabId, makeTabState(platform, sender.tab.url, sender.tab.title ?? '', { tabId }))
      }
    }
    const state = tabStates.get(tabId)
    if (!state) return
    state.signal = msg.signal
    tabStates.set(tabId, state)
    broadcastPlatformDetected(tabId, state)
    // Extraction is button-triggered — no auto-extract on signal
    return
  }

  if (message.type === 'VIDEO_PAUSED') {
    const stateOnPause = tabStates.get(tabId)
    if (stateOnPause) {
      stateOnPause.isPlaying = false
      if (stateOnPause.liveTimer) { clearInterval(stateOnPause.liveTimer); stateOnPause.liveTimer = null }
      tabStates.set(tabId, stateOnPause)
      // Pause should only update playback state. Extraction is explicitly button-triggered.
      if (stateOnPause.isRecording) {
        stateOnPause.isRecording = false
        tabStates.set(tabId, stateOnPause)
      }
    }
    chrome.storage.local.get(['extraction_poll_tab_id'], (result) => {
      if (result.extraction_poll_tab_id === tabId) chrome.alarms.clear('extractionPoll')
    })
    return
  }

  if (message.type === 'VIDEO_CHANGED') {
    // Content script detected SPA navigation — reset session for new URL.
    // Use message.url (from location.href) — authoritative, never stale.
    // Use message.title if provided (document.title at navigate-finish time),
    // otherwise fall back to sender.tab.title.
    const newUrl = (message.url as string) || sender.tab?.url || ''
    const newTitle = (message.title as string) || sender.tab?.title || ''
    if (!newUrl) return

    const state = tabStates.get(tabId)
    if (state) {
      state.isPlaying = false
      state.captionChunks = []
      tabStates.set(tabId, state)
    }
    chrome.storage.local.get(['extraction_poll_tab_id'], (result) => {
      if (result.extraction_poll_tab_id === tabId) {
        chrome.alarms.clear('extractionPoll')
        chrome.storage.local.remove(['extraction_poll_tab_id'])
      }
    })
    handleTabChange(tabId, newUrl, newTitle)
    return
  }

  if (message.type === 'VIDEO_RESUMED') {
    if (!tabStates.has(tabId) && sender.tab?.url) {
      const platform = detectPlatform(sender.tab.url)
      if (platform !== 'unknown') {
        tabStates.set(tabId, makeTabState(platform, sender.tab.url, sender.tab.title ?? ''))
      }
    }
    const state = tabStates.get(tabId)
    if (!state || !sidePanelOpen) return
    state.isPlaying = true
    tabStates.set(tabId, state)
    // Start extractionPoll alarm (0.5 min) to keep audio capture alive
    chrome.alarms.get('extractionPoll', (existing) => {
      if (!existing) chrome.alarms.create('extractionPoll', { periodInMinutes: 0.5 })
    })
    chrome.storage.local.set({ extraction_poll_tab_id: tabId, active_video_url: state.url })
    // Keep audio capture running so the buffer is ready when the user hits Extract
    if (state.platform !== 'youtube' && state.platform !== 'unknown') {
      startAudioCapture(tabId)
    }
    return
  }

  // Legacy live-caption support (kept for YouTube weak-signal fallback)
  if (message.type === 'LIVE_CAPTURE_CHUNK') {
    const state = tabStates.get(tabId)
    if (!state) return
    state.captionChunks.push(message.text)
    tabStates.set(tabId, state)
  }
})

// ─── Messages from side panel ─────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'GET_CURRENT_PLATFORM') {
    // Panel is clearly open if it's asking — restore flag after SW restart
    sidePanelOpen = true
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0]
      if (!tab?.id) { sendResponse(null); return }

      let state = tabStates.get(tab.id)
      if (!state && tab.url && tab.title) {
        const platform = detectPlatform(tab.url)
        state = makeTabState(platform, tab.url, tab.title)
        tabStates.set(tab.id, state)
      }
      sendResponse(state ?? null)

      // Start audio capture so the buffer is ready for the Extract button
      if (state && state.platform !== 'youtube' && state.platform !== 'unknown') {
        startAudioCapture(tab.id)
      }
    })
    return true
  }

  if (message.type === 'SIDEPANEL_OPENED') {
    sidePanelOpen = true
    // Start audio capture for the current active tab if applicable
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0]
      if (!tab?.id) return
      const state = tabStates.get(tab.id)
      if (state && state.platform !== 'youtube' && state.platform !== 'unknown') {
        startAudioCapture(tab.id)
      }
    })
    return
  }

  if (message.type === 'SIDEPANEL_CLOSED') {
    sidePanelOpen = false
    stopAudioCapture()
    return
  }

  if (message.type === 'SET_MODE') {
    selectedMode = message.mode as OutcomeMode
    return
  }

  if (message.type === 'START_EXTRACTION') {
    // Manual extraction trigger (fallback / user-initiated)
    handleStartExtraction(message.tabId, message.mode, !!message.force)
    return
  }

  if (message.type === 'CLEAR_ANALYSIS') {
    // User actively cleared the current result — drop cache for the active URL.
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0]
      const url = (message.url as string | undefined) ?? tab?.url ?? ''
      if (url) {
        clearCachedAnalysis(url).then(() => broadcastCurrentAnalysis(url, null))
      }
    })
    return
  }

  if (message.type === 'GET_CURRENT_ANALYSIS') {
    // Side panel asks on mount which analysis is current — for the active URL.
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      const tab = tabs[0]
      if (!tab?.url) {
        const stored = await loadCurrentAnalysis()
        sendResponse(stored)
        return
      }
      const cached = await loadCachedAnalysis(tab.url)
      sendResponse(cached ? { url: tab.url, pack: cached } : null)
    })
    return true
  }

  if (message.type === 'GET_SESSION') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0]
      const state = tab?.id ? tabStates.get(tab.id) : null
      sendResponse(state?.session ?? null)
    })
    return true
  }
})

// ─── YouTube alarm-based polling ─────────────────────────────────────────────

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== 'extractionPoll') return

  // Retrieve the tabId stored when polling was started (survives SW restarts)
  const stored = await chrome.storage.local.get(['extraction_poll_tab_id', 'active_video_url'])
  const tabId = stored.extraction_poll_tab_id as number | undefined
  const activeUrl = stored.active_video_url as string | undefined

  if (!tabId) return

  // Rebuild TabState from storage if the SW was restarted and lost in-memory state
  if (!tabStates.has(tabId) && activeUrl) {
    const { session, lastTranscriptTimestamp } = await loadSessionFromStorage(activeUrl)
    const tab = await chrome.tabs.get(tabId).catch(() => null)
    if (tab?.url) {
      // Use the tab's CURRENT url — the stored activeUrl may be stale (tab navigated)
      const currentPlatform = detectPlatform(tab.url)
      if (currentPlatform !== 'unknown') {
        tabStates.set(tabId, makeTabState(currentPlatform, tab.url, tab.title ?? '', {
          session,
          lastTranscriptTimestamp,
          tabId,
          isPlaying: true,
        }))
      }
    }
  }

  const state = tabStates.get(tabId)
  if (!state || !state.isPlaying || !sidePanelOpen) return

  // Send FETCH_TRANSCRIPT to the video tab (NOT the active tab) so captions
  // are updated even when the user has switched to a different tab.
  chrome.tabs.sendMessage(tabId, { type: 'FETCH_TRANSCRIPT' }, (response) => {
    if (chrome.runtime.lastError) return  // tab closed or navigated away
    if (response?.transcript) {
      const s = tabStates.get(tabId)
      if (s && s.platform !== 'youtube') {
        // Accumulate latest captions so the next Extract button click has fresh context
        s.captionChunks = [response.transcript]
        tabStates.set(tabId, s)
      }
    }
  })

  // Keep audio capture alive for live platforms (ensure buffer is always ready)
  if (state.platform !== 'youtube' && state.platform !== 'unknown') {
    startAudioCapture(tabId)
  }
})

// ─── Manual extraction (user-triggered via Extract button) ───────────────────

async function handleStartExtraction(tabId: number, mode: OutcomeMode, force = false) {
  if (!tabStates.has(tabId)) {
    const tab = await chrome.tabs.get(tabId).catch(() => null)
    if (!tab?.url) return
    const platform = detectPlatform(tab.url)
    if (platform === 'unknown') return
    tabStates.set(tabId, makeTabState(platform, tab.url, tab.title ?? '', { tabId }))
  }
  selectedMode = mode
  const state = tabStates.get(tabId)!

  console.log('[bg] handleStartExtraction | platform:', state.platform, '| url:', state.url, '| isRecording:', state.isRecording, '| force:', force)

  // Note: content-aware cache check moved into runExtraction. Reason: it needs
  // the actual transcript or audio buffer to compute a content hash. Doing it
  // here would either be URL-only (too coarse — same URL + new mode hits the
  // wrong cached pack) or duplicate the transcript fetch.
  state.skipKeyedCache = force === true
  tabStates.set(tabId, state)

  if (state.platform === 'youtube') {
    // MODE A: fetch full transcript first
    console.log('[bg] YouTube: fetching transcript…')
    chrome.runtime.sendMessage({ type: 'EXTRACTION_PROGRESS', percent: 15, statusText: 'Transcript wird gelesen…' }).catch(() => {})
    const transcriptData = await fetchTranscriptFromTab(tabId)
    const transcript = transcriptData?.transcript ?? ''
    console.log('[bg] YouTube transcript length:', transcript.length)

    // Re-read state — user may have navigated away during the async fetch
    const freshState = tabStates.get(tabId)
    if (!freshState || freshState.url !== state.url) {
      console.log('[bg] Tab navigated during transcript fetch — aborting')
      return
    }

    if (transcript.length > 30) {
      console.log('[bg] youtube final mode: transcript-success | chars:', transcript.length)
      chrome.runtime.sendMessage({ type: 'EXTRACTION_PROGRESS', percent: 35, statusText: 'Vollständiges Video wird analysiert…' }).catch(() => {})
      if (freshState.isRecording) { freshState.isRecording = false; tabStates.set(tabId, freshState) }
      await runExtraction(tabId, freshState, { transcript })
    } else {
      // Transcript unavailable — audio capture would mute the YouTube tab, so never enter audio mode for YouTube.
      // Show a clear actionable error instead.
      console.log('[bg] YouTube: transcript unavailable — showing error, NOT entering audio mode')
      chrome.runtime.sendMessage({
        type: 'EXTRACTION_ERROR',
        message: 'Kein Transcript gefunden. Aktiviere die YouTube-Untertitel (CC-Taste) für dieses Video und versuche es erneut.',
        isHint: true,
      }).catch(() => {})
    }
  } else {
    // MODE B: TikTok / Instagram / Facebook — always audio
    console.log('[bg] MODE B audio | platform:', state.platform, '| offscreenReady:', offscreenReady)
    await extractFromBufferedAudio(tabId, state)
  }
}

async function extractFromBufferedAudio(tabId: number, state: TabState) {
  // Hard block: YouTube must NEVER enter audio/recording mode
  if (state.platform === 'youtube') {
    console.warn('[bg] toggleRecording: hard-blocked for YouTube — showing transcript hint')
    chrome.runtime.sendMessage({
      type: 'EXTRACTION_ERROR',
      message: 'Kein Transcript gefunden. Aktiviere die YouTube-Untertitel (CC-Taste) für dieses Video und versuche es erneut.',
      isHint: true,
    }).catch(() => {})
    return
  }

  // For non-YouTube platforms, capture runs continuously after first play.
  // Extract should consume the current buffer immediately on button click.
  console.log('[bg] extractFromBufferedAudio: flushing live buffer | platform:', state.platform)
  if (state.isRecording) {
    state.isRecording = false
    tabStates.set(tabId, state)
  }
  await flushAndAnalyze(tabId, state)
}

async function flushAndAnalyze(tabId: number, state: TabState) {
  console.log('[bg] flushAndAnalyze | platform:', state.platform)
  const audioData = await flushAudio()
  console.log('[bg] flushAudio result | hasData:', !!audioData?.data, '| durationMs:', audioData?.durationMs)
  if (!audioData?.data) {
    const errMsg = state.platform === 'youtube'
      ? 'Kein Audio aufgezeichnet. Starte das Video, klicke Extract, warte einige Sekunden, dann pausiere.'
      : 'Kein Audio im Puffer. Das Video muss laufen, bevor du Extract klickst. Warte nach dem Klick mindestens 3 Sekunden vor dem Pausieren.'
    chrome.runtime.sendMessage({ type: 'EXTRACTION_ERROR', message: errMsg }).catch(() => {})
    return
  }
  await runExtraction(tabId, state, { audio: audioData.data })
  // Restart capture so next recording segment is ready (does NOT set isRecording = true)
  startAudioCapture(tabId)
}

// ─── Partial JSON extraction for streaming preview ───────────────────────────

function unescapeJson(s: string): string {
  return s.replace(/\\"/g, '"').replace(/\\n/g, ' ').replace(/\\t/g, ' ').replace(/\\\\/g, '\\')
}

function parsePartialJson(text: string): { title?: string; summary?: string; keywords: string[]; key_takeaways: string[] } {
  const result: { title?: string; summary?: string; keywords: string[]; key_takeaways: string[] } = { keywords: [], key_takeaways: [] }

  const titleMatch = /"title"\s*:\s*"((?:[^"\\]|\\.)+)"/.exec(text)
  if (titleMatch) result.title = unescapeJson(titleMatch[1])

  const summaryMatch = /"summary"\s*:\s*"((?:[^"\\]|\\.)+)"/.exec(text)
  if (summaryMatch) result.summary = unescapeJson(summaryMatch[1])

  // Extract keywords array (short strings, no length floor)
  const kwIdx = text.indexOf('"keywords"')
  if (kwIdx !== -1) {
    const arrStart = text.indexOf('[', kwIdx)
    const arrEnd = text.indexOf(']', arrStart)
    const slice = arrEnd !== -1 ? text.slice(arrStart, arrEnd) : text.slice(arrStart)
    const kwRe = /"((?:[^"\\]|\\.)+?)"/g
    let m: RegExpExecArray | null
    while ((m = kwRe.exec(slice)) !== null) {
      const s = unescapeJson(m[1])
      if (s.length > 0 && s.length < 60) result.keywords.push(s)
    }
  }

  // Extract complete bullet strings from bullets or key_takeaways array
  const arrIdx = Math.max(text.indexOf('"key_takeaways"'), text.indexOf('"bullets"'))
  if (arrIdx !== -1) {
    const section = text.slice(arrIdx).replace(/^"(?:key_takeaways|bullets)"\s*:\s*\[/, '')
    const bulletRe = /"((?:[^"\\]|\\.){20,})"/g
    let m
    while ((m = bulletRe.exec(section)) !== null) {
      const s = unescapeJson(m[1])
      if (s.length > 20) result.key_takeaways.push(s)
    }
  }

  return result
}

// ─── Main extraction via server streaming (SSE) ───────────────────────────────

async function runExtraction(tabId: number, state: TabState, content: { transcript?: string; audio?: string }) {
  if (state.extracting) return

  // YouTube transcripts cover the entire video; live audio captures only the buffer.
  const extractionScope = state.platform === 'youtube' ? 'full_video' : 'current_segment'

  // Content-aware cache check. Skip the LLM call when the same video has already
  // been analyzed with the same mode/scope and an unchanged transcript/audio.
  // The `skipKeyedCache` flag (set when the user clicks "New Analysis") forces a fresh run.
  const contentHash = await hashContent(content)
  const cacheKey = await buildExtractionCacheKey({
    url: state.url,
    mode: selectedMode,
    scope: extractionScope,
    contentHash,
  })

  if (!state.skipKeyedCache) {
    const cached = await loadKeyedAnalysis(cacheKey)
    if (cached) {
      console.log('[bg] keyed-cache hit — skipping LLM call | key:', cacheKey.slice(0, 12))
      await saveCachedAnalysis(state.url, cached)
      chrome.runtime.sendMessage({ type: 'EXTRACTION_COMPLETE', pack: cached, segmentId: cached.id }).catch(() => {})
      return
    }
  }
  // Reset the force-flag once consumed.
  state.skipKeyedCache = false

  if (!state.session || state.session.url !== state.url) {
    state.session = { url: state.url, platform: state.platform, title: state.title, segments: [] }
  }
  const segmentId = crypto.randomUUID()
  const packId = crypto.randomUUID()
  state.session.segments.push({ id: segmentId, pausedAt: new Date().toISOString(), result: null })
  state.extracting = true
  tabStates.set(tabId, state)
  broadcastSessionUpdate(state.session)

  chrome.runtime.sendMessage({ type: 'EXTRACTION_PROGRESS', percent: 25, statusText: 'Analysiere Inhalt…' }).catch(() => {})

  const token = await getSupabaseSession()

  try {
    const sessionContext = getSessionContext(state.session)
    const payload = {
      url: state.url,
      platform: state.platform,
      mode: selectedMode,
      strategy: state.strategy,
      extractionScope,
      transcript: content.transcript,
      audioData: content.audio,
      audioMimeType: content.audio ? 'audio/webm' : undefined,
      metadata: { title: state.title, description: '' },
      ...(sessionContext ? { sessionContext } : {}),
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 90_000)

    const res = await fetch(`${API_BASE}/extract/stream`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(payload),
    })

    if (!res.ok) {
      clearTimeout(timeout)
      const err = await res.json().catch(() => ({})) as Record<string, unknown>
      chrome.runtime.sendMessage({ type: 'EXTRACTION_ERROR', message: (err.message as string) ?? (err.error as string) ?? `Error ${res.status}`, segmentId }).catch(() => {})
      removeSegment(state.session, segmentId)
      return
    }

    // Read SSE stream
    const reader = res.body!.getReader()
    const decoder = new TextDecoder()
    let sseBuffer = ''
    let accumulated = ''
    let lastStreamingUpdate = 0
    let lastStreamingPack: Pack | null = null
    let gotDone = false

    const basePackFields = {
      id: packId,
      userId: token ?? '',
      url: state.url,
      platform: state.platform,
      mode: selectedMode,
      savedAt: new Date().toISOString(),
    }

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      sseBuffer += decoder.decode(value, { stream: true })
      const lines = sseBuffer.split('\n')
      sseBuffer = lines.pop() ?? ''

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        const raw = line.slice(6).trim()
        if (!raw) continue

        let event: Record<string, unknown>
        try { event = JSON.parse(raw) } catch { continue }

        if (event.type === 'chunk') {
          accumulated += (event.text as string) ?? ''
          chrome.runtime.sendMessage({ type: 'EXTRACTION_PROGRESS', percent: 60, statusText: 'Erstelle Zusammenfassung…' }).catch(() => {})

          // Send streaming update every 80 chars (was 150) for snappier perceived progress.
          if (accumulated.length - lastStreamingUpdate > 80) {
            lastStreamingUpdate = accumulated.length
            const partial = parsePartialJson(accumulated)
            if (partial.title || partial.summary || partial.keywords.length > 0 || partial.key_takeaways.length > 0) {
              const streamPack: Pack = {
                ...basePackFields,
                title: partial.title ?? state.title,
                summary: partial.summary ?? '',
                keywords: partial.keywords,
                key_takeaways: partial.key_takeaways,
              }
              lastStreamingPack = streamPack
              chrome.runtime.sendMessage({ type: 'EXTRACTION_STREAMING', pack: streamPack }).catch(() => {})
            }
          }
        } else if (event.type === 'done') {
          gotDone = true
          clearTimeout(timeout)
          const data = event.data as {
            title?: string
            summary?: string
            keywords?: string[]
            key_takeaways?: string[]
            important_links?: RelatedLink[]
            quick_facts?: QuickFacts
            v2?: ExtractionPackV2
          } | undefined

          // If done data has no bullets (truncated JSON fallback on server), prefer streaming content
          const doneKeyTakeaways = data?.key_takeaways ?? []
          const finalKeyTakeaways = doneKeyTakeaways.length > 0
            ? doneKeyTakeaways
            : (lastStreamingPack?.key_takeaways ?? [])

          const pack: Pack = {
            ...basePackFields,
            title: data?.title || lastStreamingPack?.title || state.title,
            summary: data?.summary || lastStreamingPack?.summary || '',
            keywords: data?.keywords ?? lastStreamingPack?.keywords ?? [],
            key_takeaways: finalKeyTakeaways,
            important_links: data?.important_links ?? [],
            quick_facts: data?.quick_facts,
            ...(data?.v2 ? { v2: data.v2 } : {}),
          }
          const seg = state.session?.segments.find(s => s.id === segmentId)
          if (seg) seg.result = pack
          if (state.session) {
            broadcastSessionUpdate(state.session)
            saveSessionToStorage(state.url, state.session, state.extractionId, state.tabId ?? undefined, state.lastTranscriptTimestamp)
          }
          // Persist the analysis so it survives URL/tab/SW changes and shows instantly on revisit.
          saveCachedAnalysis(state.url, pack).catch(() => {})
          saveKeyedAnalysis(cacheKey, pack).catch(() => {})
          chrome.runtime.sendMessage({ type: 'EXTRACTION_COMPLETE', pack, segmentId }).catch(() => {})
        } else if (event.type === 'progress') {
          const percent = typeof event.percent === 'number' ? event.percent : 90
          const statusText = typeof event.statusText === 'string' ? event.statusText : 'Verifying links…'
          chrome.runtime.sendMessage({ type: 'EXTRACTION_PROGRESS', percent, statusText }).catch(() => {})
        } else if (event.type === 'error') {
          clearTimeout(timeout)
          throw new Error((event.message as string) ?? 'Server error during extraction')
        }
      }
    }

    clearTimeout(timeout)

    // Stream closed without a done event — fall back to last streaming content
    if (!gotDone) {
      if (lastStreamingPack) {
        const seg = state.session?.segments.find(s => s.id === segmentId)
        if (seg) seg.result = lastStreamingPack
        if (state.session) {
          broadcastSessionUpdate(state.session)
          saveSessionToStorage(state.url, state.session, state.extractionId, state.tabId ?? undefined, state.lastTranscriptTimestamp)
        }
        saveCachedAnalysis(state.url, lastStreamingPack).catch(() => {})
        saveKeyedAnalysis(cacheKey, lastStreamingPack).catch(() => {})
        chrome.runtime.sendMessage({ type: 'EXTRACTION_COMPLETE', pack: lastStreamingPack, segmentId }).catch(() => {})
      } else {
        chrome.runtime.sendMessage({ type: 'EXTRACTION_ERROR', message: 'Extraktion unterbrochen. Versuche es erneut.', segmentId }).catch(() => {})
        removeSegment(state.session, segmentId)
      }
    }
  } catch (err) {
    const msg = err instanceof Error && err.name === 'AbortError' ? 'Timeout. Versuche es erneut.' : (err instanceof Error ? err.message : 'Unbekannter Fehler')
    chrome.runtime.sendMessage({ type: 'EXTRACTION_ERROR', message: msg, segmentId }).catch(() => {})
    removeSegment(state.session, segmentId)
  } finally {
    state.extracting = false
    tabStates.set(tabId, state)
  }
}


// ─── Helpers ──────────────────────────────────────────────────────────────────

function broadcastSessionUpdate(session: VideoSession) {
  chrome.runtime.sendMessage({ type: 'SESSION_UPDATE', session }).catch(() => {})
}

function getSessionContext(session: VideoSession | null): string {
  if (!session || session.segments.length === 0) return ''
  return session.segments
    .filter((s) => s.result !== null)
    .map((s) => s.result!.key_takeaways.join('\n'))
    .join('\n---\n')
}

function removeSegment(session: VideoSession | null, segmentId: string) {
  if (!session) return
  session.segments = session.segments.filter((s) => s.id !== segmentId)
}

async function getSupabaseSession(): Promise<string | null> {
  return new Promise((resolve) => {
    chrome.storage.local.get(['supabase_token'], (result) => {
      resolve(result.supabase_token ?? null)
    })
  })
}
