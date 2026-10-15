
/**
 * Date and Time Utilities
 */

/**
 * Converts a 24-hour time string ("HH:MM") to a 12-hour string ("H:MM AM/PM").
 * Minutes are preserved — the old version always output ":00" which was a bug.
 */
export function convertTo12Hour(time24) {
    if (!time24) return '';
    const [hStr, mStr] = time24.split(':');
    const h = parseInt(hStr, 10);
    const m = mStr || '00';
    const period = h >= 12 ? 'PM' : 'AM';
    const hour12 = h % 12 || 12;
    return `${hour12}:${m} ${period}`;
}

export function formatTimeSlot(slot) {
    const [start, end] = slot.split('-');
    return `${convertTo12Hour(start)} - ${convertTo12Hour(end)}`;
}

function parseDateForDisplay(value) {
    if (value instanceof Date) return value;
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
        const [year, month, day] = value.split('-').map(Number);
        return new Date(year, month - 1, day, 12);
    }
    return new Date(value);
}

export function formatDate(value) {
    const date = parseDateForDisplay(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
    });
}

export function formatDateTime(value) {
    const date = parseDateForDisplay(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit'
    });
}

export function getMonthYear(month, year) {
    const date = new Date(year, month);
    return date.toLocaleDateString('en-US', { 
        month: 'long', 
        year: 'numeric' 
    });
}

export function getDaysInMonth(month, year) {
    return new Date(year, month + 1, 0).getDate();
}

export function getFirstDayOfMonth(month, year) {
    return new Date(year, month, 1).getDay();
}

export function isToday(day, month, year) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const checkDate = new Date(year, month, day);
    checkDate.setHours(0, 0, 0, 0);
    return checkDate.getTime() === today.getTime();
}

export function isSameDate(date1, date2) {
    return date1.getFullYear() === date2.getFullYear() &&
           date1.getMonth() === date2.getMonth() &&
           date1.getDate() === date2.getDate();
}

export function isPastDate(date) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const checkDate = new Date(date);
    checkDate.setHours(0, 0, 0, 0);
    return checkDate < today;
}

/**
 * Returns local date string in YYYY-MM-DD format without UTC shift
 */
export function getLocalISODate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

/**
 * Validates a Philippine mobile number.
 * Accepts the 10-digit form after +63 (e.g. 9171234567).
 * Strips spaces and dashes before testing.
 */
export function isValidPHPhone(raw) {
    return /^9\d{9}$/.test(raw.replace(/\s|-/g, ''));
}

/**
 * Normalises a validated PH number to 09XXXXXXXXX format.
 */
export function normalizePHPhone(raw) {
    return '0' + raw.replace(/\s|-/g, '');
}

/**
 * Returns the number of working days (Mon–Fri) between today and a target date.
 * Used by MyRequestsComponent for payment reminder banners.
 * Mirrors the same function in scripts/DateUtils.js (server-side copy).
 *
 * @param {string} dateStr  e.g. "2026-11-15"
 * @returns {number}
 */
export function normalizeEventId(id) {
    if (typeof id !== 'string') return id;
    if (id.startsWith('evt_')) return id.slice(4);
    if (id.startsWith('event_')) return id.slice(6);
    return id;
}

export function getWorkingDaysUntil(dateStr) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const target = new Date(dateStr + 'T12:00:00');
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

/**
 * Parses an event time range string like "9:00 AM - 4:00 PM" into a
 * [startTime24, endTime24] tuple, e.g. ["09:00", "16:00"].
 * Mirrors scripts/DateUtils.js parseEventTime.
 *
 * @param {string} timeStr
 * @returns {[string, string]}
 */
export function parseEventTime(timeStr) {
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
