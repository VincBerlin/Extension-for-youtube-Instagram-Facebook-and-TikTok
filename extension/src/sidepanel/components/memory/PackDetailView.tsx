import { useMemo, useState } from 'react'
import type { Pack } from '@shared/types'
import { ResultCard } from '../ResultCard'
import { useAppStore } from '../../store'
import { supabase } from '../../hooks/useAuth'
import { exportPackToPdf } from '../../utils/pdfExport'
import { useT } from '../../i18n'
import { loadLibrary } from '../../hooks/useLibrary'
import styles from './PackDetailView.module.css'

interface Props {
  pack: Pack
  onBack: () => void
}

/**
 * Read-only detail view for a saved Pack. Reuses ResultCard for the body so
 * the rendering matches the live extraction. Adds metadata (URL, savedAt),
 * folder reassignment, Export PDF, and Delete actions on top.
 */
export function PackDetailView({ pack, onBack }: Props) {
  const t = useT()
  const setView = useAppStore((s) => s.setView)
  void setView
  const setPacks = useAppStore((s) => s.setPacks)
  const packs = useAppStore((s) => s.packs)
  const collections = useAppStore((s) => s.collections)
  const addPackToFolder = useAppStore((s) => s.addPackToFolder)
  const removePackFromFolder = useAppStore((s) => s.removePackFromFolder)

  const [confirming, setConfirming] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [moving, setMoving] = useState(false)
  const [folderStatus, setFolderStatus] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null)

  const savedAt = pack.savedAt ? new Date(pack.savedAt).toLocaleString() : null

  // Derive the pack's current folder from the local collections cache —
  // this is the source of truth that the rest of the UI reads, so any move
  // must update it immutably (handled below).
  const currentFolderId = useMemo(() => {
    const owning = collections.find((c) =>
      c.items.some((it) => it.type === 'pack' && it.refId === pack.id),
    )
    return owning?.id ?? ''
  }, [collections, pack.id])

  async function handleDelete() {
    setDeleting(true)
    setError(null)
    console.log('[LIBRARY-DEBUG] packs: delete | packId:', pack.id)
    const { error: delError } = await supabase.from('packs').delete().eq('id', pack.id)
    setDeleting(false)
    if (delError) {
      console.warn('[LIBRARY-DEBUG] packs: delete failed |', delError.message)
      setError(`${t('deleteFailed')}: ${delError.message}`)
      setConfirming(false)
      return
    }
    console.log('[LIBRARY-DEBUG] packs: delete ok')
    setPacks(packs.filter((p) => p.id !== pack.id))
    void loadLibrary()
    onBack()
  }

  async function handleMoveFolder(nextFolderId: string) {
    if (moving) return
    if (nextFolderId === currentFolderId) return
    setMoving(true)
    setFolderStatus(null)

    // 1. Remove existing relation if any. The check constraint requires
    // (collection_id, type, ref_id) to identify the row.
    if (currentFolderId) {
      console.log('[FOLDER-DEBUG] move: unlink old | folderId-suffix:', currentFolderId.slice(0, 8), '| packId-suffix:', pack.id.slice(0, 8))
      const { error: delErr } = await supabase
        .from('collection_items')
        .delete()
        .eq('collection_id', currentFolderId)
        .eq('type', 'pack')
        .eq('ref_id', pack.id)
      if (delErr) {
        console.warn('[FOLDER-DEBUG] move: unlink failed |', delErr.message)
        setFolderStatus({ kind: 'err', msg: `${t('moveFailed')}: ${delErr.message}` })
        setMoving(false)
        return
      }
    }

    // 2. Insert new relation if a target folder was chosen.
    if (nextFolderId) {
      console.log('[FOLDER-DEBUG] move: link new | folderId-suffix:', nextFolderId.slice(0, 8), '| packId-suffix:', pack.id.slice(0, 8))
      const { error: insErr } = await supabase.from('collection_items').insert({
        collection_id: nextFolderId,
        type: 'pack',
        ref_id: pack.id,
        position: 0,
      })
      if (insErr) {
        console.warn('[FOLDER-DEBUG] move: link failed |', insErr.message)
        setFolderStatus({ kind: 'err', msg: `${t('moveFailed')}: ${insErr.message}` })
        setMoving(false)
        // Best-effort: keep the local cache consistent with the server. The
        // unlink already happened, so reflect that.
        if (currentFolderId) removePackFromFolder(currentFolderId, pack.id)
        return
      }
    }

    // 3. Reflect the move in the local store so the library updates instantly.
    if (currentFolderId) removePackFromFolder(currentFolderId, pack.id)
    if (nextFolderId) addPackToFolder(nextFolderId, pack.id)
    setMoving(false)

    const targetName = nextFolderId
      ? collections.find((c) => c.id === nextFolderId)?.name ?? t('folder')
      : t('uncategorized')
    setFolderStatus({
      kind: 'ok',
      msg: nextFolderId ? `${t('movedToFolder')} "${targetName}".` : t('removedFromFolder'),
    })
  }

  return (
    <div className={styles.root}>
      <div className={styles.detailMeta}>
        {pack.url && (
          <div className={styles.metaRow}>
            <span className={styles.metaLabel}>{t('videoUrl')}</span>
            <a className={styles.metaUrl} href={pack.url} target="_blank" rel="noreferrer">
              {pack.url}
            </a>
          </div>
        )}
        {savedAt && (
          <div className={styles.metaRow}>
            <span className={styles.metaLabel}>{t('savedOn')}</span>
            <span className={styles.metaValue}>{savedAt}</span>
          </div>
        )}
      </div>

      <div className={styles.folderRow}>
        <span className={styles.folderLabel}>{t('folderColon')}</span>
        <select
          className={styles.folderSelect}
          value={currentFolderId}
          onChange={(e) => handleMoveFolder(e.target.value)}
          disabled={moving}
          aria-label={t('moveToFolder')}
        >
          <option value="">{t('uncategorized')}</option>
          {collections.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        {folderStatus && (
          <span
            className={`${styles.folderStatus} ${folderStatus.kind === 'err' ? styles.folderStatusErr : ''}`}
            role={folderStatus.kind === 'err' ? 'alert' : 'status'}
          >
            {folderStatus.msg}
          </span>
        )}
      </div>

      <div className={styles.actions}>
        <button
          type="button"
          className={styles.actionBtn}
          onClick={() => exportPackToPdf(pack)}
        >
          {t('exportPdf')}
        </button>
        <button
          type="button"
          className={`${styles.actionBtn} ${styles.deleteBtn}`}
          onClick={() => setConfirming(true)}
          disabled={deleting}
        >
          {t('delete')}
        </button>
      </div>

      {confirming && (
        <div className={styles.confirmCard} role="alertdialog">
          <p className={styles.confirmText}>{t('deletePackConfirm')}</p>
          <div className={styles.confirmActions}>
            <button
              type="button"
              className={styles.actionBtn}
              onClick={() => setConfirming(false)}
              disabled={deleting}
            >
              {t('close')}
            </button>
            <button
              type="button"
              className={`${styles.actionBtn} ${styles.deleteBtn}`}
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting ? t('saving') : t('delete')}
            </button>
          </div>
        </div>
      )}

      {error && <p className={styles.error}>{error}</p>}

      <ResultCard
        pack={pack}
        isSaved={true}
      />
    </div>
  )
}
