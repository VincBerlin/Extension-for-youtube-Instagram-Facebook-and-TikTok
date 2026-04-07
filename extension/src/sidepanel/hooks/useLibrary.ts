import { useEffect } from 'react'
import { supabase } from './useAuth'
import { useAppStore } from '../store'
import type { Pack, Collection } from '@shared/types'

// Supabase returns snake_case — map to camelCase Pack type
export function mapPackRow(row: Record<string, unknown>): Pack {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    title: row.title as string,
    url: row.url as string,
    platform: row.platform as Pack['platform'],
    mode: row.mode as Pack['mode'],
    bullets: row.bullets as string[],
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

export function useLibrary() {
  const { user, setPacks, setCollections } = useAppStore()

  useEffect(() => {
    if (!user) return

    async function load() {
      const [{ data: packs }, { data: collections }] = await Promise.all([
        supabase
          .from('packs')
          .select('*')
          .eq('user_id', user!.id)
          .order('saved_at', { ascending: false })
          .limit(50),
        supabase
          .from('collections')
          .select('*, collection_items(*)')
          .eq('user_id', user!.id),
      ])

      if (packs) setPacks((packs as Array<Record<string, unknown>>).map(mapPackRow))
      if (collections) setCollections((collections as Array<Record<string, unknown>>).map(mapCollection))
    }

    load()
  }, [user, setPacks, setCollections])
}
