import { describe, expect, it } from 'vitest'
import { selectCachePruneKeys } from './cachePrune'

describe('selectCachePruneKeys', () => {
  it('keeps everything under the cap', () => {
    const entries = [
      { key: 'a', cachedAt: 1 },
      { key: 'b', cachedAt: 2 },
    ]
    expect(selectCachePruneKeys(entries, 5)).toEqual([])
  })

  it('drops the oldest entries beyond the cap', () => {
    const entries = [
      { key: 'oldest', cachedAt: 10 },
      { key: 'newest', cachedAt: 40 },
      { key: 'mid', cachedAt: 30 },
      { key: 'old', cachedAt: 20 },
    ]
    expect(selectCachePruneKeys(entries, 2).sort()).toEqual(['old', 'oldest'])
  })

  it('treats missing timestamps (legacy entries, cachedAt 0) as oldest', () => {
    const entries = [
      { key: 'legacy', cachedAt: 0 },
      { key: 'fresh', cachedAt: 100 },
      { key: 'newer', cachedAt: 200 },
    ]
    expect(selectCachePruneKeys(entries, 2)).toEqual(['legacy'])
  })

  it('does not mutate the input array', () => {
    const entries = [
      { key: 'b', cachedAt: 2 },
      { key: 'a', cachedAt: 1 },
    ]
    selectCachePruneKeys(entries, 1)
    expect(entries[0].key).toBe('b')
  })
})
