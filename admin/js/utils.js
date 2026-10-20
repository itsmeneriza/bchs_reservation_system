/**
 * Admin Utilities
 * Pure helpers shared across all admin modules.
 */

// ─── Room Helpers ─────────────────────────────────────────────────────────────

function getRoomName(id) {
  if (id === "global") return "ALL FACILITIES";
  const r = (
    facilities && facilities.length > 0 ? facilities : RoomUtils.ROOMS_FALLBACK
  ).find((x) => x.id === id);
  return r ? r.name : RoomUtils.ROOM_NAMES[id] || id;
}

// ─── Time Formatters ─────────────────────────────────────────────────────────
// Delegates to shared DateUtils (loaded via <script src="/scripts/DateUtils.js"> in admin.html).

function convertTo12Hour(t) {
  return DateUtils.convertTo12Hour(t);
}

function formatApptTime(t) {
  return DateUtils.formatApptTime(t);
}

function formatDateSimple(d) {
  return d ? DateUtils.formatDateOnly(d) || "-" : "-";
}

function formatDateTimeSimple(d) {
  return d ? DateUtils.formatDateTime(d) || "-" : "-";
}

// ─── Time Option Builder ──────────────────────────────────────────────────────

function buildTimeOptions() {
  const options = [];
  for (let h = 7; h <= 18; h++) {
    for (let m of [0, 30]) {
      if (h === 18 && m === 30) continue;
      const hour12 = h % 12 || 12;
      const ampm = h < 12 ? "AM" : "PM";
      const label = `${hour12}:${m === 0 ? "00" : "30"} ${ampm}`;
      const value = `${String(h).padStart(2, "0")}:${m === 0 ? "00" : "30"}`;
      options.push(`<option value="${value}">${label}</option>`);
    }
  }
  return options.join("");
}

// ─── Staff Helpers ────────────────────────────────────────────────────────────

function isStaffMember(email) {
  if (!email) return false;
  return staff.some((s) => s.email.toLowerCase() === email.toLowerCase());
}

function isStaffRequest(req) {
  if (!req) return false;
  if (req.isStaff === true) return true;
  return isStaffMember(req.email);
}

// ─── Gradient Helper ─────────────────────────────────────────────────────────

const GRADIENT_PALETTES = [
  "linear-gradient(135deg, #667eea, #764ba2)",
  "linear-gradient(135deg, #f093fb, #f5576c)",
  "linear-gradient(135deg, #4facfe, #00f2fe)",
  "linear-gradient(135deg, #43e97b, #38f9d7)",
  "linear-gradient(135deg, #fa709a, #fee140)",
  "linear-gradient(135deg, #a18cd1, #fbc2eb)",
  "linear-gradient(135deg, #fccb90, #d57eeb)",
  "linear-gradient(135deg, #e0c3fc, #8ec5fc)",
  "linear-gradient(135deg, #f6d365, #fda085)",
  "linear-gradient(135deg, #96fbc4, #f9f586)",
];

function randomGradient() {
  const g =
    GRADIENT_PALETTES[Math.floor(Math.random() * GRADIENT_PALETTES.length)];
  return `__gradient__${g}`;
}

// ─── Toast ────────────────────────────────────────────────────────────────────

function showToast(m, t) {
  const el = document.createElement("div");
  el.className = `toast ${t}`;
  el.textContent = m;
  const container = document.getElementById("toastContainer");
  if (container) {
    container.appendChild(el);
    setTimeout(() => el.remove(), 3000);
  }
}

// ─── API Helper ───────────────────────────────────────────────────────────────

async function patchRequest(id, update) {
  const res = await fetch(`/api/requests/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(update),
  });
  if (!res.ok) console.warn("[WARN] patchRequest failed for", id);
  return res.ok;
}

// ─── Conflict Detection ───────────────────────────────────────────────────────

/**
 * Returns the set of booked hour-slots (e.g. '08:00') for a given facility + date,
 * excluding an optional reservationId (so edits don't conflict with themselves).
 */
function getAdminBookedHours(facilityId, dateStr, excludeId = null) {
  const takenHours = new Set();
  requests.forEach((r) => {
    if (r.id === excludeId) return;
    if (["cancelled", "refused", "rejected"].includes(r.status)) return;
    if (!["approved", "pending", "blocked"].includes(r.status)) return;
    const matchesRoom =
      r.facilityId === facilityId || r.facilityId === "global";
    if (!matchesRoom || r.date !== dateStr) return;
    const [startH, startM] = r.startTime.split(":").map(Number);
    const [endH, endM] = r.endTime.split(":").map(Number);
    // Walk in 30-minute increments from the booking's actual start to its end (exclusive)
    let cur = startH * 60 + startM;
    const endMins = endH * 60 + endM;
    while (cur < endMins) {
      const hh = String(Math.floor(cur / 60)).padStart(2, "0");
      const mm = cur % 60 === 0 ? "00" : "30";
      takenHours.add(`${hh}:${mm}`);
      cur += 30;
    }
  });
  return takenHours;
}

/**
 * Applies red styling to taken time options in a <select> element.
 * Clears red styling from options that are now free.
 */
function applyConflictStyling(selectEl, takenHours) {
  if (!selectEl) return;
  selectEl.querySelectorAll("option").forEach((opt) => {
    if (!opt.value) return;
    // Match both HH:00 and HH:30 keys
    const hourKey = opt.value.substring(0, 5);
    const isTaken = takenHours.has(hourKey);
    if (isTaken) {
      opt.style.color = "#ef4444";
      opt.style.backgroundColor = "#fee2e2";
      opt.disabled = true;
      if (!opt.textContent.includes("(Unavailable)")) {
        opt.textContent += " (Unavailable)";
      }
    } else {
      opt.style.color = "";
      opt.style.backgroundColor = "";
      opt.disabled = false;
      opt.textContent = opt.textContent.replace(" (Unavailable)", "");
    }
  });
  // Clear selection if currently selected option is now disabled
  if (selectEl.selectedOptions[0]?.disabled) selectEl.value = "";
}

/**
 * Refreshes conflict highlighting for the manual reservation modal.
 * Call whenever facility or date changes.
 */
window.refreshManualConflicts = function () {
  const facilityId = document.getElementById("manualRoom")?.value;
  const dateStr = document.getElementById("manualDate")?.value;
  const startTime = document.getElementById("manualStartTime")?.value;
  const endTime = document.getElementById("manualEndTime")?.value;
  if (!facilityId || !dateStr) return;
  const taken = getAdminBookedHours(facilityId, dateStr);
  applyConflictStyling(document.getElementById("manualStartTime"), taken);
  applyConflictStyling(document.getElementById("manualEndTime"), taken);

  // Show inline warning banner
  const banner = document.getElementById("manual-conflict-warning");
  if (!banner) return;
  const conflict = adminCheckConflict(facilityId, dateStr, startTime, endTime);
  if (conflict) {
    const isBlock = conflict.status === "blocked";
    banner.innerHTML = isBlock
      ? `<strong>Facility Unavailable</strong> — The facility is blocked for this time slot.`
      : `<strong>Time Conflict</strong> — This time overlaps with <em>${conflict.name}</em> (${conflict.startTime}–${conflict.endTime}).`;
    banner.style.display = "block";
  } else {
    banner.style.display = "none";
  }
};

/**
 * Refreshes conflict highlighting for the add/edit event modal.
 * Call whenever location or date changes.
 */
window.refreshEventConflicts = function () {
  const location = document.getElementById("eventLocation")?.value;
  const dateStr = document.getElementById("eventDate")?.value;
  const startTime = document.getElementById("eventStartTime")?.value;
  const endTime = document.getElementById("eventEndTime")?.value;
  if (!location || !dateStr) return;
  const facilityId = location.toLowerCase();
  const saveBtn = document.getElementById("saveEventBtn");
  const excluded = saveBtn?._editingId ? "event_" + saveBtn._editingId : null;
  const taken = getAdminBookedHours(facilityId, dateStr, excluded);
  applyConflictStyling(document.getElementById("eventStartTime"), taken);
  applyConflictStyling(document.getElementById("eventEndTime"), taken);

  // Show inline warning banner
  const banner = document.getElementById("event-conflict-warning");
  if (!banner) return;
  const conflict = adminCheckConflict(
    facilityId,
    dateStr,
    startTime,
    endTime,
    excluded,
  );
  if (conflict) {
    const isBlock = conflict.status === "blocked";
    banner.innerHTML = isBlock
      ? `<strong>Facility Unavailable</strong> — The facility is blocked for this time slot.`
      : `<strong>Time Conflict</strong> — This time overlaps with <em>${conflict.name}</em> (${conflict.startTime}–${conflict.endTime}).`;
    banner.style.display = "block";
  } else {
    banner.style.display = "none";
  }
};

/**
 * Returns the first conflicting reservation for the given facility/date/time range,
 * or null if the slot is free. Pass excludeId to skip a record (edit mode).
 */
function adminCheckConflict(
  facilityId,
  dateStr,
  startTime,
  endTime,
  excludeId = null,
) {
  if (!facilityId || !dateStr || !startTime || !endTime || startTime >= endTime)
    return null;
  return (
    requests.find((r) => {
      if (r.id === excludeId) return false;
      if (["cancelled", "refused", "rejected"].includes(r.status)) return false;
      if (!["approved", "accepted", "pending", "blocked"].includes(r.status))
        return false;
      const matchesRoom =
        r.facilityId === facilityId || r.facilityId === "global";
      if (!matchesRoom || r.date !== dateStr) return false;
      if (r.status === "blocked" && r.isFullDayBlock) return true;
      // Overlap: existing starts before new ends AND existing ends after new starts
      return r.startTime < endTime && r.endTime > startTime;
    }) || null
  );
}

// ─── Payment Helpers ──────────────────────────────────────────────────────────

/**
 * Computes the down payment amount based on the booking total.
 * - totalAmount <= 2000 → 50% of total
 * - totalAmount >  2000 → flat ₱2,000
 */
function computeDownPayment(totalAmount) {
  return totalAmount <= 2000 ? totalAmount / 2 : 2000;
}

/**
 * Computes the booking total from facility price, duration, and utility fee.
 * Utility fee (₱800) is added for bookings of 8 hours or more.
 * Staff bookings are always free.
 *
 * @param {number} pricePerHour
 * @param {string} startTime  "HH:MM"
 * @param {string} endTime    "HH:MM"
 * @param {boolean} isStaff
 * @returns {{ duration: number, facilityTotal: number, utilityFee: number, total: number }}
 */
function computeBookingTotal(pricePerHour, startTime, endTime, isStaff) {
  const [sH, sM] = startTime.split(":").map(Number);
  const [eH, eM] = endTime.split(":").map(Number);
  const duration = (eH * 60 + eM - (sH * 60 + sM)) / 60;
  const facilityTotal = isStaff ? 0 : pricePerHour * duration;
  const utilityFee = !isStaff && duration >= 8 ? 800 : 0;
  return {
    duration,
    facilityTotal,
    utilityFee,
    total: facilityTotal + utilityFee,
  };
}
