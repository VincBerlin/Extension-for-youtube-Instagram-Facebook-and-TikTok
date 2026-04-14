import express from 'express'
import cors from 'cors'
import { extractRouter } from './routes/extract.js'
import { transcribeRouter } from './routes/transcribe.js'

const app = express()
const PORT = process.env.PORT ?? 3000

// Explicit origin allowlist — chrome-extension:// origins are always allowed
// (service-worker requests carry the extension origin). Additional origins can
// be added via ALLOWED_ORIGINS env var (comma-separated).
const extraOrigins = (process.env.ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true)
    if (origin.startsWith('chrome-extension://')) return callback(null, true)
    if (extraOrigins.includes(origin)) return callback(null, true)
    callback(new Error(`CORS: origin not allowed: ${origin}`))
  },
  credentials: true,
}))

app.use(express.json({ limit: '20mb' }))

app.use('/extract', extractRouter)
app.use('/transcribe', transcribeRouter)

app.get('/health', (_req, res) => res.json({ ok: true }))

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`)
})
