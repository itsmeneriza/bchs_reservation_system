/**
 * RoomUtils — single source of truth for room fallback data and room helpers.
 *
 * rooms.json is the live source of truth.  These fallback constants are used
 * only when the API call to /data/rooms.json fails.  All capacities, prices,
 * and minPax values must match rooms.json exactly.
 *
 * Export style: CommonJS + browser globals (same pattern as DateUtils.js).
 */

'use strict';

// ─── Fallback room list (mirrors data/rooms.json) ─────────────────────────────
// Update both here AND in rooms.json when room data changes.

const ROOMS_FALLBACK = [
    { id: 'auditorium', name: 'Auditorium', capacity: 700,  pricePerHour: 1800, minPax: 100 },
    { id: 'library',    name: 'Library',    capacity: 100,  pricePerHour: 1000, minPax: 40  },
    { id: 'grounds',    name: 'Grounds',    capacity: 180,  pricePerHour: 700,  minPax: 50  },
    { id: 'avr',        name: 'AVR',        capacity: 150,  pricePerHour: 500,  minPax: 30  },
    { id: 'gym',        name: 'Gym',        capacity: 300,  pricePerHour: 1000, minPax: 50  }
];

// Convenience maps derived from the fallback list —
// these are also used when the live rooms array is available (same shape).

/** @type {{ [roomId: string]: number }} */
const ROOM_PRICE_FALLBACK = Object.fromEntries(
    ROOMS_FALLBACK.map(r => [r.id, r.pricePerHour])
);

/** @type {{ [roomId: string]: number }} */
const ROOM_MIN_PAX = Object.fromEntries(
    ROOMS_FALLBACK.map(r => [r.id, r.minPax])
);

/** @type {{ [roomId: string]: string }} */
const ROOM_NAMES = Object.fromEntries(
    ROOMS_FALLBACK.map(r => [r.id, r.name])
);

// ─── Room helpers ─────────────────────────────────────────────────────────────

/**
 * Returns the display name for a room id.
 * Accepts a live rooms array as optional second argument; falls back to
 * ROOMS_FALLBACK if the array is empty or not provided.
 *
 * @param {string}   id
 * @param {object[]} [liveRooms]
 * @returns {string}
 */
function getRoomName(id, liveRooms) {
    if (id === 'global') return 'ALL FACILITIES';
    const source = (liveRooms && liveRooms.length > 0) ? liveRooms : ROOMS_FALLBACK;
    const r = source.find(x => x.id === id);
    return r ? r.name : (ROOM_NAMES[id] || id);
}

/**
 * Returns the price-per-hour for a room.
 * Uses the live rooms array when available, falls back to ROOM_PRICE_FALLBACK.
 *
 * @param {string}   roomId
 * @param {object[]} [liveRooms]
 * @returns {number}
 */
function getRoomPrice(roomId, liveRooms) {
    const source = (liveRooms && liveRooms.length > 0) ? liveRooms : ROOMS_FALLBACK;
    const room = source.find(r => r.id === roomId);
    return room ? room.pricePerHour : (ROOM_PRICE_FALLBACK[roomId] ?? 0);
}

/**
 * Returns the minimum pax for a room, reading from the live rooms array first
 * (where rooms.json has a minPax field), then ROOM_MIN_PAX, then 0.
 *
 * @param {string}   roomId
 * @param {object[]} [liveRooms]
 * @returns {number}
 */
function getRoomMinPax(roomId, liveRooms) {
    const source = (liveRooms && liveRooms.length > 0) ? liveRooms : ROOMS_FALLBACK;
    const room = source.find(r => r.id === roomId);
    if (room && room.minPax != null) return room.minPax;
    return ROOM_MIN_PAX[roomId] ?? 0;
}

/**
 * Returns the effective room list: liveRooms if non-empty, otherwise ROOMS_FALLBACK.
 *
 * @param {object[]} [liveRooms]
 * @returns {object[]}
 */
function getRooms(liveRooms) {
    return (liveRooms && liveRooms.length > 0) ? liveRooms : ROOMS_FALLBACK;
}

// ─── Exports ──────────────────────────────────────────────────────────────────

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        ROOMS_FALLBACK,
        ROOM_PRICE_FALLBACK,
        ROOM_MIN_PAX,
        ROOM_NAMES,
        getRoomName,
        getRoomPrice,
        getRoomMinPax,
        getRooms
    };
}

if (typeof window !== 'undefined') {
    window.RoomUtils = {
        ROOMS_FALLBACK,
        ROOM_PRICE_FALLBACK,
        ROOM_MIN_PAX,
        ROOM_NAMES,
        getRoomName,
        getRoomPrice,
        getRoomMinPax,
        getRooms
    };
}
