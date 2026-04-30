import { useState, useEffect } from 'react'
import type { Pack } from '@shared/types'
import { useAppStore } from '../store'
import styles from './ResultCard.module.css'

interface Props {
  pack: Pack
  onSave: (pack: Pack, folderId: string | null) => void
  isSaved: boolean
  selectedFolder: string | null
  onFolderChange: (id: string | null) => void
  onCreateFolder: () => void
  suggestedFolderName?: string
}

export function ResultCard({ pack, onSave, isSaved, selectedFolder, onFolderChange, onCreateFolder, suggestedFolderName }: Props) {
  const [revealedCount, setRevealedCount] = useState(0)
  const [showDetails, setShowDetails]     = useState(false)
  const [showLinks, setShowLinks]         = useState(false)

  // Reset and replay reveal animation every time a new pack arrives
  useEffect(() => {
    setRevealedCount(0)
    setShowDetails(false)
    setShowLinks(false)

    const total = pack.key_takeaways.length
    let count = 0

    const iv = setInterval(() => {
      count++
      setRevealedCount(count)
      if (count >= total) {
        clearInterval(iv)
        setTimeout(() => setShowDetails(true), 250)
        setTimeout(() => setShowLinks(true), 500)
      }
    }, 170)

    return () => clearInterval(iv)
  }, [pack.id])

  const visibleBullets = pack.key_takeaways.slice(0, revealedCount)

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
          {isSaved ? '✓' : 'Save'}
        </button>
      </div>

      {pack.summary && (
        <p className={`${styles.summary} ${styles.fadeIn}`} style={{ '--delay': '0ms' } as React.CSSProperties}>
          {pack.summary}
        </p>
      )}

      {pack.keywords && pack.keywords.length > 0 && (
        <div className={`${styles.keywords} ${styles.fadeIn}`} style={{ '--delay': '0ms' } as React.CSSProperties}>
          {pack.keywords.map((k, i) => (
            <span key={i} className={styles.keyword}>{k}</span>
          ))}
        </div>
      )}

      {visibleBullets.length > 0 && (
        <ul className={styles.bullets}>
          {visibleBullets.map((b, i) => (
            <li
              key={i}
              className={`${styles.bullet} ${styles.fadeIn}`}
              style={{ '--delay': '0ms' } as React.CSSProperties}
            >
              {b}
            </li>
          ))}
        </ul>
      )}

      {showDetails && pack.relevant_points && pack.relevant_points.length > 0 && (
        <div className={`${styles.relevantPoints} ${styles.fadeIn}`} style={{ '--delay': '0ms' } as React.CSSProperties}>
          <p className={styles.sectionLabel}>Details</p>
          <ul className={styles.bullets} style={{ borderTop: 'none', paddingTop: 0 }}>
            {pack.relevant_points.map((p, i) => (
              <li key={i} className={`${styles.bullet} ${styles.bulletMuted}`}>{p}</li>
            ))}
          </ul>
        </div>
      )}

      {showDetails && pack.quick_facts && (
        <div className={`${styles.quickFacts} ${styles.fadeIn}`} style={{ '--delay': '0ms' } as React.CSSProperties}>
          <p className={styles.sectionLabel}>Quick facts</p>
          <div className={styles.quickFactsRow}>
            {pack.quick_facts.platform && <span className={styles.factPill}>{pack.quick_facts.platform}</span>}
            {pack.quick_facts.category && <span className={styles.factPill}>{pack.quick_facts.category}</span>}
            {pack.quick_facts.content_type && <span className={styles.factPill}>{pack.quick_facts.content_type}</span>}
          </div>
        </div>
      )}

      {showLinks && pack.important_links && pack.important_links.length > 0 && (
        <div className={`${styles.links} ${styles.fadeIn}`} style={{ '--delay': '0ms' } as React.CSSProperties}>
          <p className={styles.sectionLabel}>Links</p>
          {pack.important_links.map((link, i) => (
            <a key={i} href={link.url} target="_blank" rel="noreferrer" className={styles.link}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                <polyline points="15 3 21 3 21 9"/>
                <line x1="10" y1="14" x2="21" y2="3"/>
              </svg>
              <span className={styles.linkContent}>
                <span className={styles.linkTitle}>{link.title}</span>
                {link.description && <span className={styles.linkDesc}>{link.description}</span>}
              </span>
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

// ─── Folder picker ─────────────────────────────────────────────────────────────

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
            {suggestedName ? `+ New: ${suggestedName}` : '+ New folder'}
          </button>
        </div>
      )}
    </div>
  )
}
