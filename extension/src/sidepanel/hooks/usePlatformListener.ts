import { useEffect } from 'react'
import type { ExtensionMessage, PlatformDetectedMessage } from '@shared/types'
import { useAppStore } from '../store'

/**
 * Listens for messages from the background service worker and syncs
 * platform state + extraction progress/results into the store.
 */
export function usePlatformListener() {
  const {
    setPlatformState,
    setExtractionStatus,
    setExtractionResult,
    setExtractionError,
  } = useAppStore()

  useEffect(() => {
    function handleMessage(message: ExtensionMessage) {
      switch (message.type) {
        case 'PLATFORM_DETECTED': {
          const m = message as PlatformDetectedMessage
          setPlatformState({
            platform: m.platform,
            url: m.url,
            title: m.title,
            strategy: m.strategy,
            signal: m.signal,
          })
          break
        }
        case 'EXTRACTION_PROGRESS':
          setExtractionStatus('extracting', message.percent, message.statusText)
          break
        case 'EXTRACTION_COMPLETE':
          setExtractionResult(message.pack)
          break
        case 'EXTRACTION_ERROR':
          setExtractionError(message.message, message.upgradeRequired)
          break
      }
    }

    chrome.runtime.onMessage.addListener(handleMessage)

    // Request current platform state on mount (panel may open after tab was already detected)
    chrome.runtime.sendMessage({ type: 'GET_CURRENT_PLATFORM' }, (response) => {
      if (response) {
        setPlatformState({
          platform: response.platform,
          url: response.url,
          title: response.title,
          strategy: response.strategy,
          signal: response.signal,
        })
      }
    })

    return () => {
      chrome.runtime.onMessage.removeListener(handleMessage)
    }
  }, [setPlatformState, setExtractionStatus, setExtractionResult, setExtractionError])
}
