/**
 * Offscreen Document — Audio Capture
 *
 * Lifecycle:
 * 1. Background sends START_AUDIO_CAPTURE { streamId } after calling tabCapture.getMediaStreamId()
 * 2. We call getUserMedia with the stream ID → get a MediaStream
 * 3. MediaRecorder buffers audio continuously in 3-second chunks
 * 4. On FLUSH_AUDIO: concatenate all chunks → base64 → send AUDIO_DATA back to background
 * 5. On STOP_AUDIO_CAPTURE: stop recorder, clear buffer
 */

import type { StartAudioCaptureMessage, AudioDataMessage } from '@shared/types'

let recorder: MediaRecorder | null = null
let chunks: Blob[] = []
let mimeType = 'audio/webm;codecs=opus'
let captureStartMs = 0

// ─── Message handler ──────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'START_AUDIO_CAPTURE') {
    const msg = message as StartAudioCaptureMessage
    startCapture(msg.streamId).then(() => sendResponse({ ok: true })).catch((err) => {
      console.error('[offscreen] startCapture failed:', err)
      sendResponse({ ok: false, error: String(err) })
    })
    return true // async
  }

  if (message.type === 'FLUSH_AUDIO') {
    flushAudio().then(sendResponse).catch((err) => {
      console.error('[offscreen] flushAudio failed:', err)
      sendResponse(null)
    })
    return true // async
  }

  if (message.type === 'STOP_AUDIO_CAPTURE') {
    stopCapture()
    sendResponse({ ok: true })
  }
})

// ─── Capture control ──────────────────────────────────────────────────────────

async function startCapture(streamId: string) {
  if (recorder) stopCapture()

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      // @ts-expect-error — Chrome-specific constraint
      mandatory: {
        chromeMediaSource: 'tab',
        chromeMediaSourceId: streamId,
      },
    },
    video: false,
  })

  mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
    ? 'audio/webm;codecs=opus'
    : 'audio/webm'

  chunks = []
  captureStartMs = Date.now()

  recorder = new MediaRecorder(stream, { mimeType })
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data)
  }
  recorder.start(3000) // chunk every 3 seconds
}

function stopCapture() {
  recorder?.stop()
  recorder?.stream.getTracks().forEach((t) => t.stop())
  recorder = null
  chunks = []
}

async function flushAudio(): Promise<AudioDataMessage | null> {
  if (!recorder) return null

  // Request any in-progress chunk BEFORE checking if we have data —
  // if less than 3 s of video played, chunks is still empty but requestData
  // will deliver the partial chunk.
  recorder.requestData()
  await new Promise((r) => setTimeout(r, 100))

  if (chunks.length === 0) return null

  const blob = new Blob(chunks, { type: mimeType })
  const durationMs = Date.now() - captureStartMs

  const base64 = await blobToBase64(blob)

  // Reset buffer for next segment (keep recorder running)
  chunks = []
  captureStartMs = Date.now()

  return {
    type: 'AUDIO_DATA',
    data: base64,
    mimeType,
    durationMs,
  }
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      // strip "data:audio/webm;base64," prefix
      resolve(result.split(',')[1] ?? '')
    }
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}
