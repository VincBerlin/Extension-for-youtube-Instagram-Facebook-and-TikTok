import { useState, useRef, useEffect } from 'react'
import styles from './NewFolderModal.module.css'

interface Props {
  onConfirm: (name: string) => void
  onCancel: () => void
  suggestedName?: string
}

export function NewFolderModal({ onConfirm, onCancel, suggestedName }: Props) {
  const [name, setName] = useState(suggestedName ?? '')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = name.trim()
    if (trimmed) onConfirm(trimmed)
  }

  return (
    <div className={styles.overlay} onClick={onCancel}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <p className={styles.title}>New folder</p>
        <form onSubmit={handleSubmit}>
          <input
            ref={inputRef}
            className={styles.input}
            type="text"
            placeholder="Folder name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={50}
          />
          <div className={styles.actions}>
            <button type="button" className={styles.cancelBtn} onClick={onCancel}>Cancel</button>
            <button type="submit" className={styles.confirmBtn} disabled={!name.trim()}>Create</button>
          </div>
        </form>
      </div>
    </div>
  )
}
