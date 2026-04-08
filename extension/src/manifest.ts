import { defineManifest } from '@crxjs/vite-plugin'

export default defineManifest({
  manifest_version: 3,
  name: 'Extract',
  version: '0.2.0',
  description: 'Pause a video — get instant structured insights. Works on YouTube, TikTok, Instagram and Facebook.',

  permissions: ['activeTab', 'scripting', 'storage', 'tabs', 'sidePanel', 'tabCapture', 'offscreen', 'identity'],
  host_permissions: [
    'https://www.youtube.com/*',
    'https://www.tiktok.com/*',
    'https://www.instagram.com/*',
    'https://www.facebook.com/*',
  ],

  action: {
    default_title: 'Open Extract',
  },

  side_panel: {
    default_path: 'src/sidepanel/index.html',
  },

  background: {
    service_worker: 'src/background/index.ts',
    type: 'module',
  },

  content_scripts: [
    {
      matches: ['https://www.youtube.com/*'],
      js: ['src/content/youtube.ts'],
      run_at: 'document_idle',
    },
    {
      matches: ['https://www.tiktok.com/*'],
      js: ['src/content/tiktok.ts'],
      run_at: 'document_idle',
    },
    {
      matches: ['https://www.instagram.com/*'],
      js: ['src/content/instagram.ts'],
      run_at: 'document_idle',
    },
    {
      matches: ['https://www.facebook.com/*'],
      js: ['src/content/facebook.ts'],
      run_at: 'document_idle',
    },
  ],

  icons: {
    '16': 'public/icon16.png',
    '48': 'public/icon48.png',
    '128': 'public/icon128.png',
  },
})
