/**
 * Tiny static i18n layer.
 *
 * The extension is bilingual (English/German) for chrome UI labels only — the
 * AI-generated summary content is never re-translated client-side. Strings are
 * keyed by short slugs and looked up against the active language. Falls back
 * to English if a key is missing in the German table.
 */

import { useAppStore } from './store'

export type Language = 'en' | 'de'

export const LANGUAGES: ReadonlyArray<{ code: Language; label: string }> = [
  { code: 'en', label: 'EN' },
  { code: 'de', label: 'DE' },
]

type Dict = Record<string, string>

const en: Dict = {
  // Top bar
  back: 'Back',
  account: 'Account',
  library: 'Library',
  profile: 'Profile',

  // Auth
  signIn: 'Sign in',
  signOut: 'Sign out',
  signedInAs: 'Signed in as',
  youAreSignedIn: 'You are signed in',
  pleaseSignIn: 'Please sign in to view your profile.',

  // Profile
  freePlan: 'Free',
  proPlan: 'Pro',
  plan: 'plan',
  displayName: 'Display name',
  preferredLanguage: 'Preferred language',
  defaultMode: 'Default extraction mode',
  saveChanges: 'Save changes',
  saving: 'Saving…',
  saved: 'Saved.',
  loadingProfile: 'Loading profile…',
  noProfile: 'No profile found.',
  couldNotLoadProfile: 'Could not load profile',
  retry: 'Retry',
  settings: 'Settings',
  showSettings: 'Show settings',
  hideSettings: 'Hide settings',

  // Library/dashboard sections
  folders: 'Folders',
  savedAnalyses: 'Saved analyses',
  savedItems: 'Saved items',
  noFolders: 'No folders yet. Create one when saving an analysis.',
  noAnalyses: 'No saved analyses yet.',
  noItems: 'No saved items yet. Use the checkboxes on an analysis to save the bits you care about.',
  newFolder: 'New folder',
  reload: 'Reload',
  loading: 'Loading…',
  errorLoadingLibrary: 'Could not load library',

  // Saving / extraction
  extract: 'Extract',
  newAnalysis: 'New Analysis',
  clear: 'Clear',
  saveSelected: 'Save Selected',
  saveFullAnalysis: 'Save Full Analysis',
  alreadySaved: 'Saved ✓',
  selectFirst: 'Select takeaways or links first',

  // Detail view
  videoUrl: 'Video URL',
  savedOn: 'Saved on',
  exportPdf: 'Export PDF',
  topicBlocks: 'Topic blocks',
  resources: 'Resources',
  setupGuide: 'Setup guide',
  warnings: 'Warnings',
  summary: 'Summary',
  showMore: 'Show more',
  showLess: 'Show less',
  otherResources: 'Other resources',
  showAllResources: 'Show all resources',
  showFewerResources: 'Show fewer resources',
  folder: 'Folder',
  folderColon: 'Folder:',
  noFolder: 'No folder',
  uncategorized: 'Uncategorized',
  inFolder: 'In folder',
  moveToFolder: 'Move to folder',
  currentFolder: 'Current folder',
  savedTo: 'Saved to',
  savedFolderFailed: 'Analysis saved, but folder assignment failed',
  movedToFolder: 'Moved to',
  removedFromFolder: 'Removed from folder',
  moveFailed: 'Move failed',

  // Delete
  delete: 'Delete',
  deletePackConfirm: 'Delete this saved analysis? This cannot be undone.',
  deleteFolderConfirm: 'Delete this folder? Saved analyses inside it will become uncategorized.',
  deleteFailed: 'Delete failed',
  deleted: 'Deleted.',

  // Misc
  open: 'Open',
  close: 'Close',
  error: 'Error',
  openVideoHint: 'Open a video to get started.',
  showingLastAnalysis: 'Showing last analysis',
  clickExtractInstant: 'Click Extract to analyze this video.',
  clickExtractLive: 'Audio is captured while the video plays (with your consent) — click Extract to analyze.',
  dismiss: 'Dismiss',
  stopAndAnalyze: 'Stop & Analyze',
  analyzing: 'Analyzing…',
  updating: 'Updating…',
  recording: 'Recording…',

  // URL validation states
  urlBrokenHint: 'Repository link could not be verified.',
  urlUnverifiedHint: 'Link not verified yet — open carefully.',
}

const de: Dict = {
  // Top bar
  back: 'Zurück',
  account: 'Konto',
  library: 'Bibliothek',
  profile: 'Profil',

  // Auth
  signIn: 'Anmelden',
  signOut: 'Abmelden',
  signedInAs: 'Angemeldet als',
  youAreSignedIn: 'Du bist eingeloggt',
  pleaseSignIn: 'Bitte melde dich an, um dein Profil zu sehen.',

  // Profile
  freePlan: 'Free',
  proPlan: 'Pro',
  plan: 'Tarif',
  displayName: 'Anzeigename',
  preferredLanguage: 'Bevorzugte Sprache',
  defaultMode: 'Standard-Extraktionsmodus',
  saveChanges: 'Änderungen speichern',
  saving: 'Speichern…',
  saved: 'Gespeichert.',
  loadingProfile: 'Profil wird geladen…',
  noProfile: 'Kein Profil gefunden.',
  couldNotLoadProfile: 'Profil konnte nicht geladen werden',
  retry: 'Erneut versuchen',
  settings: 'Einstellungen',
  showSettings: 'Einstellungen anzeigen',
  hideSettings: 'Einstellungen ausblenden',

  // Library/dashboard sections
  folders: 'Ordner',
  savedAnalyses: 'Gespeicherte Analysen',
  savedItems: 'Gespeicherte Einträge',
  noFolders: 'Noch keine Ordner. Lege beim Speichern einer Analyse einen an.',
  noAnalyses: 'Noch keine gespeicherten Analysen.',
  noItems: 'Noch keine gespeicherten Einträge. Nutze die Checkboxen, um Wichtiges zu sichern.',
  newFolder: 'Neuer Ordner',
  reload: 'Neu laden',
  loading: 'Wird geladen…',
  errorLoadingLibrary: 'Bibliothek konnte nicht geladen werden',

  // Saving / extraction
  extract: 'Extrahieren',
  newAnalysis: 'Neue Analyse',
  clear: 'Zurücksetzen',
  saveSelected: 'Auswahl speichern',
  saveFullAnalysis: 'Komplette Analyse speichern',
  alreadySaved: 'Gespeichert ✓',
  selectFirst: 'Wähle zuerst Bullets oder Links aus',

  // Detail view
  videoUrl: 'Video-URL',
  savedOn: 'Gespeichert am',
  exportPdf: 'Als PDF exportieren',
  topicBlocks: 'Themenblöcke',
  resources: 'Ressourcen',
  setupGuide: 'Einrichtungsanleitung',
  warnings: 'Warnungen',
  summary: 'Zusammenfassung',
  showMore: 'Mehr anzeigen',
  showLess: 'Weniger anzeigen',
  otherResources: 'Weitere Ressourcen',
  showAllResources: 'Alle Ressourcen anzeigen',
  showFewerResources: 'Weniger Ressourcen anzeigen',
  folder: 'Ordner',
  folderColon: 'Ordner:',
  noFolder: 'Kein Ordner',
  uncategorized: 'Unsortiert',
  inFolder: 'Im Ordner',
  moveToFolder: 'In Ordner verschieben',
  currentFolder: 'Aktueller Ordner',
  savedTo: 'Gespeichert in',
  savedFolderFailed: 'Analyse gespeichert, aber Ordnerzuweisung fehlgeschlagen',
  movedToFolder: 'Verschoben nach',
  removedFromFolder: 'Aus Ordner entfernt',
  moveFailed: 'Verschieben fehlgeschlagen',

  // Delete
  delete: 'Löschen',
  deletePackConfirm: 'Diese Analyse löschen? Das kann nicht rückgängig gemacht werden.',
  deleteFolderConfirm: 'Diesen Ordner löschen? Enthaltene Analysen bleiben erhalten, sind danach aber unsortiert.',
  deleteFailed: 'Löschen fehlgeschlagen',
  deleted: 'Gelöscht.',

  // Misc
  open: 'Öffnen',
  close: 'Schließen',
  error: 'Fehler',
  openVideoHint: 'Öffne ein Video, um loszulegen.',
  showingLastAnalysis: 'Letzte Analyse wird angezeigt',
  clickExtractInstant: 'Klicke auf Extrahieren, um dieses Video zu analysieren.',
  clickExtractLive: 'Audio wird während der Wiedergabe aufgenommen (mit deiner Zustimmung) — klicke auf Extrahieren zum Analysieren.',
  dismiss: 'Schließen',
  stopAndAnalyze: 'Stoppen & analysieren',
  analyzing: 'Analysiere…',
  updating: 'Aktualisiere…',
  recording: 'Aufnahme…',

  // URL validation states
  urlBrokenHint: 'Repository-Link konnte nicht verifiziert werden.',
  urlUnverifiedHint: 'Link nicht verifiziert — vorsichtig öffnen.',
}

const TABLES: Record<Language, Dict> = { en, de }

export type TKey = keyof typeof en

export function translate(lang: Language, key: TKey): string {
  return TABLES[lang][key] ?? en[key] ?? String(key)
}

/**
 * React hook returning a `t(key)` function bound to the active language.
 * Components automatically re-render when the user switches languages.
 */
export function useT(): (key: TKey) => string {
  const lang = useAppStore((s) => s.language)
  return (key) => translate(lang, key)
}
