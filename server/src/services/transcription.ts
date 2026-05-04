/**
 * Transcription service.
 *
 * YouTube instant  : fetch official transcript via youtube-transcript library.
 * TikTok/IG/FB     : download audio via yt-dlp, analyse with Gemini multimodal.
 * Live (fallback)  : caption chunks accumulated by the content script.
 */

import {
  YoutubeTranscript,
  YoutubeTranscriptDisabledError,
  YoutubeTranscriptNotAvailableError,
  YoutubeTranscriptVideoUnavailableError,
} from 'youtube-transcript'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export interface TranscriptResult {
  text: string
  source: 'youtube-api' | 'caption-chunks' | 'whisper'
}

/**
 * Fetch a YouTube transcript by video ID.
 * Returns null if transcript is unavailable.
 */
export async function fetchYouTubeTranscript(videoId: string): Promise<TranscriptResult | null> {
  try {
    const segments = await YoutubeTranscript.fetchTranscript(videoId)
    const text = segments.map((s) => s.text).join(' ')
    return { text, source: 'youtube-api' }
  } catch (err) {
    if (
      err instanceof YoutubeTranscriptDisabledError ||
      err instanceof YoutubeTranscriptNotAvailableError ||
      err instanceof YoutubeTranscriptVideoUnavailableError
    ) {
      return null
    }
    // Rate limit or unexpected error — log and fall back
    console.error(`[transcription] Failed to fetch transcript for ${videoId}:`, err)
    return null
  }
}

/**
 * Join accumulated live caption chunks into a single transcript string.
 */
export function joinCaptionChunks(chunks: string[]): TranscriptResult {
  // Deduplicate consecutive identical chunks (common in rolling captions)
  const deduped = chunks.filter((chunk, i) => chunk !== chunks[i - 1])
  return {
    text: deduped.join(' '),
    source: 'caption-chunks',
  }
}

// ─── yt-dlp audio download (TikTok / Instagram / Facebook) ───────────────────

export interface DownloadedAudio {
  base64: string
  mimeType: 'audio/mp3'
}

/**
 * Download audio from a public TikTok/Instagram/Facebook page URL using yt-dlp.
 * Returns base64-encoded mp3 or null if the download fails (private content, etc.).
 *
 * The mp3 format is used because Gemini's inlineData explicitly supports audio/mp3,
 * unlike audio/webm which can only be passed as video/webm.
 */
export async function downloadAudioFromPageUrl(pageUrl: string): Promise<DownloadedAudio | null> {
  const tmpId = `extract-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const tmpDir = os.tmpdir()
  // Use %(ext)s so yt-dlp appends the correct extension after conversion
  const outputTemplate = path.join(tmpDir, `${tmpId}.%(ext)s`)
  const expectedFile = path.join(tmpDir, `${tmpId}.mp3`)

  try {
    console.log(`[transcription] yt-dlp download: ${pageUrl}`)

    await execFileAsync('yt-dlp', [
      '--extract-audio',
      '--audio-format', 'mp3',
      '--audio-quality', '5', // 128kbps — enough for speech transcription
      '--max-filesize', '50m', // safety cap (~10-minute video max)
      '--no-playlist',
      '--no-warnings',
      '--output', outputTemplate,
      pageUrl,
    ])

    if (!fs.existsSync(expectedFile)) {
      console.warn('[transcription] yt-dlp completed but mp3 not found at', expectedFile)
      return null
    }

    const buffer = fs.readFileSync(expectedFile)
    console.log(`[transcription] yt-dlp success: ${(buffer.byteLength / 1024).toFixed(0)} KB`)
    return { base64: buffer.toString('base64'), mimeType: 'audio/mp3' }
  } catch (err) {
    // Common causes: private content, geo-blocking, login required, removed video
    console.warn('[transcription] yt-dlp failed:', (err as Error).message?.slice(0, 200))
    return null
  } finally {
    try { if (fs.existsSync(expectedFile)) fs.unlinkSync(expectedFile) } catch { /* ignore */ }
  }
}
