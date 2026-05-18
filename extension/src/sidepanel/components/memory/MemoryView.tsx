import { useEffect, useMemo, useState } from 'react'
import { useAppStore } from '../../store'
import { loadLibrary } from '../../hooks/useLibrary'
import { exportPackToPdf } from '../../utils/pdfExport'
import { supabase } from '../../hooks/useAuth'
import { useT } from '../../i18n'
import { PackDetailView } from './PackDetailView'
import type { Pack, SavedItem } from '@shared/types'
import styles from './MemoryView.module.css'

type Tab = 'recent' | 'items' | 'collections'

export function MemoryView() {
  const {
    packs, collections, savedItems, user,
    libraryLoading, libraryError, setCollections,
    libraryFolderFilter, setLibraryFolderFilter,
  } = useAppStore()
  const t = useT()
  // Default to the cross-view folder filter (set in ProfileView). Local state
  // keeps subsequent in-library selections decoupled from Profile.
  const [tab, setTab] = useState<Tab>('recent')
  const [folderFilter, setFolderFilter] = useState<string | null>(libraryFolderFilter)
  const [openPackId, setOpenPackId] = useState<string | null>(null)
  const [folderConfirm, setFolderConfirm] = useState<string | null>(null)
  const [folderDeleting, setFolderDeleting] = useState(false)

  // Apply pre-selected folder filter from cross-view nav once on mount, then
  // clear it so a future visit (without an explicit chip click) starts clean.
  useEffect(() => {
    if (libraryFolderFilter !== null) {
      console.log('[LIBRARY-DEBUG] applying cross-view folder filter | id-suffix:', libraryFolderFilter.slice(0, 8))
      setFolderFilter(libraryFolderFilter)
      setTab('recent')
      setLibraryFolderFilter(null)
    }
  }, [libraryFolderFilter, setLibraryFolderFilter])

  const filteredPacks = useMemo<Pack[]>(() => {
    if (!folderFilter) return packs
    const col = collections.find((c) => c.id === folderFilter)
    if (!col) return packs
    const allowed = new Set(col.items.filter((i) => i.type === 'pack').map((i) => i.refId))
    return packs.filter((p) => allowed.has(p.id))
  }, [packs, collections, folderFilter])

  // Saved items can't be linked via collection_items (its type check rejects
  // anything other than 'pack' | 'resource'), so the folder reference lives
  // inside payload.metadata.folder_id. Filter by that when a folder chip
  // is active on the Saved-items tab.
  const filteredSavedItems = useMemo<SavedItem[]>(() => {
    if (!folderFilter) return savedItems
    return savedItems.filter((i) => {
      const meta = i.payload?.metadata as { folder_id?: string } | undefined
      return meta?.folder_id === folderFilter
    })
  }, [savedItems, folderFilter])

  const openPack = useMemo(
    () => (openPackId ? packs.find((p) => p.id === openPackId) ?? null : null),
    [openPackId, packs],
  )

  if (!user) {
    return (
      <div className={styles.root}>
        <p className={styles.empty}>{t('pleaseSignIn')}</p>
      </div>
    )
  }

  if (openPack) {
    return (
      <div className={styles.root}>
        <button className={styles.backInline} onClick={() => setOpenPackId(null)}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
          {t('back')}
        </button>
        <PackDetailView pack={openPack} onBack={() => setOpenPackId(null)} />
      </div>
    )
  }

  async function handleDeleteFolder(id: string) {
    setFolderDeleting(true)
    console.log('[LIBRARY-DEBUG] collections: delete | id-suffix:', id.slice(0, 8))
    const { error: ciErr } = await supabase.from('collection_items').delete().eq('collection_id', id)
    if (ciErr) {
      console.warn('[LIBRARY-DEBUG] collection_items delete failed |', ciErr.message)
    }
    const { error: colErr } = await supabase.from('collections').delete().eq('id', id)
    setFolderDeleting(false)
    setFolderConfirm(null)
    if (colErr) {
      console.warn('[LIBRARY-DEBUG] collections delete failed |', colErr.message)
      return
    }
    setCollections(collections.filter((c) => c.id !== id))
    if (folderFilter === id) setFolderFilter(null)
    void loadLibrary()
  }

  return (
    <div className={styles.root}>
      {user.email && (
        <p className={styles.identity}>{t('signedInAs')} {user.email}</p>
      )}

      <div className={styles.tabs}>
        <button className={`${styles.tab} ${tab === 'recent' ? styles.active : ''}`} onClick={() => setTab('recent')}>
          {t('savedAnalyses')}
        </button>
        <button className={`${styles.tab} ${tab === 'items' ? styles.active : ''}`} onClick={() => setTab('items')}>
          {t('savedItems')}
        </button>
        <button className={`${styles.tab} ${tab === 'collections' ? styles.active : ''}`} onClick={() => setTab('collections')}>
          {t('folders')}
        </button>
      </div>

      <div className={styles.utilityRow}>
        <button
          className={styles.reloadBtn}
          onClick={() => { void loadLibrary() }}
          disabled={libraryLoading}
        >
          {libraryLoading ? t('loading') : t('reload')}
        </button>
        {libraryError && (
          <span className={styles.errorText} title={libraryError}>
            {t('errorLoadingLibrary')} — {libraryError}
          </span>
        )}
      </div>

      {tab === 'recent' && (
        <>
          {collections.length > 0 && (
            <div className={styles.filterRow}>
              <button
                className={`${styles.filterChip} ${folderFilter === null ? styles.filterChipActive : ''}`}
                onClick={() => setFolderFilter(null)}
              >
                {t('folders')}: ✕
              </button>
              {collections.map((c) => (
                <button
                  key={c.id}
                  className={`${styles.filterChip} ${folderFilter === c.id ? styles.filterChipActive : ''}`}
                  onClick={() => setFolderFilter(c.id)}
                >
                  {c.name}
                </button>
              ))}
            </div>
          )}
          <div className={styles.list}>
            {filteredPacks.length === 0 ? (
              <p className={styles.empty}>{t('noAnalyses')}</p>
            ) : (
              filteredPacks.map((pack) => (
                <PackRow key={pack.id} pack={pack} onOpen={() => setOpenPackId(pack.id)} />
              ))
            )}
          </div>
        </>
      )}

      {tab === 'items' && (
        <>
          {collections.length > 0 && (
            <div className={styles.filterRow}>
              <button
                className={`${styles.filterChip} ${folderFilter === null ? styles.filterChipActive : ''}`}
                onClick={() => setFolderFilter(null)}
              >
                {t('folders')}: ✕
              </button>
              {collections.map((c) => (
                <button
                  key={c.id}
                  className={`${styles.filterChip} ${folderFilter === c.id ? styles.filterChipActive : ''}`}
                  onClick={() => setFolderFilter(c.id)}
                >
                  {c.name}
                </button>
              ))}
            </div>
          )}
          <div className={styles.list}>
            {filteredSavedItems.length === 0 ? (
              <p className={styles.empty}>{t('noItems')}</p>
            ) : (
              filteredSavedItems.map((item) => <SavedItemRow key={item.id} item={item} />)
            )}
          </div>
        </>
      )}

      {tab === 'collections' && (
        <div className={styles.collectionGrid}>
          {collections.length === 0 ? (
            <p className={styles.empty}>{t('noFolders')}</p>
          ) : (
            collections.map((col) => (
              <div key={col.id} className={styles.collectionCard}>
                <button
                  type="button"
                  className={styles.collectionCardMain}
                  onClick={() => { setFolderFilter(col.id); setTab('recent') }}
                  title={`${t('open')}: ${col.name}`}
                >
                  <span className={styles.collectionName}>{col.name}</span>
                  <span className={styles.collectionCount}>{col.items.length}</span>
                </button>
                <button
                  type="button"
                  className={styles.collectionDeleteCompact}
                  onClick={(e) => { e.stopPropagation(); setFolderConfirm(col.id) }}
                  aria-label={t('delete')}
                  title={t('delete')}
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <polyline points="3 6 5 6 21 6"/>
                    <path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/>
                  </svg>
                </button>
              </div>
            ))
          )}
        </div>
      )}

      {folderConfirm && (
        <div className={styles.confirmOverlay}>
          <div className={styles.confirmCard} role="alertdialog">
            <p className={styles.confirmText}>{t('deleteFolderConfirm')}</p>
            <div className={styles.confirmActions}>
              <button
                type="button"
                className={styles.confirmBtn}
                onClick={() => setFolderConfirm(null)}
                disabled={folderDeleting}
              >
                {t('close')}
              </button>
              <button
                type="button"
                className={`${styles.confirmBtn} ${styles.confirmDelete}`}
                onClick={() => folderConfirm && handleDeleteFolder(folderConfirm)}
                disabled={folderDeleting}
              >
                {folderDeleting ? t('saving') : t('delete')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function PackRow({ pack, onOpen }: { pack: Pack; onOpen: () => void }) {
  const t = useT()
  return (
    <div className={styles.packRow} onClick={onOpen} role="button" tabIndex={0}>
      <div className={styles.packMeta}>
        <span className={styles.packPlatform}>{pack.platform}</span>
        <span className={styles.packMode}>{pack.mode}</span>
      </div>
      <p className={styles.packTitle}>{pack.title}</p>
      <p className={styles.packPreview}>{pack.summary ?? pack.key_takeaways[0] ?? ''}</p>
      <button
        type="button"
        className={styles.exportBtn}
        onClick={(e) => { e.stopPropagation(); exportPackToPdf(pack) }}
      >
        {t('exportPdf')}
      </button>
    </div>
  )
}

function SavedItemRow({ item }: { item: SavedItem }) {
  const p = item.payload
  return (
    <div className={styles.itemRow}>
      <div className={styles.itemMeta}>
        <span className={styles.itemType}>{item.itemType.replace('_', ' ')}</span>
        {p.context && <span className={styles.itemContext}>{p.context}</span>}
      </div>
      <p className={styles.itemTitle}>{p.title || item.videoTitle || 'Untitled'}</p>
      {p.content && <p className={styles.itemContent}>{p.content}</p>}
      {p.resource_url && (
        <a className={styles.itemUrl} href={p.resource_url} target="_blank" rel="noreferrer">
          {p.resource_url}
        </a>
      )}
    </div>
  )
}
