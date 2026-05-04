import { useEffect, useState } from 'react'
import { useAppStore } from '../store'
import { updateProfile } from '../hooks/useProfile'
import { supabase } from '../hooks/useAuth'
import type { OutcomeMode } from '@shared/types'
import styles from './ProfileView.module.css'

const MODE_LABELS: Record<OutcomeMode, string> = {
  'knowledge':     'Knowledge',
  'build-pack':    'Build Pack',
  'decision-pack': 'Decision Pack',
  'coach-notes':   'Coach Notes',
  'tools':         'Tools',
  'stack':         'Tech Stack',
}

const LANGUAGE_OPTIONS: Array<{ code: string; label: string }> = [
  { code: 'en', label: 'English' },
  { code: 'de', label: 'Deutsch' },
  { code: 'es', label: 'Español' },
  { code: 'fr', label: 'Français' },
  { code: 'it', label: 'Italiano' },
  { code: 'pt', label: 'Português' },
]

export function ProfileView() {
  const profile = useAppStore((s) => s.profile)
  const user = useAppStore((s) => s.user)

  const [displayName, setDisplayName] = useState('')
  const [language, setLanguage] = useState('en')
  const [defaultMode, setDefaultMode] = useState<OutcomeMode>('knowledge')
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null)

  useEffect(() => {
    if (!profile) return
    setDisplayName(profile.display_name ?? '')
    setLanguage(profile.preferred_language ?? 'en')
    setDefaultMode(profile.default_mode ?? 'knowledge')
  }, [profile])

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!profile) return
    setSaving(true)
    setStatus(null)
    const updated = await updateProfile({
      display_name: displayName.trim() || null,
      preferred_language: language,
      default_mode: defaultMode,
    })
    setSaving(false)
    if (updated) {
      setStatus({ kind: 'ok', msg: 'Saved.' })
    } else {
      setStatus({ kind: 'err', msg: 'Could not save profile.' })
    }
  }

  if (!user) {
    return (
      <div className={styles.root}>
        <p className={styles.empty}>Please sign in to view your profile.</p>
      </div>
    )
  }

  if (!profile) {
    return (
      <div className={styles.root}>
        <p className={styles.empty}>Loading profile…</p>
      </div>
    )
  }

  const isPro = profile.plan === 'pro'

  return (
    <form className={styles.root} onSubmit={handleSave}>
      <div className={styles.section}>
        <span className={styles.sectionLabel}>Account</span>
        <div className={styles.identity}>
          <span className={styles.email}>{profile.email}</span>
          <div className={styles.planRow}>
            <span className={`${styles.planBadge} ${isPro ? styles.planPro : styles.planFree}`}>
              {isPro ? 'Pro' : 'Free'}
            </span>
            <span>plan</span>
          </div>
        </div>
      </div>

      <div className={styles.field}>
        <label className={styles.fieldLabel} htmlFor="display_name">Display name</label>
        <input
          id="display_name"
          className={styles.input}
          type="text"
          placeholder="Your name"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          maxLength={80}
        />
      </div>

      <div className={styles.field}>
        <label className={styles.fieldLabel} htmlFor="language">Preferred language</label>
        <select
          id="language"
          className={styles.select}
          value={language}
          onChange={(e) => setLanguage(e.target.value)}
        >
          {LANGUAGE_OPTIONS.map((opt) => (
            <option key={opt.code} value={opt.code}>{opt.label}</option>
          ))}
        </select>
      </div>

      <div className={styles.field}>
        <label className={styles.fieldLabel} htmlFor="default_mode">Default extraction mode</label>
        <select
          id="default_mode"
          className={styles.select}
          value={defaultMode}
          onChange={(e) => setDefaultMode(e.target.value as OutcomeMode)}
        >
          {(Object.keys(MODE_LABELS) as OutcomeMode[]).map((m) => (
            <option key={m} value={m}>{MODE_LABELS[m]}</option>
          ))}
        </select>
      </div>

      {status?.kind === 'ok' && <p className={styles.status}>{status.msg}</p>}
      {status?.kind === 'err' && <p className={styles.error}>{status.msg}</p>}

      <button type="submit" className={styles.saveBtn} disabled={saving}>
        {saving ? 'Saving…' : 'Save changes'}
      </button>

      <div className={styles.signOutRow}>
        <button
          type="button"
          className={styles.signOutBtn}
          onClick={() => supabase.auth.signOut()}
        >
          Sign out
        </button>
      </div>
    </form>
  )
}
