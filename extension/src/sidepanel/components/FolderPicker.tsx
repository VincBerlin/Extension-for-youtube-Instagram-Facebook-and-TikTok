import { useState, useEffect, useRef } from 'react'
import { useAppStore } from '../store'
import { useT } from '../i18n'
import styles from './FolderPicker.module.css'

interface Props {
  selected: string | null
  onSelect: (id: string | null) => void
  onCreateNew: () => void
  suggestedName?: string
}

/**
 * Folder selector + create-new entry point. Lives at the top of the result
 * area (above Save Full Analysis / Save Selected) so the user picks the
 * target folder before triggering a save. Closing on outside-click keeps the
 * dropdown from blocking surrounding actions.
 */
export function FolderPicker({ selected, onSelect, onCreateNew, suggestedName }: Props) {
  const { collections } = useAppStore()
  const t = useT()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    function onDocClick(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [open])

  const label = selected
    ? (collections.find((c) => c.id === selected)?.name ?? t('folder'))
    : t('noFolder')

  return (
    <div className={styles.fpRow}>
      <span className={styles.fpLabel}>{t('folderColon')}</span>
      <div className={styles.fpRoot} ref={rootRef}>
        <button
          type="button"
          className={styles.fpTrigger}
          onClick={() => setOpen(!open)}
          aria-haspopup="listbox"
          aria-expanded={open}
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
          </svg>
          {label}
          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ transform: open ? 'rotate(180deg)' : 'none', transition: '150ms' }}>
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </button>
        {open && (
          <div className={styles.fpDropdown} role="listbox">
            <button
              type="button"
              className={`${styles.fpOption} ${!selected ? styles.fpActive : ''}`}
              onClick={() => { onSelect(null); setOpen(false) }}
            >
              {t('noFolder')}
            </button>
            {collections.map((c) => (
              <button
                key={c.id}
                type="button"
                className={`${styles.fpOption} ${selected === c.id ? styles.fpActive : ''}`}
                onClick={() => { onSelect(c.id); setOpen(false) }}
              >
                {c.name}
              </button>
            ))}
            <div className={styles.fpDivider} />
            <button
              type="button"
              className={styles.fpCreate}
              onClick={() => { onCreateNew(); setOpen(false) }}
            >
              {suggestedName ? `+ ${t('newFolder')}: ${suggestedName}` : `+ ${t('newFolder')}`}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
