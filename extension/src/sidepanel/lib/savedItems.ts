import type { OutcomeMode } from '@shared/types'

// Allowed item_type values, mirrored from saved_items check constraint.
export type SavedItemType =
  | 'takeaway'
  | 'section'
  | 'resource'
  | 'setup_step'
  | 'command'
  | 'full_analysis'

export const ALLOWED_ITEM_TYPES: readonly SavedItemType[] = [
  'takeaway',
  'section',
  'resource',
  'setup_step',
  'command',
  'full_analysis',
] as const

// The deployed live schema for public.saved_items only exposes this set of
// columns to PostgREST. Migration 005 also defines `pack_id` and `mode`, but
// the live schema cache rejects inserts that reference them. Treat this list
// as the single source of truth for what Supabase will accept on insert.
export const ALLOWED_SAVED_ITEM_COLUMNS = [
  'user_id',
  'item_type',
  'payload',
  'video_url',
  'video_title',
] as const

export type SavedItemColumn = (typeof ALLOWED_SAVED_ITEM_COLUMNS)[number]

export interface SavedItemPayload {
  title: string
  content?: string
  resource_url?: string
  context?: string
  metadata?: Record<string, unknown>
  raw: unknown
}

export interface SavedItemRow {
  user_id: string
  item_type: SavedItemType
  payload: SavedItemPayload
  video_url: string | null
  video_title: string | null
}

export interface NormalizeInput {
  userId: string
  itemType: string
  payload: SavedItemPayload
  videoUrl: string | null
  videoTitle: string | null
  // Optional context — stuffed into payload.metadata so it survives without
  // requiring extra top-level columns the live schema may not have.
  sourcePackId?: string | null
  mode?: OutcomeMode | null
  folderId?: string | null
}

export class SavedItemValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SavedItemValidationError'
  }
}

// Single source of truth for building a saved_items insert row. Produces ONLY
// columns that the live schema cache accepts. Anything else (pack_id, mode,
// folder_id) is folded into `payload.metadata` so reads can still recover it
// without coupling to optional columns.
export function normalizeSavedItemRow(input: NormalizeInput): SavedItemRow {
  if (!ALLOWED_ITEM_TYPES.includes(input.itemType as SavedItemType)) {
    throw new SavedItemValidationError(`Invalid item type: ${input.itemType}`)
  }

  const metadata: Record<string, unknown> = {
    ...(input.payload.metadata ?? {}),
  }
  if (input.sourcePackId) metadata.source_pack_id = input.sourcePackId
  if (input.mode) metadata.mode = input.mode
  if (input.folderId) metadata.folder_id = input.folderId

  const payload: SavedItemPayload = {
    title: input.payload.title,
    raw: input.payload.raw,
    ...(input.payload.content !== undefined ? { content: input.payload.content } : {}),
    ...(input.payload.resource_url !== undefined ? { resource_url: input.payload.resource_url } : {}),
    ...(input.payload.context !== undefined ? { context: input.payload.context } : {}),
    metadata,
  }

  return {
    user_id: input.userId,
    item_type: input.itemType as SavedItemType,
    payload,
    video_url: input.videoUrl,
    video_title: input.videoTitle,
  }
}

// Defensive runtime guard. Throws if a row contains any key the live schema
// does not accept. Catches regressions before they reach Supabase.
export function assertSavedItemsRow(row: Record<string, unknown>): void {
  const allowed = new Set<string>(ALLOWED_SAVED_ITEM_COLUMNS)
  for (const key of Object.keys(row)) {
    if (!allowed.has(key)) {
      throw new SavedItemValidationError(`Invalid saved_items payload key: ${key}`)
    }
  }
}
