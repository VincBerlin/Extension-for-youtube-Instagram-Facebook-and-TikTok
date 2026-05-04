import test from 'node:test'
import assert from 'node:assert/strict'
import { extractYouTubeId } from './youtube.js'

test('extractYouTubeId supports watch URLs', () => {
  assert.equal(extractYouTubeId('https://www.youtube.com/watch?v=abc123xyz00'), 'abc123xyz00')
})

test('extractYouTubeId supports youtu.be URLs with query params', () => {
  assert.equal(extractYouTubeId('https://youtu.be/abc123xyz00?si=token'), 'abc123xyz00')
})

test('extractYouTubeId supports shorts URLs', () => {
  assert.equal(extractYouTubeId('https://www.youtube.com/shorts/abc123xyz00?feature=share'), 'abc123xyz00')
})

test('extractYouTubeId returns null for invalid URLs', () => {
  assert.equal(extractYouTubeId('not-a-url'), null)
})
