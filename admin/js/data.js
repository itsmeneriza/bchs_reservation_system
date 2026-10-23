/**
 * Admin Data Loader
 * Fetches facilities, staff, requests, and events from the server API.
 * Shared logic: DateUtils (parseEventTime)
 * loaded via <script src="/scripts/FacilityUtils.js"> and <script src="/scripts/DateUtils.js">
 * before this file in admin.html — available as window.FacilityUtils and window.DateUtils.
 */

// ─── Load All ─────────────────────────────────────────────────────────────────

async function loadData() {
  try {
    await Promise.all([loadFacilities(), loadRequests(), loadStaff(), loadEvents()]);
    renderAll();
    renderAdminEvents();
  } catch (error) {
    console.error("Error loading data:", error);
    showToast(error.message || "Could not load admin data.", "error");
  }
}

// ─── Facilities ────────────────────────────────────────────────────────────────────

async function loadFacilities() {
  const response = await fetch("/api/facilities");
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || `Facilities API returned ${response.status}.`);
  }
  if (!Array.isArray(data.facilities)) {
    throw new Error("Facilities API response did not contain a facilities list.");
  }
  facilities = data.facilities;
  populateFacilitySelects();
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
      const combined = data.requests || [];

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
    if (!res.ok) {
      throw new Error(`Events API returned ${res.status}.`);
    }
    const data = await res.json();
    if (!Array.isArray(data.events)) {
      throw new Error("Events API response did not contain an events list.");
    }
    adminEvents = data.events;

    // Remove previously merged synthetic entries to avoid duplicates.
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
        facilityId: ev.facilityId || ev.location.toLowerCase(),
        facilityName: ev.location,
        name: ev.title,
        date: ev.date,
        startTime: start,
        endTime: end,
        purpose: ev.description || ev.title,
        status: "approved",
        paymentStatus: "paid",
        totalAmount: 0,
        isSchoolEvent: true,
        submittedAt: ev.date + "T00:00:00.000Z",
      });
    });
  } catch (error) {
    adminEvents = [];
    console.error("Could not load events from Supabase:", error);
  }
}

// ─── Event Time Parser ────────────────────────────────────────────────────────
// Delegates to shared DateUtils (loaded before this file in admin.html).

function parseEventTime(timeStr) {
  return DateUtils.parseEventTime(timeStr);
}
