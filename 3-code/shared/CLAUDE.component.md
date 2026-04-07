# Shared

**Responsibility**: Single source of truth for all TypeScript types shared between extension and server.

**Technology**: TypeScript (no build step, imported directly)

**Source**: [`../../shared/`](../../shared/)

## Interfaces

- **Import ← extension**: via `@shared/*` path alias (resolved in `extension/tsconfig.json` paths)
- **Import ← server**: via relative path `../../../shared/types.js` (resolved by `tsx` at runtime)

## Architecture Notes

- One file: `shared/types.ts` — never split, never duplicated in extension or server
- No package.json, no build output — both consumers import the `.ts` source directly
- Key types: `Platform`, `OutcomeMode`, `ExtractionStrategy`, `ExtractionStatus`, `Pack`, `User`, `Collection`, all message types (`YouTubeSignalMessage`, `LiveCaptureChunkMessage`, `PlatformDetectedMessage`, `ExtensionMessage`, `ExtractRequest`)

## Requirements Addressed

_None linked yet — populate after `/SDLC-elicit` runs._

## Relevant Decisions

_None recorded yet._
