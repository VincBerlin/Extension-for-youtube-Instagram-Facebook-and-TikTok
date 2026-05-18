import { defineManifest } from '@crxjs/vite-plugin'

export default defineManifest({
  manifest_version: 3,
  name: 'Extract',
  version: '0.2.0',
  description: 'Extract turns videos into clear summaries, topic blocks, related resources, timestamps, and saveable insights.',

  permissions: ['activeTab', 'scripting', 'storage', 'tabs', 'sidePanel', 'tabCapture', 'offscreen', 'identity', 'alarms'],
  host_permissions: [
    'https://www.youtube.com/*',
    'https://youtube.com/*',
    'https://youtu.be/*',
    'https://www.tiktok.com/*',
    'https://tiktok.com/*',
    'https://vm.tiktok.com/*',
    'https://www.instagram.com/*',
    'https://instagram.com/*',
    'https://www.facebook.com/*',
    'https://facebook.com/*',
    'https://fb.watch/*',
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
      matches: ['https://www.youtube.com/*', 'https://youtube.com/*', 'https://youtu.be/*'],
      js: ['src/content/youtube.ts'],
      run_at: 'document_idle',
    },
    {
      matches: ['https://www.tiktok.com/*', 'https://tiktok.com/*', 'https://vm.tiktok.com/*'],
      js: ['src/content/tiktok.ts'],
      run_at: 'document_idle',
    },
    {
      matches: ['https://www.instagram.com/*', 'https://instagram.com/*'],
      js: ['src/content/instagram.ts'],
      run_at: 'document_idle',
    },
    {
      matches: ['https://www.facebook.com/*', 'https://facebook.com/*', 'https://fb.watch/*'],
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
