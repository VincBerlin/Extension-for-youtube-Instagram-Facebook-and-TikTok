import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { crx } from '@crxjs/vite-plugin'
import manifest from './src/manifest'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig(({ mode }) => {
  // Hard gate: a production build with a localhost (or missing) API base is a
  // dead extension for every Web Store user — refuse to build it. Local dev
  // uses `npm run dev` (development mode), which reads .env and may stay on
  // localhost.
  if (mode === 'production') {
    const env = loadEnv(mode, __dirname, '')
    const apiBase = env.VITE_API_BASE
    if (!apiBase || !/^https:\/\//.test(apiBase)) {
      throw new Error(
        `[build] VITE_API_BASE must be a deployed https:// URL for production builds (got: ${apiBase || 'unset'}). ` +
        'Set it in extension/.env.production.',
      )
    }
    if (/localhost|127\.0\.0\.1/.test(apiBase)) {
      throw new Error(
        `[build] VITE_API_BASE points at localhost (${apiBase}) — a store build with this URL cannot reach any server. ` +
        'Set the deployed server URL in extension/.env.production.',
      )
    }
  }

  return {
    plugins: [
      react(),
      crx({ manifest }),
    ],
    resolve: {
      alias: {
        '@shared': path.resolve(__dirname, '../shared'),
      },
    },
    build: {
      rollupOptions: {
        input: {
          // Offscreen document for audio capture (not declared in manifest — bundled as extension resource)
          offscreen: 'src/offscreen/index.html',
        },
      },
    },
  }
})
