# Permission Justifications — Chrome Web Store submission

This file maps every manifest permission and host permission to the
user-facing reason that must be entered in the Chrome Web Store
"Privacy practices" → "Permission justifications" section. Each block is
self-contained so it can be pasted verbatim into the form.

## `storage`

Stores UI preferences (theme, language), the user's optional LLM
configuration, and — when explicitly opted in — the API key for the chosen
LLM provider. No analytics or third-party identifiers are stored.

## `sidePanel`

The extension's analysis UI runs inside the Chrome side panel. The side
panel is opened by the user and remains alongside the active tab; no UI is
injected into the page itself.

## `activeTab`

When the user clicks Extract, the extension reads the URL and title of the
currently active tab to identify the video being analysed. No background
data collection happens on inactive tabs.

## `tabs`

Detects when the user switches to a supported video tab so the side panel
can show the correct platform badge and prepare the audio buffer for the
next Extract click. The extension only reads tab URL and title — page
contents are never read through this permission.

## `scripting`

Used to read the public YouTube player data (`ytInitialPlayerResponse`)
from the active tab so that the transcript can be passed to the AI model.
The script runs only when the user clicks Extract on a YouTube tab and
only on the supported video hosts listed below.

## `tabCapture`

Captures the audio stream of the active tab on TikTok, Instagram and
Facebook so that a short audio snippet can be sent to a multimodal AI model
for transcription. Capture starts only after the user has the side panel
open on a supported platform and can be stopped by closing the side panel.

## `offscreen`

Hosts the audio recorder (MediaRecorder) used together with `tabCapture` in
an offscreen document because Manifest V3 service workers cannot use the
DOM media APIs. The offscreen document holds no UI and only runs while
audio capture is active.

## `identity`

Used to support Supabase OAuth-style sign-in when applicable. The user must
explicitly initiate sign-in; no identity flow runs in the background.

## `alarms`

A short repeated alarm is used to re-attach to the YouTube player after the
service worker is suspended by Chrome. The alarm only runs while a YouTube
analysis is in progress.

## Host permissions

### `https://www.youtube.com/*`, `https://youtube.com/*`, `https://youtu.be/*`

YouTube content scripts read the public video metadata (title, current
playback time, transcript). The extension does not interact with the user's
YouTube account.

### `https://www.tiktok.com/*`, `https://tiktok.com/*`, `https://vm.tiktok.com/*`

TikTok content script signals the side panel when a video page is open and
co-operates with `tabCapture` to record a short audio snippet on Extract
click.

### `https://www.instagram.com/*`, `https://instagram.com/*`

Same purpose as the TikTok host — Reels detection and audio snippet capture.

### `https://www.facebook.com/*`, `https://facebook.com/*`, `https://fb.watch/*`

Same purpose as the TikTok host — Facebook Watch/Reels detection and audio
snippet capture.

## Backend communication

The extension talks only to the Extract backend (`VITE_API_BASE`, declared
in the build) and to the LLM provider that the user has selected. Both URLs
use HTTPS in production. The backend is operated by the Extract team; the
LLM provider is operated by OpenRouter, OpenAI, Anthropic, Google or a
user-specified OpenAI-compatible host.
