import { GoogleGenerativeAI } from '@google/generative-ai'
import OpenAI from 'openai'
import Anthropic from '@anthropic-ai/sdk'
import {
  v2ToPackFields,
  type ExtractionPackV2,
  type OutcomeMode,
  type Platform,
  type QuickFacts,
  type RelatedLink,
  type Resource,
  type SetupGuide,
  type SourceCoverage,
  type VideoSection,
} from '../../../shared/types.js'

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

interface ExtractInput {
  text?: string
  audioData?: string
  audioMimeType?: string
  mode: OutcomeMode
  platform: Platform
  title?: string
  sessionContext?: string
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

  if (AI_PROVIDER !== 'gemini') {
    const result = await extractWithAI(input)
    onChunk(JSON.stringify(result))
    return result
  }

  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY ?? '')
  let raw = ''

  if (input.audioData) {
    const model = genAI.getGenerativeModel({ model: AI_MODEL })
    const prompt = buildAudioPrompt(input)
    const rawMime = input.audioMimeType ?? 'audio/webm'
    const geminiMime = rawMime.startsWith('audio/webm') ? 'video/webm' : rawMime
    const streamResult = await model.generateContentStream({
      contents: [{ role: 'user', parts: [{ text: prompt }, { inlineData: { mimeType: geminiMime, data: input.audioData } }] }],
      generationConfig: { temperature: 0.15, maxOutputTokens: 8192, responseMimeType: 'application/json' },
    })
    for await (const chunk of streamResult.stream) {
      const text = chunk.text()
      raw += text
      onChunk(text)
    }
  } else {
    const systemPrompt = buildSystemPrompt(input.mode, input.sessionContext)
    const userPrompt = buildUserPrompt(input)
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

  return finalizeOutput(raw, input)
}

export async function extractWithAI(input: ExtractInput): Promise<ExtractOutput> {
  console.log(`[ai] provider=${AI_PROVIDER} model=${AI_MODEL} mode=${input.mode} audio=${!!input.audioData}`)

  let raw: string

  if (input.audioData) {
    if (AI_PROVIDER === 'gemini') {
      raw = await extractAudioWithGemini(input)
    } else {
      raw = JSON.stringify(emptyV2(input, 'Audio extraction requires Gemini. Set AI_PROVIDER=gemini.'))
    }
  } else {
    const systemPrompt = buildSystemPrompt(input.mode, input.sessionContext)
    const userPrompt = buildUserPrompt(input)
    switch (AI_PROVIDER) {
      case 'gemini':    raw = await extractTextWithGemini(systemPrompt, userPrompt); break
      case 'openai':    raw = await extractWithOpenAI(systemPrompt, userPrompt); break
      case 'anthropic': raw = await extractWithAnthropic(systemPrompt, userPrompt); break
    }
  }

  return finalizeOutput(raw, input)
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
  "sections": [
    {
      "title": "Short topical heading (3–6 words) — like a chapter title",
      "summary": "1–2 sentences explaining what this section covers",
      "key_points": ["Bullet 1", "Bullet 2"],
      "timestamp_seconds": 120
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
7. NO MARKDOWN. NO CODE FENCES. RAW JSON ONLY.`

function buildAudioPrompt(input: ExtractInput): string {
  const { platform, title, mode, sessionContext } = input
  const modeInstruction = MODE_INSTRUCTIONS[mode]
  const contextBlock = sessionContext
    ? `\n\nALREADY EXTRACTED earlier in this video — do not repeat:\n${sessionContext}\n`
    : ''

  return `You are an expert at understanding spoken video content. Your task is to UNDERSTAND the video, then produce a precise, structured analysis that EXPLAINS what the video covers and surfaces every actionable resource and step.

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
${contextBlock}
${V2_OUTPUT_CONTRACT}`
}

function buildSystemPrompt(mode: OutcomeMode, sessionContext?: string): string {
  const contextBlock = sessionContext
    ? `\n\nALREADY EXTRACTED earlier in this video — do not repeat:\n${sessionContext}\n`
    : ''

  return `You are an expert video-understanding assistant. You DO NOT summarize. You EXPLAIN videos and surface actionable resources, with a clear distinction between what was actually mentioned in the video and what you (the AI) are recommending as related.

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
  return `Source: ${input.platform}${input.title ? ` — "${input.title}"` : ''}

Transcript:
${input.text}

Respond with raw JSON only — no markdown, no code fences.`
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

function parseV2(text: string, input: ExtractInput): ExtractionPackV2 {
  const cleaned = text.replace(/^```(?:json)?\s*/im, '').replace(/\s*```\s*$/im, '').trim()

  let json: Record<string, unknown> = {}
  try {
    json = JSON.parse(cleaned)
  } catch {
    console.warn('[ai] V2 JSON parse failed — using legacy fallback')
    return legacyTextToV2(text, input)
  }

  return {
    title: str(json.title) || input.title || '',
    summary: str(json.summary),
    video_explanation: str(json.video_explanation),
    key_takeaways: arrStr(json.key_takeaways ?? json.bullets, 5),
    sections: parseSections(json.sections),
    resources: parseResources(json.resources ?? json.links),
    setup_guide: parseSetupGuide(json.setup_guide),
    warnings: arrStr(json.warnings, 3),
    source_coverage: parseSourceCoverage(json.source_coverage, input),
  }
}

function parseSections(raw: unknown): VideoSection[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((s): s is Record<string, unknown> => typeof s === 'object' && s !== null)
    .map((s) => ({
      title: str(s.title),
      summary: str(s.summary),
      key_points: arrStr(s.key_points, 0),
      ...(typeof s.timestamp_seconds === 'number' ? { timestamp_seconds: s.timestamp_seconds } : {}),
    }))
    .filter((s) => s.title.length > 0)
}

function parseResources(raw: unknown): Resource[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((r): r is Record<string, unknown> => typeof r === 'object' && r !== null)
    .map((r): Resource => {
      const url = str(r.url ?? r.href)
      const mentioned = typeof r.mentioned_in_video === 'boolean' ? r.mentioned_in_video : true
      const ctx = str(r.mentioned_context)
      const conf = parseConfidence(r.confidence)
      const res: Resource = {
        title: str(r.title ?? r.name),
        url,
        type: parseResourceType(r.type),
        mentioned_in_video: mentioned,
        why_relevant: str(r.why_relevant ?? r.description),
        user_action: str(r.user_action) || (mentioned ? 'Open and read.' : 'Review whether this fits your context.'),
        confidence: conf,
      }
      if (mentioned && ctx) res.mentioned_context = ctx
      return res
    })
    .filter((r) => r.url.startsWith('http') && r.title.length > 0)
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
    confidence: parseConfidence(r.confidence),
    ...(Array.isArray(r.limitations) ? { limitations: arrStr(r.limitations, 0) } : {}),
  }
}

function defaultSourceCoverage(input: ExtractInput): SourceCoverage {
  return {
    transcript_available: !!input.text,
    extraction_source: input.audioData ? 'audio' : input.text ? 'transcript' : 'mixed',
    confidence: 'medium',
  }
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
