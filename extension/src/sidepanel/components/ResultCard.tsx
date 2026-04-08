import type { Pack } from '@shared/types'
import styles from './ResultCard.module.css'

interface Props {
  pack: Pack
  onSave: (pack: Pack, collectionId: string | null) => void
  isSaved: boolean
  selectedFolder: string | null
  onFolderChange: (id: string | null) => void
  onCreateFolder: () => void
  suggestedFolderName?: string
}

export function ResultCard({ pack, onSave, isSaved, selectedFolder, onFolderChange, onCreateFolder, suggestedFolderName }: Props) {
  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <div className={styles.headerMeta}>
          <p className={styles.title}>{pack.title}</p>
          <p className={styles.meta}>{pack.mode} · {pack.platform}</p>
        </div>
        <button
          className={`${styles.saveBtn} ${isSaved ? styles.saved : ''}`}
          onClick={() => onSave(pack, selectedFolder)}
          disabled={isSaved}
        >
          {isSaved ? '✓ Saved' : 'Save'}
        </button>
      </div>

      {pack.summary && (
        <p className={styles.summary}>{pack.summary}</p>
      )}

      <ul className={styles.bullets}>
        {pack.bullets.map((b, i) => (
          <li key={i} className={styles.bullet}>{b}</li>
        ))}
      </ul>

      {pack.links && pack.links.length > 0 && (
        <div className={styles.links}>
          <p className={styles.linksLabel}>Related</p>
          {pack.links.map((link, i) => (
            <a key={i} href={link.url} target="_blank" rel="noreferrer" className={styles.link}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                <polyline points="15 3 21 3 21 9"/>
                <line x1="10" y1="14" x2="21" y2="3"/>
              </svg>
              {link.title}
            </a>
          ))}
        </div>
      )}

      {!isSaved && (
        <div className={styles.saveRow}>
          <FolderPicker
            selected={selectedFolder}
            onSelect={onFolderChange}
            onCreateNew={onCreateFolder}
            suggestedName={suggestedFolderName}
          />
        </div>
      )}
    </div>
  )
}

// Inline lightweight folder picker (avoids import of heavier FolderSelector in this file)
import { useState } from 'react'
import { useAppStore } from '../store'

function FolderPicker({ selected, onSelect, onCreateNew, suggestedName }: {
  selected: string | null
  onSelect: (id: string | null) => void
  onCreateNew: () => void
  suggestedName?: string
}) {
  const { collections } = useAppStore()
  const [open, setOpen] = useState(false)
  const label = selected ? (collections.find((c) => c.id === selected)?.name ?? 'Folder') : 'No folder'

  return (
    <div className={styles.fpRoot}>
      <button className={styles.fpTrigger} onClick={() => setOpen(!open)}>
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
        </svg>
        {label}
        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ transform: open ? 'rotate(180deg)' : 'none', transition: '150ms' }}>
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>
      {open && (
        <div className={styles.fpDropdown}>
          <button className={`${styles.fpOption} ${!selected ? styles.fpActive : ''}`} onClick={() => { onSelect(null); setOpen(false) }}>No folder</button>
          {collections.map((c) => (
            <button key={c.id} className={`${styles.fpOption} ${selected === c.id ? styles.fpActive : ''}`} onClick={() => { onSelect(c.id); setOpen(false) }}>{c.name}</button>
          ))}
          <div className={styles.fpDivider} />
          <button className={styles.fpCreate} onClick={() => { onCreateNew(); setOpen(false) }}>
            {suggestedName ? `+ New folder: ${suggestedName}` : '+ New folder'}
          </button>
        </div>
      )}
    </div>
  )
}
