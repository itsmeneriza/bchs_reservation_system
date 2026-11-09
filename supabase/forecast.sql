-- Historical and live facility forecast storage.
-- Run this once in Supabase SQL Editor after facilities, events, and reservations exist.

create table if not exists public.demand_forecasts (
  id bigserial primary key,
  facility_id text not null references public.facilities(id) on delete cascade,
  forecast_year integer not null,
  month_label text not null,
  month_num integer not null check (month_num between 1 and 12),
  week_label text not null check (week_label in ('W1', 'W2', 'W3', 'W4')),
  observed_pct numeric(5, 2) not null default 0,
  forecasted_pct numeric(5, 2) not null default 0,
  demand_tier text not null check (demand_tier in ('High', 'Moderate', 'Low')),
  anchor_event_note text not null default 'Historical activity and live bookings',
  is_eosy_vacation boolean not null default false,
  updated_at timestamptz not null default now(),
  unique (facility_id, forecast_year, month_num, week_label)
);

alter table public.demand_forecasts
  add column if not exists forecast_year integer;

update public.demand_forecasts
set forecast_year = 2026
where forecast_year is null;

alter table public.demand_forecasts
  alter column forecast_year set not null;

alter table public.demand_forecasts
  drop constraint if exists demand_forecasts_facility_id_month_num_week_label_key;

alter table public.demand_forecasts
  drop constraint if exists demand_forecasts_facility_year_month_week_key;

alter table public.demand_forecasts
  add constraint demand_forecasts_facility_year_month_week_key
  unique (facility_id, forecast_year, month_num, week_label);

alter table public.demand_forecasts enable row level security;
grant select on public.demand_forecasts to anon, authenticated;

drop policy if exists "Allow public read on demand_forecasts"
  on public.demand_forecasts;
create policy "Allow public read on demand_forecasts"
  on public.demand_forecasts
  for select
  to anon, authenticated
  using (true);

create or replace function public.recalculate_macro_forecasts()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  with years(year_value, weight) as (
    values (2024, 0.15::numeric), (2025, 0.30::numeric), (2026, 0.55::numeric)
  ),
  calendar(month_num, month_label, week_label) as (
    select month_num, to_char(make_date(2026, month_num, 1), 'Mon'), week_label
    from generate_series(1, 12) as month_values(month_num)
    cross join unnest(array['W1', 'W2', 'W3', 'W4']) as weeks(week_label)
  ),
  activity as (
    select
      e.facility_id,
      extract(year from occurrence_date)::integer as year_value,
      extract(month from occurrence_date)::integer as month_num,
      least(4, ((extract(day from occurrence_date)::integer - 1) / 7) + 1)::integer as week_num,
      greatest(1, extract(epoch from (e.end_time - e.start_time)) / 3600)::numeric as hours
    from public.events e
    cross join lateral generate_series(e.start_date, e.end_date, interval '1 day')
      as occurrences(occurrence_date)
    where extract(year from occurrence_date)::integer in (2024, 2025, 2026)
    union all
    select
      r.facility_id,
      extract(year from r.date)::integer,
      extract(month from r.date)::integer,
      least(4, ((extract(day from r.date)::integer - 1) / 7) + 1)::integer,
      greatest(1, extract(epoch from (r.end_time - r.start_time)) / 3600)::numeric
    from public.reservations r
    where lower(r.status) in ('approved', 'accepted', 'completed')
      and extract(year from r.date)::integer in (2024, 2025, 2026)
  ),
  yearly_hours as (
    select facility_id, year_value, month_num, week_num, sum(hours) as total_hours
    from activity
    group by facility_id, year_value, month_num, week_num
  ),
  rows_to_write as (
    select
      f.id as facility_id,
      2026 as forecast_year,
      c.month_label,
      c.month_num,
      c.week_label,
      least(100, round(coalesce(y2026.total_hours, 0) / 54 * 100, 2)) as observed_pct,
      greatest(
        0,
        least(
          100,
          round(
            coalesce(y2024.total_hours, 0) / 54 * 100 * 0.15
            + coalesce(y2025.total_hours, 0) / 54 * 100 * 0.30
            + coalesce(y2026.total_hours, 0) / 54 * 100 * 0.55
            + case
                when c.month_num in (4, 5) then -40
                when c.month_num = 9 then 15
                else 0
              end,
            2
          )
        )
      ) as forecasted_pct,
      c.month_num in (4, 5) as is_eosy_vacation
    from public.facilities f
    cross join calendar c
    left join yearly_hours y2024
      on y2024.facility_id = f.id
      and y2024.year_value = 2024
      and y2024.month_num = c.month_num
      and y2024.week_num = right(c.week_label, 1)::integer
    left join yearly_hours y2025
      on y2025.facility_id = f.id
      and y2025.year_value = 2025
      and y2025.month_num = c.month_num
      and y2025.week_num = right(c.week_label, 1)::integer
    left join yearly_hours y2026
      on y2026.facility_id = f.id
      and y2026.year_value = 2026
      and y2026.month_num = c.month_num
      and y2026.week_num = right(c.week_label, 1)::integer
  )
  insert into public.demand_forecasts (
    facility_id,
    forecast_year,
    month_label,
    month_num,
    week_label,
    observed_pct,
    forecasted_pct,
    demand_tier,
    anchor_event_note,
    is_eosy_vacation,
    updated_at
  )
  select
    facility_id,
    forecast_year,
    month_label,
    month_num,
    week_label,
    observed_pct,
    forecasted_pct,
    case
      when forecasted_pct >= 70 then 'High'
      when forecasted_pct >= 35 then 'Moderate'
      else 'Low'
    end,
    case
      when is_eosy_vacation then 'Mandatory EOSY vacation adjustment'
      when month_num = 9 then 'District 3 qualifier season adjustment'
      else 'Historical activity and live bookings'
    end,
    is_eosy_vacation,
    now()
  from rows_to_write
  on conflict (facility_id, forecast_year, month_num, week_label)
  do update set
    month_label = excluded.month_label,
    observed_pct = excluded.observed_pct,
    forecasted_pct = excluded.forecasted_pct,
    demand_tier = excluded.demand_tier,
    anchor_event_note = excluded.anchor_event_note,
    is_eosy_vacation = excluded.is_eosy_vacation,
    updated_at = now();
end;
$$;

-- Populate the table immediately when this script is run.
select public.recalculate_macro_forecasts();

create or replace function public.refresh_macro_forecasts_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.recalculate_macro_forecasts();
  return null;
end;
$$;

drop trigger if exists refresh_forecasts_after_event_change on public.events;
create trigger refresh_forecasts_after_event_change
after insert or update or delete on public.events
for each statement execute function public.refresh_macro_forecasts_trigger();

drop trigger if exists refresh_forecasts_after_reservation_change on public.reservations;
create trigger refresh_forecasts_after_reservation_change
after insert or update or delete on public.reservations
for each statement execute function public.refresh_macro_forecasts_trigger();
