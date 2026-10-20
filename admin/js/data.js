/**
 * Admin Data Loader
 * Fetches facilities, staff, requests, and events from the server API.
 * Shared logic: RoomUtils (fallback data), DateUtils (parseEventTime)
 * loaded via <script src="/scripts/RoomUtils.js"> and <script src="/scripts/DateUtils.js">
 * before this file in admin.html — available as window.RoomUtils and window.DateUtils.
 */

// ─── Load All ─────────────────────────────────────────────────────────────────

async function loadData() {
  try {
    await Promise.all([loadFacilities(), loadRequests(), loadStaff(), loadEvents()]);
    renderAll();
    renderAdminEvents();
  } catch (error) {
    console.error("Error loading data:", error);
  }
}

// ─── Facilities ────────────────────────────────────────────────────────────────────

async function loadFacilities() {
  try {
    const response = await fetch("/api/facilities");
    if (response.ok) {
      const data = await response.json();
      facilities = data.facilities || [];
    }
  } catch (e) {
    facilities = RoomUtils.ROOMS_FALLBACK;
  }
  populateRoomSelects();
  if (
    document.getElementById("addReservationModal")?.classList.contains("active")
  ) {
    updateManualPricing();
  }
}

// ─── Staff ────────────────────────────────────────────────────────────────────

async function loadStaff() {
  try {
    const response = await fetch("/api/staff");
    if (response.ok) {
      const data = await response.json();
      staff = data.staff || [];
    }
  } catch (e) {
    staff = [];
  }
}

// ─── Requests ─────────────────────────────────────────────────────────────────

async function loadRequests() {
  try {
    const res = await fetch("/api/requests");
    if (res.ok) {
      const data = await res.json();
      const serverRequests = data.requests || [];

      // Merge with accepted.json
      let acceptedEntries = [];
      try {
        const r = await fetch("/api/accepted");
        if (r.ok) {
          const d = await r.json();
          acceptedEntries = (d.accepted || []).map((b) => ({
            ...b,
            status: "approved",
          }));
        }
      } catch (e) {}

      const combined = [...serverRequests];
      acceptedEntries.forEach((s) => {
        if (!combined.find((c) => c.id === s.id)) combined.push(s);
      });

      // Deduplicate by ID — keep the last occurrence so edits win over originals
      const seen = new Map();
      combined.forEach((r) => seen.set(r.id, r));
      requests = Array.from(seen.values());
    }
  } catch (e) {
    console.warn("[WARN] Could not load requests from server");
  }
}

// ─── Events ───────────────────────────────────────────────────────────────────

async function loadEvents() {
  try {
    const res = await fetch("/api/events");
    if (res.ok) {
      const data = await res.json();
      adminEvents = data.events || [];

      // Remove previously merged synthetic entries to avoid duplicates
      requests = requests.filter((r) => {
        const id = typeof r?.id === "string" ? r.id : "";
        return !id.startsWith("evt_") && !id.startsWith("event_");
      });

      adminEvents.forEach((ev) => {
        const syntheticId = "evt_" + ev.id;
        if (requests.find((r) => r.id === syntheticId)) return;
        const [start, end] = parseEventTime(ev.time);
        requests.push({
          id: syntheticId,
          facilityId: ev.location.toLowerCase(),
          facilityName: ev.location,
          name: ev.title,
          date: ev.date,
          startTime: start,
          endTime: end,
          purpose: ev.description || ev.title,
          attendees: ev.attendees || 0,
          status: "approved",
          paymentStatus: "paid",
          totalAmount: 0,
          isSchoolEvent: true,
          submittedAt: ev.date + "T00:00:00.000Z",
        });
      });
      return;
    }
  } catch (e) {}
  adminEvents = [];
}

// ─── Event Time Parser ────────────────────────────────────────────────────────
// Delegates to shared DateUtils (loaded before this file in admin.html).

function parseEventTime(timeStr) {
  return DateUtils.parseEventTime(timeStr);
}
