import { create } from 'zustand'
import type {
  Platform,
  OutcomeMode,
  ExtractionStrategy,
  ExtractionStatus,
  Pack,
  SavedItem,
  User,
  UserProfile,
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

  // Profile (full user record from `profiles` table — null until loaded)
  profile: UserProfile | null
  setProfile: (profile: UserProfile | null) => void
  // Loading + error state for the profile fetch — used by ProfileView to
  // distinguish "still loading" from "failed to load" (so the user is never
  // stuck on an indefinite spinner).
  profileLoading: boolean
  setProfileLoading: (loading: boolean) => void
  profileError: string | null
  setProfileError: (error: string | null) => void

  // Theme
  theme: Theme
  setTheme: (theme: Theme) => void

  // UI language ('en' | 'de'). Persisted to chrome.storage.local; mirrored
  // to profile.preferred_language when the user is signed in.
  language: 'en' | 'de'
  setLanguage: (lang: 'en' | 'de') => void

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
  clearAnalysis: () => void
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
  savedItems: SavedItem[]
  libraryLoading: boolean
  libraryError: string | null
  setPacks: (packs: Pack[]) => void
  setCollections: (collections: Collection[]) => void
  setSavedItems: (items: SavedItem[]) => void
  setLibraryLoading: (loading: boolean) => void
  setLibraryError: (error: string | null) => void
  addPack: (pack: Pack) => void
  addCollection: (collection: Collection) => void
  addSavedItems: (items: SavedItem[]) => void
  // Folder<->pack relations (mirror of `collection_items`). Mutating these
  // immutably keeps the local cache in sync after Save / Move / Remove so the
  // library doesn't need a full reload to reflect changes.
  addPackToFolder: (folderId: string, packId: string) => void
  removePackFromFolder: (folderId: string, packId: string) => void

  // Cross-view folder filter — set in Profile, read in Library so clicking a
  // folder chip in Profile opens Library pre-filtered to that folder.
  libraryFolderFilter: string | null
  setLibraryFolderFilter: (id: string | null) => void

  // View routing
  view: 'main' | 'library' | 'auth' | 'profile'
  setView: (view: AppState['view']) => void

  // Audio capture (live platforms): persistent recording indicator + one-time
  // consent dialog. Both driven by background messages.
  audioCaptureActive: boolean
  setAudioCaptureActive: (active: boolean) => void
  audioConsentRequired: boolean
  setAudioConsentRequired: (required: boolean) => void
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

const savedLanguage: 'en' | 'de' = (() => {
  if (typeof localStorage === 'undefined') return 'en'
  const v = localStorage.getItem('extract-lang')
  return v === 'de' || v === 'en' ? v : 'en'
})()

// Seed chrome.storage.local on side-panel load so the background service worker
// always has a value available when building the extraction payload (the SW
// has no DOM localStorage). Subsequent setLanguage() calls keep it in sync.
try {
  chrome.storage?.local?.set({ extract_language: savedLanguage })
} catch {
  // ignore (non-extension contexts)
}

export const useAppStore = create<AppState>((set) => ({
  user: null,
  setUser: (user) => set({ user }),

  profile: null,
  setProfile: (profile) => set({ profile }),
  profileLoading: false,
  setProfileLoading: (profileLoading) => set({ profileLoading }),
  profileError: null,
  setProfileError: (profileError) => set({ profileError }),

  theme: savedTheme,
  setTheme: (theme) => {
    localStorage.setItem('extract-theme', theme)
    document.documentElement.setAttribute('data-theme', theme)
    set({ theme })
  },

  language: savedLanguage,
  setLanguage: (language) => {
    localStorage.setItem('extract-lang', language)
    // Mirror to chrome.storage.local so the background service worker (which
    // has no DOM localStorage) can read it when building the extraction
    // payload. Best-effort: chrome.storage may be unavailable in non-extension
    // contexts (e.g. tests), so swallow rejections.
    try {
      chrome.storage?.local?.set({ extract_language: language })
    } catch {
      // ignore
    }
    document.documentElement.setAttribute('lang', language)
    set({ language })
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
  // Reset only the in-flight extraction status — does NOT touch latestPack/session.
  // Use clearAnalysis() when the user explicitly wants to drop the visible result.
  resetExtraction: () => set({ extraction: defaultExtraction }),
  clearAnalysis: () => set({ extraction: defaultExtraction, latestPack: null, session: null }),
  dismissError: () => set((s) => ({ extraction: { ...s.extraction, status: 'idle', error: null, isHint: false } })),

  session: null,
  setSession: (session) => set({ session }),

  latestPack: null,
  setLatestPack: (pack) => set({ latestPack: pack, extraction: { ...defaultExtraction, status: 'complete' } }),
  // Updates latestPack during streaming without changing extraction status
  updateStreamingPack: (pack) => set({ latestPack: pack }),

  packs: [],
  collections: [],
  savedItems: [],
  libraryLoading: false,
  libraryError: null,
  setPacks: (packs) => set({ packs }),
  setCollections: (collections) => set({ collections }),
  setSavedItems: (savedItems) => set({ savedItems }),
  setLibraryLoading: (libraryLoading) => set({ libraryLoading }),
  setLibraryError: (libraryError) => set({ libraryError }),
  addPack: (pack) => set((s) => ({ packs: [pack, ...s.packs] })),
  addCollection: (col) => set((s) => ({ collections: [...s.collections, col] })),
  addSavedItems: (items) => set((s) => ({ savedItems: [...items, ...s.savedItems] })),
  addPackToFolder: (folderId, packId) =>
    set((s) => ({
      collections: s.collections.map((c) =>
        c.id === folderId
          ? c.items.some((it) => it.type === 'pack' && it.refId === packId)
            ? c
            : { ...c, items: [...c.items, { type: 'pack', refId: packId }] }
          : c,
      ),
    })),
  removePackFromFolder: (folderId, packId) =>
    set((s) => ({
      collections: s.collections.map((c) =>
        c.id === folderId
          ? { ...c, items: c.items.filter((it) => !(it.type === 'pack' && it.refId === packId)) }
          : c,
      ),
    })),

  libraryFolderFilter: null,
  setLibraryFolderFilter: (libraryFolderFilter) => set({ libraryFolderFilter }),

  view: 'main',
  setView: (view) => set({ view }),

  audioCaptureActive: false,
  setAudioCaptureActive: (audioCaptureActive) => set({ audioCaptureActive }),
  audioConsentRequired: false,
  setAudioConsentRequired: (audioConsentRequired) => set({ audioConsentRequired }),
}))
