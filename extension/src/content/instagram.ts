import type { LiveCaptureChunkMessage } from '@shared/types'

// Instagram Reels auto-captions are rendered in a positioned overlay.
// Only activated on explicit user action.

let captionObserver: MutationObserver | null = null
let waitObserver: MutationObserver | null = null

// Ordered by stability — aria and data attributes first, class-name partials as fallback.
const CAPTION_SELECTORS = [
  '[aria-label*="captions" i]',
  '[aria-label*="caption" i]',
  '[class*="Caption"][role]',
  '[class*="x1lliihq"][class*="Caption"]',
  'span[class*="Caption"]',
  '[class*="Caption"]',
]

function findContainer(): Element | null {
  for (const sel of CAPTION_SELECTORS) {
    const el = document.querySelector(sel)
    if (el?.textContent?.trim()) return el
  }
  return null
}

function sendChunk(text: string) {
  const msg: LiveCaptureChunkMessage = { type: 'LIVE_CAPTURE_CHUNK', text, timestamp: Date.now() }
  chrome.runtime.sendMessage(msg)
}

function observe(container: Element) {
  let lastText = ''

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
  if (captionObserver) return

  const container = findContainer()
  if (container) {
    observe(container)
    return
  }

  const deadline = Date.now() + 60_000
  waitObserver = new MutationObserver(() => {
    if (Date.now() > deadline) { waitObserver?.disconnect(); return }
    const c = findContainer()
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
}

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'START_LIVE_CAPTURE') startLiveCapture()
  if (message.type === 'STOP_LIVE_CAPTURE') stopLiveCapture()
})
