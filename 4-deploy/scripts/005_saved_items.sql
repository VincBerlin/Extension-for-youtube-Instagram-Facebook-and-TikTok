-- ============================================================================
-- Migration 005: Selective save (saved_items)
-- Project: resource-extractor
-- Apply in: Supabase SQL Editor (Dashboard → SQL Editor → New query)
--
-- A `saved_items` row stores ONE selectable artefact extracted from a video:
-- a key takeaway, a section, a resource, a setup step, a command — or, when
-- `item_type` is 'full_analysis', the whole pack as a single bookmark. Users
-- pick what to keep instead of saving everything.
--
-- Storage strategy:
--   - `payload` jsonb holds the artefact verbatim (no normalization needed).
--   - `pack_id` (nullable) points back to the originating pack when one was
--     also saved; otherwise the saved item is standalone.
--   - `item_type` is constrained to a known set so queries / filters stay
--     sane. The allowed values are aligned with the V2 extraction contract
--     (key_takeaways, sections, resources, setup_guide.steps,
--     setup_guide.commands) plus a 'full_analysis' alias for the whole pack.
--
-- RLS: a user can only see / write their own rows. Service role bypasses RLS
-- by default, so server-side inserts (with service-role key) still work.
--
-- IMPORTANT: this migration is idempotent — `if not exists` on the table and
-- `drop policy if exists` ensure re-running is safe.
-- ============================================================================

create table if not exists public.saved_items (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  pack_id      uuid references public.packs(id) on delete set null,
  item_type    text not null check (item_type in (
    'takeaway',
    'section',
    'resource',
    'setup_step',
    'command',
    'full_analysis'
  )),
  payload      jsonb not null,
  video_url    text,
  video_title  text,
  mode         text,
  created_at   timestamptz not null default now()
);

create index if not exists idx_saved_items_user_created
  on public.saved_items (user_id, created_at desc);

create index if not exists idx_saved_items_pack
  on public.saved_items (pack_id);

alter table public.saved_items enable row level security;

drop policy if exists "saved_items: own rows readable"   on public.saved_items;
drop policy if exists "saved_items: own rows insertable" on public.saved_items;
drop policy if exists "saved_items: own rows updatable"  on public.saved_items;
drop policy if exists "saved_items: own rows deletable"  on public.saved_items;

create policy "saved_items: own rows readable"
  on public.saved_items for select
  using (auth.uid() = user_id);

create policy "saved_items: own rows insertable"
  on public.saved_items for insert
  with check (auth.uid() = user_id);

create policy "saved_items: own rows updatable"
  on public.saved_items for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "saved_items: own rows deletable"
  on public.saved_items for delete
  using (auth.uid() = user_id);

comment on table  public.saved_items              is 'Per-artefact bookmarks — selective alternative to saving the entire pack.';
comment on column public.saved_items.item_type    is 'Artefact type: takeaway, section, resource, setup_step, command, full_analysis.';
comment on column public.saved_items.payload      is 'Verbatim artefact JSON; shape depends on `item_type`.';
comment on column public.saved_items.pack_id      is 'Originating pack (nullable — set if the user also saved the full pack).';
comment on column public.saved_items.video_url    is 'Source video URL — used for grouping in Library.';
comment on column public.saved_items.video_title  is 'Source video title — display label.';
comment on column public.saved_items.mode         is 'Extraction mode used (knowledge / build-pack / etc.).';
