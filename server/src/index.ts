import express, { type NextFunction, type Request, type Response } from 'express'
import cors from 'cors'
import { extractRouter } from './routes/extract.js'
import { transcribeRouter } from './routes/transcribe.js'
import { llmRouter } from './routes/llm.js'
import { optionalEnv } from './config/env.js'
import { isOriginAllowed } from './security/corsOrigin.js'

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
const extraOrigins = (optionalEnv('ALLOWED_ORIGINS') ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

// `callback(null, false)` (not an Error) for disallowed origins: the cors
// middleware then omits the CORS headers and the browser blocks the response
// — an Error here would surface as an Express 500 with a stack trace.
app.use(cors({
  origin: (origin, callback) => callback(null, isOriginAllowed(origin, allowedExtensionIds, extraOrigins)),
  credentials: true,
}))

app.use(express.json({ limit: '20mb' }))

app.use('/extract', extractRouter)
app.use('/transcribe', transcribeRouter)
app.use('/llm', llmRouter)

app.get('/health', (_req, res) => res.json({ ok: true }))

// Final safety net: anything a route throws (or passes to next()) lands here
// as clean JSON — never an HTML stack trace.
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[server] unhandled error:', err.message)
  if (res.headersSent) return
  res.status(500).json({ error: 'Internal server error' })
})

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`)
})
