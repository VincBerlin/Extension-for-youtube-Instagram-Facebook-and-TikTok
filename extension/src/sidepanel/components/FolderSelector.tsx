import { useState } from 'react'
import { useAppStore } from '../store'
import styles from './FolderSelector.module.css'

interface Props {
  onSelect: (collectionId: string | null) => void
  onCreateNew: () => void
  selected: string | null
}

export function FolderSelector({ onSelect, onCreateNew, selected }: Props) {
  const { collections } = useAppStore()
  const [open, setOpen] = useState(false)

  const label = selected
    ? (collections.find((c) => c.id === selected)?.name ?? 'Unknown folder')
    : 'No folder'

  return (
    <div className={styles.root}>
      <button className={styles.trigger} onClick={() => setOpen(!open)}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
        </svg>
        <span>{label}</span>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 150ms' }}>
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>

      {open && (
        <div className={styles.dropdown}>
          <button
            className={`${styles.option} ${selected === null ? styles.active : ''}`}
            onClick={() => { onSelect(null); setOpen(false) }}
          >
            No folder
          </button>
          {collections.map((col) => (
            <button
              key={col.id}
              className={`${styles.option} ${selected === col.id ? styles.active : ''}`}
              onClick={() => { onSelect(col.id); setOpen(false) }}
            >
              {col.name}
            </button>
          ))}
          <div className={styles.divider} />
          <button
            className={styles.createBtn}
            onClick={() => { onCreateNew(); setOpen(false) }}
          >
            + New folder
          </button>
        </div>
      )}
    </div>
  )
}
