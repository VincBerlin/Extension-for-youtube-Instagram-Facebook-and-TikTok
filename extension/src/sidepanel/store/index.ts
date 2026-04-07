import { create } from 'zustand'
import type {
  Platform,
  OutcomeMode,
  ExtractionStrategy,
  ExtractionStatus,
  Pack,
  User,
  Collection,
  YouTubeSignal,
} from '@shared/types'

interface ExtractionState {
  status: ExtractionStatus
  percent: number
  statusText: string
  result: Pack | null
  error: string | null
  upgradeRequired: boolean
}

interface PlatformState {
  platform: Platform
  url: string
  title: string
  strategy: ExtractionStrategy
  signal?: YouTubeSignal
}

interface AppState {
  // Auth
  user: User | null
  setUser: (user: User | null) => void

  // Current page context
  platformState: PlatformState
  setPlatformState: (state: PlatformState) => void

  // Extraction
  selectedMode: OutcomeMode
  setSelectedMode: (mode: OutcomeMode) => void
  extraction: ExtractionState
  setExtractionStatus: (status: ExtractionStatus, percent?: number, statusText?: string) => void
  setExtractionResult: (pack: Pack) => void
  setExtractionError: (error: string, upgradeRequired?: boolean) => void
  resetExtraction: () => void

  // Library (loaded from Supabase)
  packs: Pack[]
  collections: Collection[]
  setPacks: (packs: Pack[]) => void
  setCollections: (collections: Collection[]) => void
  addPack: (pack: Pack) => void

  // View routing
  view: 'main' | 'memory' | 'auth'
  setView: (view: AppState['view']) => void
}

const defaultExtractionState: ExtractionState = {
  status: 'idle',
  percent: 0,
  statusText: '',
  result: null,
  error: null,
  upgradeRequired: false,
}

const defaultPlatformState: PlatformState = {
  platform: 'unknown',
  url: '',
  title: '',
  strategy: 'live',
}

export const useAppStore = create<AppState>((set) => ({
  // Auth
  user: null,
  setUser: (user) => set({ user }),

  // Platform
  platformState: defaultPlatformState,
  setPlatformState: (platformState) => set({ platformState }),

  // Extraction
  selectedMode: 'knowledge',
  setSelectedMode: (selectedMode) => set({ selectedMode }),
  extraction: defaultExtractionState,
  setExtractionStatus: (status, percent = 0, statusText = '') =>
    set((s) => ({ extraction: { ...s.extraction, status, percent, statusText } })),
  setExtractionResult: (result) =>
    set((s) => ({ extraction: { ...s.extraction, status: 'complete', result, error: null } })),
  setExtractionError: (error, upgradeRequired = false) =>
    set((s) => ({ extraction: { ...s.extraction, status: 'error', error, upgradeRequired } })),
  resetExtraction: () => set({ extraction: defaultExtractionState }),

  // Library
  packs: [],
  collections: [],
  setPacks: (packs) => set({ packs }),
  setCollections: (collections) => set({ collections }),
  addPack: (pack) => set((s) => ({ packs: [pack, ...s.packs] })),

  // View
  view: 'main',
  setView: (view) => set({ view }),
}))
