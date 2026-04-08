import type {
  Platform,
  ExtractionStrategy,
  YouTubeSignal,
  PlatformDetectedMessage,
  YouTubeSignalMessage,
  VideoPausedMessage,
  AudioDataMessage,
  ExtractRequest,
  OutcomeMode,
  VideoSession,
  SessionSegment,
  Pack,
} from '@shared/types'
import { detectMode } from '@shared/types'
import { SUPERGLUE_HOOKS } from '../config/superglue'

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
  extracting: boolean           // debounce: prevent double-triggering on rapid pause/play
  audioRetryHintShown: boolean  // true after first no-audio attempt — next is a real error
}

const tabStates = new Map<number, TabState>()
let selectedMode: OutcomeMode = 'knowledge'
let sidePanelOpen = false

// ─── Offscreen document ───────────────────────────────────────────────────────

let offscreenReady = false

async function ensureOffscreen() {
  if (offscreenReady) return
  const existing = await chrome.offscreen.hasDocument()
  if (!existing) {
    await chrome.offscreen.createDocument({
      url: chrome.runtime.getURL('src/offscreen/index.html'),
      reasons: [chrome.offscreen.Reason.USER_MEDIA],
      justification: 'Record tab audio for pause-triggered extraction',
    })
  }
  offscreenReady = true
}

// closeOffscreen is available if needed in the future
// async function closeOffscreen() { ... }

// ─── Audio capture management ─────────────────────────────────────────────────

async function startAudioCapture(tabId: number) {
  try {
    const streamId = await new Promise<string>((resolve, reject) => {
      chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }, (id) => {
        if (chrome.runtime.lastError) reject(chrome.runtime.lastError)
        else resolve(id)
      })
    })
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

async function handleTabChange(tabId: number, url: string, title: string) {
  const platform = detectPlatform(url)

  // Stop audio capture from previous tab if platform changes
  const prev = tabStates.get(tabId)
  if (prev && prev.platform !== 'youtube' && platform !== prev.platform) {
    stopAudioCapture()
  }

  const state: TabState = {
    platform,
    url,
    title,
    strategy: resolveStrategy(platform),
    captionChunks: [],
    session: null,
    extracting: false,
    audioRetryHintShown: false,
  }
  tabStates.set(tabId, state)

  // Auto-detect extraction mode from video title
  if (platform !== 'unknown') {
    selectedMode = detectMode(title)
  }

  broadcastPlatformDetected(tabId, state)

  // Only start audio capture if the side panel is already open.
  // chrome.tabCapture.getMediaStreamId() requires the extension to be
  // actively invoked for the tab — it fails silently otherwise.
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
}

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

chrome.tabs.onRemoved.addListener((tabId) => {
  tabStates.delete(tabId)
})

// ─── Messages from content scripts ────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender) => {
  const tabId = sender.tab?.id
  if (tabId == null) return

  if (message.type === 'YOUTUBE_SIGNAL') {
    const msg = message as YouTubeSignalMessage
    const state = tabStates.get(tabId)
    if (!state) return
    state.signal = msg.signal
    tabStates.set(tabId, state)
    broadcastPlatformDetected(tabId, state)
    return
  }

  if (message.type === 'VIDEO_PAUSED') {
    const msg = message as VideoPausedMessage
    // If SW was restarted, tabStates is empty — synthesise from the sender tab
    // so extraction still works without requiring a full page reload.
    if (!tabStates.has(tabId) && sender.tab?.url) {
      const platform = detectPlatform(sender.tab.url)
      if (platform !== 'unknown') {
        tabStates.set(tabId, {
          platform,
          url: sender.tab.url,
          title: sender.tab.title ?? '',
          strategy: resolveStrategy(platform),
          captionChunks: [],
          session: null,
          extracting: false,
          audioRetryHintShown: false,
        })
      }
    }
    handleVideoPaused(tabId, msg.currentTime)
    return
  }

  if (message.type === 'VIDEO_RESUMED') {
    // Synthesise state after SW restart so audio capture can (re)start
    if (!tabStates.has(tabId) && sender.tab?.url) {
      const platform = detectPlatform(sender.tab.url)
      if (platform !== 'unknown') {
        tabStates.set(tabId, {
          platform,
          url: sender.tab.url,
          title: sender.tab.title ?? '',
          strategy: resolveStrategy(platform),
          captionChunks: [],
          session: null,
          extracting: false,
          audioRetryHintShown: false,
        })
      }
    }
    const state = tabStates.get(tabId)
    if (sidePanelOpen && state && state.platform !== 'youtube') {
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
        state = {
          platform,
          url: tab.url,
          title: tab.title,
          strategy: resolveStrategy(platform),
          captionChunks: [],
          session: null,
          extracting: false,
          audioRetryHintShown: false,
        }
        tabStates.set(tab.id, state)
      }
      sendResponse(state ?? null)
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
    handleStartExtraction(message.tabId, message.mode)
    return
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

// ─── Video pause handler ──────────────────────────────────────────────────────

async function handleVideoPaused(tabId: number, currentTime: number) {
  const state = tabStates.get(tabId)
  if (!state || state.platform === 'unknown') return
  if (state.extracting) return  // already processing a previous pause

  state.extracting = true
  tabStates.set(tabId, state)

  // Create / update session
  if (!state.session || state.session.url !== state.url) {
    state.session = {
      url: state.url,
      platform: state.platform,
      title: state.title,
      segments: [],
    }
  }

  const segmentId = crypto.randomUUID()
  const segment: SessionSegment = {
    id: segmentId,
    pausedAt: new Date().toISOString(),
    result: null,
  }
  state.session.segments.push(segment)
  tabStates.set(tabId, state)

  // Broadcast updated session (shows "extracting" state for this segment)
  broadcastSessionUpdate(state.session)
  chrome.runtime.sendMessage({
    type: 'EXTRACTION_PROGRESS',
    percent: 20,
    statusText: 'Analysing…',
  }).catch(() => {})

  if (state.platform === 'youtube') {
    await extractYouTube(tabId, state, segmentId, currentTime)
  } else {
    await extractAudio(tabId, state, segmentId)
  }

  state.extracting = false
  tabStates.set(tabId, state)
}

// ─── YouTube extraction ───────────────────────────────────────────────────────

async function extractYouTube(_tabId: number, state: TabState, segmentId: string, currentTime: number) {
  const previousSummary = getSessionContext(state.session)

  const body: ExtractRequest = {
    url: state.url,
    platform: 'youtube',
    mode: selectedMode,
    strategy: 'instant',
    metadata: { title: state.title, description: '' },
    sessionContext: previousSummary,
    // Pass currentTime so the server can truncate the transcript
    transcript: currentTime > 0 ? `[up to ${Math.floor(currentTime)}s]` : undefined,
  }

  await sendExtractionRequest(body, segmentId, state)
}

// ─── Audio extraction ─────────────────────────────────────────────────────────

async function extractAudio(tabId: number, state: TabState, segmentId: string) {
  const audioData = await flushAudio()

  if (!audioData || !audioData.data) {
    // No audio captured — fall back to caption chunks if available
    if (state.captionChunks.length === 0) {
      if (!state.audioRetryHintShown) {
        // First attempt: audio capture likely failed because the user hasn't
        // interacted with the tab yet (Chrome tabCapture requirement).
        // Show a friendly hint and retry capture so it's ready for the next pause.
        state.audioRetryHintShown = true
        tabStates.set(tabId, state)
        chrome.runtime.sendMessage({
          type: 'EXTRACTION_ERROR',
          message: 'Klicke einmal in das Video und pausiere erneut — dann startet die Extraktion.',
          isHint: true,
          segmentId,
        }).catch(() => {})
        // Retry starting capture now that we know the user is interacting
        startAudioCapture(tabId)
      } else {
        // Second attempt still no audio — real error
        chrome.runtime.sendMessage({
          type: 'EXTRACTION_ERROR',
          message: 'Kein Audio aufgezeichnet. Aktiviere Untertitel oder öffne das Video auf YouTube.',
          segmentId,
        }).catch(() => {})
      }
      removeSegment(state.session, segmentId)
      return
    }
    // Use caption chunks as text
    const body: ExtractRequest = {
      url: state.url,
      platform: state.platform,
      mode: selectedMode,
      strategy: 'live',
      captionChunks: state.captionChunks,
      metadata: { title: state.title, description: '' },
      sessionContext: getSessionContext(state.session),
    }
    state.captionChunks = []
    tabStates.set(tabId, state)
    // Restart capture so the next segment has audio
    startAudioCapture(tabId)
    await sendExtractionRequest(body, segmentId, state)
    return
  }

  const body: ExtractRequest = {
    url: state.url,
    platform: state.platform,
    mode: selectedMode,
    strategy: 'live',
    audioData: audioData.data,
    audioMimeType: audioData.mimeType,
    metadata: { title: state.title, description: '' },
    sessionContext: getSessionContext(state.session),
  }

  // Restart audio capture for next segment
  startAudioCapture(tabId)

  await sendExtractionRequest(body, segmentId, state)
}

// ─── HTTP request ─────────────────────────────────────────────────────────────

const FETCH_TIMEOUT_MS = 60_000

async function sendExtractionRequest(
  body: ExtractRequest,
  segmentId: string,
  state: TabState
) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

  try {
    const session = await getSupabaseSession()

    // Baue superglue Payload
    const payload: Record<string, unknown> = {
      platform: body.platform,
      video_url: body.url,
      user_id: session ?? 'anonymous',
      audio: body.audioData ?? null,
      transcript: body.transcript
        ?? (body.captionChunks ? body.captionChunks.join(' ') : null),
      folder_id: null,
    }

    const res = await fetch(SUPERGLUE_HOOKS.generateSummary, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    clearTimeout(timeout)

    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}))
      const message = errBody.error ?? `Server error: ${res.status}`
      chrome.runtime.sendMessage({
        type: 'EXTRACTION_ERROR',
        message,
        segmentId,
      }).catch(() => {})
      removeSegment(state.session, segmentId)
      return
    }

    const data = await res.json()

    // Mappe superglue Response auf bestehendes Pack Format
    const pack: Pack = {
      id: crypto.randomUUID(),
      userId: session ?? '',
      title: data.title ?? '',
      url: state.url,
      platform: state.platform,
      mode: selectedMode,
      summary: data.summary ?? '',
      bullets: data.key_points ?? [],
      links: (data.tags ?? []).map((t: string) => ({
        title: t,
        url: `https://www.google.com/search?q=${encodeURIComponent(t)}`,
      })),
      savedAt: new Date().toISOString(),
    }

    // Update segment mit Result
    if (state.session) {
      const seg = state.session.segments.find((s) => s.id === segmentId)
      if (seg) seg.result = pack
      broadcastSessionUpdate(state.session)
    }

    chrome.runtime.sendMessage({
      type: 'EXTRACTION_COMPLETE',
      pack,
      segmentId,
    }).catch(() => {})

  } catch (err) {
    clearTimeout(timeout)
    const message =
      err instanceof Error && err.name === 'AbortError'
        ? 'Request timed out. Try again.'
        : err instanceof Error
        ? err.message
        : 'Unknown error'
    chrome.runtime.sendMessage({
      type: 'EXTRACTION_ERROR',
      message,
      segmentId,
    }).catch(() => {})
    removeSegment(state.session, segmentId)
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function broadcastSessionUpdate(session: VideoSession) {
  chrome.runtime.sendMessage({ type: 'SESSION_UPDATE', session }).catch(() => {})
}

function getSessionContext(session: VideoSession | null): string {
  if (!session || session.segments.length === 0) return ''
  const previous = session.segments
    .filter((s) => s.result !== null)
    .map((s) => s.result!.bullets.join('\n'))
    .join('\n---\n')
  return previous
}

function removeSegment(session: VideoSession | null, segmentId: string) {
  if (!session) return
  session.segments = session.segments.filter((s) => s.id !== segmentId)
}

// ─── Manual extraction (user-triggered via Extract button) ───────────────────

async function handleStartExtraction(tabId: number, mode: OutcomeMode) {
  // Synthesise state if SW was restarted (tabStates empty)
  if (!tabStates.has(tabId)) {
    const tab = await chrome.tabs.get(tabId).catch(() => null)
    if (!tab?.url) return
    const platform = detectPlatform(tab.url)
    if (platform === 'unknown') return
    tabStates.set(tabId, {
      platform,
      url: tab.url,
      title: tab.title ?? '',
      strategy: resolveStrategy(platform),
      captionChunks: [],
      session: null,
      extracting: false,
      audioRetryHintShown: false,
    })
  }

  // Override mode for this extraction then delegate to the shared handler
  selectedMode = mode
  await handleVideoPaused(tabId, 0)
}

async function getSupabaseSession(): Promise<string | null> {
  return new Promise((resolve) => {
    chrome.storage.local.get(['supabase_token'], (result) => {
      resolve(result.supabase_token ?? null)
    })
  })
}
