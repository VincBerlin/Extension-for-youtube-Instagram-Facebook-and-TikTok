import type { YouTubeSignal, YouTubeSignalMessage, VideoPausedMessage, VideoResumedMessage } from '@shared/types'

// ─── Signal detection ─────────────────────────────────────────────────────────

function buildSignal(video?: HTMLVideoElement | null): YouTubeSignal {
  const hasTranscript = !!document.querySelector('[aria-label="Show transcript"]')
  const descText = document.querySelector('#description-inline-expander, ytd-expander #content')?.textContent ?? ''
  const hasDescription = descText.trim().length > 80
  const hasChapters = document.querySelectorAll('.ytp-chapter-hover-container').length > 0

  return {
    hasTranscript,
    hasDescription,
    hasChapters,
    videoDurationSeconds: video?.duration ?? null,
    currentTime: video?.currentTime ?? 0,
  }
}

function sendSignal(video?: HTMLVideoElement | null) {
  const msg: YouTubeSignalMessage = { type: 'YOUTUBE_SIGNAL', signal: buildSignal(video) }
  chrome.runtime.sendMessage(msg).catch(() => {})
}

// ─── Pause / play detection ───────────────────────────────────────────────────

let pauseDebounce: ReturnType<typeof setTimeout> | null = null
let lastPauseTime = -1

function attachVideoListeners(video: HTMLVideoElement) {
  video.addEventListener('pause', () => {
    // Short debounce to ignore seek-induced pause/play cycles
    if (pauseDebounce) clearTimeout(pauseDebounce)
    pauseDebounce = setTimeout(() => {
      if (video.paused && !video.ended && video.currentTime !== lastPauseTime) {
        lastPauseTime = video.currentTime
        const msg: VideoPausedMessage = { type: 'VIDEO_PAUSED', currentTime: video.currentTime }
        chrome.runtime.sendMessage(msg).catch(() => {})
      }
    }, 600)
  })

  video.addEventListener('play', () => {
    if (pauseDebounce) { clearTimeout(pauseDebounce); pauseDebounce = null }
    const msg: VideoResumedMessage = { type: 'VIDEO_RESUMED' }
    chrome.runtime.sendMessage(msg).catch(() => {})
    sendSignal(video)
  })
}

// ─── Init ─────────────────────────────────────────────────────────────────────

function init() {
  const video = document.querySelector<HTMLVideoElement>('video')
  if (video) {
    attachVideoListeners(video)
    sendSignal(video)
  }

  // Watch for video element appearing after SPA navigation
  const observer = new MutationObserver(() => {
    const v = document.querySelector<HTMLVideoElement>('video')
    if (v && !v.dataset.extractListened) {
      v.dataset.extractListened = '1'
      attachVideoListeners(v)
      sendSignal(v)
    }
  })
  observer.observe(document.body, { childList: true, subtree: true })

  // Fallback signal after DOM settles
  setTimeout(() => sendSignal(document.querySelector<HTMLVideoElement>('video')), 3000)
}

init()

// Reset dedup state on YouTube SPA navigation so the first pause on a new
// video is never silently ignored (same currentTime as the previous video).
window.addEventListener('yt-navigate-finish', () => {
  lastPauseTime = -1
})
