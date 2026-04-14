---
name: REQ-SEC-privileged-api-origin-restriction
description: Privileged backend endpoints must not use wildcard CORS; only approved origins may call extraction and billing routes.
type: project
---

# Requirement: Privileged API origin restriction

## Status
Draft

## Class
REQ-SEC

## Priority
Critical

## Statement
The system shall restrict browser-originated access to privileged backend endpoints to an explicit allowlist of approved origins and shall not use wildcard CORS for production extraction, billing, or account-affecting routes.

## Rationale
The server is configured with `cors({ origin: '*' })`, which allows any webpage to make credentialed requests to `/extract`, `/stripe/checkout`, and other privileged endpoints. For a paid SaaS backend this broadens the abuse surface unnecessarily.

## Acceptance Criteria
1. Given a request from an unapproved web origin to `/extract` or `/stripe/checkout`, when the request is made, then the server does not return permissive CORS headers for that origin.
2. Given a request from an approved origin (chrome-extension or explicitly listed domain), when the request is made, then the server returns the minimal required CORS headers.
3. Given a production deployment, when server configuration is reviewed, then allowed origins are environment-driven and not hardcoded to `*`.

## Source
- CON-production-trust-boundary
