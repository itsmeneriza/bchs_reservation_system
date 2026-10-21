# Supabase Login Setup: Start to Finish

This guide follows login from Supabase configuration through the browser,
Express endpoint, database lookup, and response.

> **Authentication limitation:** guest login currently finds or creates a
> database row using a submitted phone number. It does not verify ownership
> with an OTP, password, or Supabase Auth. Anyone who knows a number can
> currently sign in as its guest record.

## Step 1: Prepare the Supabase project

In Supabase, note your project URL and server-side key from the project's API
settings. The server uses:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` (preferred for server database access)

The code also falls back to `SUPABASE_ANON_KEY` if the service-role key is
absent. When using the anon key, database row-level security (RLS) policies
must permit the required queries and guest inserts.

### Required tables

The `staffs` table is queried for these fields:

| Column | Purpose |
| --- | --- |
| `id` | Staff record identifier |
| `full_name` | Name displayed by the application |
| `staff_id` | Staff login identifier |
| `email` | Optional staff profile information |

The `guests` table is queried and inserted using:

| Column | Purpose |
| --- | --- |
| `id` | Guest record identifier |
| `mobile_number` | Guest sign-in phone, stored as `09XXXXXXXXX` |

Make `guests.mobile_number` unique. Remove any existing duplicate values
before adding the unique constraint. The constraint lets the server safely
handle two first-time sign-ins for the same number at once.

## Step 2: Configure the local server environment

Create or update `.env` in the repository root:

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_server_only_service_role_key
```

`.env` is ignored by Git. Never commit it. The service-role key bypasses RLS;
keep it exclusively on the server. Do not put it in HTML, browser JavaScript,
or a client-side environment variable.

Restart the server after changing environment values:

```powershell
npm start
```

## Step 3: Create the server-only Supabase client

File: `services/supabaseClient.js`

This module reads the environment variables and creates the Supabase client.
It is stored outside `user/src/`, which is served to the browser under `/src`,
so the server's Supabase module and service-role key are not sent as browser
code.

## Step 4: Implement the database operations

File: `scripts/AuthService.js`

This is the server-side database/business-logic layer:

- `staffLogin(staffId)` looks up one row in `staffs` by `staff_id`.
- `loginGuest(phoneNumber)` looks up `guests.mobile_number`.
- If no guest row exists, `loginGuest` inserts one with `mobile_number`.
- If the insert reports a unique-constraint conflict, it fetches the row that
  the concurrent request created.
- Database errors are logged on the server and returned as a service error.

The API returns only the fields selected by these operations; it never returns
the Supabase service-role key.

## Step 5: Define the login route and endpoint

File: `routes/auth.js`

The router validates the JSON body, calls the appropriate `AuthService`
method, and formats success or error responses. It defines:

```http
POST /auth/login
POST /login
```

Because the router is mounted under `/api` in the next step, the full endpoint
for new clients is:

```http
POST /api/auth/login
Content-Type: application/json
```

`POST /api/login` is retained as a compatibility alias for older callers.

### Guest / external user request

```json
{
  "isStaff": false,
  "phone": "09171234567"
}
```

The phone must contain `09` followed by nine digits.

### Staff request

```json
{
  "isStaff": true,
  "staffId": "BCHS-001"
}
```

### Successful guest response

```json
{
  "success": true,
  "isStaff": false,
  "user": {
    "id": "guest-record-id",
    "mobile_number": "09171234567"
  }
}
```

Staff success returns `isStaff: true` and a `user` object with `id`,
`full_name`, `staff_id`, and `email`.

| HTTP status | Meaning |
| --- | --- |
| `200` | Staff lookup or guest lookup/registration succeeded |
| `400` | Invalid login type, missing field, or invalid phone format |
| `401` | Staff ID was not found or is invalid |
| `503` | Supabase, table, permission, or service failure |

## Step 6: Mount the router in Express

File: `server.js`

The server imports the router and mounts it:

```js
import authRouter from './routes/auth.js';
app.use('/api', authRouter);
```

The `/api` mount prefix combines with `/auth/login` from `routes/auth.js` to
make `POST /api/auth/login`. Keep `express.json()` registered before the router
so `req.body` contains the submitted JSON.

## Step 7: Call the endpoint from the browser

File: `user/src/services/authService.js`

The browser helper sends the login payload to `/api/auth/login`, handles
network and API errors, then normalizes the returned Supabase profile into the
user shape used by both pages. It contains no Supabase key and does not query
Supabase directly.

## Step 8: Connect each login form

### Landing page

- `user/public/index.html` contains the landing-page form and profile markup.
- `user/src/components/landing-auth.js` validates the phone or staff ID,
  calls `loginUser`, saves the returned profile to local storage, and updates
  the profile/logout UI.

### Reservation page

- `user/public/reservation.html` contains the reservation-page form and
  profile markup.
- `user/src/components/LoginComponent.js` validates the input, calls
  `loginUser`, and updates the application's login state and profile UI.
- `user/src/core/state.js` persists the reservation page's user state in
  local storage.

Both pages use the same browser helper and server endpoint.

## Step 9: Verify the full flow

1. Confirm `.env` has the Supabase URL and server-side key; do not print or
   share the key.
2. Start the application with `npm start`.
3. Open either the landing or reservation page.
4. Submit a valid mobile number. **For a number not already in `guests`, this
   will create a real database row.**
5. Confirm a row with that `mobile_number` exists in Supabase.
6. Sign in with the same number again; it should return the existing row,
   rather than add another.
7. Test staff login with a valid `staff_id` from `staffs`.
8. Check the browser's displayed error and the server terminal if a request
   fails.

Common errors:

- `column guests.mobile_number does not exist`: the Supabase table needs the
  column used by this implementation, or the code must be changed to match the
  actual column name.
- Permission/RLS error: configure the server-side service-role key, or
  intentionally use the anon key with suitable RLS policies.
- Duplicate guest rows: clean existing duplicates and add a unique constraint
  to `mobile_number`.
- Missing environment configuration: verify `.env` is at the repository root
  and restart the server.

## File flow at a glance

```text
index.html / reservation.html
        │ user submits form
        ▼
landing-auth.js / LoginComponent.js
        │ call loginUser()
        ▼
user/src/services/authService.js
        │ POST /api/auth/login
        ▼
server.js
        │ app.use('/api', authRouter)
        ▼
routes/auth.js
        │ validate and dispatch by isStaff
        ▼
scripts/AuthService.js
        │ Supabase query/insert
        ▼
services/supabaseClient.js
        │ server credentials from .env
        ▼
Supabase staffs / guests tables
```
