# Core Reservation System: Step-by-Step Build Guide

This guide describes a small, working reservation system using the same core
stack as this repository: Node.js, Express, and Supabase (PostgreSQL). It covers
account sign-up/sign-in, facilities, availability checks, reservation requests,
user cancellation, and administrator approval or rejection.

The example is intentionally separate from the existing application. Build it
in a new `core-reservation-starter` directory first, and integrate it into the
main application only after testing. Do not replace the existing `server.js` or
data files with the starter files without reviewing their existing behavior.

## 1. What the system does

1. A user creates an account or signs in with email and password.
2. The browser sends the Supabase access token with protected API requests.
3. Express verifies that token with Supabase Auth. The browser cannot choose its
   own user ID or administrator role.
4. A user selects a facility and submits a start/end time, purpose, and
   attendee count.
5. PostgreSQL checks for overlapping pending or approved reservations before
   inserting a pending reservation. A database lock prevents two simultaneous
   submissions for the same facility from both claiming the same time.
6. A user can cancel their own pending request.
7. An administrator can approve or reject pending requests.

Pending reservations block overlapping requests. Rejected and cancelled
reservations do not. This is a small low-volume starter; a production system
may need additional policies for holidays, opening hours, payments, email,
auditing, and higher-volume locking.

## 2. Prerequisites

- Node.js 18 or newer and npm
- A Supabase project
- A modern web browser

Create the Supabase project and keep its project URL, anon/publishable key, and
service-role/secret key available. **Never put the service-role key in browser
code or commit it to Git.**

## 3. Create the starter project

Open PowerShell in the repository root and run:

```powershell
mkdir core-reservation-starter
cd core-reservation-starter
npm init -y
npm install express dotenv @supabase/supabase-js
mkdir public
```

Replace the generated `package.json` with the complete file below. The project
uses ES modules, matching the current repository's Node.js setup.

### `package.json`

```json
{
  "name": "core-reservation-starter",
  "private": true,
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "start": "node server.js",
    "dev": "node --watch server.js"
  },
  "dependencies": {
    "@supabase/supabase-js": "^2.0.0",
    "dotenv": "^17.0.0",
    "express": "^4.21.0"
  }
}
```

Run `npm install` after replacing the manifest so the lockfile matches it.

## 4. Configure Supabase credentials

Create `.env` in `core-reservation-starter` and fill in the values from the
Supabase project settings. Keep this file private and out of Git.

### `.env`

```dotenv
PORT=3000
SUPABASE_URL=https://YOUR_PROJECT_ID.supabase.co
SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_OR_PUBLISHABLE_KEY
SUPABASE_SERVICE_ROLE_KEY=YOUR_SUPABASE_SERVICE_ROLE_OR_SECRET_KEY
```

The anon key is used by the server for Supabase Auth token verification and
sign-in. The service-role key is used only by the server for database
operations. Both stay on the server in this example.

If the existing repository's `.gitignore` does not cover the new `.env` file,
add this line to it:

```gitignore
.env
```

Never paste real keys into documentation, source files, or a Git commit. When
deploying, configure these values using the hosting provider's secret-variable
settings instead of uploading `.env`.

## 5. Create the database schema

In Supabase, open **SQL Editor**, create a new query, paste the complete SQL
below, and run it. The schema creates user profiles, facilities, reservations,
security policies, and the database function that safely submits a request.

### `database.sql`

```sql
-- Profiles use the Supabase Auth user ID. Users cannot set their own role.
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  role text not null default 'user' check (role in ('user', 'admin')),
  created_at timestamptz not null default now()
);

-- Facilities are maintained through the database dashboard or a protected
-- administrator endpoint added later.
create table if not exists public.facilities (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text not null default '',
  capacity integer not null check (capacity > 0),
  price_per_hour numeric(10, 2) not null default 0
    check (price_per_hour >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Reservations are tied to authenticated users and facilities.
create table if not exists public.reservations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  facility_id uuid not null references public.facilities (id),
  start_at timestamptz not null,
  end_at timestamptz not null,
  purpose text not null check (length(trim(purpose)) between 3 and 500),
  attendees integer not null check (attendees > 0),
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  created_at timestamptz not null default now(),
  reviewed_by uuid references auth.users (id),
  reviewed_at timestamptz,
  check (end_at > start_at)
);

create index if not exists reservations_facility_time_idx
  on public.reservations (facility_id, start_at, end_at);

create index if not exists reservations_user_created_idx
  on public.reservations (user_id, created_at desc);

-- Automatically create a regular-user profile when Supabase Auth creates an
-- account. The role is always set by the database, not supplied by the browser.
create or replace function public.create_profile_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (id, email, role)
  values (new.id, coalesce(new.email, ''), 'user')
  on conflict (id) do update
    set email = excluded.email;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.create_profile_for_new_user();

-- RLS is enabled even though the starter API uses a server-only service key.
-- This provides a safe default if direct client database access is added later.
alter table public.profiles enable row level security;
alter table public.facilities enable row level security;
alter table public.reservations enable row level security;

drop policy if exists "Users can read their own profile" on public.profiles;
create policy "Users can read their own profile"
  on public.profiles for select
  to authenticated
  using (id = (select auth.uid()));

drop policy if exists "Anyone can read active facilities" on public.facilities;
create policy "Anyone can read active facilities"
  on public.facilities for select
  to anon, authenticated
  using (is_active = true);

drop policy if exists "Users can read their own reservations" on public.reservations;
create policy "Users can read their own reservations"
  on public.reservations for select
  to authenticated
  using (
    user_id = (select auth.uid())
    or exists (
      select 1
      from public.profiles
      where profiles.id = (select auth.uid())
        and profiles.role = 'admin'
    )
  );

-- The browser is not granted write access to reservations. The API verifies
-- user tokens, checks roles, and performs these writes using its secret key.
revoke insert, update, delete on public.reservations from anon, authenticated;
revoke insert, update, delete on public.profiles from anon, authenticated;
revoke insert, update, delete on public.facilities from anon, authenticated;

-- Submit a pending request. The server passes the user ID only after verifying
-- its Supabase access token. Serializing submissions per facility prevents
-- concurrent overlapping requests from both passing the availability check.
create or replace function public.submit_reservation(
  p_user_id uuid,
  p_facility_id uuid,
  p_start_at timestamptz,
  p_end_at timestamptz,
  p_purpose text,
  p_attendees integer
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  new_reservation_id uuid;
  facility_capacity integer;
begin
  if p_end_at <= p_start_at then
    raise exception 'End time must be later than start time';
  end if;

  if p_start_at <= now() then
    raise exception 'Start time must be in the future';
  end if;

  if length(trim(p_purpose)) not between 3 and 500 then
    raise exception 'Purpose must be between 3 and 500 characters';
  end if;

  if p_attendees <= 0 then
    raise exception 'Attendee count must be greater than zero';
  end if;

  -- One lock per facility keeps the overlap check and insert atomic for this
  -- small system. It serializes submissions for that facility, not other ones.
  perform pg_advisory_xact_lock(hashtext(p_facility_id::text), 0);

  select capacity into facility_capacity
  from public.facilities
  where id = p_facility_id and is_active = true;

  if facility_capacity is null then
    raise exception 'Facility is unavailable';
  end if;

  if p_attendees > facility_capacity then
    raise exception 'Attendee count exceeds facility capacity';
  end if;

  if exists (
    select 1
    from public.reservations
    where facility_id = p_facility_id
      and status in ('pending', 'approved')
      and start_at < p_end_at
      and end_at > p_start_at
  ) then
    raise exception 'Time slot already reserved';
  end if;

  insert into public.reservations (
    user_id,
    facility_id,
    start_at,
    end_at,
    purpose,
    attendees,
    status
  )
  values (
    p_user_id,
    p_facility_id,
    p_start_at,
    p_end_at,
    trim(p_purpose),
    p_attendees,
    'pending'
  )
  returning id into new_reservation_id;

  return new_reservation_id;
end;
$$;

-- Only the trusted server's service-role client can submit through this
-- function. Never expose the service-role key to a browser.
revoke all on function public.submit_reservation(
  uuid, uuid, timestamptz, timestamptz, text, integer
) from public, anon, authenticated;
grant execute on function public.submit_reservation(
  uuid, uuid, timestamptz, timestamptz, text, integer
) to service_role;

-- Starter facility records. The UUIDs are generated automatically.
insert into public.facilities (name, description, capacity, price_per_hour)
values
  ('Auditorium', 'Large indoor venue with a stage.', 700, 1800),
  ('Library', 'Quiet indoor meeting and study space.', 100, 1000),
  ('Gym', 'Indoor sports and event facility.', 300, 1000)
on conflict (name) do nothing;
```

The SQL deliberately grants no direct reservation-write access to browser
users. All write endpoints below first authenticate the caller and, for review
actions, check the caller's profile role.

### Promote the first administrator

1. Sign up using the system's sign-up form after starting the server.
2. In Supabase SQL Editor, replace the email below with that account's email
   and run:

```sql
update public.profiles
set role = 'admin'
where id = (
  select id
  from auth.users
  where lower(email) = lower('admin@example.com')
  limit 1
);
```

Only trusted project owners should run this statement. Do not add a public
endpoint that lets a user change their own role.

## 6. Create the Express API

Create `server.js` in `core-reservation-starter`. This is the complete starter
API: account endpoints, token verification, role checks, facility listing,
reservation submit/list/cancel, administrator review, and static web hosting.

### `server.js`

```js
import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const requiredEnv = [
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
];

for (const name of requiredEnv) {
  if (!process.env[name]) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
}

const supabaseUrl = process.env.SUPABASE_URL;

// This client handles sign-up, sign-in, and verification of access tokens.
const authClient = createClient(
  supabaseUrl,
  process.env.SUPABASE_ANON_KEY,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  },
);

// This secret-key client is server-only. Never import it from browser files.
const databaseClient = createClient(
  supabaseUrl,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  },
);

const projectDir = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: '16kb' }));

// Wrap async route handlers so Express 4 passes rejected promises to the
// centralized error handler.
const asyncHandler = (handler) => (req, res, next) =>
  Promise.resolve(handler(req, res, next)).catch(next);

function isValidEmail(value) {
  return typeof value === 'string'
    && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function parseReservationBody(body) {
  const facilityId = body?.facilityId;
  const purpose = body?.purpose;
  const attendees = Number(body?.attendees);
  const startAt = new Date(body?.startAt);
  const endAt = new Date(body?.endAt);

  if (typeof facilityId !== 'string' || !facilityId.trim()) {
    return { error: 'Select a facility.' };
  }
  if (typeof purpose !== 'string' || purpose.trim().length < 3
      || purpose.trim().length > 500) {
    return { error: 'Purpose must be between 3 and 500 characters.' };
  }
  if (!Number.isInteger(attendees) || attendees <= 0) {
    return { error: 'Attendees must be a positive whole number.' };
  }
  if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) {
    return { error: 'Enter valid start and end times.' };
  }
  if (endAt <= startAt) {
    return { error: 'End time must be later than start time.' };
  }
  if (startAt <= new Date()) {
    return { error: 'Start time must be in the future.' };
  }

  return {
    value: {
      facilityId: facilityId.trim(),
      purpose: purpose.trim(),
      attendees,
      startAt: startAt.toISOString(),
      endAt: endAt.toISOString(),
    },
  };
}

// Verify the bearer token with Supabase Auth, then load the user's role from
// the database. Never accept an ID or role sent in the JSON request body.
const requireUser = asyncHandler(async (req, res, next) => {
  const authorization = req.get('authorization') || '';
  const match = authorization.match(/^Bearer\s+(.+)$/i);

  if (!match) {
    return res.status(401).json({ message: 'Sign in to continue.' });
  }

  const { data: authData, error: authError } =
    await authClient.auth.getUser(match[1]);

  if (authError || !authData.user) {
    return res.status(401).json({ message: 'Your session is invalid. Sign in again.' });
  }

  const { data: profile, error: profileError } = await databaseClient
    .from('profiles')
    .select('id, email, role')
    .eq('id', authData.user.id)
    .maybeSingle();

  if (profileError) throw profileError;
  if (!profile) {
    return res.status(403).json({ message: 'No user profile is available for this account.' });
  }

  req.user = {
    id: authData.user.id,
    email: profile.email,
    role: profile.role,
  };
  return next();
});

const requireAdmin = (req, res, next) => {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ message: 'Administrator access is required.' });
  }
  return next();
};

// Sign up creates a regular user. The database trigger creates their profile.
app.post('/api/auth/signup', asyncHandler(async (req, res) => {
  const { email, password } = req.body || {};
  if (!isValidEmail(email)) {
    return res.status(400).json({ message: 'Enter a valid email address.' });
  }
  if (typeof password !== 'string' || password.length < 8) {
    return res.status(400).json({ message: 'Password must be at least 8 characters.' });
  }

  const { data, error } = await authClient.auth.signUp({
    email: email.trim().toLowerCase(),
    password,
  });
  if (error) {
    return res.status(400).json({ message: error.message });
  }

  return res.status(201).json({
    message: data.session
      ? 'Account created. You are signed in.'
      : 'Account created. Check your email to confirm it, then sign in.',
    accessToken: data.session?.access_token || null,
  });
}));

// Sign in returns a short-lived access token for subsequent API calls.
app.post('/api/auth/login', asyncHandler(async (req, res) => {
  const { email, password } = req.body || {};
  if (!isValidEmail(email) || typeof password !== 'string' || !password) {
    return res.status(400).json({ message: 'Enter your email and password.' });
  }

  const { data, error } = await authClient.auth.signInWithPassword({
    email: email.trim().toLowerCase(),
    password,
  });
  if (error || !data.session) {
    return res.status(401).json({ message: error?.message || 'Unable to sign in.' });
  }

  return res.json({
    accessToken: data.session.access_token,
    user: { id: data.user.id, email: data.user.email },
  });
}));

// The client calls this on page load to restore its signed-in UI safely.
app.get('/api/me', requireUser, (req, res) => {
  res.json({ user: req.user });
});

app.get('/api/facilities', asyncHandler(async (_req, res) => {
  const { data, error } = await databaseClient
    .from('facilities')
    .select('id, name, description, capacity, price_per_hour')
    .eq('is_active', true)
    .order('name');

  if (error) throw error;
  return res.json({ facilities: data });
}));

// This is a convenience availability check. The submit RPC repeats the overlap
// check inside a database lock, so this read cannot cause double bookings.
app.get('/api/availability', asyncHandler(async (req, res) => {
  const { facilityId, startAt, endAt } = req.query;
  const start = new Date(startAt);
  const end = new Date(endAt);

  if (typeof facilityId !== 'string' || !facilityId.trim()
      || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())
      || end <= start) {
    return res.status(400).json({ message: 'Enter a facility and valid start/end times.' });
  }

  const { data, error } = await databaseClient
    .from('reservations')
    .select('id')
    .eq('facility_id', facilityId)
    .in('status', ['pending', 'approved'])
    .lt('start_at', end.toISOString())
    .gt('end_at', start.toISOString())
    .limit(1);

  if (error) throw error;
  return res.json({ available: data.length === 0 });
}));

// Users see only their own bookings. Admins see all bookings for the review UI.
app.get('/api/reservations', requireUser, asyncHandler(async (req, res) => {
  let query = databaseClient
    .from('reservations')
    .select('id, user_id, facility_id, start_at, end_at, purpose, attendees, status, created_at, facilities(name)')
    .order('start_at');

  if (req.user.role !== 'admin') {
    query = query.eq('user_id', req.user.id);
  }

  const { data, error } = await query;
  if (error) throw error;
  return res.json({ reservations: data });
}));

app.post('/api/reservations', requireUser, asyncHandler(async (req, res) => {
  const parsed = parseReservationBody(req.body);
  if (parsed.error) {
    return res.status(400).json({ message: parsed.error });
  }

  const { value } = parsed;
  const { data, error } = await databaseClient.rpc('submit_reservation', {
    p_user_id: req.user.id,
    p_facility_id: value.facilityId,
    p_start_at: value.startAt,
    p_end_at: value.endAt,
    p_purpose: value.purpose,
    p_attendees: value.attendees,
  });

  if (error) {
    if (error.message.includes('Time slot already reserved')) {
      return res.status(409).json({ message: 'That time is already reserved. Choose another time.' });
    }
    if (error.message.includes('Facility is unavailable')) {
      return res.status(409).json({ message: 'That facility is currently unavailable.' });
    }
    if (error.message.includes('Attendee count exceeds facility capacity')) {
      return res.status(400).json({ message: 'Attendee count exceeds the facility capacity.' });
    }
    throw error;
  }

  return res.status(201).json({
    reservation: { id: data, status: 'pending' },
    message: 'Reservation request submitted for approval.',
  });
}));

app.patch('/api/reservations/:id/cancel', requireUser, asyncHandler(async (req, res) => {
  const { data, error } = await databaseClient
    .from('reservations')
    .update({ status: 'cancelled' })
    .eq('id', req.params.id)
    .eq('user_id', req.user.id)
    .eq('status', 'pending')
    .select('id, status')
    .maybeSingle();

  if (error) throw error;
  if (!data) {
    return res.status(404).json({
      message: 'Pending reservation not found. Only your pending requests can be cancelled.',
    });
  }
  return res.json({ reservation: data });
}));

app.patch(
  '/api/admin/reservations/:id/review',
  requireUser,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { decision } = req.body || {};
    if (!['approved', 'rejected'].includes(decision)) {
      return res.status(400).json({ message: 'Decision must be approved or rejected.' });
    }

    const { data, error } = await databaseClient
      .from('reservations')
      .update({
        status: decision,
        reviewed_by: req.user.id,
        reviewed_at: new Date().toISOString(),
      })
      .eq('id', req.params.id)
      .eq('status', 'pending')
      .select('id, status, reviewed_by, reviewed_at')
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      return res.status(404).json({ message: 'Pending reservation not found.' });
    }
    return res.json({ reservation: data });
  }),
);

// Return a JSON 404 for unknown API paths rather than serving the HTML page.
app.use('/api', (_req, res) => {
  res.status(404).json({ message: 'API endpoint not found.' });
});

// Serve the small browser client and its assets from the public directory.
app.use(express.static(path.join(projectDir, 'public')));

// Log server-side details for diagnosis but do not return database internals.
app.use((error, _req, res, _next) => {
  console.error('Request failed:', error);
  if (res.headersSent) return;
  return res.status(500).json({ message: 'An unexpected server error occurred.' });
});

const port = Number(process.env.PORT || 3000);
app.listen(port, () => {
  console.log(`Reservation system: http://localhost:${port}`);
});
```

The server code never sends the service-role key to a browser. It also derives
the user ID and role from verified Supabase data rather than trusting request
body fields.

## 7. Create the browser page

Create `public/index.html`. It includes the sign-up/sign-in controls, a booking
form, a reservation list, and a small administrator review area.

### `public/index.html`

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Facility Reservation</title>
    <style>
      body {
        max-width: 900px;
        margin: 2rem auto;
        padding: 0 1rem;
        color: #1f2937;
        font: 16px/1.5 system-ui, sans-serif;
      }
      section {
        margin: 1.5rem 0;
        padding: 1rem;
        border: 1px solid #d1d5db;
        border-radius: 0.5rem;
      }
      label { display: block; margin-top: 0.75rem; }
      input, select, textarea, button {
        box-sizing: border-box;
        max-width: 100%;
        padding: 0.55rem;
        font: inherit;
      }
      input, select, textarea { width: 100%; }
      button { margin: 0.75rem 0.5rem 0 0; cursor: pointer; }
      li { margin: 0.75rem 0; }
      #message { min-height: 1.5rem; font-weight: 600; }
      [hidden] { display: none !important; }
    </style>
  </head>
  <body>
    <h1>Facility Reservation</h1>
    <p id="message" role="status" aria-live="polite"></p>

    <section id="auth-section">
      <h2>Sign in or create an account</h2>
      <form id="auth-form">
        <label for="email">Email</label>
        <input id="email" type="email" autocomplete="email" required>

        <label for="password">Password (at least 8 characters)</label>
        <input id="password" type="password" minlength="8"
               autocomplete="current-password" required>

        <button type="submit">Sign in</button>
        <button id="signup-button" type="button">Create account</button>
      </form>
    </section>

    <section id="account-section" hidden>
      <p id="account-label"></p>
      <button id="logout-button" type="button">Sign out</button>
    </section>

    <section id="booking-section" hidden>
      <h2>Request a reservation</h2>
      <form id="booking-form">
        <label for="facility">Facility</label>
        <select id="facility" required></select>

        <label for="start-at">Start time</label>
        <input id="start-at" type="datetime-local" required>

        <label for="end-at">End time</label>
        <input id="end-at" type="datetime-local" required>

        <label for="purpose">Purpose</label>
        <textarea id="purpose" minlength="3" maxlength="500" required></textarea>

        <label for="attendees">Number of attendees</label>
        <input id="attendees" type="number" min="1" step="1" required>

        <button id="check-availability" type="button">Check availability</button>
        <button type="submit">Submit request</button>
      </form>
      <p>Requests remain pending until an administrator reviews them.</p>
    </section>

    <section id="reservation-section" hidden>
      <h2 id="reservation-heading">My reservations</h2>
      <ul id="reservation-list"></ul>
    </section>

    <script type="module" src="/app.js"></script>
  </body>
</html>
```

## 8. Add the browser behavior

Create `public/app.js`. It calls the Express API, stores only the short-lived
access token in browser storage, escapes displayed data by using `textContent`,
and shows cancel/review actions only where appropriate.

### `public/app.js`

```js
const message = document.querySelector('#message');
const authSection = document.querySelector('#auth-section');
const accountSection = document.querySelector('#account-section');
const bookingSection = document.querySelector('#booking-section');
const reservationSection = document.querySelector('#reservation-section');
const reservationList = document.querySelector('#reservation-list');
const facilitySelect = document.querySelector('#facility');

let accessToken = localStorage.getItem('reservation_access_token');
let currentUser = null;

function showMessage(text) {
  message.textContent = text;
}

async function api(url, options = {}) {
  const headers = new Headers(options.headers || {});
  if (options.body) headers.set('content-type', 'application/json');
  if (accessToken) headers.set('authorization', `Bearer ${accessToken}`);

  const response = await fetch(url, { ...options, headers });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(result.message || `Request failed (${response.status}).`);
  }
  return result;
}

function setSignedInUI(signedIn) {
  authSection.hidden = signedIn;
  accountSection.hidden = !signedIn;
  bookingSection.hidden = !signedIn;
  reservationSection.hidden = !signedIn;
}

function addText(parent, tagName, text) {
  const element = document.createElement(tagName);
  element.textContent = text;
  parent.append(element);
  return element;
}

async function loadFacilities() {
  const { facilities } = await api('/api/facilities');
  facilitySelect.replaceChildren();

  for (const facility of facilities) {
    const option = document.createElement('option');
    option.value = facility.id;
    option.textContent = `${facility.name} (capacity ${facility.capacity})`;
    facilitySelect.append(option);
  }
}

function addCancelButton(item, reservation) {
  if (reservation.status !== 'pending' || reservation.user_id !== currentUser.id) {
    return;
  }

  const button = addText(item, 'button', 'Cancel pending request');
  button.type = 'button';
  button.addEventListener('click', async () => {
    try {
      await api(`/api/reservations/${encodeURIComponent(reservation.id)}/cancel`, {
        method: 'PATCH',
      });
      showMessage('Reservation request cancelled.');
      await loadReservations();
    } catch (error) {
      showMessage(error.message);
    }
  });
}

function addReviewButtons(item, reservation) {
  if (currentUser.role !== 'admin' || reservation.status !== 'pending') return;

  for (const decision of ['approved', 'rejected']) {
    const button = addText(
      item,
      'button',
      decision === 'approved' ? 'Approve' : 'Reject',
    );
    button.type = 'button';
    button.addEventListener('click', async () => {
      try {
        await api(
          `/api/admin/reservations/${encodeURIComponent(reservation.id)}/review`,
          {
            method: 'PATCH',
            body: JSON.stringify({ decision }),
          },
        );
        showMessage(`Reservation ${decision}.`);
        await loadReservations();
      } catch (error) {
        showMessage(error.message);
      }
    });
  }
}

async function loadReservations() {
  const { reservations } = await api('/api/reservations');
  reservationList.replaceChildren();

  if (reservations.length === 0) {
    addText(reservationList, 'li', 'No reservations yet.');
    return;
  }

  for (const reservation of reservations) {
    const item = document.createElement('li');
    const facilityName = reservation.facilities?.name || 'Facility';
    const start = new Date(reservation.start_at).toLocaleString();
    const end = new Date(reservation.end_at).toLocaleString();
    addText(
      item,
      'span',
      `${facilityName}: ${start} – ${end}; ${reservation.attendees} attendees; `
        + `${reservation.status}; purpose: ${reservation.purpose}`,
    );
    addCancelButton(item, reservation);
    addReviewButtons(item, reservation);
    reservationList.append(item);
  }
}

async function refreshSignedInPage() {
  const { user } = await api('/api/me');
  currentUser = user;
  setSignedInUI(true);
  document.querySelector('#account-label').textContent =
    `${user.email} (${user.role})`;
  document.querySelector('#reservation-heading').textContent =
    user.role === 'admin' ? 'All reservations' : 'My reservations';
  await Promise.all([loadFacilities(), loadReservations()]);
}

async function submitAuth(endpoint) {
  const email = document.querySelector('#email').value.trim();
  const password = document.querySelector('#password').value;
  const result = await api(endpoint, {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });

  if (!result.accessToken) {
    showMessage(result.message);
    return;
  }

  accessToken = result.accessToken;
  localStorage.setItem('reservation_access_token', accessToken);
  await refreshSignedInPage();
  showMessage(result.message || 'Signed in.');
}

document.querySelector('#auth-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    await submitAuth('/api/auth/login');
  } catch (error) {
    showMessage(error.message);
  }
});

document.querySelector('#signup-button').addEventListener('click', async () => {
  try {
    await submitAuth('/api/auth/signup');
  } catch (error) {
    showMessage(error.message);
  }
});

document.querySelector('#logout-button').addEventListener('click', () => {
  accessToken = null;
  currentUser = null;
  localStorage.removeItem('reservation_access_token');
  setSignedInUI(false);
  showMessage('Signed out.');
});

document.querySelector('#booking-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    // datetime-local is interpreted in the user's local time zone and converted
    // to ISO UTC timestamps before they are sent to the server.
    const startAt = new Date(document.querySelector('#start-at').value);
    const endAt = new Date(document.querySelector('#end-at').value);
    const result = await api('/api/reservations', {
      method: 'POST',
      body: JSON.stringify({
        facilityId: facilitySelect.value,
        startAt: startAt.toISOString(),
        endAt: endAt.toISOString(),
        purpose: document.querySelector('#purpose').value,
        attendees: Number(document.querySelector('#attendees').value),
      }),
    });
    showMessage(result.message);
    event.target.reset();
    await loadReservations();
  } catch (error) {
    showMessage(error.message);
  }
});

document.querySelector('#check-availability').addEventListener('click', async () => {
  const startAt = new Date(document.querySelector('#start-at').value);
  const endAt = new Date(document.querySelector('#end-at').value);
  if (!facilitySelect.value || Number.isNaN(startAt.getTime())
      || Number.isNaN(endAt.getTime()) || endAt <= startAt) {
    showMessage('Choose a facility and enter valid start and end times.');
    return;
  }

  try {
    const params = new URLSearchParams({
      facilityId: facilitySelect.value,
      startAt: startAt.toISOString(),
      endAt: endAt.toISOString(),
    });
    const result = await api(`/api/availability?${params}`);
    showMessage(
      result.available
        ? 'This time appears available. It is checked again when you submit.'
        : 'That time is already pending or approved for this facility.',
    );
  } catch (error) {
    showMessage(error.message);
  }
});

setSignedInUI(false);
if (accessToken) {
  refreshSignedInPage().catch((error) => {
    // A stale or expired token should not keep the page in a false signed-in
    // state. The user can sign in again using the form.
    accessToken = null;
    localStorage.removeItem('reservation_access_token');
    setSignedInUI(false);
    showMessage(error.message);
  });
}
```

## 9. Start and test locally

From the `core-reservation-starter` directory:

```powershell
npm start
```

Open [http://localhost:3000](http://localhost:3000). Test in this order:

1. Create a regular account. If Supabase requires email confirmation, confirm
   the email before signing in.
2. Sign in and confirm the facility list appears.
3. Submit a reservation request with a future time. It should show as pending.
4. Submit an overlapping request for the same facility. It should return a
   conflict message instead of creating a second pending request.
5. Cancel the pending request and confirm its status changes to cancelled.
6. Promote a second account to administrator using the SQL in section 5.
7. Sign in as the administrator. The page should show all reservations and
   review buttons for pending ones.
8. Approve or reject a request and confirm the status updates.
9. Try a protected endpoint without signing in. It should return HTTP 401.
10. Try an administrator endpoint as a regular user. It should return HTTP 403.

The browser cannot complete sign-up when email confirmation is enabled until the
user has confirmed their address. For local testing, configure Supabase Auth's
email-confirmation settings deliberately; do not disable confirmation in a
production environment merely to simplify testing.

## 10. How to connect the starter to the existing application

After the isolated starter passes its tests:

1. Back up the repository and work on a feature branch.
2. Reuse the database schema only after comparing it with existing Supabase
   tables. Do not blindly run duplicate table or trigger definitions against
   production data.
3. Merge the API endpoints into the existing Express server rather than
   replacing existing request, notification, or admin routes.
4. Keep only one trusted server-side Supabase service-role client. Do not import
   a service-role client into `user/src`.
5. Adapt the existing login UI to the chosen auth flow and consistently use one
   response shape.
6. Verify all existing API routes and workflows after integration.
7. Keep `.env` out of Git and rotate any key that has ever been committed or
   exposed.

## 11. Important production work not included

- Email verification, password reset, rate limits, and abuse protection
- Facility-specific hours, holidays, setup/cleanup buffers, and time-based
  capacity rules
- Payment processing and refunds
- Approval notifications and audit history for changed reservations
- Admin pages for adding, editing, or disabling facilities
- Data retention, backups, monitoring, and deployment with HTTPS
- Stronger session storage strategy if the app faces untrusted scripts or
  cross-site scripting risk; a secure, HTTP-only cookie can be preferable to
  browser `localStorage`
- Load testing and finer-grained locking if many people book concurrently

Treat this as an educational core starter, not a complete production security
review. Before handling real users or payments, review the policies, business
rules, and deployment security with the system owner.
