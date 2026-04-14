---
name: CON-production-trust-boundary
description: Production browser clients are untrusted; private vendor credentials must stay server-side and privileged origins must be explicitly restricted.
type: project
---

# Constraint: Production trust boundary

## Status
Draft

## Category
Security / Deployment

## Statement
Production browser clients are untrusted. Private vendor credentials shall not be embedded in extension bundles, and privileged backend operations shall not be exposed to arbitrary web origins.

## Rationale
Chrome extensions ship as installable packages that can be inspected. Any secret bundled into the extension is effectively public. Wildcard CORS on privileged endpoints allows any webpage to trigger extraction or billing operations on behalf of an authenticated user.

## Affected Scope
- `extension/src/` — no private keys, no direct privileged vendor calls
- `server/src/index.ts` — CORS must use an explicit allowlist
- `server/src/routes/` — privileged routes must restrict allowed origins
- `extension/src/manifest.ts` — host_permissions must not include third-party vendor APIs

## Derived Requirements
- REQ-SEC-server-owned-secrets
- REQ-SEC-privileged-api-origin-restriction
