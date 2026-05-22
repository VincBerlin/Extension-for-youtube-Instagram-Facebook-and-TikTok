import { useEffect } from 'react'
import { supabase } from './useAuth'
import { useAppStore } from '../store'
import type {
  Pack,
  Collection,
  ExtractionPackV2,
  QuickFacts,
  RelatedLink,
  SavedItem,
  SavedItemType,
  OutcomeMode,
} from '@shared/types'


function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function normalizeV2(source: Record<string, unknown>): ExtractionPackV2 {
  return {
    title: asString(source.title),
    summary: asString(source.summary),
    video_explanation: asString(source.video_explanation),
    key_takeaways: asStringArray(source.key_takeaways ?? source.bullets),
    sections: Array.isArray(source.sections) ? (source.sections as ExtractionPackV2['sections']) : [],
    resources: Array.isArray(source.resources) ? (source.resources as ExtractionPackV2['resources']) : [],
    setup_guide:
      source.setup_guide && typeof source.setup_guide === 'object'
        ? (source.setup_guide as ExtractionPackV2['setup_guide'])
        : { exists: false },
    warnings: asStringArray(source.warnings),
    source_coverage:
      source.source_coverage && typeof source.source_coverage === 'object'
        ? (source.source_coverage as ExtractionPackV2['source_coverage'])
        : {
            transcript_available: false,
            extraction_source: 'mixed',
            extraction_scope: 'current_segment',
            confidence: 'low',
          },
  }
}

// Supabase returns snake_case — map to camelCase Pack type.
// The deployed schema flattens the V2 extraction payload across many columns
// (`video_explanation`, `key_takeaways`, `sections`, `resources`,
// `setup_guide`, `warnings`, `source_coverage`) and stores the full original
// extraction in `analysis_json`. Any legacy fields (`keywords`,
// `relevant_points`, `important_links`, `quick_facts`) live inside
// `analysis_json.legacy` — read from there so older rows still render.
export function mapPackRow(row: Record<string, unknown>): Pack {
  const analysis = (row.analysis_json as Record<string, unknown> | null) ?? null
  const legacy = (analysis?.legacy as Record<string, unknown> | undefined) ?? undefined

  // Reconstruct the V2 payload preferentially from columns; fall back to
  // analysis_json for older rows that pre-date the column split.
  const v2: ExtractionPackV2 | undefined = (() => {
    if (analysis && typeof analysis === 'object' && 'sections' in analysis && Array.isArray(analysis.sections)) {
      return normalizeV2(analysis)
    }
    if (Array.isArray(row.sections) || row.video_explanation || row.source_coverage) {
      return normalizeV2(row)
    }
    return undefined
  })()

  return {
    id: row.id as string,
    userId: row.user_id as string,
    title: row.title as string,
    url: row.url as string,
    platform: row.platform as Pack['platform'],
    mode: row.mode as Pack['mode'],
    key_takeaways:
      (row.key_takeaways as string[] | null) ??
      (row.bullets as string[] | null) ??
      [],
    summary: (row.summary as string | null) ?? undefined,
    keywords: (legacy?.keywords as string[] | undefined) ?? undefined,
    relevant_points: (legacy?.relevant_points as string[] | undefined) ?? undefined,
    important_links: (legacy?.important_links as RelatedLink[] | undefined) ?? undefined,
    quick_facts: (legacy?.quick_facts as QuickFacts | undefined) ?? undefined,
    v2,
    savedAt: row.saved_at as string,
  }
}

// Supabase returns snake_case — map to camelCase Collection type
function mapCollection(row: Record<string, unknown>): Collection {
  const items = (row.collection_items as Array<Record<string, unknown>> ?? []).map((item) => ({
    type: item.type as Collection['items'][number]['type'],
    refId: item.ref_id as string,
  }))
  return {
    id: row.id as string,
    userId: row.user_id as string,
    name: row.name as string,
    items,
    createdAt: row.created_at as string,
  }
}

function mapSavedItem(row: Record<string, unknown>): SavedItem {
  const payload = (row.payload as SavedItem['payload'] | null) ?? { title: '', raw: null }
  return {
    id: row.id as string,
    userId: row.user_id as string,
    packId: (row.pack_id as string | null) ?? null,
    itemType: row.item_type as SavedItemType,
    payload,
    videoUrl: (row.video_url as string | null) ?? null,
    videoTitle: (row.video_title as string | null) ?? null,
    mode: (row.mode as OutcomeMode | null) ?? null,
    createdAt: row.created_at as string,
  }
}

export async function loadLibrary(): Promise<void> {
  const state = useAppStore.getState()
  const user = state.user
  if (!user) return

  state.setLibraryLoading(true)
  state.setLibraryError(null)
  console.log('[LIBRARY-DEBUG] load: start | userId-suffix:', user.id.slice(0, 8))
  try {
    const [
      { data: packs, error: packsError },
      { data: collections, error: collectionsError },
      { data: items, error: itemsError },
    ] = await Promise.all([
      supabase
        .from('packs')
        .select('*')
        .eq('user_id', user.id)
        .order('saved_at', { ascending: false })
        .limit(100),
      supabase
        .from('collections')
        .select('*, collection_items(*)')
        .eq('user_id', user.id),
      supabase
        .from('saved_items')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(200),
    ])

    if (packsError) console.warn('[LIBRARY-DEBUG] packs load failed |', packsError.message)
    if (collectionsError) console.warn('[LIBRARY-DEBUG] collections load failed |', collectionsError.message)
    if (itemsError) console.warn('[LIBRARY-DEBUG] saved_items load failed |', itemsError.message)

    const fresh = useAppStore.getState()
    if (packs) fresh.setPacks((packs as Array<Record<string, unknown>>).map(mapPackRow))
    if (collections) fresh.setCollections((collections as Array<Record<string, unknown>>).map(mapCollection))
    if (items) fresh.setSavedItems((items as Array<Record<string, unknown>>).map(mapSavedItem))

    const errorParts = [packsError?.message, collectionsError?.message, itemsError?.message].filter(Boolean)
    fresh.setLibraryError(errorParts.length > 0 ? errorParts.join(' | ') : null)
    console.log('[LIBRARY-DEBUG] load: ok | packs:', packs?.length ?? 0, '| collections:', collections?.length ?? 0, '| savedItems:', items?.length ?? 0)
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error'
    console.warn('[LIBRARY-DEBUG] load: unexpected error |', msg)
    useAppStore.getState().setLibraryError(msg)
  } finally {
    useAppStore.getState().setLibraryLoading(false)
  }
}

export function useLibrary() {
  const user = useAppStore((s) => s.user)

  useEffect(() => {
    if (!user) return
    void loadLibrary()
  }, [user])
}
