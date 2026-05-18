import { GoogleGenerativeAI } from '@google/generative-ai'
import OpenAI from 'openai'
import Anthropic from '@anthropic-ai/sdk'
import {
  v2ToPackFields,
  type AttachedLink,
  type AttachedLinkSource,
  type ExtractionLanguage,
  type ExtractionPackV2,
  type ExtractionScope,
  type GitHubResourceCandidate,
  type OutcomeMode,
  type Platform,
  type QuickFacts,
  type RelatedLink,
  type Resource,
  type SetupGuide,
  type SourceCoverage,
  type UrlValidation,
  type VideoSection,
  type YouTubeSourceBundle,
} from '../../../shared/types.js'
import { appendAiInferredCandidate, buildGitHubCandidates } from './githubCandidates.js'
import { canonicalizeGitHubUrl } from './githubCanonicalizer.js'
import { validateGitHubCandidates } from './urlValidator.js'

type Provider = 'gemini' | 'openai' | 'anthropic'

const AI_PROVIDER = (process.env.AI_PROVIDER ?? 'gemini') as Provider
const AI_MODEL = process.env.AI_MODEL ?? defaultModel(AI_PROVIDER)

function defaultModel(provider: Provider): string {
  switch (provider) {
    case 'gemini':    return 'gemini-2.0-flash'
    case 'openai':    return 'gpt-4o'
    case 'anthropic': return 'claude-sonnet-4-5'
  }
}

// ─── Mode instructions ────────────────────────────────────────────────────────

const MODE_INSTRUCTIONS: Record<OutcomeMode, string> = {
  'knowledge': `
Focus: concepts, mental models, frameworks, surprising or counterintuitive insights, key facts.
- Prefer "why" and "how" insights over surface-level "what" descriptions
- Capture the core argument or thesis of the content
- Include any memorable analogies, numbers, or statistics mentioned`,

  'build-pack': `
Focus: actionable steps, implementation details, code patterns, CLI commands, configuration, tools.
- Be specific enough that a developer could follow without watching the video
- Capture exact commands, flags, file paths, or API calls mentioned
- Extract every repository, library, package, or boilerplate referenced into resources[]
- Note any "gotchas" or things the author says NOT to do — put these in warnings[]`,

  'decision-pack': `
Focus: decision criteria, tradeoffs, conditions, and rules for choosing between options.
- Write criteria as decision rules: "Use X when...", "Avoid Y if...", "Prefer A over B when..."
- Capture explicit pros/cons and their context
- Note the author's recommendation and the conditions it applies to`,

  'coach-notes': `
Focus: technique cues, form corrections, drills, progressions, performance principles.
- Write cues in imperative form: "keep elbows high", "rotate from hips, not shoulders"
- Capture specific numbers: reps, sets, angles, distances, durations
- Note the most common mistake the coach corrects and the fix`,

  'tools': `
Focus: every tool, app, service, library, API, or resource explicitly mentioned.
- For each, populate resources[] with: type, why_relevant, user_action
- Include pricing tier if mentioned (free, paid, freemium) inside why_relevant
- Note alternatives mentioned and why the speaker chose one over another`,

  'stack': `
Focus: the complete technical stack with specifics.
- List each layer: frontend, backend, database, auth, hosting, CDN, monitoring, CI/CD — as resources[] with type='tool'/'service'
- Capture the specific version, tier, or configuration used (not just the tool name)
- Note why each technology was chosen (performance, cost, DX, etc.) if explained`,
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ExtractInput {
  text?: string
  audioData?: string
  audioMimeType?: string
  mode: OutcomeMode
  platform: Platform
  title?: string
  sessionContext?: string
  /** Drives source_coverage.extraction_scope so the UI can label Full vs. Partial. */
  extractionScope?: ExtractionScope
  /**
   * Optional YouTube page bundle: description text + canonical link list.
   * When present the prompt embeds the description and tells the AI to treat
   * those links as ground-truth resources (mentioned_in_video=true).
   */
  youtubeSource?: YouTubeSourceBundle
  /**
   * Target language for the AI-generated text content. When set, overrides the
   * default "respond in source language" rule. URLs, repo names, command-line
   * snippets and proper nouns stay verbatim regardless. Defaults to 'en'.
   */
  extractionLanguage?: ExtractionLanguage
  /**
   * Pre-built + validated GitHub repo candidates. Populated by
   * `prepareGitHubCandidates` before the AI call. The AI receives these as a
   * fixed allow-list (with `gh_1`, `gh_2` IDs) and is forbidden from inventing
   * its own github.com URLs.
   */
  githubCandidates?: GitHubResourceCandidate[]
}

const LANGUAGE_NAMES: Record<ExtractionLanguage, string> = {
  en: 'English',
  de: 'German (Deutsch)',
}

/**
 * Builds the directive that overrides V2_OUTPUT_CONTRACT rule #6
 * ("respond in the same language as the source content"). The directive is
 * prepended to the prompt so it dominates downstream rules.
 */
function buildLanguageDirective(language?: ExtractionLanguage): string {
  if (!language) return ''
  const name = LANGUAGE_NAMES[language]
  return `LANGUAGE OVERRIDE — HIGHEST PRIORITY:
- All AI-generated text fields MUST be written in ${name}, regardless of the source video's spoken language.
- This applies to: title, summary, video_explanation, key_takeaways, sections[].title, sections[].summary, sections[].key_points, sections[].semantic_keywords, resources[].why_relevant, resources[].user_action, resources[].mentioned_context (translate the paraphrase, but keep any quoted product/proper-noun verbatim), key_takeaway_links[].why_relevant_here, key_takeaway_links[].user_action, key_takeaway_links[].description, related_links[].why_relevant_here, related_links[].user_action, related_links[].description, setup_guide.title, setup_guide.prerequisites, setup_guide.steps[].description, setup_guide.warnings, setup_guide.expected_result, warnings[], source_coverage.limitations.
- Keep VERBATIM (do NOT translate): URLs, domain names, repository names, file paths, CLI commands, code snippets, environment variable names, product/brand/library/framework names (e.g. "React", "Tailwind", "Next.js"), proper nouns of people, channels and companies, version numbers.
- This directive overrides any other rule that would tell you to match the source language.
`
}

export interface ExtractOutput {
  title: string
  summary: string
  keywords: string[]
  bullets: string[]
  links: RelatedLink[]
  quick_facts: QuickFacts
  v2: ExtractionPackV2
}

// ─── Main entry points ────────────────────────────────────────────────────────

export async function extractWithAIStream(
  input: ExtractInput,
  onChunk: (text: string) => void,
): Promise<ExtractOutput> {
  console.log(`[ai] stream provider=${AI_PROVIDER} model=${AI_MODEL} mode=${input.mode} audio=${!!input.audioData}`)

  const prepared = await prepareGitHubCandidates(input)

  if (AI_PROVIDER !== 'gemini') {
    const result = await extractWithAI(prepared)
    onChunk(JSON.stringify(result))
    return result
  }

  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY ?? '')
  let raw = ''

  if (prepared.audioData) {
    const model = genAI.getGenerativeModel({ model: AI_MODEL })
    const prompt = buildAudioPrompt(prepared)
    console.log(`[ai] stream language=${prepared.extractionLanguage ?? 'auto'}`)
    const rawMime = prepared.audioMimeType ?? 'audio/webm'
    const geminiMime = rawMime.startsWith('audio/webm') ? 'video/webm' : rawMime
    const streamResult = await model.generateContentStream({
      contents: [{ role: 'user', parts: [{ text: prompt }, { inlineData: { mimeType: geminiMime, data: prepared.audioData } }] }],
      generationConfig: { temperature: 0.15, maxOutputTokens: 8192, responseMimeType: 'application/json' },
    })
    for await (const chunk of streamResult.stream) {
      const text = chunk.text()
      raw += text
      onChunk(text)
    }
  } else {
    const systemPrompt = buildSystemPrompt(prepared.mode, prepared.sessionContext, prepared.extractionLanguage)
    const userPrompt = buildUserPrompt(prepared)
    console.log(`[ai] stream language=${prepared.extractionLanguage ?? 'auto'}`)
    const model = genAI.getGenerativeModel({ model: AI_MODEL, systemInstruction: systemPrompt })
    const streamResult = await model.generateContentStream({
      contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
      generationConfig: { temperature: 0.15, maxOutputTokens: 8192, responseMimeType: 'application/json' },
    })
    for await (const chunk of streamResult.stream) {
      const text = chunk.text()
      raw += text
      onChunk(text)
    }
  }

  return finalizeOutput(raw, prepared)
}

export async function extractWithAI(input: ExtractInput): Promise<ExtractOutput> {
  console.log(`[ai] provider=${AI_PROVIDER} model=${AI_MODEL} mode=${input.mode} audio=${!!input.audioData}`)

  // Idempotent — if candidates were already prepared upstream we keep them.
  const prepared = input.githubCandidates ? input : await prepareGitHubCandidates(input)

  let raw: string

  if (prepared.audioData) {
    if (AI_PROVIDER === 'gemini') {
      raw = await extractAudioWithGemini(prepared)
    } else {
      raw = JSON.stringify(emptyV2(prepared, 'Audio extraction requires Gemini. Set AI_PROVIDER=gemini.'))
    }
  } else {
    const systemPrompt = buildSystemPrompt(prepared.mode, prepared.sessionContext, prepared.extractionLanguage)
    const userPrompt = buildUserPrompt(prepared)
    console.log(`[ai] language=${prepared.extractionLanguage ?? 'auto'}`)
    switch (AI_PROVIDER) {
      case 'gemini':    raw = await extractTextWithGemini(systemPrompt, userPrompt); break
      case 'openai':    raw = await extractWithOpenAI(systemPrompt, userPrompt); break
      case 'anthropic': raw = await extractWithAnthropic(systemPrompt, userPrompt); break
    }
  }

  return finalizeOutput(raw, prepared)
}

// ─── Candidate preparation ───────────────────────────────────────────────────

/**
 * Build + validate GitHub repo candidates BEFORE the AI runs. These become a
 * fixed allow-list — the AI may reference them by `gh_X` ID but cannot invent
 * verified github.com URLs. Validation hits api.github.com/repos so we know
 * which candidates are real before they ever reach the user.
 *
 * Returns the same input with `githubCandidates` populated. Best-effort: a
 * thrown error in build/validate leaves `githubCandidates` empty so extraction
 * still succeeds (the parse step then treats every AI-emitted github URL as
 * ai_inferred and lets the post-validation pipeline catch broken ones).
 */
async function prepareGitHubCandidates(input: ExtractInput): Promise<ExtractInput> {
  if (input.githubCandidates) return input
  try {
    const built = buildGitHubCandidates({
      youtubeSource: input.youtubeSource,
      transcript: input.text,
    })
    if (built.length === 0) return { ...input, githubCandidates: [] }
    const validated = await validateGitHubCandidates(built)
    console.log(
      '[GITHUB-LINK-DEBUG] prepare |',
      `built: ${built.length} |`,
      `validated: ${validated.length} |`,
      `valid: ${validated.filter((c) => c.validationStatus === 'valid' || c.validationStatus === 'redirected').length} |`,
      `invalid: ${validated.filter((c) => c.validationStatus === 'invalid').length} |`,
      `unverified: ${validated.filter((c) => c.validationStatus === 'unverified').length}`,
    )
    return { ...input, githubCandidates: validated }
  } catch (err) {
    console.warn('[ai] candidate preparation failed:', (err as Error).message)
    return { ...input, githubCandidates: [] }
  }
}

// ─── Audio extraction (Gemini multimodal) ────────────────────────────────────

async function extractAudioWithGemini(input: ExtractInput): Promise<string> {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY ?? '')
  const model = genAI.getGenerativeModel({ model: AI_MODEL })

  const prompt = buildAudioPrompt(input)

  const rawMime = input.audioMimeType ?? 'audio/webm'
  const geminiMime = rawMime.startsWith('audio/webm') ? 'video/webm' : rawMime

  const result = await model.generateContent({
    contents: [{
      role: 'user',
      parts: [
        { text: prompt },
        { inlineData: { mimeType: geminiMime, data: input.audioData! } },
      ],
    }],
    generationConfig: {
      temperature: 0.15,
      maxOutputTokens: 8192,
      responseMimeType: 'application/json',
    },
  })

  return result.response.text()
}

// ─── Text extraction ──────────────────────────────────────────────────────────

async function extractTextWithGemini(systemPrompt: string, userPrompt: string): Promise<string> {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY ?? '')
  const model = genAI.getGenerativeModel({ model: AI_MODEL, systemInstruction: systemPrompt })
  const result = await model.generateContent({
    contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
    generationConfig: { temperature: 0.15, maxOutputTokens: 8192, responseMimeType: 'application/json' },
  })
  return result.response.text()
}

async function extractWithOpenAI(systemPrompt: string, userPrompt: string): Promise<string> {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  const response = await openai.chat.completions.create({
    model: AI_MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.15,
    max_tokens: 4000,
    response_format: { type: 'json_object' },
  })
  return response.choices[0]?.message.content ?? '{}'
}

async function extractWithAnthropic(systemPrompt: string, userPrompt: string): Promise<string> {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const response = await anthropic.messages.create({
    model: AI_MODEL,
    max_tokens: 4000,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  })
  const block = response.content[0]
  return block.type === 'text' ? block.text : '{}'
}

// ─── Prompt builders ─────────────────────────────────────────────────────────

const FILTER_RULES = `IGNORE COMPLETELY: who made the video, when it was made, likes, comments, channel plugs, "like and subscribe", greetings, intro/outro music, the creator's personal opinions about themselves, filler ("um", "you know"), transitions.
FOCUS ON: the LEARNING content only — substantive claims, instructions, data points, concepts, tools, methods, warnings, recommendations.`

const V2_OUTPUT_CONTRACT = `Respond with VALID JSON ONLY. No markdown, no code fences, no prose around the JSON. The JSON must match this exact schema:

{
  "title": "5–8 word synthesis of the specific topic covered (NOT the video title, NOT the creator name)",
  "summary": "One sentence: what this content teaches and who benefits from it",
  "video_explanation": "2–4 sentences in plain prose: what the video is about, what the creator argues/teaches/demonstrates, and the structure of the content. Write for a reader who has not watched it.",
  "key_takeaways": [
    "Direct fact, instruction, or insight — max 2 sentences. No 'the speaker says', no hedging.",
    "..."
  ],
  "key_takeaway_links": [
    [
      {
        "title": "Display name of a link from resources[] above",
        "url": "https://... (MUST appear in resources[].url)",
        "description": "Short one-liner about what the link is",
        "why_relevant_here": "1 sentence: why THIS link belongs to THIS specific takeaway",
        "user_action": "1 imperative sentence: what the user should do with it for this takeaway",
        "confidence": "high|medium|low"
      }
    ],
    []
  ],
  "sections": [
    {
      "title": "Short topical heading (3–6 words) — like a chapter title",
      "summary": "1–2 sentences explaining what THIS section covers (mini-summary of the topic block)",
      "key_points": ["Bullet 1 — direct fact/insight from this part of the video", "Bullet 2"],
      "semantic_keywords": ["keyword-1", "keyword-2", "keyword-3"],
      "timestamp_seconds": 120,
      "related_github_candidate_ids": ["gh_1", "gh_2"],
      "related_links": [
        {
          "title": "Display name of a link from resources[]",
          "url": "https://...",
          "description": "Short one-liner",
          "why_relevant_here": "1 sentence: why this link belongs to THIS section/topic block",
          "user_action": "1 imperative sentence",
          "confidence": "high|medium|low",
          "timestamp": "00:18 (OPTIONAL — copy from the YouTube description if this link came from a timestamp line)",
          "source": "youtube_description | youtube_description_timestamp | transcript_inferred (OPTIONAL — provenance of this link)"
        }
      ]
    }
  ],
  "resources": [
    {
      "title": "Display name",
      "url": "https://...",
      "type": "tool|app|service|repo|product|paper|video|article|docs|course|other",
      "mentioned_in_video": true,
      "mentioned_context": "Direct quote or close paraphrase from the transcript where the creator names this resource. REQUIRED if mentioned_in_video=true. OMIT if mentioned_in_video=false.",
      "why_relevant": "1 sentence: why this matters for the user / what problem it solves in the context of the video",
      "user_action": "1 imperative sentence: what the user should do with it (e.g. 'Install via npm install x', 'Read chapter 3', 'Sign up for the free tier and follow the quickstart')",
      "confidence": "high|medium|low"
    }
  ],
  "unassigned_resources": [
    {
      "title": "Same shape as resources[] entries",
      "url": "https://...",
      "type": "tool|...",
      "mentioned_in_video": true,
      "why_relevant": "...",
      "user_action": "...",
      "confidence": "high|medium|low"
    }
  ],
  "setup_guide": {
    "exists": true,
    "title": "What this setup achieves (e.g. 'Install Tailwind in a Next.js project')",
    "prerequisites": ["Node 20+", "Git"],
    "steps": [
      { "order": 1, "description": "Create a new project", "command": "npx create-next-app@latest" },
      { "order": 2, "description": "Install Tailwind", "command": "npm install -D tailwindcss" }
    ],
    "commands": ["npx create-next-app@latest", "npm install -D tailwindcss"],
    "warnings": ["Do not commit your .env file"],
    "expected_result": "A running dev server on localhost:3000 with Tailwind classes applying."
  },
  "warnings": [
    "Things the creator explicitly warns against, outdated info disclaimers, common pitfalls, security caveats."
  ],
  "source_coverage": {
    "transcript_available": true,
    "extraction_source": "transcript|audio|captions|description|mixed",
    "confidence": "high|medium|low",
    "limitations": ["Audio quality was poor in the second half", "Speaker switched languages briefly"]
  }
}

CRITICAL RULES:
1. mentioned_in_video: TRUE only when the creator explicitly named or showed this resource. mentioned_context MUST then be a real quote/paraphrase from the source (3–15 words). FALSE means YOU as AI are recommending it as related — be honest.
2. confidence: 'high' = explicit URL or unambiguous reference; 'medium' = name mentioned but URL inferred; 'low' = name approximate or AI suggestion.
3. setup_guide.exists = false when the video is NOT a tutorial / does not contain installation or setup steps. In that case omit (or empty) prerequisites/steps/commands/warnings/expected_result.
4. source_coverage: be honest. If transcript was missing or partial, set transcript_available=false and confidence='low' with a clear limitation message.
5. URLs: use canonical domains (e.g. https://nextjs.org, not vercel.com/next). For repos prefer https://github.com/owner/repo.
6. Language: respond in the same language as the source content.
7. NO MARKDOWN. NO CODE FENCES. RAW JSON ONLY.

LINK ASSIGNMENT RULES (very important):
A. Every entry in resources[] is the CANONICAL list of links surfaced by the video. Do not invent URLs that are not in resources[].
B. key_takeaway_links is an array PARALLEL to key_takeaways. key_takeaway_links[i] holds the links you confidently assign to key_takeaways[i]. Use [] (empty array) when nothing matches.
C. For each link in key_takeaway_links[i] and section.related_links: url MUST also exist in resources[]. why_relevant_here MUST explain — in one specific sentence — why this link belongs to THAT exact bullet/section, not just to the video at large.
D. Only assign a link when the connection is concrete (the bullet describes the link, recommends installing/using it, or directly cites it). Do not stretch. A link can appear under multiple takeaways/sections only when it is genuinely relevant to each.
E. unassigned_resources: copy any resources[] entries that you could NOT confidently match to a takeaway or a section. If every resource was assigned, set unassigned_resources to []. Do NOT duplicate the entire resources[] list here — it is the leftover bucket only.
F. Prefer attaching to a topic-block (section) over a flat key_takeaway when the link clearly belongs to one chapter of the video. The user reads topic blocks as the primary structure.

FULL-COVERAGE RULES (non-negotiable for long videos):
G. The user has NOT watched the video and is relying entirely on this analysis. Coverage MUST span the ENTIRE transcript — beginning, middle, and end. Do not over-weight the introduction.
H. sections[] is the primary output structure. Each section is a topic block: a coherent chunk of the video covering one theme. Build sections[] by reading the WHOLE transcript first, then segmenting it by topic shifts.
I. For transcripts longer than ~3000 characters, produce AT LEAST 4 sections. For transcripts longer than ~10000 characters, produce 6–10 sections. Sections must be roughly evenly distributed across the timeline — if you can attach timestamp_seconds, the timestamps must increase monotonically and span from near-start to near-end.
J. Each section MUST include: title (3–6 words), summary (1–2 sentences mini-summary of the topic), key_points (2–5 direct facts/insights from THAT chunk of the video), semantic_keywords (3–8 short tags that capture the topic).
K. semantic_keywords must be REAL terms from or strongly implied by the transcript content of that section — not generic words like "video" or "knowledge". Validate that each keyword genuinely represents the section topic.
L. key_takeaways (the flat top-level array) MUST be drawn from across the full timeline — NOT only from the opening minutes. Aim for one takeaway per major section if possible.
M. If two sections describe the same topic, MERGE them. Avoid redundant blocks.
N. If — and only if — the transcript is genuinely too short to produce 4 sections, produce as many as the content supports and set source_coverage.confidence='medium' with a limitation noting the short input.

YOUTUBE DESCRIPTION LINK RULES (apply when a "CANONICAL LINKS" block is provided in the user prompt):
O. Every URL in the CANONICAL LINKS block MUST appear in resources[] verbatim — no rewriting, no dropping. These are ground-truth links the creator put in the description and the user EXPECTS them all.
P. For each canonical link, set mentioned_in_video=true. Use the description chapter label (when present) or the link's surrounding context as mentioned_context. If the transcript also names the resource, prefer a transcript quote.
Q. Use the timestamp from CANONICAL LINKS / TIMESTAMPED CHAPTERS to assign each link to the matching section: choose the section whose time range covers that timestamp, or whose topic matches the chapter label. Do NOT dump them into unassigned_resources unless you genuinely cannot tell where they belong.
R. When an attached link comes from the description, copy the original timestamp string into related_links[].timestamp (e.g. "00:18", "1:23:45"). When the link came from the spoken transcript, omit the timestamp.
S. unassigned_resources is now a LAST-RESORT bucket: it should only hold canonical description links you truly could not match to any topic block. Aim to assign every canonical link to a section.

GITHUB CANDIDATE RULES (HARDEST, override everything else for github.com URLs):
T. A separate "GITHUB CANDIDATES" block in the user prompt lists the ONLY github.com URLs you may surface. Each candidate has an id ("gh_1", "gh_2", ...), a canonicalUrl, a validationStatus, and origin metadata.
U. NEVER invent a github.com URL that is not in the candidate list. If you believe a repo exists but no candidate matches, simply do NOT mention it. The system will surface candidates that you don't reference, but it will REJECT any new github.com URL you fabricate.
V. To attach a GitHub repo to a topic block, set sections[].related_github_candidate_ids to an array of candidate IDs (e.g. ["gh_1", "gh_3"]). You may also include the candidate's canonicalUrl in resources[] / related_links[] using the EXACT canonicalUrl string — do not rewrite it.
W. Candidates with validationStatus="invalid" must NOT be referenced — they 404. Candidates with validationStatus="unverified" may be referenced but must be marked confidence="low".
X. You may explain in why_relevant_here / mentioned_context why the candidate fits the topic — but the URL itself comes from the candidate, never from your imagination.`

function buildAudioPrompt(input: ExtractInput): string {
  const { platform, title, mode, sessionContext, extractionLanguage } = input
  const modeInstruction = MODE_INSTRUCTIONS[mode]
  const contextBlock = sessionContext
    ? `\n\nALREADY EXTRACTED earlier in this video — do not repeat:\n${sessionContext}\n`
    : ''
  const languageDirective = buildLanguageDirective(extractionLanguage)

  const githubCandidatesBlock = formatGitHubCandidatesForPrompt(input.githubCandidates)

  return `${languageDirective}You are an expert at understanding spoken video content. Your task is to UNDERSTAND the video, then produce a precise, structured analysis that EXPLAINS what the video covers and surfaces every actionable resource and step.

STEP 1 — LISTEN AND UNDERSTAND:
- Identify the exact topic(s), the type of content (tutorial / opinion / review / demonstration / interview / story), the audience level, and the structure (intro → sections → conclusion).
- Notice any moments of emphasis (slowing down, repeating, "this is important") — those signal high-priority content.

STEP 2 — FILTER:
${FILTER_RULES}

STEP 3 — APPLY MODE FOCUS:
${modeInstruction}

STEP 4 — EXPLAIN:
- video_explanation MUST tell a reader who has not watched the video what it is about and what they will learn.
- sections[] should mirror the actual structure of the video (chapter-like).

STEP 5 — RESOURCES:
- Every tool, library, repo, product, book, course, paper, app, or service the creator names goes into resources[] with mentioned_in_video=true and a mentioned_context quote/paraphrase.
- You MAY add a small number of CLOSELY related resources the AI knows about — but mark them mentioned_in_video=false. Only add these if they directly help the user act on the video's content. Quality over quantity.
- Provide a real canonical URL for every resource. If you cannot, mark confidence='low' and explain in why_relevant.

STEP 6 — SETUP GUIDE:
- If the video walks through installation, configuration, or step-by-step setup, populate setup_guide with prerequisites, ordered steps (each with the exact command if shown), the commands list, any explicit warnings, and the expected_result.
- If the video is NOT a setup tutorial, set setup_guide.exists=false.

STEP 7 — SOURCE COVERAGE:
- Be honest about what you could and could not extract. Use confidence='low' when audio was unclear, transcript missing, or you had to infer heavily.

Source: ${platform}${title ? ` — "${title}"` : ''}
${contextBlock}${githubCandidatesBlock}
${V2_OUTPUT_CONTRACT}`
}

function buildSystemPrompt(
  mode: OutcomeMode,
  sessionContext?: string,
  extractionLanguage?: ExtractionLanguage,
): string {
  const contextBlock = sessionContext
    ? `\n\nALREADY EXTRACTED earlier in this video — do not repeat:\n${sessionContext}\n`
    : ''
  const languageDirective = buildLanguageDirective(extractionLanguage)

  return `${languageDirective}You are an expert video-understanding assistant. You DO NOT summarize. You EXPLAIN videos and surface actionable resources, with a clear distinction between what was actually mentioned in the video and what you (the AI) are recommending as related.

Process:
1. Read the full transcript and understand topic, audience, and structure.
2. Filter ruthlessly — keep only LEARNING content.
${FILTER_RULES}
3. Apply the mode-specific focus to filter what to include.
4. For every tool, library, repo, product, book, course, paper, app, or service the creator NAMES — add to resources[] with mentioned_in_video=true AND a mentioned_context quote/paraphrase from the transcript.
5. You MAY add a small number of closely related resources the AI knows about — but mark them mentioned_in_video=false. Only add these if they directly help the user act on the video's content.
6. Always provide a real canonical URL. If not certain, mark confidence='low'.
7. If the video walks through setup/installation/config, populate setup_guide; otherwise setup_guide.exists=false.
8. Be honest in source_coverage — say if data was missing or low-quality.

Mode: ${mode.toUpperCase()}
${MODE_INSTRUCTIONS[mode]}
${contextBlock}
${V2_OUTPUT_CONTRACT}`
}

function buildUserPrompt(input: ExtractInput): string {
  const yt = input.youtubeSource
  const descBlock =
    yt && yt.descriptionAvailable && yt.descriptionText
      ? `\n\nVideo description (verbatim — read carefully, this contains canonical links the creator wants viewers to use):\n"""\n${yt.descriptionText}\n"""\n`
      : ''

  const canonicalLinks =
    yt && yt.descriptionLinks.length > 0
      ? `\n\nCANONICAL LINKS extracted from the YouTube description (these MUST appear in resources[] verbatim — do not invent variants, do not drop them):\n${yt.descriptionLinks
          .map((l, i) => {
            const ts = l.timestamp ? ` [@${l.timestamp}]` : ''
            const t = l.title ? ` — ${l.title}` : ''
            return `${i + 1}. ${l.url}${ts}${t}`
          })
          .join('\n')}\n`
      : ''

  const timestamped =
    yt && yt.timestampedResources.length > 0
      ? `\n\nTIMESTAMPED CHAPTERS / RESOURCES (use these to anchor section timestamps and to assign links to the right topic block):\n${yt.timestampedResources
          .map((r) => `- ${r.timestamp} — ${r.label}${r.url ? ` (${r.url})` : ''}`)
          .join('\n')}\n`
      : ''

  const githubCandidatesBlock = formatGitHubCandidatesForPrompt(input.githubCandidates)

  return `Source: ${input.platform}${input.title ? ` — "${input.title}"` : ''}

Transcript:
${input.text ?? ''}
${descBlock}${canonicalLinks}${timestamped}${githubCandidatesBlock}
Respond with raw JSON only — no markdown, no code fences.`
}

/**
 * Formats the validated candidate list as a deterministic block the AI can
 * read. We deliberately list every status (including invalid) so the AI sees
 * the contrast — but the contract rule W tells it to skip invalid ones. Each
 * line is short to keep prompt-token cost low.
 */
function formatGitHubCandidatesForPrompt(candidates?: GitHubResourceCandidate[]): string {
  if (!candidates || candidates.length === 0) return ''
  const lines = candidates.map((c) => {
    const ts = c.timestamp ? ` @${c.timestamp}` : ''
    const ctx = c.surroundingText ? ` — "${c.surroundingText.slice(0, 80)}"` : c.sourceText ? ` — ${c.sourceText.slice(0, 80)}` : ''
    return `- ${c.id}: ${c.canonicalUrl} [status: ${c.validationStatus}, source: ${c.source}${ts}]${ctx}`
  })
  return `\n\nGITHUB CANDIDATES (the ONLY github.com URLs you may use — reference by ID via sections[].related_github_candidate_ids; do NOT invent github URLs not in this list):\n${lines.join('\n')}\n`
}

// ─── Output finalization ──────────────────────────────────────────────────────

function finalizeOutput(raw: string, input: ExtractInput): ExtractOutput {
  const v2 = parseV2(raw, input)
  const legacy = v2ToPackFields(v2)
  return {
    title: legacy.title || input.title || inferTitle(v2.key_takeaways),
    summary: legacy.summary ?? '',
    keywords: legacy.keywords ?? [],
    bullets: legacy.key_takeaways,
    links: legacy.important_links ?? [],
    quick_facts: legacy.quick_facts ?? defaultQuickFacts(input.platform),
    v2,
  }
}

// ─── V2 parsing ───────────────────────────────────────────────────────────────

// Exported for unit tests — production callers should use extractWithAI/Stream.
export function parseV2(text: string, input: ExtractInput): ExtractionPackV2 {
  const cleaned = text.replace(/^```(?:json)?\s*/im, '').replace(/\s*```\s*$/im, '').trim()

  let json: Record<string, unknown> = {}
  try {
    json = JSON.parse(cleaned)
  } catch {
    console.warn('[ai] V2 JSON parse failed — using legacy fallback')
    return legacyTextToV2(text, input)
  }

  // Snapshot the candidate list (mutable so we can append AI-inferred entries
  // when the AI fabricates a new github URL).
  const candidates: GitHubResourceCandidate[] = [...(input.githubCandidates ?? [])]

  let resources = parseResources(json.resources ?? json.links, input.text)
  // Reconcile every github.com resource against the candidate allow-list.
  // Invalid candidates are dropped, valid ones get the canonical URL, and any
  // AI-fabricated github URL gets registered as ai_inferred (still subject to
  // post-validation in the route layer).
  resources = reconcileGitHubResources(resources, candidates)
  // Back-fill: every URL that came from the YouTube description must show up
  // in resources[]. If the AI dropped one, add it ourselves so the user still
  // sees every link the creator put in the description.
  resources = mergeDescriptionLinksIntoResources(resources, input.youtubeSource)
  const validUrls = new Set(resources.map((r) => r.url))
  const key_takeaways = arrStr(json.key_takeaways ?? json.bullets, 5)
  const key_takeaway_links = parseTakeawayLinks(json.key_takeaway_links, key_takeaways.length, validUrls)
  const sections = parseSections(json.sections, validUrls, candidates)
  // Back-fill timestamp/source onto attached links by URL — the AI sometimes
  // drops these even though we instruct it to keep them.
  annotateAttachedFromBundle(sections, key_takeaway_links, input.youtubeSource)
  // Drop AttachedLinks pointing at github URLs whose candidate is invalid —
  // the AI may have stuck the URL in an attached_link block even though the
  // contract forbids it. Belt-and-braces.
  filterInvalidGitHubAttached(sections, key_takeaway_links, candidates)

  // Collect every URL the AI attached to a takeaway or section.
  const assignedUrls = new Set<string>()
  for (const links of key_takeaway_links) {
    for (const l of links) assignedUrls.add(l.url)
  }
  for (const s of sections) {
    for (const l of s.related_links ?? []) assignedUrls.add(l.url)
  }

  // Honour the AI's own unassigned_resources when given. Otherwise derive the
  // leftovers ourselves so the UI's "Other resources" fallback always matches
  // what the bullets ended up surfacing.
  const aiUnassigned = parseUnassignedResources(json.unassigned_resources, resources)
  const unassigned_resources = aiUnassigned.length > 0
    ? aiUnassigned
    : resources.filter((r) => !assignedUrls.has(r.url))

  return {
    title: str(json.title) || input.title || '',
    summary: str(json.summary),
    video_explanation: str(json.video_explanation),
    key_takeaways,
    key_takeaway_links,
    sections,
    resources,
    setup_guide: parseSetupGuide(json.setup_guide),
    warnings: arrStr(json.warnings, 3),
    source_coverage: parseSourceCoverage(json.source_coverage, input),
    unassigned_resources,
  }
}

/**
 * Adds description-only URLs that the AI dropped from resources[]. Each new
 * resource is marked as mentioned_in_video=true (the creator put it in their
 * description) with mentioned_context taken from the description label or
 * timestamp.
 *
 * Also: any AI-generated resource whose URL is a "truncated stub" (e.g.
 * `https://github.com/owner/r…` or just `https://github.com/owner`) is
 * upgraded to the full URL when the description's anchor href list contains
 * a same-host match. The decoded anchor href is the only authoritative
 * source for the exact destination YouTube was sending users to — display
 * text is routinely cut off and produces 404s.
 */
function mergeDescriptionLinksIntoResources(
  resources: Resource[],
  yt?: YouTubeSourceBundle,
): Resource[] {
  if (!yt) {
    // Still log AI-only GitHub URLs so we can spot hallucinations even when we
    // have no description anchors to compare against (TikTok, Instagram etc.).
    for (const r of resources) {
      logGitHubProvenance(r.url, r.title, 'ai_no_yt_source', null)
    }
    return resources
  }
  const anchorUrls = yt.descriptionAnchorUrls ?? []
  const anchorSet = new Set(anchorUrls)
  const descLinkSet = new Set((yt.descriptionLinks ?? []).map((l) => l.url))

  // Phase A: rewrite stub URLs in the existing resources using anchor URLs as truth
  const upgraded = resources.map((r) => {
    const better = pickBetterUrl(r.url, anchorUrls)
    if (!better || better === r.url) {
      // Classify how the AI's URL relates to verified description sources.
      const source = anchorSet.has(r.url)
        ? 'ai_kept_anchor_match'
        : descLinkSet.has(r.url)
          ? 'ai_kept_description_text_match'
          : 'ai_invented_no_description_match'
      logGitHubProvenance(r.url, r.title, source, null)
      return r
    }
    logGitHubProvenance(better, r.title, 'ai_url_upgraded_to_anchor', r.url)
    return { ...r, url: better }
  })

  // Phase B: dedupe (a stub URL and its decoded anchor URL may both have been parsed)
  const dedup = new Map<string, Resource>()
  for (const r of upgraded) {
    if (!dedup.has(r.url)) dedup.set(r.url, r)
  }

  // Phase C: anchor URLs that the AI never mentioned at all → add as creator-listed
  for (const url of anchorUrls) {
    if (dedup.has(url)) continue
    logGitHubProvenance(url, hostnameOf(url) ?? url, 'description_anchor_added', null)
    dedup.set(url, {
      title: hostnameOf(url) || url,
      url,
      type: 'other',
      mentioned_in_video: true,
      mentioned_context: 'From video description (anchor link).',
      why_relevant: 'Linked by the creator in the YouTube description.',
      user_action: 'Open the link to use this resource.',
      confidence: 'high',
      validation: 'unchecked',
    })
  }

  // Phase D: timestamped/text-extracted description links the AI dropped
  for (const link of yt.descriptionLinks ?? []) {
    if (dedup.has(link.url)) continue
    logGitHubProvenance(link.url, link.title || link.url, 'description_text_added', null)
    const ctx = link.timestamp
      ? `From video description (${link.timestamp})${link.title ? `: ${link.title}` : ''}`
      : `From video description${link.title ? `: ${link.title}` : ''}`
    dedup.set(link.url, {
      title: link.title || hostnameOf(link.url) || link.url,
      url: link.url,
      type: 'other',
      mentioned_in_video: true,
      mentioned_context: ctx,
      why_relevant: 'Listed by the creator in the YouTube description.',
      user_action: 'Open the link to use this resource.',
      confidence: 'high',
      validation: 'unchecked',
    })
  }

  return [...dedup.values()]
}

/**
 * Phase-1 telemetry for the P0 GitHub-URL correctness work. Logs only:
 *  - the URL itself (already public, present in the AI output)
 *  - the resource title (AI-authored, no user data)
 *  - the provenance enum
 *  - the original URL when an upgrade happened
 * Never logs transcripts, prompts, tokens, API keys, or auth state.
 *
 * Filtered to GitHub-host URLs to keep noise low — that is where our 404s come
 * from. Owner / repo segments are surfaced so we can tell at a glance whether
 * the URL has a syntactically valid {owner, repo} shape before validation runs.
 */
function logGitHubProvenance(
  url: string,
  title: string,
  source: string,
  originalUrl: string | null,
): void {
  let parsed: URL
  try { parsed = new URL(url) } catch { return }
  const host = parsed.hostname.replace(/^www\./, '').toLowerCase()
  if (host !== 'github.com') return
  const segs = parsed.pathname.split('/').filter(Boolean)
  const owner = segs[0] ?? null
  const repo = segs[1] ?? null
  const shape = owner && repo ? 'owner_repo' : owner ? 'owner_only' : 'empty'
  console.log(
    '[GITHUB-LINK-DEBUG] provenance |',
    'source:', source, '|',
    'shape:', shape, '|',
    'owner:', owner, '|',
    'repo:', repo, '|',
    'url:', url, '|',
    'originalUrl:', originalUrl ?? '-', '|',
    'title:', title?.slice(0, 60) ?? '-',
  )
}

/**
 * Decide whether a candidate URL from the AI should be replaced by one of
 * the (decoded) anchor URLs harvested from the YouTube description.
 *
 * Replaces when the AI URL is "less specific" than an anchor URL on the same
 * host — typically because the AI copied truncated display text:
 *   `https://github.com/owner` ← anchor `https://github.com/owner/repo`
 *   `https://github.com/owner/r` ← anchor `https://github.com/owner/repo`
 */
function pickBetterUrl(candidate: string, anchors: string[]): string | null {
  if (!candidate || anchors.length === 0) return null
  let cu: URL
  try { cu = new URL(candidate) } catch { return null }
  const cHost = cu.hostname.replace(/^www\./, '').toLowerCase()
  const cPath = cu.pathname.replace(/\/$/, '')

  for (const anchor of anchors) {
    let au: URL
    try { au = new URL(anchor) } catch { continue }
    const aHost = au.hostname.replace(/^www\./, '').toLowerCase()
    if (aHost !== cHost) continue
    const aPath = au.pathname.replace(/\/$/, '')

    // Anchor extends the candidate path → candidate was truncated
    if (aPath.length > cPath.length && aPath.startsWith(cPath)) {
      return anchor
    }
    // GitHub: AI may have produced a parent ("/owner") while the anchor has
    // owner/repo. Prefer the deeper one.
    if (cHost === 'github.com') {
      const aSegs = aPath.split('/').filter(Boolean)
      const cSegs = cPath.split('/').filter(Boolean)
      if (aSegs.length >= 2 && cSegs.length < 2 && aSegs[0] === cSegs[0]) {
        return anchor
      }
    }
  }
  return null
}

function hostnameOf(url: string): string | null {
  try { return new URL(url).hostname.replace(/^www\./, '') } catch { return null }
}

/**
 * After the AI returns, propagate timestamp/source metadata from the bundle
 * onto any AttachedLink whose URL came from the YouTube description. This is
 * defensive: the model is told to copy these fields but does not always.
 */
function annotateAttachedFromBundle(
  sections: VideoSection[],
  key_takeaway_links: AttachedLink[][],
  yt?: YouTubeSourceBundle,
): void {
  if (!yt || !yt.descriptionLinks?.length) return
  const meta = new Map<string, { timestamp?: string; source: AttachedLinkSource }>()
  for (const l of yt.descriptionLinks) {
    meta.set(l.url, {
      ...(l.timestamp ? { timestamp: l.timestamp } : {}),
      source: l.timestamp ? 'youtube_description_timestamp' : 'youtube_description',
    })
  }
  const apply = (link: AttachedLink): void => {
    const m = meta.get(link.url)
    if (!m) return
    if (m.timestamp && !link.timestamp) link.timestamp = m.timestamp
    if (!link.source) link.source = m.source
  }
  for (const s of sections) for (const l of s.related_links ?? []) apply(l)
  for (const arr of key_takeaway_links) for (const l of arr) apply(l)
}

function parseSections(
  raw: unknown,
  validUrls?: Set<string>,
  candidates: GitHubResourceCandidate[] = [],
): VideoSection[] {
  if (!Array.isArray(raw)) return []
  const candById = new Map<string, GitHubResourceCandidate>()
  for (const c of candidates) candById.set(c.id, c)

  return raw
    .filter((s): s is Record<string, unknown> => typeof s === 'object' && s !== null)
    .map((s) => {
      const related = parseAttachedLinks(s.related_links, validUrls)
      // Resolve `related_github_candidate_ids` → AttachedLinks. A candidate
      // is only attached when validation succeeded (valid/redirected) or the
      // status is unverified (UI badges it). Invalid candidates are skipped.
      const candIds = Array.isArray(s.related_github_candidate_ids)
        ? s.related_github_candidate_ids
            .map((v) => (typeof v === 'string' ? v.trim() : ''))
            .filter((v) => v.length > 0)
        : []
      const seenInRelated = new Set(related.map((l) => l.url))
      for (const id of candIds) {
        const cand = candById.get(id)
        if (!cand) continue
        if (cand.validationStatus === 'invalid') continue
        const url = cand.resolvedUrl ?? cand.canonicalUrl
        if (validUrls && !validUrls.has(url)) continue
        if (seenInRelated.has(url)) continue
        related.push({
          title: cand.title,
          url,
          why_relevant_here: 'Linked to this topic by the AI from the candidate list.',
          confidence: cand.validationStatus === 'unverified' ? 'low' : cand.confidenceBeforeValidation,
          ...(cand.timestamp ? { timestamp: cand.timestamp } : {}),
        })
        seenInRelated.add(url)
      }

      const semantic_keywords = arrStr(s.semantic_keywords ?? s.keywords, 0)
        .map((kw) => kw.replace(/^#/, '').trim())
        .filter((kw) => kw.length > 0 && kw.length < 40)
        .slice(0, 8)
      return {
        title: str(s.title),
        summary: str(s.summary),
        key_points: arrStr(s.key_points, 0),
        ...(semantic_keywords.length > 0 ? { semantic_keywords } : {}),
        ...(typeof s.timestamp_seconds === 'number' ? { timestamp_seconds: s.timestamp_seconds } : {}),
        ...(related.length > 0 ? { related_links: related } : {}),
      }
    })
    .filter((s) => s.title.length > 0)
}

/**
 * Reconcile every github.com URL in `resources` against the validated
 * candidate list:
 *   - URL canonicalises and matches a candidate with status 'invalid' → DROP
 *   - URL canonicalises and matches a candidate with status valid/redirected
 *     → keep, normalise the URL to the canonical/resolved form, copy
 *       validation onto the resource so downstream UI shows the green badge.
 *   - URL canonicalises and matches an 'unverified' candidate → keep, mark
 *     validation='unverified'.
 *   - URL canonicalises but is NOT in the candidate list → register as
 *     ai_inferred. The downstream validateResources call will hit the
 *     GitHub API and either confirm it (200) or strike it (404).
 *   - URL is not a recognisable github repo URL → leave untouched.
 *
 * Then we ensure every non-invalid candidate is represented in resources[]
 * even when the AI did not list it — so users always see real, verified
 * links the creator surfaced. The candidate origin (anchor / description /
 * transcript / search) drives the synthesised metadata.
 */
function reconcileGitHubResources(
  resources: Resource[],
  candidates: GitHubResourceCandidate[],
): Resource[] {
  if (candidates.length === 0) return resources
  const byCanonical = new Map<string, GitHubResourceCandidate>()
  for (const c of candidates) byCanonical.set(c.canonicalUrl, c)

  const matched = new Set<string>()
  const out: Resource[] = []

  for (const r of resources) {
    const canon = canonicalizeGitHubUrl(r.url)
    if (!canon) {
      out.push(r)
      continue
    }
    const cand = byCanonical.get(canon.canonicalUrl)
    if (!cand) {
      // AI fabricated a github URL outside the candidate list. Register it as
      // ai_inferred so the candidate map stays in sync; the validator will
      // verify it against the GitHub API in the route layer.
      const inferred = appendAiInferredCandidate(candidates, r.url, r.title)
      if (inferred) byCanonical.set(inferred.canonicalUrl, inferred)
      out.push({ ...r, url: canon.canonicalUrl, validation: 'unchecked' })
      continue
    }
    if (cand.validationStatus === 'invalid') {
      // Known 404 — drop the resource entirely.
      console.log('[GITHUB-LINK-DEBUG] reconcile | dropped invalid github resource:', cand.canonicalUrl)
      continue
    }
    matched.add(cand.canonicalUrl)
    out.push({
      ...r,
      url: cand.resolvedUrl ?? cand.canonicalUrl,
      validation: candidateStatusToValidation(cand.validationStatus),
      ...(cand.resolvedUrl && cand.resolvedUrl !== cand.canonicalUrl ? { final_url: cand.resolvedUrl } : {}),
    })
  }

  // Make sure every validated candidate appears in resources[] — even when
  // the AI omitted it. This is the candidate equivalent of
  // mergeDescriptionLinksIntoResources for non-anchor sources.
  for (const cand of candidates) {
    if (cand.validationStatus === 'invalid') continue
    if (matched.has(cand.canonicalUrl)) continue
    out.push(candidateToResource(cand))
    matched.add(cand.canonicalUrl)
  }

  return out
}

function candidateStatusToValidation(status: GitHubResourceCandidate['validationStatus']): UrlValidation {
  switch (status) {
    case 'valid':       return 'valid'
    case 'redirected':  return 'redirected'
    case 'unverified':  return 'unverified'
    case 'invalid':     return 'invalid'
    case 'unchecked':
    default:            return 'unchecked'
  }
}

function candidateToResource(cand: GitHubResourceCandidate): Resource {
  const fromCreator = cand.source !== 'ai_inferred' && cand.source !== 'github_search'
  const url = cand.resolvedUrl ?? cand.canonicalUrl
  const ctx = cand.surroundingText || cand.sourceText || ''
  return {
    title: cand.title,
    url,
    type: 'repo',
    mentioned_in_video: fromCreator,
    why_relevant: fromCreator
      ? 'GitHub repository surfaced by the creator.'
      : 'GitHub repository the AI flagged as related.',
    user_action: 'Open the repository to inspect or clone.',
    confidence: cand.validationStatus === 'unverified' ? 'low' : cand.confidenceBeforeValidation,
    validation: candidateStatusToValidation(cand.validationStatus),
    ...(fromCreator && ctx ? { mentioned_context: ctx.slice(0, 200) } : {}),
    ...(cand.resolvedUrl && cand.resolvedUrl !== cand.canonicalUrl ? { final_url: cand.resolvedUrl } : {}),
  }
}

/**
 * Strip AttachedLinks whose URL canonicalises to a known-invalid GitHub
 * candidate. The contract forbids the AI from referencing invalid
 * candidates, but we enforce it here too as a safety net.
 */
function filterInvalidGitHubAttached(
  sections: VideoSection[],
  key_takeaway_links: AttachedLink[][],
  candidates: GitHubResourceCandidate[],
): void {
  if (candidates.length === 0) return
  const invalid = new Set(
    candidates.filter((c) => c.validationStatus === 'invalid').map((c) => c.canonicalUrl),
  )
  if (invalid.size === 0) return
  const isInvalid = (link: AttachedLink): boolean => {
    const canon = canonicalizeGitHubUrl(link.url)
    return !!canon && invalid.has(canon.canonicalUrl)
  }
  for (const s of sections) {
    if (s.related_links) s.related_links = s.related_links.filter((l) => !isInvalid(l))
  }
  for (let i = 0; i < key_takeaway_links.length; i++) {
    key_takeaway_links[i] = key_takeaway_links[i].filter((l) => !isInvalid(l))
  }
}

/**
 * Parse a single AttachedLink object. Drops anything whose url is missing or
 * does not match a real entry in resources[] (when validUrls is provided).
 */
function parseAttachedLink(raw: unknown, validUrls?: Set<string>): AttachedLink | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const url = str(r.url ?? r.href)
  if (!isAcceptableUrl(url)) return null
  if (validUrls && !validUrls.has(url)) return null

  const title = str(r.title ?? r.name)
  if (!title) return null

  const why = str(r.why_relevant_here ?? r.whyRelevantHere ?? r.why_relevant)
  const userAction = str(r.user_action ?? r.userAction)
  const description = str(r.description)

  const link: AttachedLink = {
    title,
    url,
    why_relevant_here: why || 'Mentioned in this part of the video.',
    confidence: parseConfidence(r.confidence),
  }
  if (description) link.description = description
  if (userAction) link.user_action = userAction
  const timestamp = str(r.timestamp)
  if (timestamp && /^\d{1,2}(:\d{2}){1,2}$/.test(timestamp)) link.timestamp = timestamp
  const source = str(r.source) as AttachedLinkSource
  const allowedSources: AttachedLinkSource[] = [
    'youtube_description',
    'youtube_description_timestamp',
    'transcript_inferred',
    'manual',
  ]
  if (source && allowedSources.includes(source)) link.source = source
  return link
}

function parseAttachedLinks(raw: unknown, validUrls?: Set<string>): AttachedLink[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((item) => parseAttachedLink(item, validUrls))
    .filter((l): l is AttachedLink => l !== null)
}

/**
 * Parse the parallel takeaway_links array. Always returns an array of length
 * `takeawayCount` so UI can index into it directly.
 */
function parseTakeawayLinks(raw: unknown, takeawayCount: number, validUrls: Set<string>): AttachedLink[][] {
  const out: AttachedLink[][] = Array.from({ length: takeawayCount }, () => [])
  if (!Array.isArray(raw)) return out
  for (let i = 0; i < takeawayCount; i++) {
    out[i] = parseAttachedLinks(raw[i], validUrls)
  }
  return out
}

/**
 * If the AI provided unassigned_resources, sanitize it through parseResources
 * (drops bad URLs, normalizes mentioned_in_video). Defaults to [] when missing
 * — the route layer can still derive its own fallback if needed.
 */
function parseUnassignedResources(raw: unknown, allResources: Resource[]): Resource[] {
  if (!Array.isArray(raw) || raw.length === 0) return []
  const allowedUrls = new Set(allResources.map((r) => r.url))
  return parseResources(raw).filter((r) => allowedUrls.has(r.url))
}

function parseResources(raw: unknown, transcript?: string): Resource[] {
  if (!Array.isArray(raw)) return []
  const haystack = transcript ? transcript.toLowerCase() : null

  return raw
    .filter((r): r is Record<string, unknown> => typeof r === 'object' && r !== null)
    .map((r): Resource | null => {
      const url = str(r.url ?? r.href)
      if (!isAcceptableUrl(url)) return null

      const title = str(r.title ?? r.name)
      if (!title) return null

      let mentioned = typeof r.mentioned_in_video === 'boolean' ? r.mentioned_in_video : false
      const ctx = str(r.mentioned_context)

      // Rule: mentioned_in_video=true REQUIRES a non-trivial mentioned_context.
      // The AI must quote/paraphrase from the source; otherwise we treat the claim as inferred.
      if (mentioned && ctx.length < 4) {
        mentioned = false
      }

      // Rule: when we have the transcript, verify that the quoted snippet actually appears.
      // Use a short prefix (12 chars) to allow paraphrasing while catching pure hallucination.
      if (mentioned && haystack && ctx) {
        const probe = ctx.toLowerCase().slice(0, 12).trim()
        if (probe.length >= 6 && !haystack.includes(probe)) {
          mentioned = false
        }
      }

      const conf = parseConfidence(r.confidence)
      const res: Resource = {
        title,
        url,
        type: parseResourceType(r.type),
        mentioned_in_video: mentioned,
        why_relevant: str(r.why_relevant ?? r.description),
        user_action: str(r.user_action) || (mentioned ? 'Open and read.' : 'Review whether this fits your context.'),
        confidence: mentioned ? conf : (conf === 'high' ? 'medium' : conf),
        validation: 'unchecked',
      }
      if (mentioned && ctx) res.mentioned_context = ctx
      return res
    })
    .filter((r): r is Resource => r !== null)
}

// Accept only well-formed http(s) URLs with a real-looking hostname.
// Rejects 'http://example' (no TLD), 'https:///foo' (empty host), data: / javascript: schemes etc.
function isAcceptableUrl(url: string): boolean {
  if (!url || !/^https?:\/\//i.test(url)) return false
  try {
    const u = new URL(url)
    return u.hostname.length > 0 && u.hostname.includes('.') && !u.hostname.endsWith('.')
  } catch {
    return false
  }
}

function parseResourceType(raw: unknown): Resource['type'] {
  const t = String(raw ?? '').trim().toLowerCase()
  const allowed: Resource['type'][] = ['tool', 'app', 'service', 'repo', 'product', 'paper', 'video', 'article', 'docs', 'course', 'other']
  return (allowed as string[]).includes(t) ? (t as Resource['type']) : 'other'
}

function parseConfidence(raw: unknown): 'high' | 'medium' | 'low' {
  const c = String(raw ?? '').trim().toLowerCase()
  if (c === 'high' || c === 'medium' || c === 'low') return c
  return 'medium'
}

function parseSetupGuide(raw: unknown): SetupGuide {
  if (!raw || typeof raw !== 'object') return { exists: false }
  const r = raw as Record<string, unknown>
  const exists = typeof r.exists === 'boolean' ? r.exists : false
  if (!exists) return { exists: false }

  const steps = Array.isArray(r.steps)
    ? r.steps
        .filter((s): s is Record<string, unknown> => typeof s === 'object' && s !== null)
        .map((s, i) => ({
          order: typeof s.order === 'number' ? s.order : i + 1,
          description: str(s.description),
          ...(s.command ? { command: str(s.command) } : {}),
        }))
        .filter((s) => s.description.length > 0)
    : []

  return {
    exists: true,
    ...(r.title ? { title: str(r.title) } : {}),
    ...(Array.isArray(r.prerequisites) ? { prerequisites: arrStr(r.prerequisites, 0) } : {}),
    ...(steps.length ? { steps } : {}),
    ...(Array.isArray(r.commands) ? { commands: arrStr(r.commands, 0) } : {}),
    ...(Array.isArray(r.warnings) ? { warnings: arrStr(r.warnings, 0) } : {}),
    ...(r.expected_result ? { expected_result: str(r.expected_result) } : {}),
  }
}

function parseSourceCoverage(raw: unknown, input: ExtractInput): SourceCoverage {
  if (!raw || typeof raw !== 'object') {
    return defaultSourceCoverage(input)
  }
  const r = raw as Record<string, unknown>
  const allowed = ['transcript', 'audio', 'captions', 'description', 'mixed']
  const src = String(r.extraction_source ?? '').toLowerCase()
  const extraction_source = (allowed.includes(src) ? src : defaultSourceCoverage(input).extraction_source) as SourceCoverage['extraction_source']

  return {
    transcript_available: typeof r.transcript_available === 'boolean' ? r.transcript_available : !!input.text,
    extraction_source,
    extraction_scope: resolveScope(input),
    confidence: parseConfidence(r.confidence),
    ...(Array.isArray(r.limitations) ? { limitations: arrStr(r.limitations, 0) } : {}),
    ...descriptionCoverage(input),
  }
}

function defaultSourceCoverage(input: ExtractInput): SourceCoverage {
  return {
    transcript_available: !!input.text,
    extraction_source: input.audioData ? 'audio' : input.text ? 'transcript' : 'mixed',
    extraction_scope: resolveScope(input),
    confidence: 'medium',
    ...descriptionCoverage(input),
  }
}

function descriptionCoverage(input: ExtractInput): Partial<SourceCoverage> {
  const yt = input.youtubeSource
  if (!yt) return {}
  return {
    description_available: yt.descriptionAvailable,
    description_link_count: yt.descriptionLinks?.length ?? 0,
    timestamped_resource_count: yt.timestampedResources?.length ?? 0,
  }
}

// YouTube text input is a full-video transcript by default; live audio captures only what was buffered.
function resolveScope(input: ExtractInput): ExtractionScope {
  if (input.extractionScope) return input.extractionScope
  if (input.platform === 'youtube' && input.text) return 'full_video'
  return 'current_segment'
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

function arrStr(v: unknown, minLen: number): string[] {
  if (!Array.isArray(v)) return []
  return v.map((x) => String(x).trim()).filter((s) => s.length > minLen)
}

function defaultQuickFacts(platform: Platform): QuickFacts {
  return { platform, category: 'other', content_type: 'other' }
}

function emptyV2(input: ExtractInput, message: string): ExtractionPackV2 {
  return {
    title: input.title ?? '',
    summary: '',
    video_explanation: '',
    key_takeaways: [message],
    sections: [],
    resources: [],
    setup_guide: { exists: false },
    warnings: [],
    source_coverage: defaultSourceCoverage(input),
  }
}

function inferTitle(bullets: string[]): string {
  const first = bullets[0] ?? ''
  return first.length > 60 ? first.slice(0, 57) + '…' : first
}

// Last-resort fallback when JSON parsing fails entirely — extract bullets from raw text.
function legacyTextToV2(text: string, input: ExtractInput): ExtractionPackV2 {
  const bullets = text
    .split('\n')
    .map((line) => line.replace(/^[-•*]\s*/, '').trim())
    .filter((line) => line.length > 10)
    .slice(0, 12)
  return {
    title: input.title ?? '',
    summary: '',
    video_explanation: '',
    key_takeaways: bullets.length ? bullets : ['No structured output could be extracted.'],
    sections: [],
    resources: [],
    setup_guide: { exists: false },
    warnings: ['Output parser fell back to plain-text mode — analysis may be incomplete.'],
    source_coverage: { ...defaultSourceCoverage(input), confidence: 'low', limitations: ['JSON parser failed'] },
  }
}
