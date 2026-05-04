-- ============================================================================
-- Migration 003: Real user profiles
-- Project: resource-extractor
-- Apply in: Supabase SQL Editor (Dashboard → SQL Editor → New query)
--
-- Extends the existing `profiles` table from migration 001 with real profile
-- fields: email (mirrored from auth.users for fast joins), display_name,
-- preferred_language, default_mode, updated_at.
-- ============================================================================

alter table public.profiles
  add column if not exists email              text,
  add column if not exists display_name       text,
  add column if not exists preferred_language text not null default 'en',
  add column if not exists default_mode       text not null default 'knowledge'
    check (default_mode in ('build-pack', 'decision-pack', 'coach-notes', 'tools', 'stack', 'knowledge')),
  add column if not exists updated_at         timestamptz not null default now();

-- Backfill email from auth.users for existing profiles
update public.profiles p
set email = u.email
from auth.users u
where p.id = u.id and p.email is null;

-- Auto-update updated_at on every change
create or replace function public.profiles_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists profiles_updated_at on public.profiles;
create trigger profiles_updated_at
  before update on public.profiles
  for each row execute procedure public.profiles_set_updated_at();

-- Update the new-user trigger to populate email at signup
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;

-- Allow users to update their own profile (was only select before for some columns)
drop policy if exists "profiles: own update" on public.profiles;
create policy "profiles: own update" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- profiles: allow users to insert their own row (defensive — trigger usually does it)
drop policy if exists "profiles: own insert" on public.profiles;
create policy "profiles: own insert" on public.profiles
  for insert with check (auth.uid() = id);
