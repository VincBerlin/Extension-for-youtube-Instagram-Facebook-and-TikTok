import { useEffect } from 'react'
import type { ExtensionMessage, PlatformDetectedMessage, Pack } from '@shared/types'
import { detectMode } from '@shared/types'
import { useAppStore } from '../store'

export function usePlatformListener() {
  const {
    setPlatformState,
    setSelectedMode,
    setExtractionStatus,
    setExtractionError,
    setLatestPack,
    updateStreamingPack,
    setSession,
    setAudioCaptureActive,
    setAudioConsentRequired,
  } = useAppStore()

  useEffect(() => {
    function handleMessage(message: ExtensionMessage) {
      console.log('[EXTRACT-DEBUG] sidepanel: incoming runtime message | type:', message.type)
      switch (message.type) {
        case 'PLATFORM_DETECTED': {
          const m = message as PlatformDetectedMessage
          // Important: do NOT clear the visible analysis on URL change.
          // The background broadcasts a CURRENT_ANALYSIS right after PLATFORM_DETECTED
          // with either the cached pack for the new URL or null. The UI updates
          // accordingly, so the previous result stays visible until replaced.
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
        case 'CURRENT_ANALYSIS': {
          // Background tells us which pack belongs to the active URL. We only
          // hydrate when there is a pack — never auto-clear on URL change. The
          // user must press the explicit "Clear" button to remove visible state.
          if (message.pack) {
            setLatestPack(message.pack as Pack)
          }
          break
        }
        case 'EXTRACTION_PROGRESS':
          setExtractionStatus('extracting', message.percent, message.statusText)
          break
        case 'EXTRACTION_STREAMING':
          updateStreamingPack(message.pack)
          break
        case 'EXTRACTION_COMPLETE':
          console.log('[EXTRACT-DEBUG] sidepanel: EXTRACTION_COMPLETE | packId:', message.pack.id, '| key_takeaways:', message.pack.key_takeaways?.length ?? 0, '| hasV2:', !!message.pack.v2)
          setLatestPack(message.pack)
          break
        case 'EXTRACTION_ERROR':
          console.warn('[EXTRACT-DEBUG] sidepanel: EXTRACTION_ERROR | message:', message.message, '| isHint:', !!message.isHint)
          setExtractionError(message.message, message.isHint)
          break
        case 'SESSION_UPDATE':
          setSession(message.session)
          break
        case 'AUDIO_CAPTURE_STATE':
          setAudioCaptureActive(message.active)
          break
        case 'AUDIO_CONSENT_REQUIRED':
          setAudioConsentRequired(true)
          break
      }
    }

    chrome.runtime.onMessage.addListener(handleMessage)

    // Hydrate on panel open: platform + session + cached analysis (so the panel
    // re-opens already showing the last analysis instead of a blank state).
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

    chrome.runtime.sendMessage({ type: 'GET_CURRENT_ANALYSIS' }, (entry) => {
      if (entry?.pack) setLatestPack(entry.pack as Pack)
    })

    return () => chrome.runtime.onMessage.removeListener(handleMessage)
  }, [setPlatformState, setExtractionStatus, setExtractionError, setLatestPack, updateStreamingPack, setSession, setSelectedMode, setAudioCaptureActive, setAudioConsentRequired])
}
