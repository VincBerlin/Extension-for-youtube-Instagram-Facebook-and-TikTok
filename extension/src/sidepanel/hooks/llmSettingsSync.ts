// Pure predicate shared by every useLlmSettings instance: does a
// chrome.storage.onChanged event affect the public LLM settings?
//
// Only the PUBLIC settings key in the 'local' area counts. The secret key
// (llm_api_key) changes in the same save transaction and must not trigger a
// second redundant refresh; session-area changes are key-only too.

const LLM_SETTINGS_KEY = 'llm_settings'

export function isLlmSettingsChange(
  changes: Record<string, unknown>,
  areaName: string,
): boolean {
  return areaName === 'local' && LLM_SETTINGS_KEY in changes
}
