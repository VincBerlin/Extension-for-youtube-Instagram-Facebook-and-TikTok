import { defineConfig } from 'vitest/config'

// Separate from vite.config.ts on purpose: the crxjs plugin there expects a
// full extension build context and must not load for unit tests.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
