import { useState } from 'react'
import { useAppStore } from '../store'
import styles from './AudioConsentDialog.module.css'

// Prominent disclosure + affirmative consent for tab-audio capture, required
// by the Chrome Web Store User Data policy. Shown once, before the first
// capture ever starts; the decision is persisted by the background worker.

interface UiStrings {
  title: string
  body: string
  detail: string
  allow: string
  deny: string
}

const STRINGS: Record<'en' | 'de', UiStrings> = {
  en: {
    title: 'Allow audio capture?',
    body: 'TikTok, Instagram and Facebook videos have no caption track. To summarize them, this extension records the tab’s audio while a video is playing.',
    detail: 'A recording indicator is shown while capture is active. Audio is buffered locally and sent to the extraction server only when you click Extract. If you decline, summaries for these platforms will use the page text only.',
    allow: 'Allow audio capture',
    deny: 'Not now',
  },
  de: {
    title: 'Audioaufnahme erlauben?',
    body: 'TikTok-, Instagram- und Facebook-Videos haben keine Untertitelspur. Um sie zusammenzufassen, nimmt diese Erweiterung den Ton des Tabs auf, während ein Video läuft.',
    detail: 'Während der Aufnahme wird ein Indikator angezeigt. Audio wird lokal zwischengespeichert und erst beim Klick auf „Extract" an den Server gesendet. Ohne Zustimmung nutzen Zusammenfassungen dieser Plattformen nur den Seitentext.',
    allow: 'Audioaufnahme erlauben',
    deny: 'Jetzt nicht',
  },
}

export function AudioConsentDialog() {
  const language = useAppStore((s) => s.language)
  const setAudioConsentRequired = useAppStore((s) => s.setAudioConsentRequired)
  const s = STRINGS[language]
  const [busy, setBusy] = useState(false)

  async function decide(granted: boolean) {
    setBusy(true)
    try {
      await chrome.runtime.sendMessage({ type: 'SET_AUDIO_CONSENT', granted })
    } catch {
      // Background unreachable — the dialog will reappear on the next prompt.
    }
    setAudioConsentRequired(false)
  }

  return (
    <div className={styles.overlay}>
      <div className={styles.dialog} role="alertdialog" aria-labelledby="audio-consent-title">
        <p id="audio-consent-title" className={styles.title}>{s.title}</p>
        <p className={styles.body}>{s.body}</p>
        <p className={styles.detail}>{s.detail}</p>
        <div className={styles.actions}>
          <button type="button" className={styles.denyBtn} onClick={() => decide(false)} disabled={busy}>
            {s.deny}
          </button>
          <button type="button" className={styles.allowBtn} onClick={() => decide(true)} disabled={busy}>
            {s.allow}
          </button>
        </div>
      </div>
    </div>
  )
}
