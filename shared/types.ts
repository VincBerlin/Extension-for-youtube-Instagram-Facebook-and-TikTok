// ─── Domain primitives ───────────────────────────────────────────────────────

export type Platform = 'youtube' | 'tiktok' | 'instagram' | 'facebook' | 'unknown'

/**
 * Instant keyword-based mode detection from a video title.
 * Runs in <1ms — used by background on tab change and displayed as "Auto" badge.
 */
export function detectMode(title: string): OutcomeMode {
  const t = title.toLowerCase()

  // Code / build / dev
  if (/\b(tutorial|how[- ]?to|build|code|coding|program(?:ming)?|develop(?:ment)?|setup|install|deploy(?:ment)?|api|react|vue|angular|svelte|python|javascript|typescript|rust|golang|swift|kotlin|node(?:\.?js)?|next\.?js|docker|kubernetes|git(?:hub)?|npm|package|library|framework|debug|refactor)\b/.test(t)) {
    return 'build-pack'
  }

  // Fitness / sport / coaching / technique
  if (/\b(workout|exercise|training|drill|technique|form|reps?|sets?|cardio|yoga|stretch(?:ing)?|running|gym|fitness|sport|basketball|tennis|golf|swimming|cycling|hiit|crossfit|mobility|strength|muscle|weight(?:lifting)?|athlete)\b/.test(t)) {
    return 'coach-notes'
  }

  // Tech stack / architecture / infra
  if (/\b(stack|architecture|infrastructure|hosting|backend|frontend|full[- ]?stack|cloud|aws|gcp|azure|serverless|database|microservices?|system design|devops)\b/.test(t)) {
    return 'stack'
  }

  // Tools / apps / productivity
  if (/\b(tools?|apps?|software|resources?|plugins?|extensions?|productivity|workflow|automation|saas|no[- ]?code|ai tools?)\b/.test(t)) {
    return 'tools'
  }

  // Review / comparison / decision
  if (/\b(review|comparison|compare|vs\.?|versus|best|top \d|pros?( and | & )?cons?|should (?:you|i)|worth it|pick|choose|decision|which one|alternative)\b/.test(t)) {
    return 'decision-pack'
  }

  return 'knowledge'
}

export type OutcomeMode =
  | 'build-pack'
  | 'decision-pack'
  | 'coach-notes'
  | 'tools'
  | 'stack'
  | 'knowledge'

export type ExtractionStrategy = 'instant' | 'live'

export type ExtractionStatus = 'idle' | 'detecting' | 'extracting' | 'recording' | 'complete' | 'error'

export type UserPlan = 'guest' | 'free' | 'pro'

export type Theme = 'dark' | 'light'

// ─── User ────────────────────────────────────────────────────────────────────

export interface User {
  id: string
  email: string
  plan: UserPlan
}

// ─── Library entities ────────────────────────────────────────────────────────

export interface RelatedLink {
  title: string
  url: string
}

export interface Pack {
  id: string
  userId: string
  title: string
  url: string
  platform: Platform
  mode: OutcomeMode
  summary?: string
  key_takeaways: string[]
  relevant_points?: string[]
  important_links?: RelatedLink[]
  savedAt: string
}

export type CollectionItemType = 'pack' | 'resource'

export interface CollectionItem {
  type: CollectionItemType
  refId: string
}

export interface Collection {
  id: string
  userId: string
  name: string
  items: CollectionItem[]
  createdAt: string
}

// ─── Video session (one per video URL, accumulates across pauses) ─────────────

export interface SessionSegment {
  id: string
  pausedAt: string      // ISO timestamp
  result: Pack | null   // null while extracting
}

export interface VideoSession {
  url: string
  platform: Platform
  title: string
  segments: SessionSegment[]
}

// ─── Signal (YouTube) ────────────────────────────────────────────────────────

export interface YouTubeSignal {
  hasTranscript: boolean
  hasDescription: boolean
  hasChapters: boolean
  videoDurationSeconds: number | null
  currentTime?: number
}

// ─── Content scripts → Background ────────────────────────────────────────────

export interface YouTubeSignalMessage {
  type: 'YOUTUBE_SIGNAL'
  signal: YouTubeSignal
}

export interface VideoPausedMessage {
  type: 'VIDEO_PAUSED'
  currentTime: number
}

export interface VideoResumedMessage {
  type: 'VIDEO_RESUMED'
}

// ─── Offscreen ↔ Background ───────────────────────────────────────────────────

export interface StartAudioCaptureMessage {
  type: 'START_AUDIO_CAPTURE'
  streamId: string
}

export interface FlushAudioMessage {
  type: 'FLUSH_AUDIO'
}

export interface AudioDataMessage {
  type: 'AUDIO_DATA'
  data: string       // base64 webm/opus
  mimeType: string
  durationMs: number
}

// ─── Background → Side Panel ──────────────────────────────────────────────────

export interface PlatformDetectedMessage {
  type: 'PLATFORM_DETECTED'
  platform: Platform
  url: string
  title: string
  strategy: ExtractionStrategy
  signal?: YouTubeSignal
  detectedMode: OutcomeMode
}

export interface ExtractionProgressMessage {
  type: 'EXTRACTION_PROGRESS'
  percent: number
  statusText: string
}

export interface ExtractionStreamingMessage {
  type: 'EXTRACTION_STREAMING'
  pack: Pack
}

export interface ExtractionCompleteMessage {
  type: 'EXTRACTION_COMPLETE'
  pack: Pack
  segmentId: string
}

export interface ExtractionErrorMessage {
  type: 'EXTRACTION_ERROR'
  message: string
  upgradeRequired?: boolean
  isHint?: boolean        // true = friendly tip, not a real error
  segmentId?: string
}

export interface SessionUpdateMessage {
  type: 'SESSION_UPDATE'
  session: VideoSession
}

export interface ExtractionRecordingMessage {
  type: 'EXTRACTION_RECORDING'
}

export type ExtensionMessage =
  | PlatformDetectedMessage
  | ExtractionProgressMessage
  | ExtractionStreamingMessage
  | ExtractionCompleteMessage
  | ExtractionErrorMessage
  | ExtractionRecordingMessage
  | YouTubeSignalMessage
  | VideoPausedMessage
  | VideoResumedMessage
  | SessionUpdateMessage

// ─── API ──────────────────────────────────────────────────────────────────────

export interface ExtractRequest {
  url: string
  platform: Platform
  mode: OutcomeMode
  strategy: ExtractionStrategy
  transcript?: string
  audioData?: string       // base64 webm/opus
  audioMimeType?: string
  metadata?: { title: string; description: string }
  captionChunks?: string[]
  sessionContext?: string  // summary so far (for continuity across pauses)
}

export interface ExtractResponse {
  title: string
  summary?: string
  key_takeaways: string[]
  relevant_points?: string[]
  important_links?: RelatedLink[]
}

// ─── Content script messages ──────────────────────────────────────────────────

export interface FetchTranscriptMessage {
  type: 'FETCH_TRANSCRIPT'
}

export interface TranscriptResultMessage {
  type: 'TRANSCRIPT_RESULT'
  transcript: string
  currentTime: number
}

export interface VideoChangedMessage {
  type: 'VIDEO_CHANGED'
  url: string
  title?: string
}
