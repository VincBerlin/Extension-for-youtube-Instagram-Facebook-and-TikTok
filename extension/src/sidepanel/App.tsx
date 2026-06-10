import { useState, useEffect, useMemo } from 'react'
import { useAppStore } from './store'
import { usePlatformListener } from './hooks/usePlatformListener'
import { useAuth } from './hooks/useAuth'
import { useLibrary, loadLibrary } from './hooks/useLibrary'
import { useProfile } from './hooks/useProfile'
import { PlatformBadge } from './components/PlatformBadge'
import { ExtractionProgress } from './components/ExtractionProgress'
import { ResultCard } from './components/ResultCard'
import { FolderPicker } from './components/FolderPicker'
import type { SavedItemType, SavedItemSelection, SavedItemPayload } from './components/ResultCard'
import { normalizeSavedItemRow, assertSavedItemsRow, SavedItemValidationError } from './lib/savedItems'
import { ThemeToggle } from './components/ThemeToggle'
import { LanguageToggle } from './components/LanguageToggle'
import { useT, type TKey } from './i18n'
import { MemoryView } from './components/memory/MemoryView'
import { AuthView } from './components/AuthView'
import { ProfileView } from './components/ProfileView'
import { NewFolderModal } from './components/NewFolderModal'
import { LlmSetupModal } from './components/LlmSetupModal'
import { AudioConsentDialog } from './components/AudioConsentDialog'
import { useLlmSettings } from './hooks/useLlmSettings'
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
  const t = useT()

  const {
    user, theme, view, setView,
    platformState, selectedMode,
    extraction, dismissError,
    latestPack, clearAnalysis,
    addPack, addCollection, addPackToFolder,
    collections,
    audioCaptureActive, audioConsentRequired,
  } = useAppStore()

  const [savedIds, setSavedIds] = useState<Set<string>>(new Set())
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null)
  const [showNewFolderModal, setShowNewFolderModal] = useState(false)
  const [showLlmModal, setShowLlmModal] = useState(false)
  const { settings: llmSettings, loading: llmLoading, refresh: refreshLlmSettings } = useLlmSettings()
  const [suggestedFolderName, setSuggestedFolderName] = useState<string | undefined>(undefined)
  // Per-artefact selection for the "Save Selected" button. Cleared when the
  // pack changes (new extraction or after a successful save).
  const [selectedItems, setSelectedItems] = useState<Map<string, SavedItemSelection>>(new Map())
  const [savingSelected, setSavingSelected] = useState(false)
  // Toast-style status banner for save / folder operations. `null` when idle.
  const [saveStatus, setSaveStatus] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null)

  // Reset selection any time the visible pack swaps to a different one.
  useEffect(() => {
    setSelectedItems(new Map())
  }, [latestPack?.id])

  // First-run: auto-open the LLM setup modal once settings finish loading and
  // nothing is configured yet. Also re-open when the session-only key was
  // cleared by a browser restart (keyMissing). Extract is otherwise gated.
  useEffect(() => {
    if (llmLoading) return
    if (llmSettings?.configured && !llmSettings.keyMissing) return
    setShowLlmModal(true)
  }, [llmLoading, llmSettings?.configured, llmSettings?.keyMissing])

  const selectionCount = selectedItems.size

  function toggleSelectItem(key: string, itemType: SavedItemType, payload: SavedItemPayload) {
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
    console.log('[EXTRACT-DEBUG] sidepanel: Extract button clicked | mode:', selectedMode, '| force:', force)
    if (!llmLoading && (!llmSettings?.configured || llmSettings.keyMissing)) {
      setShowLlmModal(true)
      return
    }
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0]
      console.log('[EXTRACT-DEBUG] sidepanel: active tab | id:', tab?.id, '| url:', tab?.url)
      if (!tab?.id) {
        console.warn('[EXTRACT-DEBUG] sidepanel: no active tab id — aborting')
        return
      }
      console.log('[EXTRACT-DEBUG] sidepanel: sending START_EXTRACTION → background | tabId:', tab.id, '| mode:', selectedMode, '| force:', force)
      chrome.runtime.sendMessage({ type: 'START_EXTRACTION', tabId: tab.id, mode: selectedMode, force }, (response) => {
        if (chrome.runtime.lastError) {
          console.warn('[EXTRACT-DEBUG] sidepanel: sendMessage error:', chrome.runtime.lastError.message)
        } else {
          console.log('[EXTRACT-DEBUG] sidepanel: sendMessage ack | response:', response)
        }
      })
    })
  }

  function handleClearAnalysis() {
    // Prefer the analyzed video's URL over the active tab's URL — when the user
    // is currently on a resource page (GitHub etc.) we still want to drop the
    // cached YouTube analysis, not a non-existent github.com cache entry.
    const clearUrl = latestPack?.url || platformState.url
    clearAnalysis()
    setSelectedItems(new Map())
    chrome.runtime.sendMessage({ type: 'CLEAR_ANALYSIS', url: clearUrl }).catch(() => {})
  }

  async function handleSaveSelected() {
    console.log('[SAVE-SELECTED-DEBUG] clicked')
    if (!user) {
      setSaveStatus({ kind: 'err', msg: t('pleaseSignIn') })
      setView('auth')
      return
    }
    if (!latestPack) return
    if (selectedItems.size === 0) {
      setSaveStatus({ kind: 'err', msg: t('selectFirst') })
      return
    }
    if (savingSelected) return
    setSavingSelected(true)
    setSaveStatus(null)

    const folderId = selectedFolder
    console.log('[SAVE-SELECTED-DEBUG] selected item count:', selectedItems.size)
    console.log('[SAVE-SELECTED-DEBUG] selected folder id-suffix:', folderId ? folderId.slice(0, 8) : 'none')

    // Build whitelisted rows through the central normalizer. Any extra context
    // (source pack id, mode, folder id) is folded into payload.metadata so the
    // live saved_items schema — which only exposes user_id/item_type/payload/
    // video_url/video_title — accepts the insert. The runtime guard then
    // rejects any row that smuggled in an extra key, so the "pack_id column
    // not found" error class becomes impossible to trigger.
    let rows: ReturnType<typeof normalizeSavedItemRow>[]
    try {
      rows = Array.from(selectedItems.values()).map((entry) =>
        normalizeSavedItemRow({
          userId: user.id,
          itemType: entry.itemType,
          payload: entry.payload,
          videoUrl: latestPack.url ?? null,
          videoTitle: latestPack.title ?? null,
          sourcePackId: savedIds.has(latestPack.id) ? latestPack.id : null,
          mode: latestPack.mode,
          folderId,
        }),
      )
      rows.forEach((row) => assertSavedItemsRow(row as unknown as Record<string, unknown>))
    } catch (e) {
      const msg = e instanceof SavedItemValidationError ? e.message : (e instanceof Error ? e.message : 'Unknown validation error')
      console.warn('[SAVE-SELECTED-DEBUG] validation error |', msg)
      setSavingSelected(false)
      setSaveStatus({ kind: 'err', msg: `Save failed: ${msg}` })
      return
    }

    console.log('[SAVE-SELECTED-DEBUG] saved_items payload keys only:', Object.keys(rows[0] ?? {}))
    const { data: inserted, error } = await supabase
      .from('saved_items')
      .insert(rows)
      .select('id')
    if (error) {
      console.warn('[SAVE-SELECTED-DEBUG] saved_items insert error |', error.message)
      setSavingSelected(false)
      setSaveStatus({ kind: 'err', msg: `Save failed: ${error.message}` })
      return
    }
    const insertedIds = (inserted ?? []).map((r: { id: string }) => r.id)
    console.log('[SAVE-SELECTED-DEBUG] saved_items insert success |', rows.length, 'row(s) | ids-prefix:', insertedIds.map((id) => id.slice(0, 8)))

    setSavingSelected(false)
    setSelectedItems(new Map())
    void loadLibrary()

    // Folder linking: collection_items.type is constrained to ('pack','resource')
    // and rejects 'saved_item' rows. The relation lives in payload.metadata.folder_id
    // and the library filters on that field. No collection_items insert here —
    // doing so would BLOCK on the check constraint. To enable a real FK, the
    // minimal migration would be:
    //   alter table public.collection_items
    //     drop constraint if exists collection_items_type_check;
    //   alter table public.collection_items
    //     add constraint collection_items_type_check
    //     check (type in ('pack', 'resource', 'saved_item'));
    const folder = folderId ? collections.find((c) => c.id === folderId) : null
    setSaveStatus({
      kind: 'ok',
      msg: folder
        ? `${t('savedTo')} "${folder.name}" — ${rows.length} ${rows.length === 1 ? 'item' : 'items'}.`
        : `Saved ${rows.length} item${rows.length === 1 ? '' : 's'}.`,
    })
  }

  async function handleSaveFullAnalysis() {
    if (!latestPack) return
    if (savedIds.has(latestPack.id)) return
    await handleSave(latestPack, selectedFolder)
  }

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  // After a successful sign-in, leave the AuthView so the user lands on their
  // profile (or back on the main panel). Without this, the OAuth popup closes
  // but the AuthView stays visible — making the login feel "stuck".
  useEffect(() => {
    if (user && view === 'auth') {
      console.log('[AUTH-DEBUG] post-login: leaving AuthView')
      setView('profile')
    }
  }, [user, view, setView])

  // Auto-dismiss success banners after 4s. Errors stay until the user closes
  // them so they cannot be missed.
  useEffect(() => {
    if (!saveStatus || saveStatus.kind !== 'ok') return
    const t = setTimeout(() => setSaveStatus(null), 4000)
    return () => clearTimeout(t)
  }, [saveStatus])

  async function handleSave(pack: Pack, folderId: string | null) {
    if (!user) { setView('auth'); return }
    if (savedIds.has(pack.id)) return

    setSaveStatus({ kind: 'ok', msg: 'Saving…' })
    console.log('[SAVE-DEBUG] packs: insert | packId:', pack.id, '| folderId:', folderId, '| hasV2:', !!pack.v2)

    // Build the canonical resources[] for the row column. Prefer v2.resources
    // (validated by the server). When the legacy `important_links` is the only
    // link source, project it into the resource shape so saved rows still
    // surface the links via the resources column.
    const v2 = pack.v2
    const flatResources = v2?.resources?.length
      ? v2.resources
      : (pack.important_links ?? []).map((l) => ({
          title: l.title,
          url: l.url,
          type: 'other' as const,
          mentioned_in_video: false,
          why_relevant: l.description ?? '',
          user_action: '',
          confidence: 'low' as const,
        }))

    // analysis_json keeps the FULL extraction payload — including legacy
    // fields (keywords, relevant_points, quick_facts, important_links) so a
    // future read can fully reconstruct the pack without losing data.
    const analysisJson = {
      ...(v2 ?? {}),
      legacy: {
        keywords: pack.keywords ?? [],
        relevant_points: pack.relevant_points ?? [],
        important_links: pack.important_links ?? [],
        quick_facts: pack.quick_facts ?? null,
      },
    }

    // Normalize every field for the deployed packs schema. Several JSON columns
    // (notably setup_guide, source_coverage, sections, resources, warnings) are
    // NOT NULL — sending `null` violates the constraint. Default to {}/[] so
    // an analysis missing optional fields still saves cleanly. The full
    // unfiltered extraction lives in analysis_json so nothing is lost.
    const packPayload = {
      id: pack.id,
      user_id: user.id,
      title: pack.title || 'Untitled analysis',
      url: pack.url ?? '',
      platform: pack.platform ?? 'youtube',
      mode: pack.mode ?? 'knowledge',
      bullets: pack.key_takeaways ?? [],
      summary: pack.summary ?? '',
      video_explanation: v2?.video_explanation ?? '',
      key_takeaways: pack.key_takeaways ?? [],
      sections: v2?.sections ?? [],
      resources: flatResources ?? [],
      setup_guide: v2?.setup_guide ?? {},
      warnings: v2?.warnings ?? [],
      source_coverage: v2?.source_coverage ?? {},
      analysis_json: analysisJson,
    }
    const { error } = await supabase.from('packs').insert(packPayload)

    if (error) {
      console.warn('[SAVE-DEBUG] packs: insert failed |', error.message)
      setSaveStatus({ kind: 'err', msg: `Save failed: ${error.message}` })
      return
    }

    console.log('[SAVE-DEBUG] packs: insert ok')

    const folder = folderId ? collections.find((c) => c.id === folderId) : null
    const folderName = folder?.name ?? null

    if (folderId) {
      console.log('[FOLDER-DEBUG] linking pack to collection: start | folderId-suffix:', folderId.slice(0, 8), '| packId-suffix:', pack.id.slice(0, 8))
      const { error: ciError } = await supabase.from('collection_items').insert({
        collection_id: folderId,
        type: 'pack',
        ref_id: pack.id,
        position: 0,
      })
      if (ciError) {
        console.warn('[FOLDER-DEBUG] linking pack to collection: error |', ciError.message)
        setSaveStatus({ kind: 'err', msg: `${t('savedFolderFailed')}: ${ciError.message}` })
        addPack(pack)
        setSavedIds((prev) => new Set(prev).add(pack.id))
        return
      }
      console.log('[FOLDER-DEBUG] linking pack to collection: success')
      addPackToFolder(folderId, pack.id)
    }

    addPack(pack)
    setSavedIds((prev) => new Set(prev).add(pack.id))
    setSaveStatus({
      kind: 'ok',
      msg: folderName ? `${t('savedTo')} "${folderName}".` : t('saved'),
    })
  }

  async function handleCreateFolder(name: string) {
    if (!user) { setView('auth'); return }

    console.log('[SAVE-DEBUG] collections: insert |', { name })
    const { data, error } = await supabase
      .from('collections')
      .insert({ user_id: user.id, name })
      .select()
      .single()

    if (error) {
      console.warn('[SAVE-DEBUG] collections: insert failed |', error.message)
      setSaveStatus({ kind: 'err', msg: `Create folder failed: ${error.message}` })
      setShowNewFolderModal(false)
      return
    }

    if (data) {
      console.log('[SAVE-DEBUG] collections: insert ok | id-suffix:', String(data.id).slice(0, 8))
      addCollection({ id: data.id, userId: data.user_id, name: data.name, items: [], createdAt: data.created_at })
      setSelectedFolder(data.id)
      setSaveStatus({ kind: 'ok', msg: `Folder "${data.name}" created.` })
    }
    setShowNewFolderModal(false)
  }

  // ─── Views ──────────────────────────────────────────────────────────────────

  if (view === 'auth') {
    return (
      <div className={styles.root}>
        <TopBar onBack={() => setView('main')} titleKey="account" />
        <AuthView />
      </div>
    )
  }

  if (view === 'library') {
    return (
      <div className={styles.root}>
        <TopBar onBack={() => setView('main')} titleKey="library" />
        <MemoryView />
      </div>
    )
  }

  if (view === 'profile') {
    return (
      <div className={styles.root}>
        <TopBar onBack={() => setView('main')} titleKey="profile" />
        <ProfileView />
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

  // ─── No video detected — but preserve previous analysis if any ─────────────
  // The previous analysis must stay visible when the user opens a resource link
  // (which makes the active tab unsupported). The user can dismiss via Clear.
  if (platformState.platform === 'unknown' && !hasContent) {
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
            <LanguageToggle />
            <ThemeToggle />
            <button
              className={styles.iconBtn}
              onClick={() => setShowLlmModal(true)}
              title="AI Setup"
              aria-label="AI Setup"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
            </button>
            <button className={styles.iconBtn} onClick={() => setView('library')} title={t('library')}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
              </svg>
            </button>
            {user ? (
              <button className={styles.iconBtn} onClick={() => setView('profile')} title={`${t('profile')} — ${user.email}`}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                  <circle cx="12" cy="7" r="4"/>
                </svg>
              </button>
            ) : (
              <button className={styles.iconBtn} onClick={() => setView('auth')} title={t('signIn')}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                  <circle cx="12" cy="7" r="4"/>
                </svg>
              </button>
            )}
          </div>
        </div>
        <div className={styles.content}>
          <p className={styles.hint}>{t('openVideoHint')}</p>
        </div>
      </div>
    )
  }

  const showingStaleAnalysis = platformState.platform === 'unknown' && hasContent

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
          <LanguageToggle />
          <ThemeToggle />
          <button className={styles.iconBtn} onClick={() => setView('library')} title={t('library')}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
            </svg>
          </button>
          {user ? (
            <button className={styles.iconBtn} onClick={() => setView('profile')} title={`${t('profile')} — ${user.email}`}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                <circle cx="12" cy="7" r="4"/>
              </svg>
            </button>
          ) : (
            <button className={styles.iconBtn} onClick={() => setView('auth')} title={t('signIn')}>
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
        {showingStaleAnalysis ? (
          <span className={styles.lastAnalysisNotice}>{t('showingLastAnalysis')}</span>
        ) : (
          <PlatformBadge
            platform={platformState.platform}
            strategy={platformState.strategy}
            title={platformState.title}
          />
        )}

        {/* Mode badge — hidden while active or when showing a stale analysis */}
        {!isActive && !showingStaleAnalysis && (
          <div className={styles.modeBadge}>
            <span className={styles.modeName}>{MODE_LABELS[selectedMode]}</span>
          </div>
        )}

        {/* Extract button — hidden while active. Force re-analyze when content already exists. */}
        {!isActive && !hasContent && (
          <button className={styles.extractBtn} onClick={() => handleManualExtract(false)}>
            {t('extract')}
          </button>
        )}
        {!isActive && hasContent && latestPack && (
          <>
            <FolderPicker
              selected={selectedFolder}
              onSelect={setSelectedFolder}
              onCreateNew={() => { setSuggestedFolderName(latestPack.title); setShowNewFolderModal(true) }}
              suggestedName={suggestedFolderName}
            />
            <div className={styles.actionGrid}>
              <button
                className={styles.extractBtn}
                onClick={() => handleManualExtract(true)}
                disabled={showingStaleAnalysis}
                title={showingStaleAnalysis ? t('openVideoHint') : undefined}
              >
                {t('newAnalysis')}
              </button>
              <button className={styles.secondaryBtn} onClick={handleClearAnalysis}>
                {t('clear')}
              </button>
              <button
                className={styles.secondaryBtn}
                onClick={handleSaveSelected}
                disabled={selectionCount === 0 || savingSelected}
                title={selectionCount === 0 ? t('selectFirst') : `${t('saveSelected')} (${selectionCount})`}
              >
                {savingSelected ? t('saving') : `${t('saveSelected')}${selectionCount > 0 ? ` (${selectionCount})` : ''}`}
              </button>
              <button
                className={styles.secondaryBtn}
                onClick={handleSaveFullAnalysis}
                disabled={savedIds.has(latestPack.id)}
                title={t('saveFullAnalysis')}
              >
                {savedIds.has(latestPack.id) ? t('alreadySaved') : t('saveFullAnalysis')}
              </button>
            </div>
          </>
        )}

        {saveStatus && (
          <div
            className={saveStatus.kind === 'err' ? styles.saveBanner + ' ' + styles.saveBannerErr : styles.saveBanner}
            role={saveStatus.kind === 'err' ? 'alert' : 'status'}
          >
            <span>{saveStatus.msg}</span>
            <button
              type="button"
              className={styles.saveBannerClose}
              onClick={() => setSaveStatus(null)}
              aria-label="Dismiss"
            >
              ✕
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
            <ExtractionProgress percent={extraction.percent} statusText={extraction.statusText || t('analyzing')} />
          </div>
        )}

        {/* Persistent recording indicator — visible whenever tab audio is being
            captured, independent of extraction state (CWS prominent disclosure). */}
        {audioCaptureActive && (
          <p className={styles.recordingIndicator}>&#9679; {t('recording')}</p>
        )}

        {/* Extracting with existing result → slim progress bar only (result stays visible below) */}
        {extraction.status === 'extracting' && hasContent && (
          <ExtractionProgress percent={extraction.percent} statusText={extraction.statusText || t('updating')} />
        )}

        {/* Recording → indicator + stop button (result stays visible below if it exists) */}
        {extraction.status === 'recording' && (
          <div className={styles.liveCard}>
            <p className={styles.liveTitle}>{platformState.title}</p>
            <p className={styles.recordingIndicator}>&#9679; {t('recording')}</p>
            <button className={styles.extractBtn} onClick={() => handleManualExtract(false)}>
              {t('stopAndAnalyze')}
            </button>
          </div>
        )}

        {/* Result card — only shown when real content exists (summary / takeaways / points / links) */}
        {hasContent && latestPack && (
          <ResultCard
            pack={latestPack}
            isSaved={savedIds.has(latestPack.id)}
            selection={selectionApi}
          />
        )}

        {/* Hint — only when no real content and idle */}
        {!hasContent && extraction.status === 'idle' && (
          <p className={styles.hint}>
            {platformState.strategy === 'instant'
              ? t('clickExtractInstant')
              : t('clickExtractLive')}
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
            <button className={styles.retryBtn} onClick={dismissError}>{t('dismiss')}</button>
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

      {audioConsentRequired && <AudioConsentDialog />}

      {showLlmModal && (
        <LlmSetupModal
          onClose={() => setShowLlmModal(false)}
          onSaved={() => { void refreshLlmSettings() }}
          reason={llmSettings?.configured && llmSettings.keyMissing ? 'keyMissing' : undefined}
        />
      )}
    </div>
  )
}

// ─── TopBar helper ────────────────────────────────────────────────────────────

function TopBar({ onBack, titleKey }: { onBack: () => void; titleKey: TKey }) {
  const t = useT()
  return (
    <div className={styles.topBar}>
      <button className={styles.backBtn} onClick={onBack}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polyline points="15 18 9 12 15 6"/>
        </svg>
        {t('back')}
      </button>
      <span className={styles.topBarTitle}>{t(titleKey)}</span>
    </div>
  )
}
