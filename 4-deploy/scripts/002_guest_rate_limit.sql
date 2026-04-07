-- ============================================================================
-- Migration 002: Persistent Rate Limiting
-- Project: resource-extractor
-- Apply in: Supabase SQL Editor (Dashboard → SQL Editor → New query)
-- ============================================================================

-- ─── guest_extractions ───────────────────────────────────────────────────────
-- Tracks extraction requests from unauthenticated (guest) users by IP.
-- Server-side only — no RLS needed (accessed via service role key).

create table if not exists public.guest_extractions (
  ip          text not null,
  extracted_at timestamptz not null default now()
);

create index if not exists guest_extractions_ip_extracted_at_idx
  on public.guest_extractions (ip, extracted_at desc);

-- ─── user_extractions ────────────────────────────────────────────────────────
-- Tracks extraction requests from authenticated users.
-- Used for plan-based daily limits (free plan: 10/day, pro: unlimited).

create table if not exists public.user_extractions (
  user_id     uuid not null references auth.users (id) on delete cascade,
  extracted_at timestamptz not null default now()
);

create index if not exists user_extractions_user_id_extracted_at_idx
  on public.user_extractions (user_id, extracted_at desc);

-- No RLS — both tables are only accessed server-side via service role key.
-- Do NOT enable RLS on these tables.
