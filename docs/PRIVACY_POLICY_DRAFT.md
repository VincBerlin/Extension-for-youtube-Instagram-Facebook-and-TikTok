# Privacy Policy — Extract (Chrome Extension)

_Last updated: 2026-06-10_

This is a draft privacy policy for the Extract Chrome Extension. It must be
hosted at a public URL and linked from the Chrome Web Store listing before
submission. Replace placeholder contact details with the real ones prior to
publication.

## Who we are

Extract is published by the Extract development team. Contact:
`schnetzer.vincent@gmail.com`.

## What Extract does

Extract is a browser extension that turns videos on supported platforms into
structured summaries. The user opens the side panel on a supported video page
and clicks **Extract**. The extension reads context from the active tab and
sends it to a large language model (LLM) to produce a structured analysis.

Extract only observes the four supported video platforms (YouTube, TikTok,
Instagram, Facebook). URLs and titles of other tabs are filtered out
immediately and never processed or stored.

## Audio capture (TikTok, Instagram, Facebook)

These platforms provide no caption track, so summaries are produced from the
tab's audio. How this works:

- Audio capture requires the user's **explicit one-time consent**, requested
  in a dialog before the first capture ever starts. Without consent, no audio
  is recorded — summaries then use page text only.
- After consent, audio is recorded **while a video is playing and the side
  panel is open**, so that a later Extract click can analyze it. A visible
  recording indicator is shown in the side panel during capture.
- Recorded audio is **buffered locally** in the browser. It leaves the device
  only when the user clicks **Extract** — then the buffered segment is sent
  to the Extract backend for transcription/analysis.
- Capture stops when the side panel closes, the video stops, or the tab
  navigates away. YouTube tab audio is never captured.

Transcripts, titles, and all other data likewise leave the device only as
part of a user-initiated Extract request.

## Data that is collected and processed

While the user is interacting with the extension, the following data leaves
the user's browser:

| Data | Purpose | Destination |
| --- | --- | --- |
| Video URL of the active tab | Identifies the analysed video | Extract backend |
| Video title and platform | Used as prompt context | Extract backend → LLM |
| Public transcript or captions (when available) | Input to the LLM | Extract backend → LLM |
| Captured tab audio (TikTok, Instagram, Facebook — only after consent, transmitted only on Extract click) | Input to a multimodal LLM | Extract backend → LLM (Google Gemini only) |
| User account ID (when signed in) | Linking the analysis to a user account, plan limits | Extract backend, Supabase |
| AI extraction results (the produced summary) | Storage in the user library | Extract backend, Supabase |
| BYOK API key (optional, if the user provides one) | Calling the user-selected LLM provider | The user-selected LLM provider only — **never** stored on our servers |

We do not collect:

- Form input on the video page
- Page contents outside the supported video platforms
- Identifiers beyond the Supabase auth account ID
- Advertising identifiers, click streams, or browsing history

## Local storage on the user's device

- **`chrome.storage.local`** — UI preferences (theme, language), the audio
  consent decision, the optional LLM configuration (provider, model, base
  URL, mode), and the API key when "Remember key" is enabled.
- **`chrome.storage.session`** — the API key when "Remember key" is disabled;
  it is cleared automatically when the browser session ends.
- **`chrome.storage.local` (Supabase session)** — the user's Supabase access
  token while signed in.

API keys never leave the user's device unless they are needed for an
extraction request to the user-selected LLM provider. They are sent through
HTTPS headers (`X-LLM-API-Key`) and are never written to request bodies,
server logs, or our database.

## Transmission to LLM providers

When the user has configured Bring-Your-Own-Key (BYOK), prompt content (video
title, transcript or audio snippet, AI mode) and the user's API key are
forwarded by the Extract backend to the chosen provider:

- OpenRouter (`https://openrouter.ai`)
- OpenAI (`https://api.openai.com`)
- Anthropic (`https://api.anthropic.com`)
- Google Gemini (`https://generativelanguage.googleapis.com`)
- An OpenAI-compatible base URL the user explicitly specifies

The chosen provider applies its own privacy policy and data retention rules.
Extract does not control or audit that provider.

When the user has **not** configured BYOK and the server is run with a
default API key, that key belongs to the Extract operator and the provider's
policy applies to the operator's account.

## Authentication and the user library

When the user signs in, Supabase Authentication stores the user's email and
account ID. Saved summaries, collections, and saved items are persisted in
Supabase tables owned by the Extract project. Row-level security restricts
access to the owning user.

## Plan limits and abuse protection

The Extract backend enforces daily usage limits per IP address (guests) and
per user ID (signed-in users). The most recent extraction timestamps are
recorded for this purpose and are not used for any other reason. BYOK usage
is also rate-limited to prevent abuse of our infrastructure.

## Cookies and tracking

Extract does not set cookies and does not run analytics, tracking pixels, or
fingerprinting.

## Data retention

- Local browser storage persists until the user clears it or removes the
  extension.
- Supabase rows persist until the user deletes them or requests deletion.
- LLM provider retention is governed by the provider, not by Extract.

## Deletion and access requests

Sign in to the extension and use the library view to delete individual saved
items or full analyses. For full account deletion, contact
`schnetzer.vincent@gmail.com`.

## Changes

We will update this policy when the data flow changes. The page is dated at
the top.
