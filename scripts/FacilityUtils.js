/**
 * Facility helpers for browser scripts.
 * Facility records are loaded from the Supabase-backed /api/facilities endpoint.
 */

"use strict";

function getFacilityName(id, liveFacilities = []) {
  if (id === "global") return "ALL FACILITIES";
  return liveFacilities.find((facility) => facility.id === id)?.name || id;
}

function getFacilityPrice(facilityId, liveFacilities = []) {
  return liveFacilities.find((facility) => facility.id === facilityId)
    ?.pricePerHour ?? 0;
}

function getFacilityMinPax(facilityId, liveFacilities = []) {
  return liveFacilities.find((facility) => facility.id === facilityId)?.minPax ?? 0;
}

function getFacilities(liveFacilities = []) {
  return liveFacilities;
}

const facilityUtils = {
  getFacilityName,
  getFacilityPrice,
  getFacilityMinPax,
  getFacilities,
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = facilityUtils;
}

if (typeof window !== "undefined") {
  window.FacilityUtils = facilityUtils;
}
