import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isOriginAllowed } from './corsOrigin.js'

const STORE_ID = 'abcdefghijklmnopabcdefghijklmnop'
const OTHER_ID = 'ppppppppppppppppppppppppppppppp'.padEnd(32, 'p')

test('requests without an Origin header are allowed (curl, same-origin)', () => {
  assert.equal(isOriginAllowed(undefined, [], []), true)
})

test('any chrome-extension origin is allowed while the allowlist is empty (dev fallback)', () => {
  assert.equal(isOriginAllowed(`chrome-extension://${STORE_ID}`, [], []), true)
})

test('locked-down allowlist admits only the listed extension id', () => {
  assert.equal(isOriginAllowed(`chrome-extension://${STORE_ID}`, [STORE_ID], []), true)
  assert.equal(isOriginAllowed(`chrome-extension://${OTHER_ID}`, [STORE_ID], []), false)
})

test('malformed chrome-extension origins are rejected', () => {
  assert.equal(isOriginAllowed('chrome-extension://UPPERCASE', [], []), false)
  assert.equal(isOriginAllowed('chrome-extension://tooshort', [], []), false)
})

test('extra http(s) origins are honored', () => {
  assert.equal(isOriginAllowed('https://example.com', [], ['https://example.com']), true)
  assert.equal(isOriginAllowed('https://evil.com', [], ['https://example.com']), false)
})

test('unknown web origins are rejected by default', () => {
  assert.equal(isOriginAllowed('https://anything.dev', [], []), false)
})
