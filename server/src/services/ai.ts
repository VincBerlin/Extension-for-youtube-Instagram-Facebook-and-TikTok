import { GoogleGenerativeAI } from '@google/generative-ai'
import OpenAI from 'openai'
import Anthropic from '@anthropic-ai/sdk'
import type { OutcomeMode, Platform, RelatedLink } from '../../../shared/types.js'

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
  bullets: string[]
  links: RelatedLink[]
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
    const prompt = `You are an expert at understanding spoken video content. Produce precise, high-value notes.\n\n${modeInstruction}${contextBlock}\nSource: ${input.platform}${input.title ? ` — "${input.title}"` : ''}\n\nRespond with valid JSON only:\n{\n  "title": "5–8 word synthesis",\n  "summary": "One sentence about this content",\n  "bullets": ["insight 1", ...],\n  "links": [{"title": "Name", "url": "https://..."}]\n}`
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

  const { title: aiTitle, summary, bullets, links } = parseOutput(raw)
  return {
    title: aiTitle || input.title || inferTitle(bullets),
    summary,
    bullets,
    links,
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
        bullets: ['Audio extraction requires Gemini. Set AI_PROVIDER=gemini in .env.'],
        links: [],
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

  const { title: aiTitle, summary, bullets, links } = parseOutput(raw)

  return {
    title: aiTitle || input.title || inferTitle(bullets),
    summary,
    bullets,
    links,
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

  const prompt = `You are an expert at understanding spoken video content. Your task is to listen carefully and produce precise, high-value notes.

STEP 1 — LISTEN AND UNDERSTAND:
Before extracting anything, fully process the audio to identify:
- The exact topic(s) and subtopics covered
- The content type (tutorial, opinion, review, demonstration, interview, story, etc.)
- The target audience level
- The overall structure and argument flow
- Any key moments where the speaker emphasizes, slows down, or repeats — these signal important points

STEP 2 — FILTER:
Ignore completely: intro/outro music, greetings, channel plugs, "like and subscribe", transitions, filler phrases ("um", "so basically", "you know")
Focus on: substantive claims, instructions, data points, tool names, URLs, recommendations, warnings

STEP 3 — EXTRACT using this mode:
${modeInstruction}
${contextBlock}
Source: ${input.platform}${input.title ? ` — "${input.title}"` : ''}

Output rules:
- 5–12 bullets for short content (<3 min), up to 15 for longer content
- Each bullet: direct fact or instruction, max 2 sentences, no hedging ("the speaker says", "it seems")
- If the speaker explicitly says a URL, tool name, book, or resource — include it in links
- For well-known tools mentioned without a URL, include the canonical URL

Respond with valid JSON only (no markdown, no code fences):
{
  "title": "5–8 word synthesis of the specific topic covered",
  "summary": "One sentence: what this content is specifically about and who it's for",
  "bullets": ["insight 1", "insight 2", ...],
  "links": [{ "title": "Name", "url": "https://..." }, ...]
}`

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

// ─── Prompt builders (text path) ─────────────────────────────────────────────

function buildSystemPrompt(mode: OutcomeMode, sessionContext?: string): string {
  const contextBlock = sessionContext
    ? `\n\nAlready extracted from earlier in this video — do not repeat:\n${sessionContext}\n`
    : ''

  return `You are an expert knowledge extractor. Transform video transcripts into dense, immediately useful notes.

Process:
1. Read the full transcript and understand the topic, audience, and structure
2. Identify the most valuable insights — what would a knowledgeable viewer most want to remember?
3. Apply the mode-specific focus to filter what to include
4. Extract every link, URL, GitHub repo, tool name, or resource mentioned; infer canonical URLs for well-known tools

Mode: ${mode.toUpperCase()}
${MODE_INSTRUCTIONS[mode]}
${contextBlock}
Respond with valid JSON only (no markdown, no code fences):
{
  "title": "5–8 word synthesis of the specific topic covered (not the video title)",
  "summary": "One sentence: what this content is about and who benefits from it",
  "bullets": [
    "Direct fact or instruction — max 2 sentences — no hedging, no 'the speaker says'",
    "..."
  ],
  "links": [
    { "title": "Display name", "url": "https://..." }
  ]
}

Quality rules:
- 5–12 bullets (cut ruthlessly — only points a viewer would regret missing)
- Each bullet stands alone without needing to watch the video
- No intros, outros, meta-commentary, or filler
- Links: all tools, repos, articles, services referenced — even inferred canonical URLs`
}

function buildUserPrompt(input: ExtractInput): string {
  return `Source: ${input.platform}${input.title ? ` — "${input.title}"` : ''}

Transcript:
${input.text}

Respond with JSON only.`
}

// ─── Output parsing ───────────────────────────────────────────────────────────

function parseOutput(text: string): { title: string; summary: string; bullets: string[]; links: RelatedLink[] } {
  // Strip markdown code fences if present
  const cleaned = text.replace(/^```(?:json)?\s*/im, '').replace(/\s*```\s*$/im, '').trim()

  try {
    const json = JSON.parse(cleaned)

    const bullets: string[] = (Array.isArray(json.bullets) ? json.bullets : [])
      .map((b: unknown) => String(b).trim())
      .filter((b: string) => b.length > 5)

    const links: RelatedLink[] = (Array.isArray(json.links) ? json.links : [])
      .filter((l: unknown) => typeof l === 'object' && l !== null)
      .map((l: Record<string, unknown>) => ({
        title: String(l.title ?? l.name ?? '').trim(),
        url: String(l.url ?? l.href ?? '').trim(),
      }))
      .filter((l: RelatedLink) => l.url.startsWith('http') && l.title.length > 0)

    return {
      title:   typeof json.title   === 'string' ? json.title.trim()   : '',
      summary: typeof json.summary === 'string' ? json.summary.trim() : '',
      bullets,
      links,
    }
  } catch {
    console.warn('[ai] JSON parse failed, falling back to text parser')
    return parseTextFallback(text)
  }
}

function parseTextFallback(text: string): { title: string; summary: string; bullets: string[]; links: RelatedLink[] } {
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

  return { title: '', summary: '', bullets, links }
}

function inferTitle(bullets: string[]): string {
  const first = bullets[0] ?? ''
  return first.length > 60 ? first.slice(0, 57) + '…' : first
}
