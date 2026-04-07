import type { LiveCaptureChunkMessage } from '@shared/types'

// TikTok uses auto-generated captions rendered in a specific container.
// Capture is only started after an explicit user action (START_LIVE_CAPTURE).

let captureActive = false
let captionObserver: MutationObserver | null = null
let waitObserver: MutationObserver | null = null

// Ordered by stability — data-e2e attributes are most stable,
// class-name partial matches are a fallback for DOM changes.
const CAPTION_SELECTORS = [
  '[data-e2e="video-caption"]',
  '[data-e2e="browse-video-caption"]',
  '[class*="DivCaptionText"]',
  '[class*="caption-text"]',
  '.tiktok-captions span',
]

function findCaptionContainer(): Element | null {
  for (const sel of CAPTION_SELECTORS) {
    const el = document.querySelector(sel)
    if (el) return el
  }
  return null
}

function sendChunk(text: string) {
  const msg: LiveCaptureChunkMessage = { type: 'LIVE_CAPTURE_CHUNK', text, timestamp: Date.now() }
  chrome.runtime.sendMessage(msg)
}

function observe(container: Element) {
  let lastText = ''

  // Emit any text already visible in the container
  const initial = container.textContent?.trim() ?? ''
  if (initial) { lastText = initial; sendChunk(initial) }

  captionObserver = new MutationObserver(() => {
    const text = container.textContent?.trim() ?? ''
    if (text && text !== lastText) {
      lastText = text
      sendChunk(text)
    }
  })
  captionObserver.observe(container, { childList: true, subtree: true, characterData: true })
}

function startLiveCapture() {
  if (captureActive) return
  captureActive = true

  const container = findCaptionContainer()
  if (container) {
    observe(container)
    return
  }

  // Wait for captions to appear (user may not have enabled them yet)
  // Stop waiting after 60 s to avoid leaking the observer
  const deadline = Date.now() + 60_000
  waitObserver = new MutationObserver(() => {
    if (Date.now() > deadline) { waitObserver?.disconnect(); return }
    const c = findCaptionContainer()
    if (c) {
      waitObserver?.disconnect()
      waitObserver = null
      observe(c)
    }
  })
  waitObserver.observe(document.body, { childList: true, subtree: true })
}

function stopLiveCapture() {
  captionObserver?.disconnect()
  captionObserver = null
  waitObserver?.disconnect()
  waitObserver = null
  captureActive = false
}

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'START_LIVE_CAPTURE') startLiveCapture()
  if (message.type === 'STOP_LIVE_CAPTURE') stopLiveCapture()
})
