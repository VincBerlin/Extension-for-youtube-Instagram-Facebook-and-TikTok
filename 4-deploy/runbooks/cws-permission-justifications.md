# Chrome Web Store — Permission Justifications

Paste-ready texts for the "Privacy practices" tab of the CWS developer
dashboard. One entry per requested permission. Keep them in sync with
`extension/src/manifest.ts`.

## permissions

| Permission | Justification |
|---|---|
| `scripting` | Reads the YouTube player response (`window.ytInitialPlayerResponse`) on youtube.com pages only, to fetch the video's own caption track for summarization. No code is injected into non-YouTube pages. |
| `storage` | Stores the user's settings (AI provider configuration, language, theme), cached analysis results, video session state, and the Supabase auth token locally. Nothing is synced. |
| `tabs` | Detects when the active tab is one of the four supported video platforms (YouTube, TikTok, Instagram, Facebook) so the side panel can offer extraction. URLs of non-supported tabs are filtered out immediately and never processed or stored. |
| `sidePanel` | The entire UI lives in the Chrome side panel. |
| `tabCapture` | Captures the tab's audio on TikTok/Instagram/Facebook (platforms without caption tracks) so the user-initiated "Extract" action can transcribe and summarize the video. Capture requires explicit user consent (one-time dialog) and shows a recording indicator. |
| `offscreen` | Hosts the MediaRecorder for tab-audio capture — MV3 service workers cannot record audio directly. |
| `identity` | Google/OAuth sign-in via `launchWebAuthFlow` for the optional account/library feature. |
| `alarms` | A 30-second poll keeps caption context fresh and audio capture alive while a video plays with the side panel open; cleared when the panel closes or the video stops. |

## host_permissions

| Host pattern | Justification |
|---|---|
| youtube.com / youtu.be | Content script detects the video player and reads the page's own caption data for the video being watched. |
| tiktok.com / vm.tiktok.com | Content script detects video play/pause to manage audio-capture sessions. |
| instagram.com | Same as TikTok. |
| facebook.com / fb.watch | Same as TikTok. |

## Data-use disclosures (Privacy tab checkboxes)

Collected and transmitted to the developer's server (only when the user
clicks Extract):

- **Website content**: video title, URL, caption/transcript text, captured tab audio (audio only for TikTok/Instagram/Facebook).
- **Authentication information**: Supabase session token (when signed in); user-supplied AI provider API key (transit only — forwarded as a request header, never stored server-side).
- **User activity**: none beyond the video being summarized. Browsing history is NOT collected (non-platform tabs are filtered before processing).

Limited-use certification: all data is used solely to produce the
user-requested summary and is not sold, used for ads, or transferred to
third parties other than the user's selected AI provider.
