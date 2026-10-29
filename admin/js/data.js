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
    await Promise.all([loadFacilities(), loadStaff()]);
    await loadRequests();
    await loadEvents();
    mergeAdminEventsIntoRequests();
    renderAll();
    renderAdminEvents();
  } catch (error) {
    requests = [];
    mergeAdminEventsIntoRequests();
    renderAll();
    renderAdminEvents();
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
  const response = await window.adminFetch("/api/requests");
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      data.message || `Reservations API returned ${response.status}.`,
    );
  }
  if (!Array.isArray(data.requests)) {
    throw new Error("Reservations API response did not contain a reservation list.");
  }

  // Deduplicate by ID — keep the last occurrence so edits win over originals.
  const seen = new Map();
  data.requests.forEach((request) => seen.set(request.id, request));
  requests = Array.from(seen.values());
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

  } catch (error) {
    adminEvents = [];
    console.error("Could not load events from Supabase:", error);
  }
}

function mergeAdminEventsIntoRequests() {
  requests = requests.filter((request) => {
    const id = typeof request?.id === "string" ? request.id : "";
    return !id.startsWith("evt_") && !id.startsWith("event_");
  });

  adminEvents.forEach((event) => {
    const syntheticId = "evt_" + event.id;
    const [start, end] = parseEventTime(event.time);
    requests.push({
      id: syntheticId,
      facilityId: event.facilityId || event.location.toLowerCase(),
      facilityName: event.location,
      name: event.title,
      date: event.date,
      startTime: start,
      endTime: end,
      purpose: event.description || event.title,
      status: "approved",
      paymentStatus: "paid",
      totalAmount: 0,
      isSchoolEvent: true,
      submittedAt: event.date + "T00:00:00.000Z",
    });
  });
}

// ─── Event Time Parser ────────────────────────────────────────────────────────
// Delegates to shared DateUtils (loaded before this file in admin.html).

function parseEventTime(timeStr) {
  return DateUtils.parseEventTime(timeStr);
}
