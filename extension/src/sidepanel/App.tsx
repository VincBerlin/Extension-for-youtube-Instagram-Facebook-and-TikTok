import { useState } from 'react'
import { useAppStore } from './store'
import { usePlatformListener } from './hooks/usePlatformListener'
import { useAuth } from './hooks/useAuth'
import { useLibrary } from './hooks/useLibrary'
import { PlatformBadge } from './components/PlatformBadge'
import { OutcomeModeSelector } from './components/OutcomeModeSelector'
import { ExtractButton } from './components/ExtractButton'
import { ExtractionProgress } from './components/ExtractionProgress'
import { ResultCard } from './components/ResultCard'
import { MemoryView } from './components/memory/MemoryView'
import { AuthView } from './components/AuthView'
import { supabase } from './hooks/useAuth'
import { mapPackRow } from './hooks/useLibrary'
import { startExtraction } from './services/api'
import styles from './App.module.css'

export function App() {
  usePlatformListener()
  useAuth()
  useLibrary()

  const [currentResultSaved, setCurrentResultSaved] = useState(false)

  const {
    user, view, setView,
    platformState, selectedMode, setSelectedMode,
    extraction, setExtractionStatus, resetExtraction, addPack,
  } = useAppStore()

  function handleExtract() {
    if (extraction.status === 'complete') {
      resetExtraction()
      setCurrentResultSaved(false)
      return
    }

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tabId = tabs[0]?.id
      if (!tabId) return

      if (extraction.status === 'capturing') {
        // Phase 2: stop capture and send accumulated chunks to server
        chrome.tabs.sendMessage(tabId, { type: 'STOP_LIVE_CAPTURE' }).catch(() => {})
        startExtraction(tabId, selectedMode)
      } else if (platformState.strategy === 'live') {
        // Phase 1: start caption capture, wait for user to click again
        setExtractionStatus('capturing')
        chrome.tabs.sendMessage(tabId, { type: 'START_LIVE_CAPTURE' }).catch(() => {})
      } else {
        // Instant strategy — extract immediately
        startExtraction(tabId, selectedMode)
      }
    })
  }

  async function handleSave(pack: typeof extraction.result) {
    if (!pack) return

    if (!user) {
      setView('auth')
      return
    }

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
      addPack(mapPackRow(data as Record<string, unknown>))
      setCurrentResultSaved(true)
    }
  }

  // Render auth view
  if (view === 'auth') {
    return (
      <div className={styles.root}>
        <div className={styles.topBar}>
          <button className={styles.backBtn} onClick={() => setView('main')}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polyline points="15 18 9 12 15 6"/>
            </svg>
            Back
          </button>
        </div>
        <AuthView />
      </div>
    )
  }

  // Render memory view
  if (view === 'memory') {
    return (
      <div className={styles.root}>
        <div className={styles.topBar}>
          <span className={styles.topBarTitle}>Library</span>
          <button className={styles.backBtn} onClick={() => setView('main')}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polyline points="15 18 9 12 15 6"/>
            </svg>
            Back
          </button>
        </div>
        <MemoryView />
      </div>
    )
  }

  // Main extraction view
  return (
    <div className={styles.root}>
      <div className={styles.topBar}>
        <span className={styles.logo}>
          <span className={styles.logoMark}>
            <svg width="10" height="13" viewBox="0 0 10 13" fill="none" aria-hidden="true">
              <path d="M6.5 1L1.5 6.5H5L3.5 12L8.5 6.5H5L6.5 1Z" fill="white"/>
            </svg>
          </span>
          Extract
        </span>
        <div className={styles.topBarActions}>
          <button className={styles.iconBtn} onClick={() => setView('memory')} title="Library">
            {/* Bookmark/library icon */}
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
            </svg>
          </button>
          {user ? (
            <button
              className={styles.iconBtn}
              onClick={() => supabase.auth.signOut()}
              title={`Signed in as ${user.email}`}
            >
              {/* Log out icon */}
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
                <polyline points="16 17 21 12 16 7"/>
                <line x1="21" y1="12" x2="9" y2="12"/>
              </svg>
            </button>
          ) : (
            <button className={styles.iconBtn} onClick={() => setView('auth')} title="Sign in">
              {/* User icon */}
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                <circle cx="12" cy="7" r="4"/>
              </svg>
            </button>
          )}
        </div>
      </div>

      <div className={styles.content}>
        <PlatformBadge
          platform={platformState.platform}
          strategy={platformState.strategy}
          title={platformState.title}
        />

        <OutcomeModeSelector
          selected={selectedMode}
          onChange={setSelectedMode}
        />

        {extraction.status === 'capturing' && (
          <p className={styles.capturingText}>Capturing captions… click Extract when ready</p>
        )}

        {extraction.status === 'extracting' && (
          <ExtractionProgress
            percent={extraction.percent}
            statusText={extraction.statusText}
          />
        )}

        {extraction.status === 'error' && extraction.upgradeRequired && (
          <div className={styles.upgradePrompt}>
            <p className={styles.errorText}>{extraction.error}</p>
            <button
              className={styles.upgradeBtn}
              onClick={() => setView('auth')}
            >
              {!user ? 'Sign in to continue' : 'Upgrade to Pro'}
            </button>
          </div>
        )}

        {extraction.status === 'error' && !extraction.upgradeRequired && (
          <p className={styles.errorText}>{extraction.error}</p>
        )}

        <ExtractButton
          status={extraction.status}
          platform={platformState.platform}
          onClick={handleExtract}
        />

        {extraction.result && (
          <ResultCard
            pack={extraction.result}
            onSave={handleSave}
            isSaved={currentResultSaved}
          />
        )}
      </div>
    </div>
  )
}
