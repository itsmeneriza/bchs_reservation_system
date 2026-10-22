-- Run this in Supabase Dashboard > SQL Editor after public.facilities exists
-- and contains the facility rows used by your events.

create table if not exists public.events (
  id text primary key,
  title text not null,
  event_date date not null,
  start_time time not null,
  end_time time not null,
  facility_id text not null references public.facilities(id),
  description text not null default '',
  image text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (start_time < end_time)
);

alter table public.events drop column if exists attendees;

alter table public.events enable row level security;
alter table public.facilities enable row level security;

grant select on public.events to anon, authenticated;
grant insert, update, delete on public.events to authenticated;
grant select on public.facilities to anon, authenticated;

drop policy if exists "Enable insert for authenticated users only"
  on public.events;
drop policy if exists "Allow public read of events"
  on public.events;
drop policy if exists "Public read events"
  on public.events;
drop policy if exists "Admins can insert events"
  on public.events;
drop policy if exists "Admins can update events"
  on public.events;
drop policy if exists "Admins can delete events"
  on public.events;
drop policy if exists "Public read facilities"
  on public.facilities;

create policy "Public read events"
  on public.events
  for select
  to anon, authenticated
  using (true);

create policy "Admins can insert events"
  on public.events
  for insert
  to authenticated
  with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

create policy "Admins can update events"
  on public.events
  for update
  to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

create policy "Admins can delete events"
  on public.events
  for delete
  to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

create policy "Public read facilities"
  on public.facilities
  for select
  to anon, authenticated
  using (true);
