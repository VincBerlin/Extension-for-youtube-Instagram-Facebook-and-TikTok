# Specification Phase Instructions

This directory contains all specification artifacts for the resource-extractor project.

## Phase Status

The Specification phase was bootstrapped retroactively from existing code. Core goals and requirements are derived from the implemented architecture. Use `/SDLC-elicit` to refine or add artifacts.

## Decisions Relevant to This Phase

| ID | Decision | Trigger Condition |
|----|----------|-------------------|
| — | No formal decisions recorded yet | — |

## Goals Index

| File | ID | Status | Priority | Summary |
|------|----|--------|----------|---------|

## Requirements Index

| File | ID | Class | Status | Priority | Summary |
|------|----|----|--------|----------|---------|
| [REQ-SEC-server-owned-secrets.md](requirements/REQ-SEC-server-owned-secrets.md) | REQ-SEC-server-owned-secrets | SEC | Draft | Critical | No private vendor credential in extension bundle; all privileged vendor calls go through the backend. |
| [REQ-SEC-privileged-api-origin-restriction.md](requirements/REQ-SEC-privileged-api-origin-restriction.md) | REQ-SEC-privileged-api-origin-restriction | SEC | Draft | Critical | Privileged backend routes must use an explicit origin allowlist, not wildcard CORS. |
| [REQ-REL-extraction-transport-contract.md](requirements/REQ-REL-extraction-transport-contract.md) | REQ-REL-extraction-transport-contract | REL | Draft | Critical | Client and server must share one declared extraction route, protocol, and session-context strategy. |
| [REQ-REL-subscription-lifecycle-reconciliation.md](requirements/REQ-REL-subscription-lifecycle-reconciliation.md) | REQ-REL-subscription-lifecycle-reconciliation | REL | Draft | High | Billing identifiers and webhooks must reconcile deterministically to plan state. |

## User Stories Index

| File | ID | Status | Priority | Summary |
|------|----|--------|----------|---------|

## Constraints Index

| File | ID | Category | Status | Summary |
|------|----|----|--------|---------|
| [CON-production-trust-boundary.md](constraints/CON-production-trust-boundary.md) | CON-production-trust-boundary | Security / Deployment | Draft | Browser clients are untrusted; secrets stay server-side and privileged origins are explicitly restricted. |

## Assumptions Index

| File | ID | Status | Summary |
|------|----|----|---------|
