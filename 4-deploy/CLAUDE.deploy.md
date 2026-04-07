# Deploy Phase Instructions

This directory contains deployment runbooks, IaC, and operations documentation.

## Phase Status

Not yet started. Server is running locally at `http://localhost:3000`. Extension is loaded unpacked from `extension/dist/`.

## Deployment Targets

| Component | Target | Status |
|-----------|--------|--------|
| Chrome Extension | Chrome Web Store | Not published |
| Server | TBD (e.g. Railway, Render, Fly.io) | Not deployed |

## Runbooks Index

| File | Purpose | Status |
|------|---------|--------|
| [smoke-test.md](runbooks/smoke-test.md) | Phase 1–3 Smoke Test: Schema migrieren, Server starten, Extension laden, Szenarien A–I | Active |
| [deploy-render.md](runbooks/deploy-render.md) | Phase 4: Server auf Render deployen, Extension als ZIP paketieren | Active |
| [deploy-stripe.md](runbooks/deploy-stripe.md) | Phase 5: Stripe Setup, Test-Checkout, Chrome Web Store Submission | Active |

## Infrastructure Index

| File | Purpose | Status |
|------|---------|--------|
| [render.yaml](scripts/render.yaml) | Render deployment config (copy to repo root) | Ready |

## Scripts Index

| File | Purpose | Status |
|------|---------|--------|
| [001_initial_schema.sql](scripts/001_initial_schema.sql) | Initiales Supabase-Schema: profiles, packs, resources, collections, collection_items mit RLS | Applied |
| [002_guest_rate_limit.sql](scripts/002_guest_rate_limit.sql) | guest_extractions + user_extractions für persistentes Rate-Limiting | Ready to apply |
