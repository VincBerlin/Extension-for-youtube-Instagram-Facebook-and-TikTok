import type {
  Platform,
  ExtractionStrategy,
  YouTubeSignal,
  PlatformDetectedMessage,
  YouTubeSignalMessage,
  LiveCaptureChunkMessage,
  ExtractRequest,
} from '@shared/types'

// ─── Platform detection ───────────────────────────────────────────────────────

function detectPlatform(url: string): Platform {
  try {
    const { hostname } = new URL(url)
    if (hostname.includes('youtube.com') || hostname.includes('youtu.be')) return 'youtube'
    if (hostname.includes('tiktok.com')) return 'tiktok'
    if (hostname.includes('instagram.com')) return 'instagram'
    if (hostname.includes('facebook.com')) return 'facebook'
  } catch {
    // ignore invalid URLs
  }
  return 'unknown'
}

function resolveStrategy(platform: Platform): ExtractionStrategy {
  // YouTube always uses instant — the server fetches transcripts via the youtube-transcript API,
  // so we never need DOM-based live caption capture for YouTube.
  if (platform === 'youtube') return 'instant'
  return 'live'
}

// ─── State ────────────────────────────────────────────────────────────────────

interface TabState {
  platform: Platform
  url: string
  title: string
  signal?: YouTubeSignal
  strategy: ExtractionStrategy
  captionChunks: string[]
}

const tabStates = new Map<number, TabState>()

// ─── Open side panel on action click ─────────────────────────────────────────

chrome.action.onClicked.addListener((tab) => {
  if (tab.id == null) return
  chrome.sidePanel.open({ tabId: tab.id })
})

// ─── Tab monitoring ───────────────────────────────────────────────────────────

async function handleTabChange(tabId: number, url: string, title: string) {
  const platform = detectPlatform(url)

  const state: TabState = {
    platform,
    url,
    title,
    strategy: resolveStrategy(platform),
    captionChunks: [],
  }
  tabStates.set(tabId, state)

  // For non-YouTube platforms we immediately broadcast (no signal needed)
  if (platform !== 'youtube') {
    broadcastPlatformDetected(tabId, state)
    return
  }

  // YouTube: wait for signal from content script (see onMessage handler below)
  // Broadcast an initial "detecting" state so the side panel knows we're working
  broadcastPlatformDetected(tabId, state)
}

function broadcastPlatformDetected(_tabId: number, state: TabState) {
  const msg: PlatformDetectedMessage = {
    type: 'PLATFORM_DETECTED',
    platform: state.platform,
    url: state.url,
    title: state.title,
    strategy: state.strategy,
    signal: state.signal,
  }
  // Send to side panel (may not be open yet — ignore errors)
  chrome.runtime.sendMessage(msg).catch(() => {})
}

// ─── Listen for tab updates ───────────────────────────────────────────────────

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete') return
  if (!tab.url || !tab.title) return
  handleTabChange(tabId, tab.url, tab.title)
})

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  const tab = await chrome.tabs.get(tabId)
  if (!tab.url || !tab.title) return
  handleTabChange(tabId, tab.url, tab.title)
})

// Clean up state when a tab is closed to prevent memory leaks
chrome.tabs.onRemoved.addListener((tabId) => {
  tabStates.delete(tabId)
})

// ─── Messages from content scripts ───────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender) => {
  const tabId = sender.tab?.id
  if (tabId == null) return

  if (message.type === 'YOUTUBE_SIGNAL') {
    const msg = message as YouTubeSignalMessage
    const state = tabStates.get(tabId)
    if (!state) return

    state.signal = msg.signal
    state.strategy = resolveStrategy('youtube')
    tabStates.set(tabId, state)
    broadcastPlatformDetected(tabId, state)
  }

  if (message.type === 'LIVE_CAPTURE_CHUNK') {
    const msg = message as LiveCaptureChunkMessage
    const state = tabStates.get(tabId)
    if (!state) return
    state.captionChunks.push(msg.text)
    tabStates.set(tabId, state)
  }
})

// ─── Messages from side panel ─────────────────────────────────────────────────
// Dev note: Two separate addListener calls are intentional — the first handles
// content-script messages (no async response), the second handles side-panel
// messages (returns true for GET_CURRENT_PLATFORM async response).

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'GET_CURRENT_PLATFORM') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0]
      if (!tab?.id) { sendResponse(null); return }

      let state = tabStates.get(tab.id)

      // Service worker may have been freshly started and lost tabStates.
      // Synthesize state from the tab's current URL so the side panel is not stuck on 'unknown'.
      if (!state && tab.url && tab.title) {
        const platform = detectPlatform(tab.url)
        state = {
          platform,
          url: tab.url,
          title: tab.title,
          strategy: resolveStrategy(platform),
          captionChunks: [],
        }
        tabStates.set(tab.id, state)
      }

      sendResponse(state ?? null)
    })
    return true // async response
  }

  if (message.type === 'START_EXTRACTION') {
    handleStartExtraction(message.tabId, message.mode)
  }
})

// ─── Extraction orchestration ─────────────────────────────────────────────────

const FETCH_TIMEOUT_MS = 30_000

async function handleStartExtraction(tabId: number, mode: string) {
  const state = tabStates.get(tabId)
  if (!state || state.platform === 'unknown') return

  // Guard: live extraction requires captured caption chunks.
  // If none were captured, tell the user to enable captions and let the video play.
  if (state.strategy === 'live' && state.captionChunks.length === 0) {
    chrome.runtime.sendMessage({
      type: 'EXTRACTION_ERROR',
      message: 'No captions were captured. Enable captions/subtitles on the video, let it play for a few seconds, then click Extract Again.',
    }).catch(() => {})
    return
  }

  const API_BASE = import.meta.env.VITE_API_BASE as string

  const body: ExtractRequest = {
    url: state.url,
    platform: state.platform,
    mode: mode as ExtractRequest['mode'],
    strategy: state.strategy,
    metadata: { title: state.title, description: '' },
    captionChunks: state.strategy === 'live' ? state.captionChunks : undefined,
  }

  chrome.runtime.sendMessage({
    type: 'EXTRACTION_PROGRESS',
    percent: 10,
    statusText: 'Sending to extraction engine…',
  }).catch(() => {})

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

  try {
    const session = await getSupabaseSession()
    const res = await fetch(`${API_BASE}/extract`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(session ? { Authorization: `Bearer ${session}` } : {}),
      },
      body: JSON.stringify(body),
    })
    clearTimeout(timeout)

    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}))
      const message = errBody.message ?? errBody.error ?? `Server error: ${res.status}`
      const upgradeRequired = res.status === 429 && !!errBody.plan
      chrome.runtime.sendMessage({
        type: 'EXTRACTION_ERROR',
        message,
        upgradeRequired,
      }).catch(() => {})
      return
    }

    const data = await res.json()

    // Stop live capture in content script after successful extraction
    if (state.strategy === 'live') {
      chrome.tabs.sendMessage(tabId, { type: 'STOP_LIVE_CAPTURE' }).catch(() => {})
      // Reset caption chunks so next extraction starts fresh
      state.captionChunks = []
      tabStates.set(tabId, state)
    }

    chrome.runtime.sendMessage({
      type: 'EXTRACTION_COMPLETE',
      pack: {
        id: crypto.randomUUID(),
        userId: '',
        title: data.title,
        url: state.url,
        platform: state.platform,
        mode: mode,
        bullets: data.bullets,
        savedAt: new Date().toISOString(),
      },
    }).catch(() => {})
  } catch (err) {
    clearTimeout(timeout)
    const message = err instanceof Error && err.name === 'AbortError'
      ? 'Request timed out. Try again.'
      : err instanceof Error ? err.message : 'Unknown error'
    chrome.runtime.sendMessage({
      type: 'EXTRACTION_ERROR',
      message,
    }).catch(() => {})
  }
}

async function getSupabaseSession(): Promise<string | null> {
  return new Promise((resolve) => {
    chrome.storage.local.get(['supabase_token'], (result) => {
      resolve(result.supabase_token ?? null)
    })
  })
}
