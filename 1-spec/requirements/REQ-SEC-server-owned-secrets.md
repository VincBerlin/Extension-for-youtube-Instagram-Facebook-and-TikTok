---
name: REQ-SEC-server-owned-secrets
description: No private vendor credential may be embedded in the extension bundle; all privileged vendor calls terminate on the backend server.
type: project
---

# Requirement: Server-owned secrets

## Status
Draft

## Class
REQ-SEC

## Priority
Critical

## Statement
The system shall ensure that no private vendor credential is embedded in the production browser extension bundle. All privileged calls to third-party vendors shall terminate on the backend, which injects secrets from server-side environment variables.

## Rationale
A private Superglue token was hardcoded in `extension/src/config/superglue.ts` and referenced from `background/index.ts` and `App.tsx`, causing it to be bundled into the installable extension package. This violates the architecture boundary stated in the root CLAUDE.md ("No secrets in the extension") and creates immediate abuse risk.

## Acceptance Criteria
1. Given a production extension build, when the bundle is inspected, then no private vendor token, Stripe secret, AI provider secret, or equivalent credential is present in shipped client code.
2. Given a user action that requires a privileged third-party operation, when the action executes, then the extension calls a first-party backend endpoint and the backend performs the vendor call using server-side secrets.
3. Given `extension/src/manifest.ts`, when reviewed, then `host_permissions` does not include third-party vendor API domains.

## Source
- CON-production-trust-boundary
