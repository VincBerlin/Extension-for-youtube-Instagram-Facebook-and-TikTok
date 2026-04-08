import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'

// Notify background that the side panel is open so audio capture can start
chrome.runtime.sendMessage({ type: 'SIDEPANEL_OPENED' }).catch(() => {})

// Notify background when the side panel is closed
window.addEventListener('beforeunload', () => {
  chrome.runtime.sendMessage({ type: 'SIDEPANEL_CLOSED' }).catch(() => {})
})

const root = document.getElementById('root')!
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
)
