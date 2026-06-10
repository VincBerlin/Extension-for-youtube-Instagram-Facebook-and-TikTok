// Localized status/error strings the background worker sends to the panel.
// The worker has no access to the React i18n table, so it keeps this minimal
// one and reads the panel-seeded language from chrome.storage.local
// ('extract_language', written by the side panel store on load and on every
// language switch).

export type BgMessageKey =
  | 'readingTranscript'
  | 'analyzingFullVideo'
  | 'noTranscript'
  | 'noAudioRecorded'
  | 'noAudioFallback'
  | 'analyzingContent'
  | 'creatingSummary'
  | 'extractionInterrupted'
  | 'timeoutRetry'
  | 'unknownError'
  | 'videoChangedAborted'

export const BG_MESSAGES: Record<'en' | 'de', Record<BgMessageKey, string>> = {
  en: {
    readingTranscript: 'Reading transcript…',
    analyzingFullVideo: 'Analyzing the full video…',
    noTranscript: 'No transcript found. Enable YouTube captions (CC button) for this video and try again.',
    noAudioRecorded: 'No audio recorded. Play the video, click Extract, wait a few seconds, then pause.',
    noAudioFallback: 'No audio in the buffer — trying the server fallback…',
    analyzingContent: 'Analyzing content…',
    creatingSummary: 'Creating summary…',
    extractionInterrupted: 'Extraction interrupted. Please try again.',
    timeoutRetry: 'Timeout. Please try again.',
    unknownError: 'Unknown error',
    videoChangedAborted: 'Video changed — extraction cancelled. Click Extract on the new video.',
  },
  de: {
    readingTranscript: 'Transcript wird gelesen…',
    analyzingFullVideo: 'Vollständiges Video wird analysiert…',
    noTranscript: 'Kein Transcript gefunden. Aktiviere die YouTube-Untertitel (CC-Taste) für dieses Video und versuche es erneut.',
    noAudioRecorded: 'Kein Audio aufgezeichnet. Starte das Video, klicke Extract, warte einige Sekunden, dann pausiere.',
    noAudioFallback: 'Kein Audio im Puffer — versuche Server-Fallback…',
    analyzingContent: 'Analysiere Inhalt…',
    creatingSummary: 'Erstelle Zusammenfassung…',
    extractionInterrupted: 'Extraktion unterbrochen. Versuche es erneut.',
    timeoutRetry: 'Timeout. Versuche es erneut.',
    unknownError: 'Unbekannter Fehler',
    videoChangedAborted: 'Video gewechselt — Extraktion abgebrochen. Klicke beim neuen Video auf Extract.',
  },
}

export function resolveBgMessage(key: BgMessageKey, language: unknown): string {
  const lang = language === 'de' ? 'de' : 'en'
  return BG_MESSAGES[lang][key]
}

// Cached because bgMessage fires per streaming chunk — one storage read per
// chunk would be wasteful. Invalidated when the panel switches language.
let cachedLanguage: 'en' | 'de' | null = null

if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && 'extract_language' in changes) cachedLanguage = null
  })
}

export async function bgMessage(key: BgMessageKey): Promise<string> {
  if (cachedLanguage === null) {
    try {
      const stored = await chrome.storage.local.get('extract_language')
      cachedLanguage = stored.extract_language === 'de' ? 'de' : 'en'
    } catch {
      return resolveBgMessage(key, 'en')
    }
  }
  return BG_MESSAGES[cachedLanguage][key]
}
