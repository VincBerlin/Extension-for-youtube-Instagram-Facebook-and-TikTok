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

export type ExtractionStatus = 'idle' | 'detecting' | 'extracting' | 'complete' | 'error'

export type Theme = 'dark' | 'light'

/**
 * Target language for AI-generated extraction text (summary, bullets, topic
 * blocks, why_relevant_here, user_action, key takeaways). Mirrors the side
 * panel UI language so the AI output matches what the user reads. URLs, repo
 * names, command-line snippets, product names and proper nouns stay verbatim
 * regardless of this setting — see `MODE_INSTRUCTIONS` and the language
 * directive injected into the system prompt.
 */
export type ExtractionLanguage = 'en' | 'de'

// ─── User ────────────────────────────────────────────────────────────────────

export interface User {
  id: string
  email: string
}

/**
 * Full user profile from the `profiles` table.
 * Distinct from `User` (which is just the auth identity).
 */
/**
 * Mirrors `public.profiles`. The deployed schema does NOT include `email` —
 * email is read from `auth.users` via the active Supabase session. Don't add
 * it back here; queries that select it will fail with column-not-found.
 */
export interface UserProfile {
  id: string
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

/**
 * A single user-selected artefact persisted to the `saved_items` table.
 * `item_type` mirrors the Supabase check constraint (migration 005).
 * `payload` carries the verbatim artefact JSON as built by ResultCard's
 * payload helpers.
 */
export type SavedItemType =
  | 'takeaway'
  | 'section'
  | 'resource'
  | 'setup_step'
  | 'command'
  | 'full_analysis'

export interface SavedItem {
  id: string
  userId: string
  packId: string | null
  itemType: SavedItemType
  payload: {
    title: string
    content?: string
    resource_url?: string
    context?: string
    metadata?: Record<string, unknown>
    raw: unknown
  }
  videoUrl: string | null
  videoTitle: string | null
  mode: OutcomeMode | null
  createdAt: string
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
 * - 'unverified':  AI inferred a candidate URL that could not be confirmed
 *                  against the transcript or description; UI must surface a
 *                  "best guess" badge instead of showing it as a real link.
 */
export type UrlValidation =
  | 'valid'
  | 'invalid'
  | 'redirected'
  | 'unchecked'
  | 'unverified'

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
  /** True when the YouTube description was successfully read into the prompt. */
  description_available?: boolean
  /** Number of distinct URLs extracted from the description. */
  description_link_count?: number
  /** Number of timestamped resources parsed from the description. */
  timestamped_resource_count?: number
}

/**
 * Where a link was originally surfaced.
 * - 'youtube_description':           found in the raw description text
 * - 'youtube_description_timestamp': listed in a timestamp line (e.g. "00:18 - Tool ...")
 * - 'transcript_inferred':           AI inferred from spoken content
 * - 'manual':                        rare — manually added by the user
 */
export type AttachedLinkSource =
  | 'youtube_description'
  | 'youtube_description_timestamp'
  | 'transcript_inferred'
  | 'manual'

/**
 * A link attached directly to a specific takeaway or section.
 * The AI is asked to surface only links it can confidently match to that point.
 * Use `unassigned_resources` (on ExtractionPackV2) for everything else.
 */
export interface AttachedLink {
  title: string
  url: string
  description?: string
  why_relevant_here: string         // 1 sentence: why this link belongs to THIS bullet/section
  user_action?: string              // 1 sentence: what to do with it
  confidence: ConfidenceLevel
  url_status?: UrlValidation        // mirrored from server-side validation by URL
  /** Timestamp string from the YouTube description (e.g. "00:18", "1:23:45") when source is timestamped. */
  timestamp?: string
  /** Where the link was originally surfaced (description vs. transcript). */
  source?: AttachedLinkSource
}

/** Topical section of the video — like chapter markers but AI-derived. */
export interface VideoSection {
  title: string
  summary: string             // 1-2 sentences explaining what this section covers
  key_points: string[]
  /** Short semantic keywords/tags that represent the topic — drives chip rendering. */
  semantic_keywords?: string[]
  timestamp_seconds?: number  // optional anchor when AI can locate it
  related_links?: AttachedLink[]    // links the AI assigned to this whole section
}

export interface ExtractionPackV2 {
  title: string
  summary: string             // short 1-line topic statement
  video_explanation: string   // longer prose: what this video is, what it teaches
  key_takeaways: string[]
  /**
   * Parallel to `key_takeaways`. Index N holds the links attached to takeaway N.
   * An entry may be empty/missing when no link was confidently matched.
   */
  key_takeaway_links?: AttachedLink[][]
  sections: VideoSection[]
  resources: Resource[]
  setup_guide: SetupGuide
  warnings: string[]          // creator caveats / outdated info / things to watch out for
  source_coverage: SourceCoverage
  /**
   * Resources that could not be confidently attached to any takeaway/section.
   * Rendered by the UI as a small "Other resources" fallback only when present.
   */
  unassigned_resources?: Resource[]
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

// ─── GitHub resource candidates (P0 fix) ────────────────────────────────────

/**
 * Where a GitHub URL was originally surfaced. Source order is also priority
 * order: anything earlier in this list wins over anything later when two
 * sources agree on the same {owner, repo}. Lower-priority sources are kept
 * separately and only used when no higher-priority source produced a match
 * for the same surrounding context.
 */
export type GitHubCandidateSource =
  | 'description_anchor'        // <a href> harvested from the description DOM
  | 'description_redirect'      // /redirect?q=… already decoded in anchor list
  | 'description_text'          // raw URL scanned from the description text
  | 'transcript_url'            // raw URL scanned from the transcript
  | 'transcript_mention'        // owner/repo mentioned in transcript without a URL
  | 'github_search'             // server-side GitHub search fallback
  | 'ai_inferred'               // AI suggested a URL not present in any source

/**
 * Validation status for a single candidate. Mirrors UrlValidation but kept
 * separate so callers can reason about candidates before they ever become
 * Resources. `unverified` means we ran the GitHub API and could not get a
 * confirmation (rate-limited, ambiguous search, etc.) — UI must surface that
 * clearly instead of treating it as valid.
 */
export type GitHubCandidateStatus =
  | 'valid'
  | 'invalid'
  | 'redirected'
  | 'unverified'
  | 'unchecked'

/**
 * The single source of truth for one GitHub resource the user might see in
 * the analysis. Built BEFORE the AI runs so the AI cannot invent verified
 * URLs — the AI may only reference candidates by `id`. New URLs the AI
 * suggests are also turned into candidates with source='ai_inferred' and
 * must pass validation before they can be shown.
 *
 * IDs are stable within a single extraction call (e.g. "gh_1", "gh_2") —
 * not across calls. They are pure identifiers, never logged secrets.
 */
export interface GitHubResourceCandidate {
  id: string
  /** Display title — the resource label, not the URL. Best-effort. */
  title: string
  /** Exact URL as found in the source (anchor href, raw text, etc.). */
  originalUrl: string
  /** Canonicalised `https://github.com/{owner}/{repo}` form (no .git, no query, no /tree/...). */
  canonicalUrl: string
  /** Final URL after a redirect chain, if validation followed one. */
  resolvedUrl?: string
  owner: string
  repo: string
  source: GitHubCandidateSource
  /** The literal source line / quote where this URL was found. Helps the AI cite it. */
  sourceText?: string
  /** Description timestamp ("00:18", "1:23:45") when the URL appeared on a chapter line. */
  timestamp?: string
  /** A few words of context around the URL (label, surrounding sentence). */
  surroundingText?: string
  /** Heuristic confidence assigned at extraction time, before validation runs. */
  confidenceBeforeValidation: ConfidenceLevel
  validationStatus: GitHubCandidateStatus
  /** Free-form error string when validation could not be performed (timeout, rate limit). */
  validationError?: string
}

// ─── YouTube source bundle (description + timestamped links) ─────────────────

/** A single link extracted from the YouTube description. */
export interface DescriptionLink {
  url: string
  /** Anchor text or surrounding label, when one is available. */
  title?: string
  /** "00:18", "1:23:45" — present only when this URL appeared on a timestamp line. */
  timestamp?: string
}

/**
 * A timestamped item parsed from a YouTube description chapter list /
 * "00:18 - ToolName https://example.com" pattern. Distinct from DescriptionLink:
 * may exist without a URL (e.g. plain chapter markers).
 */
export interface TimestampedResource {
  timestamp: string
  /** Seconds offset, when parseable. */
  timestamp_seconds?: number
  label: string
  url?: string
}

/**
 * Everything the extension extracted directly from the YouTube page —
 * transcript + description + parsed links. Sent to the server alongside the
 * transcript so the AI can use description links as canonical resources.
 */
export interface YouTubeSourceBundle {
  videoId: string
  videoUrl: string
  title: string
  channelName?: string
  transcriptText: string
  transcriptAvailable: boolean
  descriptionText: string
  descriptionAvailable: boolean
  descriptionLinks: DescriptionLink[]
  timestampedResources: TimestampedResource[]
  /**
   * Exact URLs harvested from `<a href>` anchors in the description DOM,
   * with `youtube.com/redirect?q=…` wrappers already decoded. Highest-priority
   * source for resource validation: the visible text on YouTube is often
   * truncated ("github.com/owner/r…"), but the anchor href is the real
   * destination.
   */
  descriptionAnchorUrls: string[]
  /** Free-form list of where data came from for telemetry / UI badges. */
  extractionSourceCoverage: ExtractionSourceType[]
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

/** Background → panel: tab-audio recording became active/inactive. Drives the
 *  persistent recording indicator (CWS prominent-disclosure requirement). */
export interface AudioCaptureStateMessage {
  type: 'AUDIO_CAPTURE_STATE'
  active: boolean
}

/** Background → panel: audio capture is blocked pending the one-time user
 *  consent — the panel must show the consent dialog. */
export interface AudioConsentRequiredMessage {
  type: 'AUDIO_CONSENT_REQUIRED'
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
  | AudioCaptureStateMessage
  | AudioConsentRequiredMessage
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
  /** Full YouTube source bundle (description text + extracted links). Only set for YouTube. */
  youtubeSource?: YouTubeSourceBundle
  /**
   * Target language for AI-generated text. Defaults to 'en' on the server when
   * omitted. URLs, repo names, command snippets, product names and proper
   * nouns stay verbatim regardless.
   */
  extractionLanguage?: ExtractionLanguage
  /**
   * Optional BYOK runtime LLM config. Does NOT carry the API key — that is
   * sent via the X-LLM-API-Key header so it never lands in request logs or
   * Supabase. The server merges this object with the parsed headers when
   * dispatching the AI call.
   */
  llm?: RuntimeLlmConfig
}

// ─── BYOK / Runtime LLM configuration ────────────────────────────────────────
// `LlmSettingsPublic` is what the extension persists to chrome.storage; it
// never contains the secret key. `RuntimeLlmConfig` is the shape that travels
// in the request body — also key-free; the key rides in X-LLM-API-Key.

export type LlmProvider =
  | 'server-default'   // use whatever the server is configured with
  | 'openrouter'
  | 'openai'
  | 'anthropic'
  | 'gemini'
  | 'openai-compatible'

export type OpenRouterMode =
  | 'free-router'   // single call to openrouter/free
  | 'free-cascade'  // ranked cascade across free models (max 3 attempts)
  | 'custom-model'  // user-specified model id

export interface LlmSettingsPublic {
  provider: LlmProvider
  model?: string
  baseUrl?: string
  openRouterMode?: OpenRouterMode
  /** false → API key lives in chrome.storage.session (cleared on browser close). */
  rememberKey: boolean
  /** true once the user has saved a working key for this provider. */
  configured: boolean
  /** ISO timestamp of the last successful /llm/test response. */
  lastTestedAt?: string
  /**
   * Derived at READ time, never persisted: configured with a BYOK provider
   * but the stored key is gone (session-only key after a browser restart).
   * The UI must re-prompt for the key instead of extracting with no headers.
   */
  keyMissing?: boolean
}

export interface RuntimeLlmConfig {
  provider: LlmProvider
  model?: string
  baseUrl?: string
  openRouterMode?: OpenRouterMode
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
