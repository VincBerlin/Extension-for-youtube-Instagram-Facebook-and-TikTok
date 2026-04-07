import type { YouTubeSignal, YouTubeSignalMessage, LiveCaptureChunkMessage } from '@shared/types'

// ─── Signal detection ─────────────────────────────────────────────────────────

function detectSignal(): YouTubeSignal {
  // Transcript button: YouTube renders it inside the overflow menu
  const hasTranscript = !!document.querySelector('[aria-label="Show transcript"]')

  // Description: check if description text is non-trivial
  const descText = document.querySelector('#description-inline-expander, ytd-expander #content')?.textContent ?? ''
  const hasDescription = descText.trim().length > 80

  // Chapters: visible in the progress bar
  const hasChapters = document.querySelectorAll('.ytp-chapter-hover-container').length > 0

  // Duration from video element
  const video = document.querySelector<HTMLVideoElement>('video')
  const videoDurationSeconds = video?.duration ?? null

  return { hasTranscript, hasDescription, hasChapters, videoDurationSeconds }
}

function sendSignal() {
  const signal = detectSignal()
  const msg: YouTubeSignalMessage = { type: 'YOUTUBE_SIGNAL', signal }
  chrome.runtime.sendMessage(msg)
}

// ─── Live caption capture ─────────────────────────────────────────────────────

let captureActive = false
let captionObserver: MutationObserver | null = null

function startLiveCapture() {
  if (captureActive) return
  captureActive = true

  const captionWindow =
    document.querySelector('.ytp-caption-window-container') ??
    document.querySelector('.captions-text')?.parentElement ??
    document.querySelector('.captions-text')
  if (!captionWindow) return

  function readText(): string {
    const segments = captionWindow!.querySelectorAll('.ytp-caption-segment')
    return segments.length > 0
      ? Array.from(segments).map((s) => s.textContent ?? '').join(' ').trim()
      : captionWindow!.textContent?.trim() ?? ''
  }

  let lastText = ''

  // Emit any caption text already visible
  const initial = readText()
  if (initial) { lastText = initial; chrome.runtime.sendMessage({ type: 'LIVE_CAPTURE_CHUNK', text: initial, timestamp: Date.now() }) }

  captionObserver = new MutationObserver(() => {
    const text = readText()
    if (text && text !== lastText) {
      lastText = text
      chrome.runtime.sendMessage({ type: 'LIVE_CAPTURE_CHUNK', text, timestamp: Date.now() } as LiveCaptureChunkMessage)
    }
  })

  captionObserver.observe(captionWindow, { childList: true, subtree: true, characterData: true })
}

function stopLiveCapture() {
  captionObserver?.disconnect()
  captionObserver = null
  captureActive = false
}

// ─── Message listener ─────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'START_LIVE_CAPTURE') startLiveCapture()
  if (message.type === 'STOP_LIVE_CAPTURE') stopLiveCapture()
  if (message.type === 'GET_TRANSCRIPT') {
    // Click the transcript button and scrape — simplified stub
    // Full implementation reads .ytd-transcript-segment-renderer items
    chrome.runtime.sendMessage({ type: 'TRANSCRIPT_RESULT', transcript: '' })
  }
})

// ─── Init ─────────────────────────────────────────────────────────────────────

// Wait for the page to finish rendering before checking for transcript
const observer = new MutationObserver(() => {
  if (document.querySelector('#description-inline-expander, ytd-expander #content')) {
    observer.disconnect()
    sendSignal()
  }
})
observer.observe(document.body, { childList: true, subtree: true })

// Fallback: send signal after 3s even if mutation hasn't fired
setTimeout(sendSignal, 3000)
