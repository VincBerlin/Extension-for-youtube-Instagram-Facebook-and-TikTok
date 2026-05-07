import { useState, useEffect, useMemo } from 'react'
import { useAppStore } from './store'
import { usePlatformListener } from './hooks/usePlatformListener'
import { useAuth } from './hooks/useAuth'
import { useLibrary } from './hooks/useLibrary'
import { useProfile } from './hooks/useProfile'
import { PlatformBadge } from './components/PlatformBadge'
import { ExtractionProgress } from './components/ExtractionProgress'
import { ResultCard } from './components/ResultCard'
import type { SavedItemType, SavedItemSelection } from './components/ResultCard'
import { ThemeToggle } from './components/ThemeToggle'
import { MemoryView } from './components/memory/MemoryView'
import { AuthView } from './components/AuthView'
import { ProfileView } from './components/ProfileView'
import { NewFolderModal } from './components/NewFolderModal'
import { supabase } from './hooks/useAuth'
import type { OutcomeMode, Pack } from '@shared/types'
import styles from './App.module.css'

const MODE_LABELS: Record<OutcomeMode, string> = {
  'knowledge':      'Knowledge',
  'build-pack':     'Build Pack',
  'decision-pack':  'Decision Pack',
  'coach-notes':    'Coach Notes',
  'tools':          'Tools',
  'stack':          'Tech Stack',
}

export function App() {
  usePlatformListener()
  useAuth()
  useLibrary()
  useProfile()

  const {
    user, theme, view, setView,
    platformState, selectedMode,
    extraction, dismissError,
    latestPack, clearAnalysis,
    addPack, addCollection,
  } = useAppStore()

  const [savedIds, setSavedIds] = useState<Set<string>>(new Set())
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null)
  const [showNewFolderModal, setShowNewFolderModal] = useState(false)
  const [suggestedFolderName, setSuggestedFolderName] = useState<string | undefined>(undefined)
  // Per-artefact selection for the "Save Selected" button. Cleared when the
  // pack changes (new extraction or after a successful save).
  const [selectedItems, setSelectedItems] = useState<Map<string, SavedItemSelection>>(new Map())
  const [savingSelected, setSavingSelected] = useState(false)

  // Reset selection any time the visible pack swaps to a different one.
  useEffect(() => {
    setSelectedItems(new Map())
  }, [latestPack?.id])

  const selectionCount = selectedItems.size

  function toggleSelectItem(key: string, itemType: SavedItemType, payload: unknown) {
    setSelectedItems((prev) => {
      const next = new Map(prev)
      if (next.has(key)) next.delete(key)
      else next.set(key, { itemType, payload })
      return next
    })
  }

  const selectionApi = useMemo(() => ({
    selected: selectedItems,
    toggle: toggleSelectItem,
  }), [selectedItems])

  function handleManualExtract(force = false) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tabId = tabs[0]?.id
      if (!tabId) return
      chrome.runtime.sendMessage({ type: 'START_EXTRACTION', tabId, mode: selectedMode, force })
    })
  }

  function handleClearAnalysis() {
    clearAnalysis()
    setSelectedItems(new Map())
    chrome.runtime.sendMessage({ type: 'CLEAR_ANALYSIS', url: platformState.url }).catch(() => {})
  }

  async function handleSaveSelected() {
    if (!user) { setView('auth'); return }
    if (!latestPack || selectedItems.size === 0 || savingSelected) return
    setSavingSelected(true)
    const rows = Array.from(selectedItems.values()).map((entry) => ({
      user_id: user.id,
      pack_id: savedIds.has(latestPack.id) ? latestPack.id : null,
      item_type: entry.itemType,
      payload: entry.payload,
      video_url: latestPack.url,
      video_title: latestPack.title,
      mode: latestPack.mode,
    }))
    const { error } = await supabase.from('saved_items').insert(rows)
    setSavingSelected(false)
    if (!error) {
      setSelectedItems(new Map())
    }
  }

  async function handleSaveFullAnalysis() {
    if (!latestPack) return
    if (savedIds.has(latestPack.id)) return
    await handleSave(latestPack, selectedFolder)
  }

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  async function handleSave(pack: Pack, folderId: string | null) {
    if (!user) { setView('auth'); return }
    if (savedIds.has(pack.id)) return

    const { error } = await supabase.from('packs').insert({
      id: pack.id,
      user_id: user.id,
      title: pack.title,
      url: pack.url,
      platform: pack.platform,
      mode: pack.mode,
      bullets: pack.key_takeaways,
      summary: pack.summary ?? null,
      keywords: pack.keywords ?? [],
      relevant_points: pack.relevant_points ?? [],
      important_links: pack.important_links ?? [],
      quick_facts: pack.quick_facts ?? null,
      v2: pack.v2 ?? null,
    })

    if (!error) {
      if (folderId) {
        await supabase.from('collection_items').insert({
          collection_id: folderId,
          type: 'pack',
          ref_id: pack.id,
          position: 0,
        })
      }
      addPack(pack)
      setSavedIds((prev) => new Set(prev).add(pack.id))
    }
  }

  async function handleCreateFolder(name: string) {
    if (!user) { setView('auth'); return }

    const { data, error } = await supabase
      .from('collections')
      .insert({ user_id: user.id, name })
      .select()
      .single()

    if (!error && data) {
      addCollection({ id: data.id, userId: data.user_id, name: data.name, items: [], createdAt: data.created_at })
      setSelectedFolder(data.id)
    }
    setShowNewFolderModal(false)
  }

  // ─── Views ──────────────────────────────────────────────────────────────────

  if (view === 'auth') {
    return (
      <div className={styles.root}>
        <TopBar onBack={() => setView('main')} title="Account" />
        <AuthView />
      </div>
    )
  }

  if (view === 'library') {
    return (
      <div className={styles.root}>
        <TopBar onBack={() => setView('main')} title="Library" />
        <MemoryView />
      </div>
    )
  }

  if (view === 'profile') {
    return (
      <div className={styles.root}>
        <TopBar onBack={() => setView('main')} title="Profile" />
        <ProfileView />
      </div>
    )
  }

  // ─── No video detected ───────────────────────────────────────────────────────

  if (platformState.platform === 'unknown') {
    return (
      <div className={styles.root}>
        <div className={styles.topBar}>
          <span className={styles.logo}>
            <span className={styles.logoMark} aria-hidden="true">
              <svg width="10" height="13" viewBox="0 0 10 13" fill="none">
                <path d="M6.5 1L1.5 6.5H5L3.5 12L8.5 6.5H5L6.5 1Z" fill="white"/>
              </svg>
            </span>
            Extract
          </span>
          <div className={styles.topBarActions}>
            <ThemeToggle />
          </div>
        </div>
        <div className={styles.content}>
          <p className={styles.hint}>Open a video to get started.</p>
        </div>
      </div>
    )
  }

  // ─── Main view ───────────────────────────────────────────────────────────────

  const isActive = extraction.status === 'extracting' || extraction.status === 'recording'

  // Only show result card when there is actual visible content — not just a title
  const hasContent = !!latestPack && (
    !!latestPack.summary ||
    (latestPack.key_takeaways?.length ?? 0) > 0 ||
    (latestPack.relevant_points?.length ?? 0) > 0 ||
    (latestPack.important_links?.length ?? 0) > 0
  )

  return (
    <div className={styles.root}>
      {/* Top bar */}
      <div className={styles.topBar}>
        <span className={styles.logo}>
          <span className={styles.logoMark} aria-hidden="true">
            <svg width="10" height="13" viewBox="0 0 10 13" fill="none">
              <path d="M6.5 1L1.5 6.5H5L3.5 12L8.5 6.5H5L6.5 1Z" fill="white"/>
            </svg>
          </span>
          Extract
        </span>
        <div className={styles.topBarActions}>
          <ThemeToggle />
          <button className={styles.iconBtn} onClick={() => setView('library')} title="Library">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
            </svg>
          </button>
          {user ? (
            <button className={styles.iconBtn} onClick={() => setView('profile')} title={`Profile — ${user.email}`}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                <circle cx="12" cy="7" r="4"/>
              </svg>
            </button>
          ) : (
            <button className={styles.iconBtn} onClick={() => setView('auth')} title="Sign in">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                <circle cx="12" cy="7" r="4"/>
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      <div className={styles.content}>
        <PlatformBadge
          platform={platformState.platform}
          strategy={platformState.strategy}
          title={platformState.title}
        />

        {/* Mode badge — hidden while active */}
        {!isActive && (
          <div className={styles.modeBadge}>
            <span className={styles.modeName}>{MODE_LABELS[selectedMode]}</span>
          </div>
        )}

        {/* Extract button — hidden while active. Force re-analyze when content already exists. */}
        {!isActive && !hasContent && (
          <button className={styles.extractBtn} onClick={() => handleManualExtract(false)}>
            Extract
          </button>
        )}
        {!isActive && hasContent && latestPack && (
          <div className={styles.actionGrid}>
            <button className={styles.extractBtn} onClick={() => handleManualExtract(true)}>
              New Analysis
            </button>
            <button className={styles.secondaryBtn} onClick={handleClearAnalysis}>
              Clear
            </button>
            <button
              className={styles.secondaryBtn}
              onClick={handleSaveSelected}
              disabled={selectionCount === 0 || savingSelected}
              title={selectionCount === 0 ? 'Select takeaways or links first' : `Save ${selectionCount} item(s)`}
            >
              {savingSelected ? 'Saving…' : `Save Selected${selectionCount > 0 ? ` (${selectionCount})` : ''}`}
            </button>
            <button
              className={styles.secondaryBtn}
              onClick={handleSaveFullAnalysis}
              disabled={savedIds.has(latestPack.id)}
              title="Save the full analysis to your library"
            >
              {savedIds.has(latestPack.id) ? 'Saved ✓' : 'Save Full Analysis'}
            </button>
          </div>
        )}

        {/* Extracting, no prior real content → full skeleton */}
        {extraction.status === 'extracting' && !hasContent && (
          <div className={styles.liveCard}>
            <p className={styles.liveTitle}>{platformState.title}</p>
            <div className={styles.skeletonGroup}>
              {[88, 72, 80].map((w, i) => <div key={i} className={styles.skeletonLine} style={{ width: `${w}%`, animationDelay: `${i * 180}ms` }} />)}
            </div>
            <div className={styles.skeletonGroup}>
              {[90, 68, 82, 75, 60].map((w, i) => <div key={i} className={styles.skeletonBulletLine} style={{ width: `${w}%`, animationDelay: `${i * 140}ms` }} />)}
            </div>
            <ExtractionProgress percent={extraction.percent} statusText={extraction.statusText || 'Analysiere…'} />
          </div>
        )}

        {/* Extracting with existing result → slim progress bar only (result stays visible below) */}
        {extraction.status === 'extracting' && hasContent && (
          <ExtractionProgress percent={extraction.percent} statusText={extraction.statusText || 'Aktualisiere…'} />
        )}

        {/* Recording → indicator + stop button (result stays visible below if it exists) */}
        {extraction.status === 'recording' && (
          <div className={styles.liveCard}>
            <p className={styles.liveTitle}>{platformState.title}</p>
            <p className={styles.recordingIndicator}>&#9679; Recording…</p>
            <button className={styles.extractBtn} onClick={() => handleManualExtract(false)}>
              Stop &amp; Analyze
            </button>
          </div>
        )}

        {/* Result card — only shown when real content exists (summary / takeaways / points / links) */}
        {hasContent && latestPack && (
          <ResultCard
            pack={latestPack}
            isSaved={savedIds.has(latestPack.id)}
            selectedFolder={selectedFolder}
            onFolderChange={setSelectedFolder}
            onCreateFolder={() => { setSuggestedFolderName(latestPack.title); setShowNewFolderModal(true) }}
            suggestedFolderName={suggestedFolderName}
            selection={selectionApi}
          />
        )}

        {/* Hint — only when no real content and idle */}
        {!hasContent && extraction.status === 'idle' && (
          <p className={styles.hint}>
            {platformState.strategy === 'instant'
              ? 'Click Extract to analyze this video.'
              : 'Click Extract to start recording audio.'}
          </p>
        )}

        {/* Error state */}
        {extraction.status === 'error' && (
          <div>
            {extraction.isHint ? (
              <p className={styles.hintText}>{extraction.error}</p>
            ) : (
              <p className={styles.errorText}>{extraction.error}</p>
            )}
            <button className={styles.retryBtn} onClick={dismissError}>Dismiss</button>
          </div>
        )}
      </div>

      {showNewFolderModal && (
        <NewFolderModal
          suggestedName={suggestedFolderName}
          onConfirm={handleCreateFolder}
          onCancel={() => setShowNewFolderModal(false)}
        />
      )}
    </div>
  )
}

// ─── TopBar helper ────────────────────────────────────────────────────────────

function TopBar({ onBack, title }: { onBack: () => void; title: string }) {
  return (
    <div className={styles.topBar}>
      <button className={styles.backBtn} onClick={onBack}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polyline points="15 18 9 12 15 6"/>
        </svg>
        Back
      </button>
      <span className={styles.topBarTitle}>{title}</span>
    </div>
  )
}
