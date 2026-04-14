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
  VideoSession,
  Theme,
} from '@shared/types'

interface ExtractionState {
  status: ExtractionStatus
  percent: number
  statusText: string
  error: string | null
  isHint: boolean
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

  // Theme
  theme: Theme
  setTheme: (theme: Theme) => void

  // Current page
  platformState: PlatformState
  setPlatformState: (state: PlatformState) => void

  // Extraction status (spinner, errors)
  selectedMode: OutcomeMode
  setSelectedMode: (mode: OutcomeMode) => void
  extraction: ExtractionState
  setExtractionStatus: (status: ExtractionStatus, percent?: number, statusText?: string) => void
  setExtractionError: (error: string, isHint?: boolean) => void
  resetExtraction: () => void
  dismissError: () => void

  // Session (current video watching session — accumulates across pauses)
  session: VideoSession | null
  setSession: (session: VideoSession | null) => void

  // Latest completed pack (from most recent pause)
  latestPack: Pack | null
  setLatestPack: (pack: Pack) => void
  updateStreamingPack: (pack: Pack) => void

  // Library
  packs: Pack[]
  collections: Collection[]
  setPacks: (packs: Pack[]) => void
  setCollections: (collections: Collection[]) => void
  addPack: (pack: Pack) => void
  addCollection: (collection: Collection) => void

  // View routing
  view: 'main' | 'library' | 'auth'
  setView: (view: AppState['view']) => void
}

const defaultExtraction: ExtractionState = {
  status: 'idle',
  percent: 0,
  statusText: '',
  error: null,
  isHint: false,
}

const defaultPlatform: PlatformState = {
  platform: 'unknown',
  url: '',
  title: '',
  strategy: 'live',
}

const savedTheme = (typeof localStorage !== 'undefined'
  ? (localStorage.getItem('extract-theme') as Theme | null)
  : null) ?? 'dark'

export const useAppStore = create<AppState>((set) => ({
  user: null,
  setUser: (user) => set({ user }),

  theme: savedTheme,
  setTheme: (theme) => {
    localStorage.setItem('extract-theme', theme)
    document.documentElement.setAttribute('data-theme', theme)
    set({ theme })
  },

  platformState: defaultPlatform,
  setPlatformState: (platformState) => set({ platformState }),

  selectedMode: 'knowledge',
  setSelectedMode: (selectedMode) => {
    chrome.runtime.sendMessage({ type: 'SET_MODE', mode: selectedMode }).catch(() => {})
    set({ selectedMode })
  },

  extraction: defaultExtraction,
  setExtractionStatus: (status, percent = 0, statusText = '') =>
    set((s) => ({ extraction: { ...s.extraction, status, percent, statusText } })),
  setExtractionError: (error, isHint = false) =>
    set((s) => ({ extraction: { ...s.extraction, status: 'error', error, isHint } })),
  resetExtraction: () => set({ extraction: defaultExtraction, latestPack: null, session: null }),
  dismissError: () => set((s) => ({ extraction: { ...s.extraction, status: 'idle', error: null, isHint: false } })),

  session: null,
  setSession: (session) => set({ session }),

  latestPack: null,
  setLatestPack: (pack) => set({ latestPack: pack, extraction: { ...defaultExtraction, status: 'complete' } }),
  // Updates latestPack during streaming without changing extraction status
  updateStreamingPack: (pack) => set({ latestPack: pack }),

  packs: [],
  collections: [],
  setPacks: (packs) => set({ packs }),
  setCollections: (collections) => set({ collections }),
  addPack: (pack) => set((s) => ({ packs: [pack, ...s.packs] })),
  addCollection: (col) => set((s) => ({ collections: [...s.collections, col] })),

  view: 'main',
  setView: (view) => set({ view }),
}))
