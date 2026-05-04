-- ============================================================================
-- Migration 004: Full Pack payload
-- Project: resource-extractor
-- Apply in: Supabase SQL Editor (Dashboard → SQL Editor → New query)
--
-- Extends `packs` so saved entries keep the full extraction payload (summary,
-- keywords, relevant_points, important_links, quick_facts and the V2 contract).
-- Existing rows keep working — all new columns are nullable / default empty.
-- ============================================================================

alter table public.packs
  add column if not exists summary          text,
  add column if not exists keywords         jsonb not null default '[]',
  add column if not exists relevant_points  jsonb not null default '[]',
  add column if not exists important_links  jsonb not null default '[]',
  add column if not exists quick_facts      jsonb,
  add column if not exists v2               jsonb;

comment on column public.packs.summary         is 'Short 1-line topic statement.';
comment on column public.packs.keywords        is 'String[] of section titles / topical keywords.';
comment on column public.packs.relevant_points is 'String[] of supporting points across sections.';
comment on column public.packs.important_links is 'RelatedLink[] — { title, url, description }.';
comment on column public.packs.quick_facts     is 'QuickFacts — { platform, category, content_type }.';
comment on column public.packs.v2              is 'Full ExtractionPackV2 payload (sections, resources, setup_guide, source_coverage, warnings).';
