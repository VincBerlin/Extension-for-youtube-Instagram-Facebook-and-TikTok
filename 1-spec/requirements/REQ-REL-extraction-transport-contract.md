---
name: REQ-REL-extraction-transport-contract
description: Client and server must share one declared extraction route, response protocol, and session-context merge strategy.
type: project
---

# Requirement: Extraction transport contract

## Status
Draft

## Class
REQ-REL

## Priority
Critical

## Statement
The system shall maintain one declared client-to-server extraction contract. For every supported extraction flow (initial and follow-up segments), the extension and server shall agree on the endpoint path, request schema, response protocol, and how prior session context is merged into subsequent requests.

## Rationale
The follow-up audio append path (`appendExtractionAudio`) sent raw base64 audio as `new_transcript_chunk` to a text-only third-party endpoint, producing garbled output. The `runExtraction` function also omitted `sessionContext` from its payload, so the server received no information about prior extractions in the same session. The existing `getSessionContext` helper was defined but unused (`void getSessionContext`).

## Acceptance Criteria
1. Given an initial extraction request, when the background worker submits it, then it targets a route on the first-party server that exists and accepts the documented payload schema.
2. Given a follow-up extraction segment (audio or text), when the background worker submits it, then it uses the same first-party server route and includes the prior session's key takeaways as `sessionContext`.
3. Given a session with completed prior segments, when `sessionContext` is populated in the request, then the server prompt includes prior takeaways with "do not repeat" instructions.
4. Given a response from the streaming extraction route, when the client reads it, then the payload conforms to the SSE `chunk`/`done`/`error` event format.

## Source
- Production gap analysis
