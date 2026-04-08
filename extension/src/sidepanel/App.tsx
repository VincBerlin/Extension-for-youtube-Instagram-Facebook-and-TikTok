import { useState, useEffect } from 'react'
import { useAppStore } from './store'
import { usePlatformListener } from './hooks/usePlatformListener'
import { useAuth } from './hooks/useAuth'
import { useLibrary } from './hooks/useLibrary'
import { PlatformBadge } from './components/PlatformBadge'
import { ExtractionProgress } from './components/ExtractionProgress'
import { ResultCard } from './components/ResultCard'
import { ThemeToggle } from './components/ThemeToggle'
import { NewFolderModal } from './components/NewFolderModal'
import { MemoryView } from './components/memory/MemoryView'
import { AuthView } from './components/AuthView'
import { supabase } from './hooks/useAuth'
import { mapPackRow } from './hooks/useLibrary'
import type { OutcomeMode } from '@shared/types'
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

  const {
    user, theme, view, setView,
    platformState, selectedMode,
    extraction, resetExtraction,
    session, latestPack,
    addPack, addCollection,
  } = useAppStore()

  const [savedIds, setSavedIds] = useState<Set<string>>(new Set())
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null)
  const [showNewFolderModal, setShowNewFolderModal] = useState(false)

  function handleManualExtract() {
    resetExtraction()
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tabId = tabs[0]?.id
      if (!tabId) return
      chrome.runtime.sendMessage({ type: 'START_EXTRACTION', tabId, mode: selectedMode })
    })
  }

  // Apply theme class to document root
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  async function handleSave(pack: typeof latestPack, collectionId: string | null) {
    if (!pack) return
    if (!user) { setView('auth'); return }

    const { data, error } = await supabase.from('packs').insert({
      user_id: user.id,
      title: pack.title,
      url: pack.url,
      platform: pack.platform,
      mode: pack.mode,
      bullets: pack.bullets,
      saved_at: new Date().toISOString(),
    }).select().single()

    if (!error && data) {
      const saved = mapPackRow(data as Record<string, unknown>)
      addPack(saved)
      setSavedIds((prev) => new Set(prev).add(pack.id))

      // Add to collection if selected
      if (collectionId) {
        await supabase.from('collection_items').insert({
          collection_id: collectionId,
          type: 'pack',
          ref_id: saved.id,
          position: 0,
        })
      }
    }
  }

  async function handleCreateFolder(name: string) {
    if (!user) { setView('auth'); return }
    const { data } = await supabase.from('collections').insert({
      user_id: user.id,
      name,
    }).select().single()
    if (data) {
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

  // ─── Main view ───────────────────────────────────────────────────────────────

  // Segments that have completed results (for session history)
  const completedSegments = session?.segments.filter((s) => s.result !== null) ?? []
  const isExtracting = extraction.status === 'extracting'

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
            <button className={styles.iconBtn} onClick={() => supabase.auth.signOut()} title={`Signed in as ${user.email}`}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
                <polyline points="16 17 21 12 16 7"/>
                <line x1="21" y1="12" x2="9" y2="12"/>
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

        {platformState.platform !== 'unknown' && (
          <div className={styles.modeBadge}>
            <span className={styles.modeAuto}>Auto</span>
            <span className={styles.modeName}>{MODE_LABELS[selectedMode]}</span>
          </div>
        )}

        {/* Manual Extract button */}
        {platformState.platform !== 'unknown' && (
          <button
            className={`${styles.extractBtn} ${isExtracting ? styles.extractBtnBusy : ''}`}
            onClick={handleManualExtract}
            disabled={isExtracting}
          >
            {isExtracting
              ? <><span className={styles.extractSpinner} /> Extracting…</>
              : extraction.status === 'complete' ? 'Extract Again' : 'Extract'}
          </button>
        )}

        {/* Active extraction spinner */}
        {isExtracting && (
          <ExtractionProgress percent={extraction.percent} statusText={extraction.statusText || 'Analysing pause…'} />
        )}

        {/* Error / hint state */}
        {extraction.status === 'error' && (
          <div>
            {extraction.isHint ? (
              <p className={styles.hintText}>{extraction.error}</p>
            ) : extraction.upgradeRequired ? (
              <div className={styles.upgradePrompt}>
                <p className={styles.errorText}>{extraction.error}</p>
                <button className={styles.upgradeBtn} onClick={() => setView('auth')}>
                  {!user ? 'Sign in to continue' : 'Upgrade to Pro'}
                </button>
              </div>
            ) : (
              <p className={styles.errorText}>{extraction.error}</p>
            )}
            <button className={styles.retryBtn} onClick={resetExtraction}>Dismiss</button>
          </div>
        )}

        {/* Idle hint */}
        {extraction.status === 'idle' && platformState.platform !== 'unknown' && (
          <p className={styles.hint}>
            {platformState.strategy === 'instant'
              ? 'Pause the video — insights appear automatically.'
              : 'Pause the video — audio is captured and analysed automatically.'}
          </p>
        )}

        {/* Latest result (most recent pause) */}
        {latestPack && extraction.status === 'complete' && (
          <ResultCard
            pack={latestPack}
            onSave={handleSave}
            isSaved={savedIds.has(latestPack.id)}
            selectedFolder={selectedFolder}
            onFolderChange={setSelectedFolder}
            onCreateFolder={() => setShowNewFolderModal(true)}
            suggestedFolderName={MODE_LABELS[selectedMode]}
          />
        )}

        {/* Session history — previous pauses in same video */}
        {completedSegments.length > 1 && (
          <div className={styles.history}>
            <p className={styles.historyLabel}>Earlier in this video</p>
            {[...completedSegments].reverse().slice(1).map((seg) => {
              if (!seg.result) return null
              return (
                <div key={seg.id} className={styles.historyCard}>
                  <p className={styles.historyTimestamp}>
                    {new Date(seg.pausedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </p>
                  <ul className={styles.historyBullets}>
                    {seg.result.bullets.slice(0, 3).map((b, i) => (
                      <li key={i} className={styles.historyBullet}>{b}</li>
                    ))}
                    {seg.result.bullets.length > 3 && (
                      <li className={styles.historyMore}>+{seg.result.bullets.length - 3} more</li>
                    )}
                  </ul>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {showNewFolderModal && (
        <NewFolderModal
          onConfirm={handleCreateFolder}
          onCancel={() => setShowNewFolderModal(false)}
          suggestedName={MODE_LABELS[selectedMode]}
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
