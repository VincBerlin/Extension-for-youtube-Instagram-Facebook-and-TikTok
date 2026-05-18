import { useEffect, useMemo, useState } from 'react'
import type { LlmProvider, LlmSettingsPublic, OpenRouterMode } from '@shared/types'
import { useLlmSettings } from '../hooks/useLlmSettings'
import { useAppStore } from '../store'
import styles from './LlmSetupModal.module.css'

interface Props {
  onClose: () => void
  onSaved?: () => void
  allowDismiss?: boolean
}

interface ProviderDef {
  id: LlmProvider
  name: string
  hint: { en: string; de: string }
  recommended?: boolean
  needsBaseUrl?: boolean
}

const PROVIDERS: ProviderDef[] = [
  { id: 'openrouter', name: 'OpenRouter', recommended: true, hint: { en: 'Free models, auto-routing', de: 'Kostenlose Modelle, Auto-Routing' } },
  { id: 'openai', name: 'OpenAI', hint: { en: 'GPT-4o, GPT-4o-mini', de: 'GPT-4o, GPT-4o-mini' } },
  { id: 'anthropic', name: 'Anthropic', hint: { en: 'Claude 3.5 family', de: 'Claude 3.5-Familie' } },
  { id: 'gemini', name: 'Google Gemini', hint: { en: 'Required for audio capture', de: 'Erforderlich für Audio' } },
  { id: 'openai-compatible', name: 'OpenAI-compatible', hint: { en: 'Self-hosted, custom URL', de: 'Self-hosted, eigene URL' }, needsBaseUrl: true },
]

interface UiStrings {
  title: string
  intro: string
  providerLabel: string
  apiKeyLabel: string
  apiKeyPlaceholder: string
  modelLabel: string
  modelPlaceholderDefault: string
  modelPlaceholderOR: string
  baseUrlLabel: string
  baseUrlPlaceholder: string
  rememberLabel: string
  rememberHint: string
  openrouterTitle: string
  openrouterBody: string
  modeFreeCascadeTitle: string
  modeFreeCascadeBody: string
  modeFreeRouterTitle: string
  modeFreeRouterBody: string
  modeCustomTitle: string
  modeCustomBody: string
  test: string
  testing: string
  testOk: string
  cancel: string
  save: string
  saving: string
  remove: string
  testRequired: string
}

const STRINGS: Record<'en' | 'de', UiStrings> = {
  en: {
    title: 'AI Setup',
    intro: 'Bring your own API key. Stored locally only — never sent to our servers or logged.',
    providerLabel: 'Provider',
    apiKeyLabel: 'API Key',
    apiKeyPlaceholder: 'sk-…',
    modelLabel: 'Model (optional)',
    modelPlaceholderDefault: 'Leave empty for default',
    modelPlaceholderOR: 'e.g. openrouter/free',
    baseUrlLabel: 'Base URL',
    baseUrlPlaceholder: 'https://your-host/v1',
    rememberLabel: 'Remember key across sessions',
    rememberHint: 'Unchecked: key is cleared when the browser closes.',
    openrouterTitle: 'OpenRouter (recommended)',
    openrouterBody:
      'Free tier with multiple models. We pick a working free model automatically — up to 3 attempts before giving up.',
    modeFreeCascadeTitle: 'Free auto-cascade',
    modeFreeCascadeBody: 'Try ranked free models in order. Recommended.',
    modeFreeRouterTitle: 'Free router',
    modeFreeRouterBody: 'Single call to openrouter/free.',
    modeCustomTitle: 'Custom model',
    modeCustomBody: 'Specify any model id from OpenRouter.',
    test: 'Test connection',
    testing: 'Testing…',
    testOk: '✓ Connection works',
    cancel: 'Cancel',
    save: 'Save',
    saving: 'Saving…',
    remove: 'Remove',
    testRequired: 'Test the connection before saving.',
  },
  de: {
    title: 'KI einrichten',
    intro: 'Eigener API-Key. Wird nur lokal gespeichert — niemals an unsere Server gesendet oder geloggt.',
    providerLabel: 'Anbieter',
    apiKeyLabel: 'API-Schlüssel',
    apiKeyPlaceholder: 'sk-…',
    modelLabel: 'Modell (optional)',
    modelPlaceholderDefault: 'Leer lassen für Standard',
    modelPlaceholderOR: 'z. B. openrouter/free',
    baseUrlLabel: 'Basis-URL',
    baseUrlPlaceholder: 'https://your-host/v1',
    rememberLabel: 'Schlüssel über Sitzungen merken',
    rememberHint: 'Nicht aktiv: Schlüssel wird beim Schließen des Browsers gelöscht.',
    openrouterTitle: 'OpenRouter (empfohlen)',
    openrouterBody:
      'Kostenlose Stufe mit mehreren Modellen. Wir wählen automatisch ein funktionierendes freies Modell — bis zu 3 Versuche.',
    modeFreeCascadeTitle: 'Frei (Auto-Cascade)',
    modeFreeCascadeBody: 'Versucht eine Rangliste freier Modelle. Empfohlen.',
    modeFreeRouterTitle: 'Frei (Router)',
    modeFreeRouterBody: 'Ein Aufruf an openrouter/free.',
    modeCustomTitle: 'Eigenes Modell',
    modeCustomBody: 'Beliebige Modell-ID von OpenRouter.',
    test: 'Verbindung testen',
    testing: 'Teste…',
    testOk: '✓ Verbindung funktioniert',
    cancel: 'Abbrechen',
    save: 'Speichern',
    saving: 'Speichere…',
    remove: 'Entfernen',
    testRequired: 'Bitte vor dem Speichern die Verbindung testen.',
  },
}

export function LlmSetupModal({ onClose, onSaved, allowDismiss = true }: Props) {
  const language = useAppStore((s) => s.language)
  const s = STRINGS[language]
  const { settings, save, remove, test } = useLlmSettings()

  const [provider, setProvider] = useState<LlmProvider>('openrouter')
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [openRouterMode, setOpenRouterMode] = useState<OpenRouterMode>('free-cascade')
  const [rememberKey, setRememberKey] = useState(false)
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'ok' | 'error'>('idle')
  const [testMessage, setTestMessage] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!settings) return
    if (settings.provider !== 'server-default') setProvider(settings.provider)
    setModel(settings.model ?? '')
    setBaseUrl(settings.baseUrl ?? '')
    setOpenRouterMode(settings.openRouterMode ?? 'free-cascade')
    setRememberKey(settings.rememberKey)
  }, [settings])

  const def = useMemo(() => PROVIDERS.find((p) => p.id === provider) ?? PROVIDERS[0]!, [provider])

  function resetTest() {
    if (testStatus !== 'idle') {
      setTestStatus('idle')
      setTestMessage(null)
    }
  }

  async function handleTest() {
    if (!apiKey.trim()) {
      setTestStatus('error')
      setTestMessage(language === 'de' ? 'API-Schlüssel fehlt.' : 'API key required.')
      return
    }
    if (def.needsBaseUrl && !baseUrl.trim()) {
      setTestStatus('error')
      setTestMessage(language === 'de' ? 'Basis-URL fehlt.' : 'Base URL required.')
      return
    }
    setTestStatus('testing')
    setTestMessage(null)
    try {
      const result = await test({
        provider,
        apiKey: apiKey.trim(),
        model: model.trim() || undefined,
        baseUrl: baseUrl.trim() || undefined,
        openRouterMode: provider === 'openrouter' ? openRouterMode : undefined,
      })
      if (result.ok) {
        setTestStatus('ok')
        setTestMessage(null)
      } else {
        setTestStatus('error')
        setTestMessage(result.message ?? result.code ?? 'Test failed')
      }
    } catch (err) {
      setTestStatus('error')
      setTestMessage((err as Error).message ?? 'Network error')
    }
  }

  async function handleSave() {
    if (testStatus !== 'ok') {
      setTestMessage(s.testRequired)
      setTestStatus('error')
      return
    }
    setSaving(true)
    const next: LlmSettingsPublic = {
      provider,
      model: model.trim() || undefined,
      baseUrl: baseUrl.trim() || undefined,
      openRouterMode: provider === 'openrouter' ? openRouterMode : undefined,
      rememberKey,
      configured: true,
      lastTestedAt: new Date().toISOString(),
    }
    const result = await save(next, apiKey.trim() || undefined)
    setSaving(false)
    if (result?.ok) {
      onSaved?.()
      onClose()
    } else {
      setTestStatus('error')
      setTestMessage(result?.error ?? 'Save failed')
    }
  }

  async function handleRemove() {
    setSaving(true)
    await remove()
    setSaving(false)
    onSaved?.()
    onClose()
  }

  const canSubmit = apiKey.trim().length > 0 && (!def.needsBaseUrl || baseUrl.trim().length > 0)

  return (
    <div className={styles.overlay} onClick={allowDismiss ? onClose : undefined}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <p className={styles.title}>{s.title}</p>
          {allowDismiss ? (
            <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="Close">×</button>
          ) : null}
        </div>
        <p className={styles.intro}>{s.intro}</p>

        <div className={styles.field}>
          <span className={styles.label}>{s.providerLabel}</span>
          <div className={styles.providerGrid}>
            {PROVIDERS.map((p) => (
              <button
                key={p.id}
                type="button"
                className={`${styles.providerCard} ${provider === p.id ? styles.providerCardActive : ''}`}
                onClick={() => { setProvider(p.id); resetTest() }}
              >
                <span className={styles.providerName}>
                  {p.name}
                  {p.recommended ? <span className={styles.recommendedBadge}>★</span> : null}
                </span>
                <span className={styles.providerHint}>{p.hint[language]}</span>
              </button>
            ))}
          </div>
        </div>

        {provider === 'openrouter' ? (
          <div className={styles.openrouterPanel}>
            <strong>{s.openrouterTitle}</strong>
            <p style={{ margin: '4px 0 0' }}>{s.openrouterBody}</p>
            <div className={styles.modeSelect}>
              <label className={styles.modeOption}>
                <input
                  type="radio"
                  name="orMode"
                  checked={openRouterMode === 'free-cascade'}
                  onChange={() => { setOpenRouterMode('free-cascade'); resetTest() }}
                />
                <span className={styles.modeOptionText}>
                  <strong>{s.modeFreeCascadeTitle}</strong>
                  <span>{s.modeFreeCascadeBody}</span>
                </span>
              </label>
              <label className={styles.modeOption}>
                <input
                  type="radio"
                  name="orMode"
                  checked={openRouterMode === 'free-router'}
                  onChange={() => { setOpenRouterMode('free-router'); resetTest() }}
                />
                <span className={styles.modeOptionText}>
                  <strong>{s.modeFreeRouterTitle}</strong>
                  <span>{s.modeFreeRouterBody}</span>
                </span>
              </label>
              <label className={styles.modeOption}>
                <input
                  type="radio"
                  name="orMode"
                  checked={openRouterMode === 'custom-model'}
                  onChange={() => { setOpenRouterMode('custom-model'); resetTest() }}
                />
                <span className={styles.modeOptionText}>
                  <strong>{s.modeCustomTitle}</strong>
                  <span>{s.modeCustomBody}</span>
                </span>
              </label>
            </div>
          </div>
        ) : null}

        <div className={styles.field}>
          <label className={styles.label} htmlFor="llm-key">{s.apiKeyLabel}</label>
          <input
            id="llm-key"
            className={styles.input}
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder={s.apiKeyPlaceholder}
            value={apiKey}
            onChange={(e) => { setApiKey(e.target.value); resetTest() }}
          />
        </div>

        {def.needsBaseUrl ? (
          <div className={styles.field}>
            <label className={styles.label} htmlFor="llm-base-url">{s.baseUrlLabel}</label>
            <input
              id="llm-base-url"
              className={styles.input}
              type="url"
              placeholder={s.baseUrlPlaceholder}
              value={baseUrl}
              onChange={(e) => { setBaseUrl(e.target.value); resetTest() }}
            />
          </div>
        ) : null}

        <div className={styles.field}>
          <label className={styles.label} htmlFor="llm-model">{s.modelLabel}</label>
          <input
            id="llm-model"
            className={styles.input}
            type="text"
            spellCheck={false}
            placeholder={provider === 'openrouter' ? s.modelPlaceholderOR : s.modelPlaceholderDefault}
            value={model}
            onChange={(e) => { setModel(e.target.value); resetTest() }}
          />
        </div>

        <label className={styles.checkboxRow}>
          <input
            type="checkbox"
            checked={rememberKey}
            onChange={(e) => setRememberKey(e.target.checked)}
          />
          <span className={styles.checkboxLabel}>
            {s.rememberLabel}
            <div className={styles.checkboxHint}>{s.rememberHint}</div>
          </span>
        </label>

        {testStatus === 'ok' ? <p className={styles.statusOk}>{s.testOk}</p> : null}
        {testStatus === 'error' && testMessage ? <p className={styles.statusError}>{testMessage}</p> : null}

        <div className={styles.actions}>
          {settings?.configured ? (
            <button type="button" className={styles.deleteBtn} onClick={handleRemove} disabled={saving}>
              {s.remove}
            </button>
          ) : <span />}
          <div className={styles.actionsRight}>
            <button
              type="button"
              className={styles.testBtn}
              onClick={handleTest}
              disabled={!canSubmit || testStatus === 'testing'}
            >
              {testStatus === 'testing' ? s.testing : s.test}
            </button>
            {allowDismiss ? (
              <button type="button" className={styles.cancelBtn} onClick={onClose} disabled={saving}>
                {s.cancel}
              </button>
            ) : null}
            <button
              type="button"
              className={styles.saveBtn}
              onClick={handleSave}
              disabled={!canSubmit || saving || testStatus !== 'ok'}
            >
              {saving ? s.saving : s.save}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
