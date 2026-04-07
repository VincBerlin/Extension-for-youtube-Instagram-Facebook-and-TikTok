-- ============================================================================
-- Migration 001: Initial Schema
-- Project: resource-extractor
-- Apply in: Supabase SQL Editor (Dashboard → SQL Editor → New query)
-- ============================================================================

-- ─── profiles ────────────────────────────────────────────────────────────────
-- One row per auth user. Created automatically via trigger on signup.
-- plan: 'free' (default) | 'pro' (after subscription)

create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  plan        text not null default 'free' check (plan in ('free', 'pro')),
  created_at  timestamptz not null default now()
);

-- Auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id)
  values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ─── packs ───────────────────────────────────────────────────────────────────
-- Extracted content packs saved by users.

create table if not exists public.packs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  title       text not null,
  url         text not null,
  platform    text not null check (platform in ('youtube', 'tiktok', 'instagram', 'facebook', 'unknown')),
  mode        text not null check (mode in ('build-pack', 'decision-pack', 'coach-notes', 'tools', 'stack', 'knowledge')),
  bullets     jsonb not null default '[]',
  saved_at    timestamptz not null default now()
);

create index if not exists packs_user_id_saved_at_idx on public.packs (user_id, saved_at desc);

-- ─── resources ───────────────────────────────────────────────────────────────
-- Individual resources saved by users (referenced from collection_items).

create table if not exists public.resources (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  url         text not null,
  label       text not null default '',
  tags        jsonb not null default '[]',
  saved_at    timestamptz not null default now()
);

create index if not exists resources_user_id_idx on public.resources (user_id);

-- ─── collections ─────────────────────────────────────────────────────────────
-- Named collections that group packs and resources.

create table if not exists public.collections (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  name        text not null,
  created_at  timestamptz not null default now()
);

create index if not exists collections_user_id_idx on public.collections (user_id);

-- ─── collection_items ────────────────────────────────────────────────────────
-- Join table: a collection contains ordered references to packs or resources.
-- useLibrary fetches these via: select('*, collection_items(*)')

create table if not exists public.collection_items (
  id              uuid primary key default gen_random_uuid(),
  collection_id   uuid not null references public.collections (id) on delete cascade,
  type            text not null check (type in ('pack', 'resource')),
  ref_id          uuid not null,  -- FK to packs.id or resources.id (not enforced, type determines table)
  position        integer not null default 0,
  created_at      timestamptz not null default now()
);

create index if not exists collection_items_collection_id_idx on public.collection_items (collection_id, position);

-- ============================================================================
-- Row Level Security
-- ============================================================================

alter table public.profiles       enable row level security;
alter table public.packs          enable row level security;
alter table public.resources      enable row level security;
alter table public.collections    enable row level security;
alter table public.collection_items enable row level security;

-- profiles: users can read and update only their own profile
create policy "profiles: own read"   on public.profiles for select using (auth.uid() = id);
create policy "profiles: own update" on public.profiles for update using (auth.uid() = id);

-- packs: users can read, insert, and delete only their own packs
create policy "packs: own read"   on public.packs for select using (auth.uid() = user_id);
create policy "packs: own insert" on public.packs for insert with check (auth.uid() = user_id);
create policy "packs: own delete" on public.packs for delete using (auth.uid() = user_id);

-- resources: users can read, insert, and delete only their own resources
create policy "resources: own read"   on public.resources for select using (auth.uid() = user_id);
create policy "resources: own insert" on public.resources for insert with check (auth.uid() = user_id);
create policy "resources: own delete" on public.resources for delete using (auth.uid() = user_id);

-- collections: users can read, insert, update, and delete only their own collections
create policy "collections: own read"   on public.collections for select using (auth.uid() = user_id);
create policy "collections: own insert" on public.collections for insert with check (auth.uid() = user_id);
create policy "collections: own update" on public.collections for update using (auth.uid() = user_id);
create policy "collections: own delete" on public.collections for delete using (auth.uid() = user_id);

-- collection_items: access derived from parent collection ownership
create policy "collection_items: own read" on public.collection_items
  for select using (
    exists (
      select 1 from public.collections c
      where c.id = collection_id and c.user_id = auth.uid()
    )
  );

create policy "collection_items: own insert" on public.collection_items
  for insert with check (
    exists (
      select 1 from public.collections c
      where c.id = collection_id and c.user_id = auth.uid()
    )
  );

create policy "collection_items: own delete" on public.collection_items
  for delete using (
    exists (
      select 1 from public.collections c
      where c.id = collection_id and c.user_id = auth.uid()
    )
  );
