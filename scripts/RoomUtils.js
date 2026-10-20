/**
 * RoomUtils — single source of truth for facility fallback data and facility helpers.
 *
 * facilities.json is the live source of truth.  These fallback constants are used
 * only when the API call to /data/facilities.json fails.  All capacities, prices,
 * and minPax values must match facilities.json exactly.
 *
 * Export style: CommonJS + browser globals (same pattern as DateUtils.js).
 */

"use strict";

// ─── Fallback facility list (mirrors data/facilities.json) ─────────────────────────────
// Update both here AND in facilities.json when facility data changes.

const ROOMS_FALLBACK = [
  {
    id: "auditorium",
    name: "Auditorium",
    capacity: 700,
    pricePerHour: 1800,
    minPax: 100,
  },
  {
    id: "library",
    name: "Library",
    capacity: 100,
    pricePerHour: 1000,
    minPax: 40,
  },
  {
    id: "grounds",
    name: "Grounds",
    capacity: 180,
    pricePerHour: 700,
    minPax: 50,
  },
  { id: "avr", name: "AVR", capacity: 150, pricePerHour: 500, minPax: 30 },
  { id: "gym", name: "Gym", capacity: 300, pricePerHour: 1000, minPax: 50 },
];

// Convenience maps derived from the fallback list —
// these are also used when the live facilities array is available (same shape).

/** @type {{ [facilityId: string]: number }} */
const ROOM_PRICE_FALLBACK = Object.fromEntries(
  ROOMS_FALLBACK.map((r) => [r.id, r.pricePerHour]),
);

/** @type {{ [facilityId: string]: number }} */
const ROOM_MIN_PAX = Object.fromEntries(
  ROOMS_FALLBACK.map((r) => [r.id, r.minPax]),
);

/** @type {{ [facilityId: string]: string }} */
const ROOM_NAMES = Object.fromEntries(
  ROOMS_FALLBACK.map((r) => [r.id, r.name]),
);

// ─── Room helpers ─────────────────────────────────────────────────────────────

/**
 * Returns the display name for a facility id.
 * Accepts a live facilities array as optional second argument; falls back to
 * ROOMS_FALLBACK if the array is empty or not provided.
 *
 * @param {string}   id
 * @param {object[]} [liveRooms]
 * @returns {string}
 */
function getRoomName(id, liveRooms) {
  if (id === "global") return "ALL FACILITIES";
  const source = liveRooms && liveRooms.length > 0 ? liveRooms : ROOMS_FALLBACK;
  const r = source.find((x) => x.id === id);
  return r ? r.name : ROOM_NAMES[id] || id;
}

/**
 * Returns the price-per-hour for a facility.
 * Uses the live facilities array when available, falls back to ROOM_PRICE_FALLBACK.
 *
 * @param {string}   facilityId
 * @param {object[]} [liveRooms]
 * @returns {number}
 */
function getRoomPrice(facilityId, liveRooms) {
  const source = liveRooms && liveRooms.length > 0 ? liveRooms : ROOMS_FALLBACK;
  const facility = source.find((r) => r.id === facilityId);
  return facility
    ? facility.pricePerHour
    : (ROOM_PRICE_FALLBACK[facilityId] ?? 0);
}

/**
 * Returns the minimum pax for a facility, reading from the live facilities array first
 * (where facilities.json has a minPax field), then ROOM_MIN_PAX, then 0.
 *
 * @param {string}   facilityId
 * @param {object[]} [liveRooms]
 * @returns {number}
 */
function getRoomMinPax(facilityId, liveRooms) {
  const source = liveRooms && liveRooms.length > 0 ? liveRooms : ROOMS_FALLBACK;
  const facility = source.find((r) => r.id === facilityId);
  if (facility && facility.minPax != null) return facility.minPax;
  return ROOM_MIN_PAX[facilityId] ?? 0;
}

/**
 * Returns the effective facility list: liveRooms if non-empty, otherwise ROOMS_FALLBACK.
 *
 * @param {object[]} [liveRooms]
 * @returns {object[]}
 */
function getRooms(liveRooms) {
  return liveRooms && liveRooms.length > 0 ? liveRooms : ROOMS_FALLBACK;
}

// ─── Exports ──────────────────────────────────────────────────────────────────

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    ROOMS_FALLBACK,
    ROOM_PRICE_FALLBACK,
    ROOM_MIN_PAX,
    ROOM_NAMES,
    getRoomName,
    getRoomPrice,
    getRoomMinPax,
    getRooms,
  };
}

if (typeof window !== "undefined") {
  window.RoomUtils = {
    ROOMS_FALLBACK,
    ROOM_PRICE_FALLBACK,
    ROOM_MIN_PAX,
    ROOM_NAMES,
    getRoomName,
    getRoomPrice,
    getRoomMinPax,
    getRooms,
  };
}
