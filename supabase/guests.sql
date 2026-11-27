-- Run this in Supabase Dashboard > SQL Editor after public.guests exists.
-- Guest accounts are created through the signup form.

alter table public.guests
  add column if not exists mobile_number text;

alter table public.guests
  add column if not exists full_name text;

alter table public.guests
  add column if not exists email text;

create unique index if not exists guests_mobile_number_unique
  on public.guests (mobile_number);
