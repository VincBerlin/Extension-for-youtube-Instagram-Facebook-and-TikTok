import { GoogleGenerativeAI } from '@google/generative-ai'
import OpenAI from 'openai'
import Anthropic from '@anthropic-ai/sdk'
import type { OutcomeMode, Platform, QuickFacts, RelatedLink } from '../../../shared/types.js'

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
- Include any memorable analogies, numbers, or statistics mentioned
- If a concept is explained step-by-step, compress it to the essential logic`,

  'build-pack': `
Focus: actionable steps, implementation details, code patterns, CLI commands, configuration, tools.
- Be specific enough that a developer could follow without watching the video
- Capture exact commands, flags, file paths, or API calls mentioned
- Extract every repository, library, package, or boilerplate referenced
- Note any "gotchas", warnings, or things the author says NOT to do`,

  'decision-pack': `
Focus: decision criteria, tradeoffs, conditions, and rules for choosing between options.
- Write criteria as decision rules: "Use X when...", "Avoid Y if...", "Prefer A over B when..."
- Capture explicit pros/cons and their context (not generic tradeoffs)
- Note the author's recommendation and the conditions it applies to
- Include any data, benchmarks, or evidence cited to support a choice`,

  'coach-notes': `
Focus: technique cues, form corrections, drills, progressions, performance principles.
- Write cues in imperative form: "keep elbows high", "rotate from hips, not shoulders"
- Capture specific numbers: reps, sets, angles, distances, durations
- Note the most common mistake the coach corrects and the fix
- Extract progressions in order (beginner → advanced)`,

  'tools': `
Focus: every tool, app, service, library, API, or resource explicitly mentioned.
- Format each bullet as: [Tool name] — what it does + how it's used in this specific context
- Include pricing tier if mentioned (free, paid, freemium)
- Note alternatives mentioned and why the speaker chose one over another
- Capture setup requirements or prerequisites if stated`,

  'stack': `
Focus: the complete technical stack with specifics.
- List each layer: frontend, backend, database, auth, hosting, CDN, monitoring, CI/CD
- Capture the specific version, tier, or configuration used (not just the tool name)
- Note why each technology was chosen (performance, cost, DX, etc.) if explained
- Include third-party services, APIs, and SDKs integrated into the stack`,
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

interface ExtractOutput {
  title: string
  summary: string
  keywords: string[]
  bullets: string[]
  links: RelatedLink[]
  quick_facts: QuickFacts
}

// ─── Main entry point ─────────────────────────────────────────────────────────

export async function extractWithAIStream(
  input: ExtractInput,
  onChunk: (text: string) => void,
): Promise<ExtractOutput> {
  console.log(`[ai] stream provider=${AI_PROVIDER} model=${AI_MODEL} mode=${input.mode} audio=${!!input.audioData}`)

  if (AI_PROVIDER !== 'gemini') {
    // Non-streaming fallback for openai/anthropic
    const result = await extractWithAI(input)
    onChunk(JSON.stringify(result))
    return result
  }

  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY ?? '')
  let raw = ''

  if (input.audioData) {
    const model = genAI.getGenerativeModel({ model: AI_MODEL })
    const contextBlock = input.sessionContext
      ? `\n\nAlready extracted from earlier in this video — do not repeat:\n${input.sessionContext}\n`
      : ''
    const modeInstruction = MODE_INSTRUCTIONS[input.mode]
    const prompt = buildAudioPrompt(input.platform, input.title, modeInstruction, contextBlock)
    const rawMime = input.audioMimeType ?? 'audio/webm'
    const geminiMime = rawMime.startsWith('audio/webm') ? 'video/webm' : rawMime
    const streamResult = await model.generateContentStream({
      contents: [{ role: 'user', parts: [{ text: prompt }, { inlineData: { mimeType: geminiMime, data: input.audioData } }] }],
      generationConfig: { temperature: 0.15, maxOutputTokens: 8192 },
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
      generationConfig: { temperature: 0.15, maxOutputTokens: 8192 },
    })
    for await (const chunk of streamResult.stream) {
      const text = chunk.text()
      raw += text
      onChunk(text)
    }
  }

  const parsed = parseOutput(raw)
  return {
    title: parsed.title || input.title || inferTitle(parsed.bullets),
    summary: parsed.summary,
    keywords: parsed.keywords,
    bullets: parsed.bullets,
    links: parsed.links,
    quick_facts: parsed.quick_facts ?? defaultQuickFacts(input.platform),
  }
}

export async function extractWithAI(input: ExtractInput): Promise<ExtractOutput> {
  console.log(`[ai] provider=${AI_PROVIDER} model=${AI_MODEL} mode=${input.mode} audio=${!!input.audioData}`)

  let raw: string

  if (input.audioData) {
    if (AI_PROVIDER === 'gemini') {
      raw = await extractAudioWithGemini(input)
    } else {
      raw = JSON.stringify({
        title: input.title ?? '',
        summary: '',
        keywords: [],
        bullets: ['Audio extraction requires Gemini. Set AI_PROVIDER=gemini in .env.'],
        links: [],
        quick_facts: defaultQuickFacts(input.platform),
      })
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

  const parsed = parseOutput(raw)

  return {
    title: parsed.title || input.title || inferTitle(parsed.bullets),
    summary: parsed.summary,
    keywords: parsed.keywords,
    bullets: parsed.bullets,
    links: parsed.links,
    quick_facts: parsed.quick_facts ?? defaultQuickFacts(input.platform),
  }
}

// ─── Audio extraction (Gemini multimodal) ────────────────────────────────────

async function extractAudioWithGemini(input: ExtractInput): Promise<string> {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY ?? '')
  const model = genAI.getGenerativeModel({ model: AI_MODEL })

  const contextBlock = input.sessionContext
    ? `\n\nAlready extracted from earlier in this video — do not repeat:\n${input.sessionContext}\n`
    : ''

  const modeInstruction = MODE_INSTRUCTIONS[input.mode]
  const prompt = buildAudioPrompt(input.platform, input.title, modeInstruction, contextBlock)

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
      temperature: 0.15,   // lower = more precise, less hallucination
      maxOutputTokens: 8192,
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
    generationConfig: { temperature: 0.15, maxOutputTokens: 8192 },
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
    max_tokens: 2500,
    response_format: { type: 'json_object' },
  })
  return response.choices[0]?.message.content ?? '{}'
}

async function extractWithAnthropic(systemPrompt: string, userPrompt: string): Promise<string> {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const response = await anthropic.messages.create({
    model: AI_MODEL,
    max_tokens: 2500,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  })
  const block = response.content[0]
  return block.type === 'text' ? block.text : '{}'
}

// ─── Prompt builders ─────────────────────────────────────────────────────────

const FILTER_RULES = `IGNORE COMPLETELY: who made the video, when it was made, likes, comments, channel plugs, "like and subscribe", greetings, intro/outro music, the creator's personal opinions about themselves, filler ("um", "you know"), transitions.
FOCUS ON: the LEARNING content only — substantive claims, instructions, data points, concepts, tools, methods, warnings, recommendations.`

const OUTPUT_CONTRACT = `Respond with valid JSON only (no markdown, no code fences):
{
  "title": "5–8 word synthesis of the specific topic covered (not the video title, not the creator name)",
  "summary": "One sentence: what this content teaches and who benefits from it",
  "keywords": ["Keyword1", "Keyword2", "..."],
  "quick_facts": {
    "platform": "youtube|tiktok|instagram|facebook",
    "category": "technology|fitness|business|education|productivity|health|finance|design|other",
    "content_type": "tutorial|review|opinion|demonstration|interview|story|tips|news|other"
  },
  "bullets": [
    "Direct fact or instruction — max 2 sentences — no hedging, no 'the speaker says'",
    "..."
  ],
  "links": [
    { "title": "Display name", "url": "https://...", "description": "Why it's relevant in one short phrase" }
  ]
}

Quality rules:
- keywords: 5–10 keywords. Each keyword is a main topic or concept from the content
- bullets: 5–12 (up to 15 for long-form). Each bullet stands alone without needing to watch the video. No intros, outros, meta-commentary, filler.
- links: every tool, library, product, book, course, or service mentioned or recommended — always include the canonical URL, even when the speaker did not state one. Each link gets a one-phrase description of why it's relevant.
- quick_facts: pick the closest match for category and content_type from the lists above. platform must echo the source platform.
- Language: respond in the same language as the source content.`

function buildAudioPrompt(platform: Platform, title: string | undefined, modeInstruction: string, contextBlock: string): string {
  return `You are an expert at understanding spoken video content. Your task is to listen carefully and produce precise, high-value learning notes.

STEP 1 — LISTEN AND UNDERSTAND:
Before extracting anything, fully process the audio to identify:
- The exact topic(s) and subtopics covered
- The content type (tutorial, opinion, review, demonstration, interview, story, etc.)
- The target audience level
- The overall structure and argument flow
- Any key moments where the speaker emphasizes, slows down, or repeats — these signal important points

STEP 2 — FILTER:
${FILTER_RULES}

STEP 3 — EXTRACT using this mode:
${modeInstruction}
${contextBlock}
Source: ${platform}${title ? ` — "${title}"` : ''}

STEP 4 — ENRICH:
- If a concept, tool, or technique is mentioned but not explained in the audio, add a brief clarifying sentence from your own knowledge. Do not invent claims the speaker didn't make — supplement factual context only.

STEP 5 — COLLECT LINKS:
- For every tool, library, product, book, course, or resource mentioned or recommended — include its canonical URL in links even if the speaker did not state one. Infer canonical URLs for all well-known items.

${OUTPUT_CONTRACT}`
}

function buildSystemPrompt(mode: OutcomeMode, sessionContext?: string): string {
  const contextBlock = sessionContext
    ? `\n\nAlready extracted from earlier in this video — do not repeat:\n${sessionContext}\n`
    : ''

  return `You are an expert knowledge extractor. Transform video transcripts into dense, immediately useful learning notes.

Process:
1. Read the full transcript and understand the topic, audience, and structure
2. Filter ruthlessly — keep only the LEARNING content.
${FILTER_RULES}
3. Apply the mode-specific focus to filter what to include
4. Enrich bullets with your own background knowledge: if a concept, tool, or technique is mentioned but not explained in the transcript, add a brief clarifying sentence using what you know. Do not invent claims the speaker didn't make — supplement factual context only.
5. Collect links: for every tool, library, product, book, course, or resource that is mentioned or recommended — include its canonical URL even if the speaker did not state one. Infer canonical URLs for all well-known items.

Mode: ${mode.toUpperCase()}
${MODE_INSTRUCTIONS[mode]}
${contextBlock}
${OUTPUT_CONTRACT}`
}

function buildUserPrompt(input: ExtractInput): string {
  return `Source: ${input.platform}${input.title ? ` — "${input.title}"` : ''}

Transcript:
${input.text}

Respond with JSON only.`
}

// ─── Output parsing ───────────────────────────────────────────────────────────

interface ParsedOutput {
  title: string
  summary: string
  keywords: string[]
  bullets: string[]
  links: RelatedLink[]
  quick_facts: QuickFacts | null
}

function parseOutput(text: string): ParsedOutput {
  // Strip markdown code fences if present
  const cleaned = text.replace(/^```(?:json)?\s*/im, '').replace(/\s*```\s*$/im, '').trim()

  try {
    const json = JSON.parse(cleaned)

    const keywords: string[] = (Array.isArray(json.keywords) ? json.keywords : [])
      .map((k: unknown) => String(k).trim())
      .filter((k: string) => k.length > 0)

    const bullets: string[] = (Array.isArray(json.bullets) ? json.bullets : [])
      .map((b: unknown) => String(b).trim())
      .filter((b: string) => b.length > 5)

    const links: RelatedLink[] = (Array.isArray(json.links) ? json.links : [])
      .filter((l: unknown) => typeof l === 'object' && l !== null)
      .map((l: Record<string, unknown>) => {
        const description = String(l.description ?? '').trim()
        const link: RelatedLink = {
          title: String(l.title ?? l.name ?? '').trim(),
          url: String(l.url ?? l.href ?? '').trim(),
        }
        if (description) link.description = description
        return link
      })
      .filter((l: RelatedLink) => l.url.startsWith('http') && l.title.length > 0)

    return {
      title:    typeof json.title   === 'string' ? json.title.trim()   : '',
      summary:  typeof json.summary === 'string' ? json.summary.trim() : '',
      keywords,
      bullets,
      links,
      quick_facts: parseQuickFacts(json.quick_facts),
    }
  } catch {
    console.warn('[ai] JSON parse failed, falling back to text parser')
    return parseTextFallback(text)
  }
}

function parseQuickFacts(raw: unknown): QuickFacts | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const platform = typeof r.platform === 'string' ? r.platform.trim().toLowerCase() : ''
  const category = typeof r.category === 'string' ? r.category.trim().toLowerCase() : ''
  const content_type = typeof r.content_type === 'string' ? r.content_type.trim().toLowerCase() : ''
  if (!platform && !category && !content_type) return null
  return { platform, category, content_type }
}

function defaultQuickFacts(platform: Platform): QuickFacts {
  return { platform, category: 'other', content_type: 'other' }
}

function parseTextFallback(text: string): ParsedOutput {
  const parts = text.split(/^LINKS:/im)
  const bulletText = parts[0] ?? text
  const linksText = parts[1] ?? ''

  const bullets = bulletText
    .split('\n')
    .map((line) => line.replace(/^[-•*]\s*/, '').trim())
    .filter((line) => line.length > 10)

  const links: RelatedLink[] = []
  const linkRegex = /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g
  let m: RegExpExecArray | null
  while ((m = linkRegex.exec(linksText)) !== null) {
    links.push({ title: m[1], url: m[2] })
  }

  return { title: '', summary: '', keywords: [], bullets, links, quick_facts: null }
}

function inferTitle(bullets: string[]): string {
  const first = bullets[0] ?? ''
  return first.length > 60 ? first.slice(0, 57) + '…' : first
}
