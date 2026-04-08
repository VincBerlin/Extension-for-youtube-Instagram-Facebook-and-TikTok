import { useEffect } from 'react'
import type { ExtensionMessage, PlatformDetectedMessage } from '@shared/types'
import { detectMode } from '@shared/types'
import { useAppStore } from '../store'

export function usePlatformListener() {
  const {
    setPlatformState,
    setSelectedMode,
    setExtractionStatus,
    setExtractionError,
    setLatestPack,
    setSession,
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
          if (m.platform !== 'unknown') {
            setSelectedMode(m.detectedMode)
          }
          break
        }
        case 'EXTRACTION_PROGRESS':
          setExtractionStatus('extracting', message.percent, message.statusText)
          break
        case 'EXTRACTION_COMPLETE':
          setLatestPack(message.pack)
          break
        case 'EXTRACTION_ERROR':
          setExtractionError(message.message, message.upgradeRequired, message.isHint)
          break
        case 'SESSION_UPDATE':
          setSession(message.session)
          break
      }
    }

    chrome.runtime.onMessage.addListener(handleMessage)

    // Hydrate on panel open
    chrome.runtime.sendMessage({ type: 'GET_CURRENT_PLATFORM' }, (response) => {
      if (response) {
        setPlatformState({
          platform: response.platform,
          url: response.url,
          title: response.title,
          strategy: response.strategy,
          signal: response.signal,
        })
        if (response.platform !== 'unknown') {
          setSelectedMode(detectMode(response.title))
        }
      }
    })

    chrome.runtime.sendMessage({ type: 'GET_SESSION' }, (session) => {
      if (session) setSession(session)
    })

    return () => chrome.runtime.onMessage.removeListener(handleMessage)
  }, [setPlatformState, setExtractionStatus, setExtractionError, setLatestPack, setSession])
}
