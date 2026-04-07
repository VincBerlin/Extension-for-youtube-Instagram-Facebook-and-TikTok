// ─── Domain primitives ───────────────────────────────────────────────────────

export type Platform = 'youtube' | 'tiktok' | 'instagram' | 'facebook' | 'unknown'

export type OutcomeMode =
  | 'build-pack'
  | 'decision-pack'
  | 'coach-notes'
  | 'tools'
  | 'stack'
  | 'knowledge'

export type ExtractionStrategy = 'instant' | 'live'

export type ExtractionStatus = 'idle' | 'detecting' | 'capturing' | 'extracting' | 'complete' | 'error'

export type UserPlan = 'guest' | 'free' | 'pro'

// ─── User ────────────────────────────────────────────────────────────────────

export interface User {
  id: string
  email: string
  plan: UserPlan
}

// ─── Library entities ────────────────────────────────────────────────────────

export interface Pack {
  id: string
  userId: string
  title: string
  url: string
  platform: Platform
  mode: OutcomeMode
  bullets: string[]
  savedAt: string // ISO timestamp
}

export interface Resource {
  id: string
  userId: string
  url: string
  label: string
  tags: string[]
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

// ─── Signal (YouTube) ────────────────────────────────────────────────────────

export interface YouTubeSignal {
  hasTranscript: boolean
  hasDescription: boolean
  hasChapters: boolean
  videoDurationSeconds: number | null
}

export type SignalStrength = 'strong' | 'weak'

// ─── Background → Side Panel messages ────────────────────────────────────────

export interface PlatformDetectedMessage {
  type: 'PLATFORM_DETECTED'
  platform: Platform
  url: string
  title: string
  strategy: ExtractionStrategy
  signal?: YouTubeSignal
}

export interface ExtractionProgressMessage {
  type: 'EXTRACTION_PROGRESS'
  percent: number
  statusText: string
}

export interface ExtractionCompleteMessage {
  type: 'EXTRACTION_COMPLETE'
  pack: Pack
}

export interface ExtractionErrorMessage {
  type: 'EXTRACTION_ERROR'
  message: string
  upgradeRequired?: boolean
}

// Content scripts → Background messages
export interface YouTubeSignalMessage {
  type: 'YOUTUBE_SIGNAL'
  signal: YouTubeSignal
}

export interface LiveCaptureChunkMessage {
  type: 'LIVE_CAPTURE_CHUNK'
  text: string
  timestamp: number
}

export type ExtensionMessage =
  | PlatformDetectedMessage
  | ExtractionProgressMessage
  | ExtractionCompleteMessage
  | ExtractionErrorMessage
  | YouTubeSignalMessage
  | LiveCaptureChunkMessage

// ─── API request/response ─────────────────────────────────────────────────────

export interface ExtractRequest {
  url: string
  platform: Platform
  mode: OutcomeMode
  strategy: ExtractionStrategy
  // For instant: transcript/metadata provided by content script
  transcript?: string
  metadata?: { title: string; description: string; chapters?: string[] }
  // For live: accumulated caption chunks
  captionChunks?: string[]
}

export interface ExtractResponse {
  bullets: string[]
  title: string
}
