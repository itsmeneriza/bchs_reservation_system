/**
 * DateUtils — shared date/time helpers used by both the server (CommonJS)
 * and, when bundled or imported as an ES module, by the admin and user layers.
 *
 * Export style: CommonJS (module.exports) so server.js can require() it.
 * The admin panel loads it as a plain <script> tag, so every export is also
 * attached to `globalThis` at the bottom for browser use without a bundler.
 */

'use strict';

// ─── 12-hour formatter ────────────────────────────────────────────────────────

/**
 * Converts a 24-hour time string ("HH:MM") to a 12-hour string ("H:MM AM/PM").
 * Preserves minutes — fixes the bug in the old user-side version that always
 * output ":00".
 *
 * @param {string} t  e.g. "14:30"
 * @returns {string}  e.g. "2:30 PM"
 */
function convertTo12Hour(t) {
    if (!t) return '';
    const [hStr, mStr] = t.split(':');
    const h = parseInt(hStr, 10);
    const m = mStr || '00';
    return `${h % 12 || 12}:${m} ${h >= 12 ? 'PM' : 'AM'}`;
}

// ─── Appointment-time formatter ───────────────────────────────────────────────

/**
 * Formats an appointment time string that may already be in 12-hour format or
 * arrive as a 24-hour string.  Pass-through if already contains AM/PM.
 *
 * @param {string} t
 * @returns {string}
 */
function formatApptTime(t) {
    if (!t) return '';
    if (t.includes('AM') || t.includes('PM')) return t;
    return convertTo12Hour(t);
}

// ─── Working days counter ─────────────────────────────────────────────────────

/**
 * Parses a date-only string without shifting days in timezones west of UTC.
 * This avoids bugs caused by `new Date('YYYY-MM-DD')` being treated as UTC.
 *
 * @param {string|Date} value
 * @returns {Date}
 */
function parseDateOnly(value) {
    if (!value) return new Date(NaN);
    if (value instanceof Date) return new Date(value.getTime());
    if (typeof value !== 'string') return new Date(value);

    const trimmed = value.trim();
    if (!trimmed) return new Date(NaN);

    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
        const [year, month, day] = trimmed.split('-').map(Number);
        return new Date(year, month - 1, day, 12, 0, 0, 0);
    }

    const parsed = new Date(trimmed);
    return Number.isNaN(parsed.getTime()) ? new Date(NaN) : parsed;
}

/**
 * Formats a date as "Oct 22, 2026" without shifting date-only values.
 *
 * @param {string|Date} value
 * @returns {string}
 */
function formatDateOnly(value) {
    const date = parseDateOnly(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
    });
}

/**
 * Formats a date and time with an abbreviated month name.
 *
 * @param {string|Date} value
 * @returns {string}
 */
function formatDateTime(value) {
    const date = parseDateOnly(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit'
    });
}

/**
 * Normalises event ids that may be stored with synthetic prefixes such as
 * "evt_123" or "event_123". This is shared across the admin and user layers.
 *
 * @param {string|number} id
 * @returns {string|number}
 */
function normalizeEventId(id) {
    if (typeof id !== 'string') return id;
    if (id.startsWith('evt_')) return id.slice(4);
    if (id.startsWith('event_')) return id.slice(6);
    return id;
}

/**
 * Returns the number of working days (Mon–Fri) between today and a target date.
 * Used by the server's email reminder and by MyRequestsComponent for payment banners.
 *
 * @param {string} dateStr  ISO date string, e.g. "2026-11-15"
 * @returns {number}
 */
function getWorkingDaysUntil(dateStr) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const target = parseDateOnly(dateStr);
    target.setHours(0, 0, 0, 0);
    let count = 0;
    const current = new Date(today);
    while (current < target) {
        current.setDate(current.getDate() + 1);
        const day = current.getDay();
        if (day !== 0 && day !== 6) count++;
    }
    return count;
}

// ─── ISO week number ──────────────────────────────────────────────────────────

/**
 * Returns the ISO week number (1–53) for a given Date object.
 * Used by both forecast functions in server.js.
 *
 * @param {Date} date
 * @returns {number}
 */
function getISOWeek(date) {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

// ─── Event-time parser ────────────────────────────────────────────────────────

/**
 * Parses an event time range string like "9:00 AM - 4:00 PM" into a
 * [startTime24, endTime24] tuple, e.g. ["09:00", "16:00"].
 * Used by admin/js/data.js and user/src/services/dataService.js.
 *
 * @param {string} timeStr
 * @returns {[string, string]}
 */
function parseEventTime(timeStr) {
    if (!timeStr) return ['08:00', '17:00'];
    const parts = timeStr.split('-').map(s => s.trim());
    return parts.map(p => {
        const match = p.match(/(\d+):(\d+)\s*(AM|PM)/i);
        if (!match) return '08:00';
        let h = parseInt(match[1], 10);
        const m = match[2];
        const ampm = match[3].toUpperCase();
        if (ampm === 'PM' && h !== 12) h += 12;
        if (ampm === 'AM' && h === 12) h = 0;
        return `${String(h).padStart(2, '0')}:${m}`;
    });
}

// ─── PH phone helpers ─────────────────────────────────────────────────────────

/**
 * Returns true if the raw input is a valid Philippine mobile number in the
 * 9XXXXXXXXX (10-digit) form used after the +63 country code.
 *
 * @param {string} raw
 * @returns {boolean}
 */
function isValidPHPhone(raw) {
    return /^9\d{9}$/.test((raw || '').replace(/\s|-/g, ''));
}

/**
 * Normalises a validated PH number to the 09XXXXXXXXX format.
 *
 * @param {string} raw
 * @returns {string}
 */
function normalizePHPhone(raw) {
    return '0' + (raw || '').replace(/\s|-/g, '');
}

// ─── Exports ──────────────────────────────────────────────────────────────────

// CommonJS — for server.js (Node)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        convertTo12Hour,
        formatApptTime,
        parseDateOnly,
        formatDateOnly,
        formatDateTime,
        normalizeEventId,
        getWorkingDaysUntil,
        getISOWeek,
        parseEventTime,
        isValidPHPhone,
        normalizePHPhone
    };
}

// Browser globals — for admin panel plain-script tags
if (typeof window !== 'undefined') {
    window.DateUtils = {
        convertTo12Hour,
        formatApptTime,
        parseDateOnly,
        formatDateOnly,
        formatDateTime,
        normalizeEventId,
        getWorkingDaysUntil,
        getISOWeek,
        parseEventTime,
        isValidPHPhone,
        normalizePHPhone
    };
}
