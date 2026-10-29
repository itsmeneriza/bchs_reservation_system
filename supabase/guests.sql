-- Run this in Supabase Dashboard > SQL Editor after public.guests exists.
-- Guest login creates a record automatically when a phone number is new.

alter table public.guests
  add column if not exists mobile_number text;

create unique index if not exists guests_mobile_number_unique
  on public.guests (mobile_number);
