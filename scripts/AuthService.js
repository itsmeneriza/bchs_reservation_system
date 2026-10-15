/**
 * AuthService — shared authentication helpers used by both the reservation
 * app (LoginComponent.js) and the landing page (landing-auth.js).
 *
 * Owns:
 *   - localStorage key names (single source of truth)
 *   - session read/write/clear helpers
 *   - PH phone validation and normalisation
 *   - staff-data loader
 *
 * Export style: ES module default export + named exports.
 * Both LoginComponent.js and landing-auth.js import from this file.
 *
 * Note: landing-auth.js is a plain IIFE script, not an ES module.
 * It is converted to import from AuthService in this refactor.
 * If landing-auth.js is ever reverted to a plain script, replace the import
 * with a <script type="module"> tag or inline the helpers.
 */

// ─── Session key names ────────────────────────────────────────────────────────

export const SESSION_KEYS = {
    loggedIn: 'bchs_user_logged_in',
    userData: 'bchs_user_data'
};

// ─── Session helpers ──────────────────────────────────────────────────────────

/**
 * Returns the current session user object, or null if not logged in.
 *
 * @returns {object|null}
 */
export function getSession() {
    try {
        const isLoggedIn = localStorage.getItem(SESSION_KEYS.loggedIn) === 'true';
        const userData = JSON.parse(localStorage.getItem(SESSION_KEYS.userData) || 'null');
        return isLoggedIn && userData ? userData : null;
    } catch {
        return null;
    }
}

/**
 * Persists a user session to localStorage.
 *
 * @param {object} user
 */
export function setSession(user) {
    localStorage.setItem(SESSION_KEYS.loggedIn, 'true');
    localStorage.setItem(SESSION_KEYS.userData, JSON.stringify(user));
}

/**
 * Removes the current session from localStorage.
 */
export function clearSession() {
    localStorage.removeItem(SESSION_KEYS.loggedIn);
    localStorage.removeItem(SESSION_KEYS.userData);
}

/**
 * Returns true if a valid session exists.
 *
 * @returns {boolean}
 */
export function isLoggedIn() {
    return getSession() !== null;
}

// ─── PH phone helpers ─────────────────────────────────────────────────────────

/**
 * Returns true if the raw input is a valid Philippine mobile number in the
 * 9XXXXXXXXX (10-digit) form used after the +63 country code.
 * Strips spaces and dashes before testing.
 *
 * @param {string} raw
 * @returns {boolean}
 */
export function isValidPHPhone(raw) {
    return /^9\d{9}$/.test((raw || '').replace(/\s|-/g, ''));
}

/**
 * Normalises a validated PH number to the 09XXXXXXXXX format.
 *
 * @param {string} raw
 * @returns {string}
 */
export function normalizePHPhone(raw) {
    return '0' + (raw || '').replace(/\s|-/g, '');
}

// ─── Staff data loader ────────────────────────────────────────────────────────

/**
 * Fetches the staff directory from /data/staff.json.
 * Returns the staff array, or an empty array on failure.
 *
 * @returns {Promise<object[]>}
 */
export async function loadStaffData() {
    try {
        const response = await fetch('/data/staff.json');
        if (response.ok) {
            const data = await response.json();
            return data.staff || [];
        }
    } catch (e) {
        console.error('Failed to load staff directory', e);
    }
    return [];
}

/**
 * Looks up a staff member by ID (case-insensitive).
 *
 * @param {object[]} staffData
 * @param {string}   staffId
 * @returns {object|null}
 */
export function findStaffById(staffData, staffId) {
    if (!staffId || !Array.isArray(staffData)) return null;
    return staffData.find(s => s.id.toLowerCase() === staffId.toLowerCase()) || null;
}
