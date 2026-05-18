import express from 'express'
import cors from 'cors'
import { extractRouter } from './routes/extract.js'
import { transcribeRouter } from './routes/transcribe.js'
import { llmRouter } from './routes/llm.js'
import { optionalEnv } from './config/env.js'

const app = express()
const PORT = Number(optionalEnv('PORT', '3001'))

// CORS allowlists — explicit, not wildcard. Two sources:
//   ALLOWED_EXTENSION_IDS   comma-separated Chrome Extension IDs (32 lowercase
//                           letters a-p). A request whose Origin is
//                           `chrome-extension://<id>` is allowed only if <id>
//                           appears here. If the env is unset we fall open to
//                           allow ALL chrome-extension:// origins so local dev
//                           with an unpacked extension keeps working — set the
//                           env in production to lock to your own build.
//   ALLOWED_ORIGINS         comma-separated http(s) origins (web app, marketing
//                           site, localhost for dev frontends).
const allowedExtensionIds = (optionalEnv('ALLOWED_EXTENSION_IDS') ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
const allowExtensionFallback = allowedExtensionIds.length === 0
const extraOrigins = (optionalEnv('ALLOWED_ORIGINS') ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

function isAllowedChromeExtensionOrigin(origin: string): boolean {
  const match = origin.match(/^chrome-extension:\/\/([a-p]{32})$/)
  if (!match) return false
  if (allowExtensionFallback) return true
  return allowedExtensionIds.includes(match[1])
}

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true)
    if (origin.startsWith('chrome-extension://')) {
      if (isAllowedChromeExtensionOrigin(origin)) return callback(null, true)
      return callback(new Error(`CORS: extension origin not allowed: ${origin}`))
    }
    if (extraOrigins.includes(origin)) return callback(null, true)
    callback(new Error(`CORS: origin not allowed: ${origin}`))
  },
  credentials: true,
}))

app.use(express.json({ limit: '20mb' }))

app.use('/extract', extractRouter)
app.use('/transcribe', transcribeRouter)
app.use('/llm', llmRouter)

app.get('/health', (_req, res) => res.json({ ok: true }))

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`)
})
