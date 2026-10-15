# BCHS Reservation System — Code Review Report

## Executive Summary

The codebase is a working, feature-rich reservation system split across three layers: a Node.js/Express server (`server.js`), an admin panel (`admin/`), and a user-facing app (`user/`). The user-facing app follows modern ES-module component patterns well. However, the server and the admin panel carry significant organizational and repetition problems. The biggest issues are:

1. **`server.js` does too many unrelated jobs** — it is a 1,400+ line single file that mixes routing, business logic, email composition, forecast computation, and data archiving.
2. **The forecast algorithm is fully duplicated** — `computeForecast()` and `generateForecastFromData()` are two separate implementations of the same algorithm inside `server.js`, sharing no code.
3. **Room data (IDs, names, capacities, prices) is hard-coded in at least six separate places** across the server, admin, and user layers.
4. **`convertTo12Hour` exists in three separate files** — the admin layer, the user utility module, and inline as anonymous arrow functions in the server.
5. **`getWorkingDaysUntil` is copy-pasted** between `server.js` and `MyRequestsComponent.js`.
6. **Email HTML templates are hand-built in multiple server routes** without a shared template function.
7. **The admin panel uses global `var` state** and loads scripts without a module system, making dependency order fragile.

---

## 1. Code Organization Issues

### 1.1 `server.js` — One Giant File

`server.js` is 1,400+ lines and handles:
- All REST route handlers (requests, accepted, events, history, forecast, notifications)
- Two independent forecast computation algorithms
- Email reminder scheduling
- Data archiving / history migration logic
- ISO week number helpers

**Recommendation:** Split into modules:
```
server/
  routes/
    requests.js      -- /api/requests CRUD
    events.js        -- /api/events CRUD
    accepted.js      -- /api/accepted CRUD
    history.js       -- /api/history
    forecast.js      -- /api/forecast
    notifications.js -- /api/notify-*
  services/
    forecastService.js  -- single forecast algorithm used by both routes
    archiveService.js   -- archivePastReservations()
    emailService.js     -- transporter + all sendMail helpers + template builder
    historyService.js   -- readHistory(), writeHistory()
  utils/
    dateUtils.js        -- getISOWeek(), getWorkingDaysUntil()
  server.js            -- only: require + app.listen + middleware setup
```

### 1.2 Admin Panel — Global Namespace Scripts

The admin panel (`admin/js/`) uses plain `<script>` tags and `var` globals. All eight JS files share one global scope. This means:
- Load order in `admin.html` must be manually maintained.
- Every function is implicitly global (`renderAll`, `loadData`, `openEditModal`, `patchRequest`, etc.).
- There is no `import`/`export` — a bug in one module silently affects others.

**Recommendation:** Either convert to ES modules (like the user app already does), or at minimum wrap each file in an IIFE to prevent namespace pollution. The dependency chain is: `state.js` → `utils.js` → `data.js` → all render modules → `app.js`. This should be documented and enforced.

### 1.3 `user/api/save-request.js` — Dead Code

`user/api/save-request.js` is a standalone handler file with usage instructions in a comment block. The actual request saving is done by `server.js`'s `POST /api/requests` route, which is a complete reimplementation. This file is never imported or required anywhere.

**Recommendation:** Delete `user/api/save-request.js`. It is dead code that duplicates intent and will confuse future maintainers.

### 1.4 `user/data.ts` — Orphaned TypeScript File

There is a `user/data.ts` file in the user folder. The project has no TypeScript build step in `package.json`. No other TypeScript files exist. This file cannot be executed as-is.

**Recommendation:** Convert to `.js` or remove if unused. Confirm whether a TypeScript compilation step was intended and never wired up.

### 1.5 Landing Page Auth is Completely Separate from App Auth

`user/src/components/landing-auth.js` and `user/src/components/LoginComponent.js` both implement authentication logic for the same user session stored in `localStorage` (`bchs_user_logged_in`, `bchs_user_data`). They duplicate:
- `localStorage` key names (hardcoded strings repeated in both files)
- Phone validation logic (regex `/^9\d{9}$/`)
- Staff-ID lookup flow
- Session read/write

**Recommendation:** Extract a single `user/src/services/authService.js` that owns `getSession()`, `setSession()`, `clearSession()`, `isValidPHPhone()`, `normalizePHPhone()`, and `loadStaffData()`. Both `LoginComponent.js` and `landing-auth.js` import from it.

---

## 2. Repetitive Code

### 2.1 `convertTo12Hour` — Three Implementations

| Location | Implementation |
|---|---|
| `admin/js/utils.js` → `convertTo12Hour(t)` | Splits `HH:MM`, handles hours/minutes |
| `user/src/utils/dateUtils.js` → `convertTo12Hour(time24)` | Similar, always outputs `:00` |
| `server.js` → `const fmt12h = t => { ... }` (inside `/api/notify-cancellation`) | Inline arrow, same logic |
| `admin/js/events.js` → `const fmt = v => { ... }` (inside `saveNewEvent`) | Another inline arrow |

All four do the same 12-hour conversion. The user-side version drops the minutes (always returns `:00`), which is a subtle bug difference worth fixing when consolidating.

**Recommendation:** The user-side `user/src/utils/dateUtils.js` already exports `convertTo12Hour`. Fix it to handle minutes properly. On the admin side, `admin/js/utils.js` already has a `convertTo12Hour` — remove all inline arrow duplicates and call the shared function. The server-side inline version in notification routes should be replaced with a utility in `server/utils/dateUtils.js`.

### 2.2 Forecast Algorithm — Fully Duplicated

`server.js` contains two complete forecast computation functions:

- **`computeForecast()`** (lines ~310–500): Used by `GET /api/forecast`, scoped to the last completed year. Uses local variable suffixes like `const nextWeekDate`, `targetWeek`, `sameWeekCounts`, `trendFactor`.
- **`generateForecastFromData()`** (lines ~700–950): Called on startup and on every request/status change. Uses the same seasonal baseline algorithm but with `G`-suffixed variable names (`nextWeekDateG`, `targetWeekG`, `sameWeekCountsG`, `trendFactorG`) — these are clearly copy-pasted with find-replace.

Both functions duplicate:
- The ISO-week seasonal baseline calculation
- The 4-week recent trend factor calculation
- The `getISOWeek()` helper call pattern
- Room analytics (utilization, peak days, trend)
- Recommendation generation logic

The two outputs differ slightly (one scopes to last year only, the other includes current year + 3-month predictions), but the core algorithm is identical.

**Recommendation:** Extract a single `computeRoomAnalytics(roomData, roomId, roomNames)` helper and a `computePrediction(roomData, getISOWeek)` helper. Both forecast functions call the same helpers with different data scopes.

### 2.3 `getWorkingDaysUntil` — Copy-Pasted

Identical logic appears in two places:

- `server.js` → `function getWorkingDaysUntil(dateStr)` (used by email reminders)
- `user/src/components/MyRequestsComponent.js` → `getWorkingDaysUntil(dateStr)` (used for payment reminder banners)

Both walk from today to a target date counting non-weekend days.

**Recommendation:** On the server, move to `server/utils/dateUtils.js`. On the client, it already lives in a component — move it to `user/src/utils/dateUtils.js` and export it.

### 2.4 Room Fallback Data — Six Hard-Coded Copies

The five-room list `[auditorium, library, grounds, avr, gym]` with their capacities and prices appears hardcoded in:

1. `admin/js/data.js` → `loadRooms()` catch block (fallback array)
2. `admin/js/reservations.js` → `populateRoomSelects()` fallback array
3. `admin/js/reservations.js` → `renderAdminFacilityPicker()` fallback array
4. `user/src/services/dataService.js` → `loadRooms()` catch block
5. `admin/js/data.js` → `ROOM_PRICE_FALLBACK` constant
6. `user/src/services/dataService.js` → `PRICE_FALLBACK` constant

These six copies must all be updated when a room is added, renamed, or repriced. The auditorium capacity is `700` in `rooms.json` and `1000` in the admin fallback and the chat bot responses — these are already out of sync.

**Recommendation:** `rooms.json` is the source of truth. The fallback arrays should all reference a single shared constant. On the admin side, define one `ROOMS_FALLBACK` in `admin/js/data.js` and import it (or make it globally available). On the user side, `dataService.js` already has one fallback constant — remove the duplicate in other files. The chat bot's hardcoded capacity strings (`1,000 pax`, `2,000 pax`) are also stale; the bot should read from `state.rooms`.

### 2.5 `ADMIN_MIN_PAX` — Duplicated Constant

The minimum-pax constraint per room:
```js
{ auditorium: 100, grounds: 50, library: 40, avr: 30, gym: 50 }
```
Appears in:
- `admin/js/reservations.js` → `const ADMIN_MIN_PAX`
- `user/src/components/ReservationModalComponent.js` → `static MIN_PAX`

**Recommendation:** This constraint should live in `rooms.json` as a `minPax` field on each room object, loaded once from the server. Both the admin and user layers read it from the data rather than maintaining parallel constants.

### 2.6 Email HTML Templates — No Shared Builder

`server.js` contains at least six separate inline HTML email templates, all sharing the same visual design (maroon header, table layout, office hours footer, automated notice disclaimer). The outer container style (`font-family:Arial, max-width:600px, border:1px solid #e2e8f0`) is repeated verbatim six times across:

- `PATCH /api/requests/:id` — admin edit email
- `checkAndSendReminders()` — payment reminder
- `POST /api/notify-appointment` — appointment email
- `POST /api/notify-cancellation` — cancellation email
- `POST /api/notify-edit` — edit notification email
- `POST /api/notify-rejection` — rejection email

**Recommendation:** Create a single `buildEmailHtml({ title, greeting, bodyHtml, footerNote })` function in `server/services/emailService.js`. Each route calls it with its specific content. The table rows for reservation details (`Facility`, `Date`, `Time`) also repeat — extract a `buildDetailTable(rows)` helper.

### 2.7 Conflict Detection — Parallel Implementations

Booking conflict checks exist independently in two layers:

- **Admin side** (`admin/js/utils.js`): `adminCheckConflict()` and `getAdminBookedHours()` — operates against the global `requests` array.
- **User side** (`user/src/services/reservationService.js`): `findConflict()`, `getBookedSlots()`, `isTimeSlotBooked()` — operates against `state.reservations`.

Both implement the same overlap logic: `startTime < endTime && endTime > startTime`. Both handle global blocks. Both exclude cancelled/refused statuses. The logic is sound but exists in two codebases that cannot share code at runtime (admin uses plain scripts; user uses ES modules).

**Recommendation:** This is acceptable given the architecture split, but the logic should be kept in sync. Document both as implementing the same spec, and add a comment referencing each other. If the admin is ever converted to ES modules, they can share `reservationService.js`.

### 2.8 Tab Switching — Duplicated Pattern

Nearly identical tab-switching code:
```js
document.querySelectorAll('.tab-trigger').forEach(t => t.classList.remove('active'));
document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
tab.classList.add('active');
document.getElementById(`${tab.dataset.tab}-tab`)?.classList.add('active');
```
Appears in:
- `admin/js/app.js` → `setupTabs()`
- `admin/js/editModal.js` → `savereservationChanges()` (the part that switches to the approved/confirmed tab after saving)

And separately in the user app:
- `user/src/app.js` → `handleTabClick(btn)`

The admin panel's post-save tab switch (switching to approved or confirmed tab) manually replicates the `setupTabs` logic instead of calling a `switchTab(name)` helper.

**Recommendation:** In the admin panel, extract `activateTab(tabName)` in `app.js` and expose it on `window`. Call `window.activateTab('approved')` in `editModal.js` and `blocks.js` instead of repeating the querySelectorAll pattern.

### 2.9 `loadData` After Every Action

In the admin panel, every mutation (`saveManualReservation`, `savereservationChanges`, `confirmQuickBlock`, `quickUnblock`, `cyclePaymentStatus`, `toggleDownPayment`, `toggleRemainingBalance`) ends with `await loadData()`, which refetches all four endpoints and rerenders all eight tabs. This pattern works but is expensive — a single payment status toggle causes a full data reload and eight re-renders.

**Recommendation:** This is a design pattern to note for future optimization. For now, it keeps data consistent. If performance becomes a concern, introduce optimistic updates: mutate the local `requests` array, rerender only the affected tab, and let the full refresh happen in the background.

### 2.10 `parseEventTime` — Duplicated in Admin and User

The function that converts `"9:00 AM - 4:00 PM"` into `["09:00", "16:00"]`:

- `admin/js/data.js` → `function parseEventTime(timeStr)` (global function)
- `user/src/services/dataService.js` → `_parseEventTime(timeStr)` (instance method)

Both do the same regex match on `(\d+):(\d+)\s*(AM|PM)` and the same AM/PM hour adjustment.

**Recommendation:** Since these are in separate runtime contexts, document them as intentional mirrors. If the admin is ever modularized, they can share one implementation.

---

## 3. Specific, Actionable Refactoring Suggestions

### Priority 1 — High Impact, Low Risk

#### A. Merge the two forecast functions in `server.js`

**Files:** `server.js` lines ~310–500 (`computeForecast`) and ~700–950 (`generateForecastFromData`)

Extract shared helpers:
```js
// server/services/forecastService.js
function computeRoomAnalytics(roomRes, roomId, roomNames, getISOWeek) { ... }
function computeSummary(allData, roomNames) { ... }
function computeRecommendations(roomAnalytics) { ... }
```
`computeForecast` calls these scoped to `lastYear` data only.
`generateForecastFromData` calls the same helpers on the full dataset.
This removes ~200 lines of duplicated logic.

#### B. Extract `buildEmailHtml()` helper

**Files:** `server.js` (six inline templates)

```js
// server/services/emailService.js
function buildEmailHtml(title, bodyHtml) {
    return `<div style="font-family:Arial,sans-serif;max-width:600px;...">
        <h2 style="color:#800020;">${title}</h2>
        ${bodyHtml}
        <hr ...>
        <p style="font-size:0.75rem;color:#94a3b8;">Automated notice from BCHS Reservation System.</p>
    </div>`;
}
```
Each route passes only its unique content. Eliminates ~120 lines of repeated HTML.

#### C. Move `getWorkingDaysUntil` to shared utilities

**Files:** `server.js` and `user/src/components/MyRequestsComponent.js`

Server: `server/utils/dateUtils.js` → export `getWorkingDaysUntil`.
Client: `user/src/utils/dateUtils.js` → add and export `getWorkingDaysUntil`.
Remove the copy from `MyRequestsComponent.js`.

#### D. Fix the `convertTo12Hour` minute-dropping bug and eliminate inline duplicates

**Files:** `user/src/utils/dateUtils.js`, `admin/js/utils.js`, `server.js`, `admin/js/events.js`

The user-side `convertTo12Hour` always outputs `:00` (it ignores the minutes). The admin-side version preserves minutes. Fix the user-side version to match, then remove all four inline arrow-function duplicates.

### Priority 2 — Medium Impact, Some Refactoring

#### E. Centralize `MIN_PAX` in `rooms.json`

**Files:** `admin/js/reservations.js`, `user/src/components/ReservationModalComponent.js`, `data/rooms.json`

Add `"minPax": 100` to each room in `rooms.json`. Both admin and user layers read it from the loaded room object. Remove both hardcoded constant definitions.

#### F. Add `activateTab(name)` helper to admin panel

**Files:** `admin/js/app.js`, `admin/js/editModal.js`, `admin/js/blocks.js`

```js
// admin/js/app.js
window.activateTab = function(tabName) {
    document.querySelectorAll('.tab-trigger').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    document.querySelector(`[data-tab="${tabName}"]`)?.classList.add('active');
    document.getElementById(`${tabName}-tab`)?.classList.add('active');
};
```
Call `window.activateTab('approved')` in `editModal.js` and `window.activateTab('confirmed')` in `blocks.js`. Removes ~8 repeated lines of querySelectorAll boilerplate.

#### G. Extract `authService` for the user-facing auth logic

**Files:** `user/src/components/LoginComponent.js`, `user/src/components/landing-auth.js`

```js
// user/src/services/authService.js
export const SESSION_KEYS = { logged: 'bchs_user_logged_in', data: 'bchs_user_data' };
export function getSession() { ... }
export function setSession(user) { ... }
export function clearSession() { ... }
export async function loadStaffData() { ... }
```
Both auth components import from here. The `localStorage` key names become a single point of truth.

#### H. Consolidate room fallback arrays

**Files:** `admin/js/data.js`, `admin/js/reservations.js`, `user/src/services/dataService.js`

Define one `ROOMS_FALLBACK` constant in `admin/js/data.js`:
```js
const ROOMS_FALLBACK = [
    { id: 'auditorium', name: 'Auditorium', capacity: 700, pricePerHour: 1800 },
    ...
];
```
Remove the duplicate arrays in `populateRoomSelects()` and `renderAdminFacilityPicker()` — both already check `rooms.length > 0` and fall back. Have them both use `ROOMS_FALLBACK`.

On the user side, `dataService.js`'s catch block is the only fallback — keep it there and align the capacity values with `rooms.json` (the auditorium is `700`, not `1000`).

### Priority 3 — Lower Risk, Code Clarity

#### I. Split `server.js` into route modules

This is the most impactful long-term change. Suggested first step — extract the notification routes (they are the most self-contained):
```
server/routes/notifications.js  -- all /api/notify-* handlers
server/services/emailService.js -- transporter + buildEmailHtml
```
Then extract the forecast endpoint:
```
server/routes/forecast.js
server/services/forecastService.js
```
Do one module at a time to avoid large diffs.

#### J. Delete dead code

- `user/api/save-request.js` — fully superseded by `server.js`'s `POST /api/requests`
- `user/data.ts` — orphaned TypeScript file with no build step

#### K. Fix the chat bot's stale hardcoded room data

**File:** `user/src/components/ChatComponent.js`

The bot hardcodes `"Gym: 2,000 pax"` and `"Auditorium: 1,000 pax"` in several response strings. The actual data in `rooms.json` is `gym: 300` and `auditorium: 700`. The bot already has access to `state.rooms` and `dataService.getRooms()` in the capacity handler — extend that pattern to the per-room info responses so they read live data instead of stale strings.

---

## Summary Table

| Issue | Files Involved | Effort | Risk |
|---|---|---|---|
| Duplicate forecast algorithm | `server.js` (2 functions) | High | Medium |
| Duplicate email templates | `server.js` (6 routes) | Medium | Low |
| `getWorkingDaysUntil` copy | `server.js`, `MyRequestsComponent.js` | Low | Low |
| `convertTo12Hour` copies | 4 locations | Low | Low |
| Room fallback arrays (6 copies) | 3 files | Low | Low |
| `MIN_PAX` duplicated constant | 2 files | Low | Low |
| Tab-switch boilerplate | `app.js`, `editModal.js`, `blocks.js` | Low | Low |
| Auth logic duplicated | `LoginComponent.js`, `landing-auth.js` | Medium | Medium |
| `parseEventTime` mirrored | `admin/data.js`, `dataService.js` | Low | Low |
| Dead code `save-request.js` | `user/api/save-request.js` | Trivial | None |
| `server.js` monolith | `server.js` | Very High | Medium |
| Chat bot stale room data | `ChatComponent.js` | Low | Low |
