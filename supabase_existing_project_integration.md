# Supabase Integration Guide for the Existing BCHS Reservation Project

This companion guide keeps the core workflow in [core_reservation.md](./core_reservation.md)
but explains how to adapt it to this repository instead of building a separate
starter. The workflow remains: user sign-in, facility selection, availability
check, reservation request, user cancellation, and administrator approval or
rejection.

This is an integration plan and safe migration guide, not authorization to
replace the current application or run schema changes against a live database.
The repository already has several JSON-backed features and existing Supabase
tables may have unknown schemas. Back up the data and inspect the Supabase
project before applying any SQL.

## 1. Current project state to account for

The current application is a hybrid:

- `server.js` serves the static user/admin pages and mounts `/api/auth`.
- `routes/auth.js` calls `scripts/AuthService.js`.
- `scripts/AuthService.js` looks up staff in a `staffs` table and reads or
  creates guests in a `guests` table.
- The user reservation UI still uses JSON-backed API contracts such as
  `/api/requests`, `/api/accepted`, and `/api/facilities`.
- `routes/requests.js`, `routes/history.js`, `routes/forecast.js`,
  `routes/notifications.js`, and `routes/chat.js` are CommonJS route factories
  that read/write JSON files.
- `package.json` declares `"type": "module"`, while several backend files use
  `require()` and `module.exports`. Those files must be converted to ES modules
  or isolated as CommonJS before mounting them from the ESM server.
- `user/src/services/supabaseClient.js` reads `process.env` in browser code.
  Static browser JavaScript does not automatically receive Node's `.env`
  variables. Do not put a service-role key in this file.

**Important authentication gap:** the current login form asks for a phone
number or staff ID, and the current auth route performs a database lookup. A
phone number or staff ID by itself is not proof of identity. Before protecting
reservation writes, replace this with real Supabase Auth (recommended here:
email/password for all accounts, with staff roles stored in a database profile)
or implement a complete verified OTP flow. Never treat knowledge of a staff ID
as authentication.

## 2. Integration principles

1. Keep the current application working while the new database-backed API is
   developed.
2. Do not rename or drop existing tables until their schema and use are known.
3. Do not run two write paths for the same reservation (JSON and Supabase).
   Pick one canonical store after a tested cutover.
4. Keep request/response shapes expected by existing calendar components where
   possible; translate Supabase rows at the API boundary.
5. Derive the authenticated user and staff/admin role from a verified Supabase
   session. Ignore user IDs and roles supplied in request bodies.
6. Keep the Supabase service-role key on the server only. Browser code may use a
   publishable/anon key only when Row Level Security policies are correct.
7. Preserve events, email, forecast, history, and admin workflows when moving
   reservations. They are related, but are not automatically migrated by this
   guide.

## 3. Repository file plan

| File | Integration change |
|---|---|
| `package.json` | Keep ES modules. Convert any backend CommonJS modules before loading them into `server.js`. |
| `.env` (local only) | Store Supabase URL, anon key, service-role key, and port. Never commit this file. |
| `services/supabaseClient.js` | Make this the single server-only Supabase client using the service-role key. |
| `user/src/services/supabaseClient.js` | Remove Node `process.env` usage. Use Supabase Auth only with a public key supplied at build/runtime, or remove this client if auth is proxied through the server. |
| `scripts/AuthService.js` | Replace lookup-only login with Supabase Auth sign-in and profile/role lookup. |
| `routes/auth.js` | Add real sign-up/sign-in or OTP verification endpoints; return a session/token only after Supabase Auth verifies credentials. |
| `routes/supabaseReservations.js` (new) | Add database-backed facility, availability, reservation, cancellation, and admin review endpoints. Keep it separate while testing. |
| `server.js` | Mount the new ESM router without disturbing static file serving; only switch API traffic after validation. |
| `user/src/services/authService.js` | Send real credentials to Supabase Auth and maintain/refresh the verified access token. |
| `user/src/services/requestService.js` | Attach the access token to reservation API calls and handle `401`, `403`, and `409` responses. |
| `user/src/services/dataService.js` | Adapt Supabase-backed API fields into the existing calendar object shape; stop silently treating a database error as an empty dataset. |
| `user/src/services/reservationService.js` | Keep client-side conflict checks for responsiveness, but rely on the database transaction for the final conflict check. |
| `admin/js/data.js` and admin mutation files | Add authenticated admin requests and map admin status changes to the database review endpoint. |
| `data/*.json` | Keep as a backup/seed source until migration and cutover are explicitly verified. |

### Existing JSON route APIs

The current reservation client expects these paths and response keys:

- `GET /api/facilities` → `{ facilities: [...] }`
- `GET /api/requests` → `{ requests: [...] }`
- `POST /api/requests` → creates a pending request
- `GET /api/accepted` → `{ accepted: [...] }`
- `POST /api/accepted` and `PATCH /api/requests/:id` → admin workflow
- `GET/POST/PUT/DELETE /api/events` → school events

The endpoint list is visible in `routes/requests.js`. Keep these contracts or
update all callers in the same release. This integration guide recommends
keeping the first three read/write contracts while deriving `accepted` from
database reservation records with an approved status. Keep school `events`
separate initially; they are not the same as user-submitted reservations.

## 4. Supabase setup before changing application code

### Step 1: Inspect the existing Supabase project

In Supabase Dashboard, inspect **Table Editor**, **Authentication → Users**,
**Authentication → Providers**, and **SQL Editor**. Record:

- Existing schemas/columns for `staffs`, `guests`, `facilities`, or
  reservation-related tables
- Primary keys and foreign keys
- Existing RLS policies and grants
- Whether Auth users already correspond to staff or guest records
- Whether the current project contains production records

Do not assume that similarly named tables have the columns in the sample below.
Do not run `DROP`, destructive `ALTER`, or cleanup statements to make the example
fit an existing database.

### Step 2: Configure Auth

For the recommended email/password model:

1. Enable Email in Supabase Auth providers.
2. Set site URL and allowed redirect URLs for local and deployed applications.
3. Decide whether email confirmation is required.
4. Create regular users through Supabase Auth.
5. Promote verified staff accounts to the `admin` role using a trusted SQL
   session or protected administrative process.

The existing phone/staff-ID-only form needs to change. A staff ID can be used as
a profile lookup after sign-in, but must not be the credential. If the
organization requires phone-only login, implement and test Supabase phone OTP
including code verification, resend limits, and abuse controls before migration.

### Step 3: Add the environment variables

Add these to the local `.env` file, which must stay ignored by Git:

```dotenv
PORT=3000
SUPABASE_URL=https://YOUR_PROJECT_ID.supabase.co
SUPABASE_ANON_KEY=YOUR_PUBLIC_ANON_OR_PUBLISHABLE_KEY
SUPABASE_SERVICE_ROLE_KEY=YOUR_PRIVATE_SERVICE_ROLE_OR_SECRET_KEY
```

The project `.gitignore` already ignores `.env*`. Verify with `git status` that
the real `.env` file is not staged. Use the hosting provider's secret-variable
settings in deployed environments.

## 5. Database model for a compatibility-first migration

The following example uses new `core_` table names to avoid colliding with
unknown existing tables. The reservation record stores the original request
payload in `request_data` so the API can gradually adapt the existing
calendar/admin shape. It does not migrate school events.

Review the sample data and constraints against the existing business rules
before running this SQL. Run it in a development Supabase project first.

### `core_schema.sql`

```sql
-- Link every application profile to a real Supabase Auth user.
create table if not exists public.core_profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  role text not null default 'user' check (role in ('user', 'admin')),
  created_at timestamptz not null default now()
);

-- Keep the existing frontend facility IDs (e.g. "auditorium") as text IDs.
create table if not exists public.core_facilities (
  id text primary key,
  name text not null,
  capacity integer not null check (capacity > 0),
  price_per_hour numeric(10, 2) not null default 0
    check (price_per_hour >= 0),
  min_pax integer not null default 1 check (min_pax > 0),
  is_active boolean not null default true
);

-- The JSONB payload preserves fields that the calendar/admin currently display.
-- Normalized columns are authoritative for identity, time, and status.
create table if not exists public.core_reservations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id),
  facility_id text not null references public.core_facilities (id),
  start_at timestamptz not null,
  end_at timestamptz not null,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'cancelled', 'blocked')),
  request_data jsonb not null default '{}'::jsonb,
  submitted_at timestamptz not null default now(),
  reviewed_by uuid references auth.users (id),
  reviewed_at timestamptz,
  check (end_at > start_at)
);

create index if not exists core_reservations_facility_time_idx
  on public.core_reservations (facility_id, start_at, end_at);

create index if not exists core_reservations_user_time_idx
  on public.core_reservations (user_id, submitted_at desc);

-- New sign-ups receive a regular profile. Never accept a role from the client.
create or replace function public.core_create_profile()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.core_profiles (user_id, email, role)
  values (new.id, coalesce(new.email, ''), 'user')
  on conflict (user_id) do update
    set email = excluded.email;
  return new;
end;
$$;

drop trigger if exists core_auth_user_created on auth.users;
create trigger core_auth_user_created
  after insert on auth.users
  for each row execute procedure public.core_create_profile();

alter table public.core_profiles enable row level security;
alter table public.core_facilities enable row level security;
alter table public.core_reservations enable row level security;

-- The project server uses the service-role key for this API. Direct browser
-- writes are intentionally not granted. Add direct-client policies only after
-- a separate review of each policy and every role.
revoke insert, update, delete
  on public.core_profiles, public.core_facilities, public.core_reservations
  from anon, authenticated;

-- One database lock per facility makes the conflict check and insert atomic.
create or replace function public.core_submit_reservation(
  p_user_id uuid,
  p_facility_id text,
  p_start_at timestamptz,
  p_end_at timestamptz,
  p_request_data jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  new_id uuid;
  facility_capacity integer;
  attendees integer;
begin
  if p_start_at <= now() or p_end_at <= p_start_at then
    raise exception 'Invalid reservation time';
  end if;

  attendees := nullif(p_request_data->>'attendees', '')::integer;
  if attendees is null or attendees <= 0 then
    raise exception 'Attendee count must be positive';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_facility_id), 0);

  select capacity into facility_capacity
  from public.core_facilities
  where id = p_facility_id and is_active = true;

  if facility_capacity is null then
    raise exception 'Facility is unavailable';
  end if;
  if attendees > facility_capacity then
    raise exception 'Attendee count exceeds facility capacity';
  end if;

  if exists (
    select 1 from public.core_reservations
    where facility_id = p_facility_id
      and status in ('pending', 'approved', 'blocked')
      and start_at < p_end_at
      and end_at > p_start_at
  ) then
    raise exception 'Time slot already reserved';
  end if;

  insert into public.core_reservations (
    user_id, facility_id, start_at, end_at, status, request_data
  )
  values (
    p_user_id, p_facility_id, p_start_at, p_end_at, 'pending', p_request_data
  )
  returning id into new_id;

  return new_id;
end;
$$;

revoke all on function public.core_submit_reservation(
  uuid, text, timestamptz, timestamptz, jsonb
) from public, anon, authenticated;
grant execute on function public.core_submit_reservation(
  uuid, text, timestamptz, timestamptz, jsonb
) to service_role;

-- Seed the stable facility IDs used by the existing browser components.
insert into public.core_facilities (id, name, capacity, price_per_hour, min_pax)
values
  ('auditorium', 'Auditorium', 700, 1800, 100),
  ('library', 'Library', 100, 1000, 40),
  ('grounds', 'Grounds', 180, 700, 50),
  ('avr', 'AVR', 150, 500, 30),
  ('gym', 'Gym', 300, 1000, 50)
on conflict (id) do nothing;
```

The backend's service-role client bypasses RLS, so route-level authentication
and authorization in the next section are mandatory. RLS is not a substitute
for protecting the Express API.

### Promote the first administrator

First create and verify the staff account through Supabase Auth. Then run this
trusted SQL using the exact account email:

```sql
update public.core_profiles
set role = 'admin'
where user_id = (
  select id
  from auth.users
  where lower(email) = lower('admin@example.com')
  limit 1
);
```

Do not add a public self-service role-change endpoint.

## 6. Server-side Supabase client changes

`services/supabaseClient.js` is the server client. It currently falls back to
the service-role key if the anon key is missing; make the intent explicit and
fail fast when the private key is absent:

```js
import { createClient } from '@supabase/supabase-js';

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error(
    'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required on the server.',
  );
}

export const supabaseAdmin = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  },
);
```

Update server-side imports to use `supabaseAdmin`. Do not share this module with
browser code. `user/src/services/supabaseClient.js` must either be removed from
browser imports or initialized separately with a public anon key through an
intentional frontend configuration mechanism. A static page does not resolve
Node's `process.env`.

## 7. Backend API additions and current `server.js`

### Resolve the module-format mismatch first

The project declares `"type": "module"` in `package.json`; therefore a `.js`
file using `require()` and `module.exports` cannot be imported as an ordinary
ES module. Before mounting `routes/requests.js` or other legacy routes, choose
and test one of these strategies:

1. Convert the server-side route and its dependencies to ES modules; or
2. Move the legacy CommonJS backend into an isolated directory with its own
   `package.json` declaring `"type": "commonjs"`, and ensure all of its required
   dependencies are CommonJS-compatible.

For the Supabase core API, prefer a new ESM router
(`routes/supabaseReservations.js`) so the migration can proceed without
rewriting all legacy JSON routes at once. Do not mount both the legacy and new
reservation routers on the same write paths.

### Mounting the new router

Keep the existing static file-serving middleware and `/api/auth` mounting.
After creating and testing the new router, add it to `server.js`:

```js
import supabaseReservationsRouter from './routes/supabaseReservations.js';

// Keep the existing static routes and auth router.
app.use('/api', supabaseReservationsRouter);
```

The new router should expose the contracts below. Mount it only once. If the
legacy `requests.js` is later converted and mounted, remove or change duplicate
routes.

### Required router behavior

Implement these endpoints in `routes/supabaseReservations.js`:

| Method and path | Access | Database operation |
|---|---|---|
| `GET /api/facilities` | Public | List active `core_facilities`, map snake_case to current `id`, `name`, `capacity`, `pricePerHour`, `minPax`. |
| `GET /api/requests` | Signed-in user; admin sees all | List own pending/non-approved records; admins may list all. Return the existing `{ requests: [...] }` shape. |
| `GET /api/accepted` | Signed-in user; admin sees all | Select approved records and return `{ accepted: [...] }`. |
| `POST /api/requests` | Signed-in user | Ignore submitted `id`, `status`, and user identity; call `core_submit_reservation` with verified `req.user.id`. Return `409` for overlap. |
| `PATCH /api/requests/:id` | Admin only | Validate allowed status transition and update review fields. |
| `DELETE /api/requests/:id` | Owner for pending requests or admin | Update status to cancelled; do not physically delete an audit record. |
| `DELETE /api/accepted/:id` | Admin only | Cancel/revoke an approved reservation according to policy. |
| `GET /api/events` | Existing event policy | Keep current event implementation until events are deliberately migrated. |

Every protected endpoint must:

1. Read `Authorization: Bearer <access-token>`.
2. Verify the token with Supabase Auth `auth.getUser(token)`.
3. Load the user's role from `core_profiles`.
4. Return `401` when the session is missing/invalid and `403` when the role is
   insufficient.
5. Never trust `userId`, `role`, or an approved status supplied by the browser.

The database `core_submit_reservation` function is the final conflict guard.
Client-side `findConflict()` improves the interface but must not be treated as
enforcement; two users can submit at the same time.

### Compatibility adapter for existing frontend records

The calendar currently uses camelCase and date/time fields (such as
`facilityId`, `startTime`, `endTime`, `submittedAt`, and `status`). Supabase
uses normalized snake_case columns. When reading a database row, the API should
return a compatibility object approximately like:

```js
function toLegacyReservation(row) {
  return {
    ...row.request_data,
    id: row.id,
    userId: row.user_id,
    facilityId: row.facility_id,
    date: row.start_at.slice(0, 10),
    startTime: row.start_at.slice(11, 16),
    endTime: row.end_at.slice(11, 16),
    submittedAt: row.submitted_at,
    status: row.status,
  };
}
```

Confirm the existing UI's time-zone conventions before using this exact
conversion. If the database timestamps are UTC, convert to the school's
configured time zone instead of blindly slicing an ISO string. Use one tested
date/time adapter for both API reads and writes.

## 8. Frontend authentication changes

`user/src/services/authService.js` currently posts only `isStaff`, `staffId`, or
`phone` to `/api/auth/login`; it does not perform a password or OTP challenge.
The current server response is not a Supabase Auth session. Update the UI and
API as one change. A minimal email/password migration requires:

1. Add email and password controls to both `user/public/index.html` and
   `user/public/reservation.html`.
2. Add `/api/auth/signup` and `/api/auth/login` endpoints backed by Supabase
   Auth.
3. Return the Supabase access token only after successful authentication.
4. Verify that token on every protected reservation request.
5. Load the database role from `core_profiles`; never set `isStaff` from a
   client checkbox.
6. Remove the old staff-ID-only and guest-phone-only login as an authorization
   mechanism. Retain phone numbers only as profile/contact fields if needed.

If the frontend calls Supabase Auth directly instead of proxying auth through
Express:

- Use the public anon/publishable key only.
- Configure browser credentials intentionally; `process.env` will not work in
  the current static-server setup.
- Enable and test RLS for every table reachable from the browser.
- Never import `services/supabaseClient.js` into `user/src`.

## 9. Frontend reservation API changes

### `user/src/services/requestService.js`

Update `saveRequest()` so it:

- Gets the current, unexpired access token from the chosen auth/session helper.
- Sends it as `Authorization: Bearer ...`.
- Does not generate authoritative IDs or set the authoritative status locally.
- Parses JSON error messages and throws errors for all non-2xx responses.
- Treats HTTP `409` as a conflict users can act on, and HTTP `401` as a request
  to sign in again.

The existing implementation currently catches most network failures and
returns `null`. That can make a failed database write appear like a normal
booking failure. Surface the server message to the reservation UI instead.

Example request shape:

```js
const response = await fetch('/api/requests', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${accessToken}`,
  },
  body: JSON.stringify(request),
});

const result = await response.json();
if (!response.ok) {
  throw new Error(result.message || 'Could not submit reservation.');
}
return result.request;
```

### `user/src/services/dataService.js`

Continue calling `/api/facilities`, `/api/requests`, and `/api/accepted` during
the compatibility phase. Update the field mapping where necessary (notably
`price_per_hour` to `pricePerHour`). Do not quietly substitute fallback facility
data after an authorization or server error; show the user/admin that data
could not be loaded. Fallbacks may remain for a confirmed network-offline mode,
but they should be explicit.

### `user/src/services/reservationService.js`

Keep the immediate client-side conflict check for responsiveness. The server
and database must repeat validation and conflict checks during submission. If
the API returns `409`, display the conflict and refresh the affected date's
reservations.

## 10. Admin and supporting features

The existing admin UI writes to JSON-backed `/api/requests`, `/api/accepted`,
and `/api/events`. Once reservation endpoints use Supabase:

- `admin/js/data.js` must send an authenticated session on request-list and
  facility APIs.
- `admin/js/reservations.js` and `admin/js/editModal.js` must use admin-only
  review/update endpoints; they must no longer write a second copy to
  `accepted.json`.
- `admin/js/blocks.js` should represent blocks as reservation records with
  `status = 'blocked'`, or remain on the legacy store until a separate blocks
  migration is implemented.
- `admin/js/events.js` can continue using the event API while that API remains
  backed by `events.json`. Do not let an event with the same time accidentally
  bypass the reservation overlap rules; include school events in the final
  availability check or migrate them into the same conflict source.
- `routes/history.js`, `routes/forecast.js`, and `routes/notifications.js` need
  data-source adapters if they currently read reservation JSON files. Migrate
  these separately and verify their existing behavior.

Do not mount current CommonJS routes from the ESM server until the module
format issue and each route's dependencies have been resolved. Avoid broad
rewrites of unrelated email, chatbot, or forecasting code as part of the first
reservation database cutover.

## 11. Data migration and cutover

### Phase A: preserve and map existing data

1. Back up the repository's `data/` JSON files and export any existing
   Supabase tables.
2. Decide which records are canonical. Identify duplicates between
   `requests.json` and `accepted.json`.
3. Build a field map:

   | Existing record | Supabase field |
   |---|---|
   | `facilityId` | `core_reservations.facility_id` |
   | `date`, `startTime`, `endTime` | `start_at`, `end_at` in a documented time zone |
   | `status` (`accepted`/`approved`) | `approved` |
   | `status` (`refused`/`rejected`) | `rejected` |
   | pending request | `pending` |
   | cancelled request | `cancelled` |
   | remaining display/payment/contact properties | `request_data` JSONB initially |

4. Resolve every legacy record's owner to a real Auth user. Do not assign all
   imported records to a shared or fake user. If the owner cannot be reliably
   mapped, keep that record in the legacy archive until a reviewed import
   policy is established.
5. Convert local date/time values to timestamps using the school's configured
   time zone. Do not assume that a stored date string is UTC.

### Phase B: import into a development database

1. Create the new `core_` tables in a non-production project.
2. Import facilities and compare IDs, capacity, rates, and minimum attendee
   counts with `data/facilities.json`.
3. Write a one-off migration script that validates each JSON record before
   insertion and reports skipped/invalid records. Do not run an unreviewed bulk
   insert in production.
4. Compare row counts and sample records with the source JSON. Check for
   duplicates and overlapping active reservations.
5. Test owner visibility, admin visibility, date/time rendering, and every
   reservation status transition.

### Phase C: cutover

1. Deploy database-backed reads first behind a feature flag or maintenance
   window.
2. Confirm user and admin pages render the same calendar results.
3. Switch reservation writes to Supabase only. Stop JSON writes for those same
   requests so there is exactly one source of truth.
4. Keep the JSON backups read-only during the rollback window.
5. Verify successful requests, duplicate conflict rejection, cancellation,
   approval, event overlap, and rollback.
6. Remove old reservation JSON code only after explicit sign-off and verified
   backups. Do not delete source files or data as part of an initial cutover.

## 12. Verification checklist

- [ ] `.env` is ignored by Git and contains no committed secrets.
- [ ] Supabase Auth creates a profile with role `user`.
- [ ] A regular user cannot assign themselves `admin`.
- [ ] Invalid or missing access tokens receive HTTP `401`.
- [ ] A regular user cannot approve/reject or view other users' records.
- [ ] Facility API maps Supabase columns to existing frontend field names.
- [ ] Reservation API ignores forged body `userId`, `role`, and `status`.
- [ ] Invalid time ranges and past start times are rejected.
- [ ] Attendee count cannot exceed capacity.
- [ ] Two concurrent overlapping requests cannot both be created.
- [ ] Pending requests block conflicts; rejected/cancelled records do not.
- [ ] Approved bookings appear in the existing calendar/admin view once, not
  twice through both `/api/requests` and `/api/accepted`.
- [ ] Events and blocked dates are included in conflict detection or remain
  clearly isolated until migrated.
- [ ] Admin approval preserves the audit fields and current notification needs.
- [ ] History, forecast, and notification features are tested before their
  backing JSON data is retired.
- [ ] All relevant CommonJS/ESM module imports are verified at server startup.

## 13. Rollback plan

If the new database API fails after cutover:

1. Stop new writes briefly or place the application in maintenance mode.
2. Restore the previous API routing configuration.
3. Keep all new database records; do not delete them during rollback.
4. Export records created after cutover and reconcile them with the preserved
   JSON backup before re-enabling the old write path.
5. Record the failure and repeat the migration in development before trying
   another production cutover.

This repository-specific plan deliberately stages the database work. The
standalone implementation in [core_reservation.md](./core_reservation.md)
remains the reference for the minimal end-to-end workflow; this file explains
the extra adapters, authentication, module-format, and migration work needed
for the existing BCHS application.
