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

/**
 * How much of the video the analysis covers.
 * - 'full_video': entire transcript / full audio (default for YouTube)
 * - 'current_segment': only what was captured live up to the Extract click
 *   (default for TikTok / Instagram / Facebook because audio is buffered live)
 */
export type ExtractionScope = 'full_video' | 'current_segment'

export type ExtractionStatus = 'idle' | 'detecting' | 'extracting' | 'recording' | 'complete' | 'error'

export type Theme = 'dark' | 'light'

// ─── User ────────────────────────────────────────────────────────────────────

export interface User {
  id: string
  email: string
}

/**
 * Full user profile from the `profiles` table.
 * Distinct from `User` (which is just the auth identity).
 */
export interface UserProfile {
  id: string
  email: string
  display_name: string | null
  preferred_language: string          // ISO 639-1 e.g. 'en', 'de'
  default_mode: OutcomeMode
  plan: 'free' | 'pro'
  created_at: string
  updated_at: string
}

// ─── Library entities ────────────────────────────────────────────────────────

export interface RelatedLink {
  title: string
  url: string
  description?: string
}

export interface QuickFacts {
  platform: string
  category: string
  content_type: string
}

export interface Pack {
  id: string
  userId: string
  title: string
  url: string
  platform: Platform
  mode: OutcomeMode
  summary?: string
  keywords?: string[]
  key_takeaways: string[]
  relevant_points?: string[]
  important_links?: RelatedLink[]
  quick_facts?: QuickFacts
  /** Full V2 analysis — present when extraction used the V2 contract. */
  v2?: ExtractionPackV2
  savedAt: string
}

// ─── V2 extraction contract — rich, structured video understanding ────────────

export type ResourceType =
  | 'tool'
  | 'app'
  | 'service'
  | 'repo'
  | 'product'
  | 'paper'
  | 'video'
  | 'article'
  | 'docs'
  | 'course'
  | 'other'

export type ConfidenceLevel = 'high' | 'medium' | 'low'

/**
 * Result of server-side URL liveness check.
 * - 'valid':       HEAD/GET returned 2xx
 * - 'redirected':  3xx → final URL stored in `final_url`; user can still click
 * - 'invalid':     4xx/5xx, network error, DNS failure → UI must mark clearly
 * - 'unchecked':   not yet validated (e.g. validation skipped or failed timeout)
 */
export type UrlValidation = 'valid' | 'invalid' | 'redirected' | 'unchecked'

/**
 * A link/tool/repo/product the AI surfaced for the user.
 * `mentioned_in_video=true` means the creator named it explicitly (verifiable via `mentioned_context`).
 * `mentioned_in_video=false` means the AI inferred it as related — must be marked clearly.
 */
export interface Resource {
  title: string
  url: string
  type: ResourceType
  mentioned_in_video: boolean
  mentioned_context?: string  // direct quote / paraphrase from transcript when mentioned_in_video=true
  why_relevant: string        // 1 sentence: why this matters to the user
  user_action: string         // 1 sentence: what the user should do with it
  confidence: ConfidenceLevel
  /** Server-side URL liveness check result. Defaults to 'unchecked' until validation runs. */
  validation?: UrlValidation
  /** Final URL after redirects (only set when validation = 'redirected'). */
  final_url?: string
}

export interface SetupStep {
  order: number
  description: string
  command?: string            // optional shell/code command for this step
}

/**
 * Installation/setup instructions extracted from the video.
 * If the video has no setup content, `exists=false` and other fields stay empty.
 */
export interface SetupGuide {
  exists: boolean
  title?: string
  prerequisites?: string[]
  steps?: SetupStep[]
  commands?: string[]         // top-level commands collected from the video
  warnings?: string[]
  expected_result?: string
}

export type ExtractionSourceType =
  | 'transcript'      // server-side youtube-transcript
  | 'audio'           // multimodal audio capture
  | 'captions'        // DOM caption observer
  | 'description'     // video description / metadata fallback
  | 'mixed'

/**
 * Tells the user how confident the analysis is and where the data came from.
 * Used by the UI to surface "low confidence" badges and limitations.
 */
export interface SourceCoverage {
  transcript_available: boolean
  extraction_source: ExtractionSourceType
  /** What slice of the video the analysis covers — drives the "Full video / Partial" UI badge. */
  extraction_scope: ExtractionScope
  confidence: ConfidenceLevel
  limitations?: string[]
}

/** Topical section of the video — like chapter markers but AI-derived. */
export interface VideoSection {
  title: string
  summary: string             // 1-2 sentences explaining what this section covers
  key_points: string[]
  timestamp_seconds?: number  // optional anchor when AI can locate it
}

export interface ExtractionPackV2 {
  title: string
  summary: string             // short 1-line topic statement
  video_explanation: string   // longer prose: what this video is, what it teaches
  key_takeaways: string[]
  sections: VideoSection[]
  resources: Resource[]
  setup_guide: SetupGuide
  warnings: string[]          // creator caveats / outdated info / things to watch out for
  source_coverage: SourceCoverage
}

/** Bridge V2 → legacy Pack so existing UI keeps rendering until full migration. */
export function v2ToPackFields(v2: ExtractionPackV2): Pick<
  Pack,
  | 'title'
  | 'summary'
  | 'keywords'
  | 'key_takeaways'
  | 'relevant_points'
  | 'important_links'
  | 'quick_facts'
  | 'v2'
> {
  return {
    title: v2.title,
    summary: v2.summary,
    keywords: v2.sections.map((s) => s.title),
    key_takeaways: v2.key_takeaways,
    relevant_points: v2.sections.flatMap((s) => s.key_points),
    important_links: v2.resources.map((r) => ({
      title: r.title,
      url: r.url,
      description: r.why_relevant,
    })),
    quick_facts: {
      platform: 'video',
      category: v2.setup_guide.exists ? 'tutorial' : 'knowledge',
      content_type: v2.sections[0]?.title ?? 'video',
    },
    v2,
  }
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

/** Sent by background after PLATFORM_DETECTED, carries the cached/current analysis (or null). */
export interface CurrentAnalysisMessage {
  type: 'CURRENT_ANALYSIS'
  url: string
  pack: Pack | null
}

export type ExtensionMessage =
  | PlatformDetectedMessage
  | ExtractionProgressMessage
  | ExtractionStreamingMessage
  | ExtractionCompleteMessage
  | ExtractionErrorMessage
  | ExtractionRecordingMessage
  | CurrentAnalysisMessage
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
  /**
   * What slice of the video should be analysed. Defaults to 'full_video' on the
   * server when omitted. For YouTube the client always sets 'full_video'; for
   * live platforms the client sets 'current_segment' because the audio buffer
   * only contains what was captured up to the Extract click.
   */
  extractionScope?: ExtractionScope
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
  keywords?: string[]
  key_takeaways: string[]
  relevant_points?: string[]
  important_links?: RelatedLink[]
  quick_facts?: QuickFacts
  /** Full V2 analysis — populated when the server used the V2 contract. */
  v2?: ExtractionPackV2
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
