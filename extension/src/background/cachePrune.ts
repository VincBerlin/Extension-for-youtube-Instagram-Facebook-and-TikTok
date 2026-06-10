// Bounded analysis caches. chrome.storage.local has a hard quota (~10MB);
// without pruning, every set() eventually rejects and caching/session
// persistence silently stop working.

export const MAX_CACHE_ENTRIES = 50

// Given cache entries (storage key + write timestamp), return the keys to
// delete so that at most maxEntries newest remain. Entries without a
// timestamp (written before pruning existed) count as oldest.
export function selectCachePruneKeys(
  entries: ReadonlyArray<{ key: string; cachedAt: number }>,
  maxEntries: number,
): string[] {
  if (entries.length <= maxEntries) return []
  return [...entries]
    .sort((a, b) => b.cachedAt - a.cachedAt)
    .slice(maxEntries)
    .map((e) => e.key)
}
