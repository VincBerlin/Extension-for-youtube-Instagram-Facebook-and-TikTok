import type { VideoPausedMessage, VideoResumedMessage } from '@shared/types'

const attached = new WeakSet<HTMLVideoElement>()
const pauseDebounces = new WeakMap<HTMLVideoElement, ReturnType<typeof setTimeout>>()

function attachVideo(video: HTMLVideoElement) {
  if (attached.has(video)) return
  attached.add(video)

  video.addEventListener('pause', () => {
    const existing = pauseDebounces.get(video)
    if (existing) clearTimeout(existing)
    pauseDebounces.set(video, setTimeout(() => {
      if (video.paused && !video.ended) {
        const msg: VideoPausedMessage = { type: 'VIDEO_PAUSED', currentTime: video.currentTime }
        chrome.runtime.sendMessage(msg).catch(() => {})
      }
    }, 600))
  })

  video.addEventListener('play', () => {
    const existing = pauseDebounces.get(video)
    if (existing) { clearTimeout(existing); pauseDebounces.delete(video) }
    const msg: VideoResumedMessage = { type: 'VIDEO_RESUMED' }
    chrome.runtime.sendMessage(msg).catch(() => {})
  })
}

function scanVideos() {
  document.querySelectorAll<HTMLVideoElement>('video').forEach(attachVideo)
}

scanVideos()
const observer = new MutationObserver(scanVideos)
observer.observe(document.body, { childList: true, subtree: true })
