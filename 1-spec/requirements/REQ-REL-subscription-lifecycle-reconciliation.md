---
name: REQ-REL-subscription-lifecycle-reconciliation
description: Billing identifiers and webhook events must reconcile deterministically to plan state; checkout errors must be handled.
type: project
---

# Requirement: Subscription lifecycle reconciliation

## Status
Draft

## Class
REQ-REL

## Priority
High

## Statement
The system shall persist the external billing identifiers required to reconcile checkout completion, cancellation, and payment failure events to a user's plan state, and shall handle billing API errors without unhandled rejections.

## Rationale
The `checkout.session.completed` webhook upgraded a user's plan but did not persist `stripe_customer_id` or `stripe_subscription_id`. The `customer.subscription.deleted` handler looked up the user by `stripe_customer_id` — a column that was never populated — making subscription cancellation silently non-functional. Checkout session creation also had no error handling, allowing Stripe API errors or misconfigured price IDs to produce unhandled rejections.

## Acceptance Criteria
1. Given a successful checkout session, when the completion webhook is processed, then the user profile stores both `stripe_customer_id` and `stripe_subscription_id`.
2. Given a subscription cancellation event, when the webhook is processed, then the system can resolve the affected user via `stripe_customer_id` and transition their plan to `free`.
3. Given a billing API error during checkout session creation, when the request fails, then the server returns a structured error response and logs the failure — no unhandled rejection.
4. Given `profiles.stripe_customer_id`, when checked, then it is unique across rows so that cancellation lookups are unambiguous.

## Source
- Production gap analysis
