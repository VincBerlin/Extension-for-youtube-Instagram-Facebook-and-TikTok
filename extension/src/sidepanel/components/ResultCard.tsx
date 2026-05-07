import { useState, useEffect } from 'react'
import type { Pack } from '@shared/types'
import { useAppStore } from '../store'
import styles from './ResultCard.module.css'

// Allowed item_type values for saved_items, mirrored from the Supabase check
// constraint. Keep in sync with migration 005.
export type SavedItemType =
  | 'takeaway'
  | 'section'
  | 'resource'
  | 'setup_step'
  | 'command'
  | 'full_analysis'

export interface SavedItemSelection {
  itemType: SavedItemType
  payload: unknown
}

export interface SelectionApi {
  selected: Map<string, SavedItemSelection>
  toggle: (key: string, itemType: SavedItemType, payload: unknown) => void
}

interface Props {
  pack: Pack
  isSaved: boolean
  selectedFolder: string | null
  onFolderChange: (id: string | null) => void
  onCreateFolder: () => void
  suggestedFolderName?: string
  selection?: SelectionApi
}

export function ResultCard({ pack, isSaved, selectedFolder, onFolderChange, onCreateFolder, suggestedFolderName, selection }: Props) {
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

  const sel = selection
  const isItemSelected = (key: string) => !!sel?.selected.has(key)

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <div className={styles.headerMeta}>
          <p className={styles.title}>{pack.title}</p>
          <p className={styles.meta}>{pack.mode} · {pack.platform}</p>
        </div>
        {isSaved && <span className={`${styles.saveBtn} ${styles.saved}`} aria-label="Saved">✓</span>}
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
          {visibleBullets.map((b, i) => {
            const key = `takeaway:${i}`
            const checked = isItemSelected(key)
            return (
              <li
                key={i}
                className={`${styles.bullet} ${styles.fadeIn} ${checked ? styles.bulletSelected : ''}`}
                style={{ '--delay': '0ms' } as React.CSSProperties}
              >
                {sel && (
                  <input
                    type="checkbox"
                    className={styles.itemCheckbox}
                    checked={checked}
                    onChange={() => sel.toggle(key, 'takeaway', { text: b })}
                    aria-label="Select takeaway"
                  />
                )}
                <span className={styles.bulletText}>{b}</span>
              </li>
            )
          })}
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
          {pack.important_links.map((link, i) => {
            const key = `link:${i}:${link.url}`
            const checked = isItemSelected(key)
            // Always saved as item_type='resource' — saved_items has no 'link' kind.
            // Prefer the richer v2.resources entry (validation, mentioned_context,
            // why_relevant, user_action…) when one matches by URL; otherwise fall
            // back to the leaner RelatedLink-shaped payload.
            const matchedResource = pack.v2?.resources?.find((r) => r.url === link.url)
            const savedPayload = matchedResource ?? link
            return (
              <div key={i} className={`${styles.linkRow} ${checked ? styles.bulletSelected : ''}`}>
                {sel && (
                  <input
                    type="checkbox"
                    className={styles.itemCheckbox}
                    checked={checked}
                    onChange={() => sel.toggle(key, 'resource', savedPayload)}
                    aria-label="Select resource"
                  />
                )}
                <a href={link.url} target="_blank" rel="noreferrer" className={styles.link}>
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
              </div>
            )
          })}
        </div>
      )}

      {showLinks && pack.v2?.setup_guide?.exists && (
        (pack.v2.setup_guide.steps?.length ?? 0) + (pack.v2.setup_guide.commands?.length ?? 0) > 0
      ) && (
        <div className={`${styles.setupGuide} ${styles.fadeIn}`} style={{ '--delay': '0ms' } as React.CSSProperties}>
          <p className={styles.sectionLabel}>{pack.v2.setup_guide.title ?? 'Setup'}</p>

          {pack.v2.setup_guide.steps && pack.v2.setup_guide.steps.length > 0 && (
            <ul className={styles.bullets} style={{ borderTop: 'none', paddingTop: 0 }}>
              {pack.v2.setup_guide.steps.map((step, i) => {
                const key = `setup_step:${i}`
                const checked = isItemSelected(key)
                const stepLabel = step.command
                  ? `${step.description} — \`${step.command}\``
                  : step.description
                return (
                  <li
                    key={i}
                    className={`${styles.bullet} ${styles.bulletMuted} ${checked ? styles.bulletSelected : ''}`}
                  >
                    {sel && (
                      <input
                        type="checkbox"
                        className={styles.itemCheckbox}
                        checked={checked}
                        onChange={() => sel.toggle(key, 'setup_step', step)}
                        aria-label="Select setup step"
                      />
                    )}
                    <span className={styles.bulletText}>{stepLabel}</span>
                  </li>
                )
              })}
            </ul>
          )}

          {pack.v2.setup_guide.commands && pack.v2.setup_guide.commands.length > 0 && (
            <div className={styles.commands}>
              {pack.v2.setup_guide.commands.map((cmd, i) => {
                const key = `command:${i}:${cmd}`
                const checked = isItemSelected(key)
                return (
                  <div key={i} className={`${styles.commandRow} ${checked ? styles.bulletSelected : ''}`}>
                    {sel && (
                      <input
                        type="checkbox"
                        className={styles.itemCheckbox}
                        checked={checked}
                        onChange={() => sel.toggle(key, 'command', { command: cmd })}
                        aria-label="Select command"
                      />
                    )}
                    <code className={styles.commandText}>{cmd}</code>
                  </div>
                )
              })}
            </div>
          )}
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
