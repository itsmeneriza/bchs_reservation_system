-- Run this in Supabase Dashboard > SQL Editor after the facilities table exists.
-- This stores facility-user reservation requests in Supabase while preserving
-- the existing reservation payload used by the app.

create table if not exists public.reservations (
  id bigserial primary key,
  reservation_code varchar(50) not null unique,
  facility_id text references public.facilities(id) on update cascade on delete restrict,
  user_type varchar(20) not null check (user_type in ('staff', 'guest')),
  staff_id uuid references public.staffs(id) on delete set null,
  guest_id uuid references public.guests(id) on delete set null,
  source varchar(20) not null check (source in ('staff', 'guest', 'walk_in')),
  name varchar(100) not null,
  email varchar(255),
  contact varchar(20) not null,
  is_staff boolean not null default false,
  date date not null,
  start_time time not null,
  end_time time not null,
  attendees integer,
  purpose varchar(255),
  additional_notes text,
  status varchar(30) not null default 'pending' check (status in ('pending', 'approved', 'accepted', 'rejected', 'refused', 'cancelled', 'completed', 'blocked')),
  payment_status varchar(30) not null default 'pending' check (payment_status in ('pending', 'paid', 'unpaid')),
  appointment_date date,
  appointment_time varchar(50),
  total_amount numeric(10,2) not null default 0.00,
  down_payment_paid boolean not null default false,
  remaining_balance_paid boolean not null default false,
  block_reschedule_pending boolean not null default false,
  block_reschedule_reason text,
  admin_edit_snapshot jsonb,
  request_data jsonb not null default '{}'::jsonb,
  submitted_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (start_time < end_time)
);

create index if not exists idx_reservations_status on public.reservations (status);
create index if not exists idx_reservations_facility_date on public.reservations (facility_id, date);
create index if not exists idx_reservations_user on public.reservations (staff_id, guest_id);
create index if not exists idx_reservations_source on public.reservations (source);

create or replace function public.update_reservations_modified_column()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_update_reservations_modified on public.reservations;
create trigger trg_update_reservations_modified
before update on public.reservations
for each row
execute function public.update_reservations_modified_column();

create or replace function public.prevent_reservation_time_conflicts()
returns trigger as $$
begin
  if new.status = 'blocked' then
    return new;
  end if;

  if new.status not in ('pending', 'approved', 'accepted') then
    return new;
  end if;

  if tg_op = 'UPDATE'
    and new.facility_id is not distinct from old.facility_id
    and new.date is not distinct from old.date
    and new.start_time is not distinct from old.start_time
    and new.end_time is not distinct from old.end_time
    and (
      new.status = old.status
      or old.status in ('pending', 'approved', 'accepted')
    ) then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtext(new.date::text)::bigint);

  if exists (
    select 1
    from public.reservations existing
    where existing.reservation_code <> new.reservation_code
      and existing.date = new.date
      and existing.status in ('pending', 'approved', 'accepted', 'blocked')
      and (
        existing.facility_id is null
        or new.facility_id is null
        or existing.facility_id = new.facility_id
      )
      and existing.start_time < new.end_time
      and existing.end_time > new.start_time
  ) then
    raise exception 'reservation_time_conflict'
      using errcode = 'P0001';
  end if;

  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_prevent_reservation_time_conflicts on public.reservations;
create trigger trg_prevent_reservation_time_conflicts
before insert or update on public.reservations
for each row
execute function public.prevent_reservation_time_conflicts();

alter table public.reservations enable row level security;

drop policy if exists "Public read reservations" on public.reservations;
drop policy if exists "Guests can insert reservations" on public.reservations;
drop policy if exists "Users can update their reservations" on public.reservations;
drop policy if exists "Users can delete their reservations" on public.reservations;
drop policy if exists "Public insert reservations" on public.reservations;
drop policy if exists "Public update reservations" on public.reservations;
drop policy if exists "Public delete reservations" on public.reservations;

revoke all on public.reservations from public, anon, authenticated;
grant select, insert, update, delete on public.reservations to service_role;
grant usage, select on sequence public.reservations_id_seq to service_role;
