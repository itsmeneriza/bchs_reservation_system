/**
 * Admin Reservations Module
 * Manual reservation creation, tab renders (Queue, Confirmed, Approved, Upcoming, History, Cancellations).
 * Facility records are loaded from the Supabase-backed /api/facilities endpoint.
 */

// ─── Facility Helpers ─────────────────────────────────────────────────────────────
function _getAdminFacilities() {
  return Array.isArray(facilities) ? facilities : [];
}

function _getAdminMinPax(facilityId) {
  const facility = _getAdminFacilities().find((r) => r.id === facilityId);
  return facility?.minPax ?? 0;
}

function _getAdminFacilityPrice(facilityId) {
  return _getAdminFacilities().find((r) => r.id === facilityId)?.pricePerHour ?? 0;
}

function refreshManualFacilityPicker() {
  renderAdminFacilityPicker();
}

let manualStaffProfile = null;
let manualStaffLookupVersion = 0;

function setManualStaffLookupStatus(message, color = "#64748b") {
  const status = document.getElementById("manualStaffLookupStatus");
  if (!status) return;
  status.textContent = message;
  status.style.color = color;
}

function clearManualStaffDetails() {
  manualStaffProfile = null;
  ["manualName", "manualEmail"].forEach((id) => {
    const input = document.getElementById(id);
    if (!input) return;
    input.value = "";
    input.readOnly = false;
    input.style.removeProperty("background");
    input.style.removeProperty("color");
    input.style.removeProperty("cursor");
  });
}

window.invalidateManualStaffLookup = function () {
  manualStaffLookupVersion += 1;
  clearManualStaffDetails();
  setManualStaffLookupStatus("Staff ID changed. Leave the field to look up details.");
};

window.toggleManualRequesterType = function () {
  const staffToggle = document.getElementById("manualIsStaff");
  if (!staffToggle) return;
  staffToggle.checked = !staffToggle.checked;
  updateManualRequesterFields();
  updateManualPricing();
};

function updateManualRequesterFields() {
  const isStaff = document.getElementById("manualIsStaff")?.checked || false;
  const staffIdGroup = document.getElementById("manualStaffIdGroup");
  const nameGroup = document.getElementById("manualNameGroup");
  const contactNumberGroup = document.getElementById("manualContactNumberGroup");
  const nameLabel = document.getElementById("manualNameLabel");
  const contactNumber = document.getElementById("manualContactNumber");

  if (staffIdGroup) staffIdGroup.style.display = isStaff ? "block" : "none";
  if (staffIdGroup) staffIdGroup.classList.toggle("full-width", !isStaff);
  if (nameGroup) nameGroup.classList.toggle("full-width", !isStaff);
  if (contactNumberGroup)
    contactNumberGroup.style.display = isStaff ? "none" : "block";
  if (nameLabel)
    nameLabel.textContent = isStaff
      ? "Full Name *"
      : "Name *";
  if (contactNumber) {
    contactNumber.value = "";
  }
  const staffIdInput = document.getElementById("manualStaffId");
  if (staffIdInput) staffIdInput.value = "";
  manualStaffLookupVersion += 1;
  clearManualStaffDetails();
  setManualStaffLookupStatus(
    isStaff ? "Enter the staff ID number to load staff details." : "",
  );
}

window.lookupManualStaff = async function () {
  const isStaff = document.getElementById("manualIsStaff")?.checked || false;
  const staffId = document.getElementById("manualStaffId")?.value.trim() || "";
  if (!isStaff || !staffId) return;
  if (manualStaffProfile?.staffId === staffId) return;

  const lookupVersion = ++manualStaffLookupVersion;
  manualStaffProfile = null;
  setManualStaffLookupStatus("Looking up staff details...");

  try {
    const response = await window.adminFetch(
      `/api/admin/staff/${encodeURIComponent(staffId)}`,
    );
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(result.message || "Could not find that staff ID.");
    }
    if (
      lookupVersion !== manualStaffLookupVersion ||
      staffId !== document.getElementById("manualStaffId")?.value.trim()
    ) {
      return;
    }

    const staff = result.staff;
    if (!staff?.id || !staff.fullName || !staff.email) {
      throw new Error("This staff record is missing a name or email address.");
    }

    manualStaffProfile = staff;
    ["manualName", "manualEmail"].forEach((id) => {
      const input = document.getElementById(id);
      if (!input) return;
      input.readOnly = true;
      input.style.background = "#f1f5f9";
      input.style.color = "#64748b";
      input.style.cursor = "not-allowed";
    });
    document.getElementById("manualName").value = staff.fullName;
    document.getElementById("manualEmail").value = staff.email;
    setManualStaffLookupStatus(`Staff found: ${staff.fullName}`, "#15803d");
  } catch (error) {
    if (lookupVersion !== manualStaffLookupVersion) return;
    clearManualStaffDetails();
    setManualStaffLookupStatus(error.message, "#b91c1c");
  }
};

// ─── Render All Tabs ──────────────────────────────────────────────────────────

function renderAll() {
  renderQueue();
  renderConfirmed();
  renderApproved();
  renderUpcoming();
  renderPayments();
  renderReschedulingRequests();
  renderCancellations();
  renderHistory();
  renderCalendar();
}

function needsRescheduleReview(request) {
  return !!(
    request.blockReschedulePending ||
    request.rescheduleRequestedAt ||
    request.rescheduleReason ||
    request.rescheduledDate ||
    request.rescheduledStartTime ||
    request.rescheduledEndTime
  );
}

function getReschedulingRequests() {
  return requests
    .filter(
      (request) =>
        (["approved", "accepted"].includes(request.status) ||
          (request.status === "pending" && request.blockReschedulePending)) &&
        !request.isSchoolEvent &&
        !request.isFullDayBlock &&
        needsRescheduleReview(request),
    )
    .sort((a, b) => a.date.localeCompare(b.date));
}

// ─── Facility Selects / Facility Picker ──────────────────────────────────────────

function populateFacilitySelects() {
  const source = _getAdminFacilities();

  const editEl = document.getElementById("editFacilityId");
  if (editEl)
    editEl.innerHTML = source
      .map(
        (r) => `<option value="${escapeAdminText(r.id)}">${escapeAdminText(r.name)} (${r.capacity} pax)</option>`,
      )
      .join("");

  const eventLocation = document.getElementById("eventLocation");
  if (eventLocation) {
    const selectedFacilityId =
      facilities.find((facility) => facility.name === eventLocation.value)?.id ||
      eventLocation.value;
    eventLocation.innerHTML = source.length
      ? source
          .map(
            (facility) =>
              `<option value="${escapeAdminText(facility.name)}" data-facility-id="${escapeAdminText(facility.id)}">${escapeAdminText(facility.name)}</option>`,
          )
          .join("")
      : '<option value="">No facilities available</option>';
    const selectedFacility = facilities.find(
      (facility) =>
        facility.id === selectedFacilityId || facility.name === selectedFacilityId,
    );
    if (selectedFacility) eventLocation.value = selectedFacility.name;
  }

  renderAdminFacilityPicker();
  if (
    document.getElementById("addReservationModal")?.classList.contains("active")
  )
    updateManualPricing();
}

window.renderAdminFacilityPicker = function (filterPax) {
  const row = document.getElementById("admin-facility-row");
  if (!row) return;
  const source = _getAdminFacilities();
  if (filterPax === undefined)
    filterPax =
      parseInt(document.getElementById("manualAttendees")?.value) || 0;
  const currentVal =
    document.getElementById("manualFacility")?.value || source[0]?.id || "";
  const selectedDate = document.getElementById("manualDate")?.value || "";
  const startTime = document.getElementById("manualStartTime")?.value || "";
  const endTime = document.getElementById("manualEndTime")?.value || "";
  const isGroundsWeekend = isAdminWeekendDate(selectedDate);

  if (!source.length) {
    row.innerHTML = '<p class="empty-message">No facilities are available.</p>';
    return;
  }
  row.innerHTML = source
    .map((r) => {
      const tooSmall = filterPax > 0 && r.capacity < filterPax;
      const groundsUnavailable =
        isAdminGroundsFacility(r.id) && isGroundsWeekend;
      const conflict =
        selectedDate && startTime && endTime
          ? adminCheckConflict(r.id, selectedDate, startTime, endTime)
          : null;
      const timeUnavailable = Boolean(conflict);
      const isSelected = r.id === currentVal;
      const unavailable = tooSmall || groundsUnavailable || timeUnavailable;
      const unavailableReason = groundsUnavailable
        ? "Grounds are unavailable on Saturdays and Sundays"
        : timeUnavailable
          ? conflict.status === "blocked"
            ? "Facility is blocked for this date and time"
            : `Time conflicts with ${conflict.name} (${conflict.startTime}–${conflict.endTime})`
          : tooSmall
            ? `Capacity: ${r.capacity} pax — too small for ${filterPax} attendees`
            : `${r.name} · up to ${r.capacity} pax`;
      return `<button type="button"
            class="admin-facility-pill${isSelected ? " selected" : ""}${unavailable ? " disabled" : ""}"
            ${unavailable ? "disabled" : ""}
            title="${escapeAdminText(unavailableReason)}"
            onclick="selectAdminFacility(${escapeAdminJsArgument(r.id)})">
            <span class="facility-pill-name">${escapeAdminText(r.name)}</span>
            <span class="facility-pill-cap">${timeUnavailable ? "Unavailable" : `${r.capacity} pax`}</span>
        </button>`;
    })
    .join("");
};

window.selectAdminFacility = function (facilityId) {
  const date = document.getElementById("manualDate")?.value || "";
  const startTime = document.getElementById("manualStartTime")?.value || "";
  const endTime = document.getElementById("manualEndTime")?.value || "";
  if (
    isAdminGroundsFacility(facilityId) &&
    isAdminWeekendDate(date)
  ) {
    showToast("Grounds are unavailable on Saturdays and Sundays.", "error");
    return;
  }
  const conflict = adminCheckConflict(facilityId, date, startTime, endTime);
  if (conflict) {
    showToast(
      conflict.status === "blocked"
        ? "This facility is blocked for the selected date and time."
        : `This facility conflicts with "${conflict.name}" (${conflict.startTime}–${conflict.endTime}).`,
      "error",
    );
    return;
  }
  const hiddenInput = document.getElementById("manualFacility");
  if (hiddenInput) hiddenInput.value = facilityId;
  renderAdminFacilityPicker();
  updateAdminFacilitySuggestion();
  updateManualPricing();
  refreshManualConflicts();
  if (window.checkAdminMinPax) checkAdminMinPax();
};

// ─── Open / Close Manual Reservation Modal ────────────────────────────────────

function openAddReservationModal(selectedDate) {
  const modal = document.getElementById("addReservationModal");
  if (!facilities.length) {
    showToast("Facilities could not be loaded. Please try again later.", "error");
    return;
  }
  const defaultFacility = facilities[0].id;
  const hiddenFacility = document.getElementById("manualFacility");
  if (hiddenFacility && !hiddenFacility.value) hiddenFacility.value = defaultFacility;

  populateFacilitySelects();
  const dateValue =
    typeof selectedDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(selectedDate)
      ? selectedDate
      : new Date().toISOString().split("T")[0];
  document.getElementById("manualDate").value = dateValue;
  document.getElementById("manualAttendees").value = "";
  document.getElementById("manualStartTime").value = "08:00";
  document.getElementById("manualEndTime").value = "10:00";
  document.getElementById("admin-facility-suggestion").style.display = "none";

  renderAdminFacilityPicker(0);

  ["manualStartTime", "manualEndTime"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) {
      el.removeEventListener("change", updateManualPricing);
      el.addEventListener("change", updateManualPricing);
      el.removeEventListener("change", refreshManualConflicts);
      el.addEventListener("change", refreshManualConflicts);
      el.removeEventListener("change", refreshManualFacilityPicker);
      el.addEventListener("change", refreshManualFacilityPicker);
    }
  });

  updateManualPricing();
  refreshManualConflicts();
  modal.classList.add("active");
}

window.closeAddReservationModal = () => {
  document.getElementById("addReservationModal").classList.remove("active");
  [
    "manualName",
    "manualContactNumber",
    "manualEmail",
    "manualPurpose",
  ].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });
  document.getElementById("purposeOtherBox").style.display = "none";
  document.getElementById("purposeOtherBox").value = "";
  document.getElementById("manualAttendees").value = "";
  document.getElementById("manualFacility").value = "";
  document
    .querySelectorAll('#manualUtilities input[type="checkbox"]')
    .forEach((cb) => (cb.checked = false));
  document.getElementById("utilitiesOtherBox").style.display = "none";
  document.getElementById("utilitiesOtherBox").value = "";
  document.getElementById("admin-facility-suggestion").style.display = "none";
  document.getElementById("manualPricingPreview").style.display = "none";
  document.getElementById("adminPaxRow").style.display = "none";
  document.getElementById("admin-min-pax-warning").style.display = "none";
  const staffToggle = document.getElementById("manualIsStaff");
  if (staffToggle) staffToggle.checked = false;
  updateManualRequesterFields();
  updateManualPricing();
};

// ─── Pricing Preview ──────────────────────────────────────────────────────────

function updateManualPricing() {
  const facilityId = document.getElementById("manualFacility").value;
  const start = document.getElementById("manualStartTime").value;
  const end = document.getElementById("manualEndTime").value;
  const preview = document.getElementById("manualPricingPreview");
  const isStaff = document.getElementById("manualIsStaff")?.checked || false;

  const pill = document.getElementById("staffTogglePill");
  const track = document.getElementById("staffToggleTrack");
  const labelOff = document.getElementById("staffToggleLabel");
  const labelOn = document.getElementById("staffToggleLabelOn");
  if (pill)
    pill.style.transform = isStaff ? "translateX(78px)" : "translateX(0)";
  if (track) track.style.borderColor = isStaff ? "#800020" : "#e2e8f0";
  if (labelOff) labelOff.style.color = isStaff ? "#94a3b8" : "#475569";
  if (labelOn) {
    labelOn.style.color = isStaff ? "#800020" : "#94a3b8";
    labelOn.style.fontWeight = isStaff ? "800" : "700";
  }

  if (!facilityId || !start || !end || start >= end) {
    preview.style.display = "none";
    return;
  }

  const facility = facilities.find((r) => r.id === facilityId);
  const pricePerHour = isStaff
    ? 0
    : (facility?.pricePerHour ?? _getAdminFacilityPrice(facilityId));
  const { duration, facilityTotal, utilityFee, total } = computeBookingTotal(
    pricePerHour,
    start,
    end,
    isStaff,
  );

  document.getElementById("manualPriceRate").textContent = isStaff
    ? "FREE (Staff)"
    : `₱${pricePerHour.toLocaleString("en-PH")}/hr`;
  document.getElementById("manualPriceDuration").textContent =
    `${duration} hr${duration !== 1 ? "s" : ""}`;
  document.getElementById("manualPriceSubtotal").textContent = isStaff
    ? "FREE"
    : `₱${facilityTotal.toLocaleString("en-PH", { minimumFractionDigits: 2 })}`;

  const utilityRow = document.getElementById("manualUtilityFeeRow");
  if (utilityRow) {
    if (!isStaff && utilityFee > 0) {
      utilityRow.style.display = "flex";
      const utilityFeeEl = document.getElementById("manualUtilityFeeAmount");
      if (utilityFeeEl)
        utilityFeeEl.textContent = `₱${utilityFee.toLocaleString("en-PH", { minimumFractionDigits: 2 })}`;
    } else {
      utilityRow.style.display = "none";
    }
  }

  document.getElementById("manualPriceTotal").textContent = isStaff
    ? "FREE"
    : `₱${total.toLocaleString("en-PH", { minimumFractionDigits: 2 })}`;
  document.getElementById("manualPriceTotal").style.color = isStaff
    ? "#16a34a"
    : "#800020";
  preview.style.display = isStaff ? "none" : "block";
}

window.updateAdminFacilitySuggestion = function () {
  const attendees =
    parseInt(document.getElementById("manualAttendees").value) || 0;
  const purposeSelect = document.getElementById("manualPurpose");
  const purposeValue =
    purposeSelect?.value === "Other"
      ? document.getElementById("purposeOtherBox")?.value.trim()
      : purposeSelect?.value || "";
  const purpose = (purposeValue || "").toLowerCase();
  const facilitySelect = document.getElementById("manualFacility");
  const suggestionBox = document.getElementById("admin-facility-suggestion");
  const suggestionText = document.getElementById("admin-suggestion-text");
  if ((!attendees || attendees <= 0) && !purpose) {
    suggestionBox.style.display = "none";
    return;
  }

  const currentFacility = facilities.find((r) => r.id === facilitySelect.value);
  if (!currentFacility) {
    suggestionBox.style.display = "none";
    return;
  }

  if (purpose) {
    const purposeMappings = [
      {
        keywords: ["basketball", "volleyball", "sports tournament", "physical education", "sport", "athletic", "game", "team building", "outdoor activity"],
        ids: ["gym", "grounds"],
        reason: "this is a physical or sports activity",
      },
      {
        keywords: ["dance", "theater", "theatre", "performance", "concert", "cultural", "drama", "talent show"],
        ids: ["avr", "auditorium", "gym"],
        reason: "this activity needs stage, presentation, or audiovisual facilities",
      },
      {
        keywords: ["study", "research", "examination", "library", "quiet", "book", "reading"],
        ids: ["library", "avr"],
        reason: "this is a focused academic or study activity",
      },
      {
        keywords: ["lecture", "presentation", "seminar", "workshop", "training", "conference", "film screening", "media", "multimedia", "video", "slides"],
        ids: ["avr", "auditorium"],
        reason: "this activity requires audio-visual or presentation support",
      },
      {
        keywords: ["graduation", "awards ceremony", "ceremony", "assembly", "cultural event", "exhibition"],
        ids: ["auditorium", "grounds"],
        reason: "this is a large event or ceremony",
      },
      {
        keywords: ["meeting", "committee", "club", "organization", "board", "parent-teacher"],
        ids: ["library", "avr", "auditorium"],
        reason: "this is a meeting or organizational activity",
      },
    ];

    const purposeMapping = purposeMappings.find((mapping) =>
      mapping.keywords.some((keyword) => purpose.includes(keyword)),
    );
    if (purposeMapping) {
      const suitable = purposeMapping.ids
        .map((id) => facilities.find((facility) => facility.id === id))
        .filter((facility) => facility && (!attendees || facility.capacity >= attendees))
        .sort((a, b) => a.capacity - b.capacity);
      const target = suitable.find((facility) => facility.id !== currentFacility.id);
      if (target) {
        suggestionText.innerHTML =
          `<strong>Purpose suggestion:</strong> Because this reservation is for ${purposeMapping.reason}, ` +
          `consider <strong><a href="#" onclick="document.getElementById('manualFacility').value=${escapeAdminJsArgument(target.id)};updateAdminFacilitySuggestion();return false;" style="color:#800020;">${escapeAdminText(target.name)} (${target.capacity} pax)</a></strong>.`;
        suggestionBox.style.display = "block";
        return;
      }
    }
  }

  if (attendees > currentFacility.capacity) {
    const fits = facilities
      .filter((r) => r.capacity >= attendees)
      .sort((a, b) => a.capacity - b.capacity);
    suggestionText.innerHTML =
      fits.length > 0
        ? `<strong>${escapeAdminText(currentFacility.name)}</strong> fits ${currentFacility.capacity} pax. Suggested: <strong>${fits.map((r) => `<a href="#" onclick="document.getElementById('manualFacility').value=${escapeAdminJsArgument(r.id)};updateAdminFacilitySuggestion();return false;" style="color:#800020;">${escapeAdminText(r.name)} (${r.capacity} pax)</a>`).join(", ")}</strong>`
        : `${attendees} pax exceeds all facilities. Contact admin for special arrangements.`;
    suggestionBox.style.display = "block";
    return;
  }
  if (attendees < currentFacility.capacity * 0.2) {
    const smaller = facilities
      .filter(
        (r) => r.capacity >= attendees && r.capacity < currentFacility.capacity,
      )
      .sort((a, b) => a.capacity - b.capacity);
    if (smaller.length > 0) {
      suggestionText.innerHTML = `Only ${attendees} pax — consider a smaller facility: ${smaller.map((r) => `<a href="#" onclick="document.getElementById('manualFacility').value=${escapeAdminJsArgument(r.id)};updateAdminFacilitySuggestion();return false;" style="color:#800020;">${escapeAdminText(r.name)} (${r.capacity} pax)</a>`).join(", ")}`;
      suggestionBox.style.display = "block";
      return;
    }
  }
  suggestionBox.style.display = "none";
};

window.checkAdminMinPax = () => {
  const facilityId = document.getElementById("manualFacility").value;
  const pax = parseInt(document.getElementById("manualAttendees").value) || 0;
  const min = _getAdminMinPax(facilityId);
  const warning = document.getElementById("admin-min-pax-warning");
  if (!warning) return;
  if (min > 0 && pax > 0 && pax < min) {
    warning.textContent = `Minimum ${min} pax required for ${getFacilityName(facilityId)}.`;
    warning.style.display = "block";
  } else {
    warning.style.display = "none";
  }
};

// ─── Save Manual Reservation ──────────────────────────────────────────────────

async function saveManualReservation() {
  const name = document.getElementById("manualName").value.trim();
  const facilityId = document.getElementById("manualFacility").value;
  const facilityName = getFacilityName(facilityId);
  const date = document.getElementById("manualDate").value;
  const startTime = document.getElementById("manualStartTime").value;
  const endTime = document.getElementById("manualEndTime").value;
  const purposeVal = document.getElementById("manualPurpose").value;
  const purpose =
    purposeVal === "Other"
      ? document.getElementById("purposeOtherBox").value.trim() || "Other"
      : purposeVal;
  const attendees =
    parseInt(document.getElementById("manualAttendees").value) || 0;
  const isStaff = document.getElementById("manualIsStaff")?.checked || false;
  const staffId = document.getElementById("manualStaffId")?.value.trim() || "";
  if (
    isStaff &&
    (!manualStaffProfile || manualStaffProfile.staffId !== staffId)
  ) {
    showToast(
      "Enter a valid staff ID and wait for the staff details to load.",
      "error",
    );
    return;
  }
  const rawContact = isStaff
    ? ""
    : document.getElementById("manualContactNumber").value.trim();
  const contactDigits = rawContact.replace(/[\s-]/g, "");
  const localContactDigits = contactDigits.startsWith("0")
    ? contactDigits.slice(1)
    : contactDigits;
  if (rawContact && !DateUtils.isValidPHPhone(localContactDigits)) {
    showToast(
      "Enter a valid Philippine mobile number (e.g. 09123456789).",
      "error",
    );
    return;
  }
  const contact = isStaff
    ? manualStaffProfile.staffId
    : rawContact
      ? DateUtils.normalizePHPhone(localContactDigits)
      : "N/A";
  const email = isStaff
    ? manualStaffProfile.email
    : document.getElementById("manualEmail").value.trim() || "admin@bchs.edu";
  const utilities = Array.from(
    document.querySelectorAll(
      '#manualUtilities input[type="checkbox"]:checked',
    ),
  ).map((cb) =>
    cb.value === "Others"
      ? document.getElementById("utilitiesOtherBox").value.trim() || "Others"
      : cb.value,
  );

  if (!name || !date || !startTime || !endTime || !purpose || attendees < 1) {
    alert(
      "Please fill in all required fields (Name, Date, Times, Purpose, and Number of Pax).",
    );
    return;
  }
  if (
    purposeVal === "Other" &&
    !document.getElementById("purposeOtherBox").value.trim()
  ) {
    alert("Please specify the purpose of the reservation.");
    return;
  }
  if (startTime >= endTime) {
    alert("Start time must be earlier than end time.");
    return;
  }
  if (
    isAdminGroundsFacility(facilityId) &&
    isAdminWeekendDate(date)
  ) {
    showToast(
      "Grounds are unavailable on Saturdays and Sundays.",
      "error",
    );
    return;
  }

  // Hard conflict check — block save if time overlaps any existing reservation
  const existingConflict = adminCheckConflict(
    facilityId,
    date,
    startTime,
    endTime,
  );
  if (existingConflict) {
    const isBlock = existingConflict.status === "blocked";
    showToast(
      isBlock
        ? `Cannot save: facility is blocked for this time slot.`
        : `Cannot save: time conflicts with "${escapeAdminText(existingConflict.name)}" (${escapeAdminText(existingConflict.startTime)}–${escapeAdminText(existingConflict.endTime)}).`,
      "error",
    );
    return;
  }
  const minPax = _getAdminMinPax(facilityId);
  if (minPax > 0 && attendees < minPax) {
    alert(`Minimum ${minPax} pax required for ${getFacilityName(facilityId)}.`);
    return;
  }

  const facility = facilities.find((r) => r.id === facilityId);
  const pricePerHour = isStaff
    ? 0
    : (facility?.pricePerHour ?? _getAdminFacilityPrice(facilityId));
  const { total: totalAmount } = computeBookingTotal(
    pricePerHour,
    startTime,
    endTime,
    isStaff,
  );

  const newEntry = {
    id: "admin_" + Date.now(),
    source: "walk_in",
    isStaff,
    staffId: isStaff ? manualStaffProfile.id : null,
    facilityId,
    facilityName,
    name,
    contact,
    email,
    date,
    startTime,
    endTime,
    purpose,
    utilities: utilities.length ? utilities : [],
    attendees,
    status: "pending",
    paymentStatus: isStaff ? "free" : "unpaid",
    totalAmount,
    submittedAt: new Date().toISOString(),
  };

  try {
    const res = await window.adminFetch("/api/requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newEntry),
    });
    const result = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(
        result.message || `Reservations API returned ${res.status}.`,
      );
    }
    const reservationCode = result.request?.reservationCode;
    if (!reservationCode) {
      throw new Error("The server did not return a reservation number.");
    }
    showToast(
      `Manual reservation added. Reservation number: ${reservationCode}`,
      "success",
    );
  } catch (error) {
    showToast(`Failed to save reservation: ${error.message}`, "error");
    return;
  }

  closeAddReservationModal();
  await loadData();
}

// ─── Render Queue ─────────────────────────────────────────────────────────────

function renderQueue() {
  const body = document.getElementById("queueTableBody");
  if (!body) return;
  const pending = requests.filter(
    (r) =>
      r.status === "pending" &&
      r.blockReschedulePending !== true &&
      (!r.appointmentDate || r.appointmentDate.trim() === ""),
  );
  document.getElementById("pendingCount").textContent =
    `${pending.length} pending`;
  const badge = document.getElementById("queue-badge");
  if (badge) {
    badge.textContent = pending.length;
    badge.style.display = pending.length > 0 ? "inline-flex" : "none";
  }

  body.innerHTML = pending.length
    ? pending
        .map((req) => {
          const staffReq = isStaffRequest(req);
          const safeId = escapeAdminJsArgument(req.id);
          const paymentCell = staffReq
            ? `<td><span class="badge badge-secondary" style="font-weight:700;">FREE</span></td>`
            : `<td><span style="font-size:12px;color:#94a3b8;">—</span></td>`;
          const editedTag = req.userEditReason
            ? `<div style="display:inline-block;background:#eff6ff;color:#1d4ed8;border:1px solid #bfdbfe;border-radius:4px;font-size:10px;font-weight:700;padding:1px 6px;margin-left:5px;vertical-align:middle;">EDITED</div>`
            : "";
          return `<tr>
            <td>${formatDateSimple(req.submittedAt)}</td>
            <td><strong>${escapeAdminText(req.name)}</strong>${editedTag}</td>
            <td><span class="badge badge-secondary">${escapeAdminText(getFacilityName(req.facilityId))}</span></td>
            <td>${formatDateSimple(req.date)}</td>
            <td><div class="truncate" title="${escapeAdminText(req.purpose)}">${escapeAdminText(req.purpose)}</div></td>
            ${paymentCell}
            <td><button class="btn btn-bchs btn-sm" onclick="openEditModal(${safeId},'QUEUE_REVIEW')">Manage Request</button></td>
        </tr>`;
        })
        .join("")
    : '<tr><td colspan="7" style="text-align:center;padding:20px;color:#6b7280;">Queue is empty</td></tr>';
}

// ─── Render Confirmed ─────────────────────────────────────────────────────────

function getConfirmedEditMode(req) {
  if (!req.appointmentDate || !req.appointmentTime) return "VIEW_ONLY";
  const timeStr = req.appointmentTime.trim();
  let hours = 0,
    minutes = 0;
  const ampmMatch = timeStr.match(/(\d+):(\d+)\s*(AM|PM)/i);
  const h24Match = timeStr.match(/^(\d{1,2}):(\d{2})$/);
  if (ampmMatch) {
    hours = parseInt(ampmMatch[1]);
    minutes = parseInt(ampmMatch[2]);
    const period = ampmMatch[3].toUpperCase();
    if (period === "PM" && hours !== 12) hours += 12;
    if (period === "AM" && hours === 12) hours = 0;
  } else if (h24Match) {
    hours = parseInt(h24Match[1]);
    minutes = parseInt(h24Match[2]);
  } else {
    return "VIEW_ONLY";
  }
  const apptDateTime = new Date(
    `${req.appointmentDate}T${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:00`,
  );
  const diffHours = (new Date() - apptDateTime) / (1000 * 60 * 60);
  if (diffHours >= 0 && diffHours < 1.5) return "CONFIRMED_EDIT";
  if (diffHours >= 1.5) return "RESCHEDULE_OR_REJECT";
  return "VIEW_ONLY";
}

window.rescheduleConfirmed = (id) => {
  openEditModal(id, "QUEUE_REVIEW");
  setTimeout(() => {
    const titleEl = document.getElementById("editModalTitle");
    if (titleEl) titleEl.textContent = "Set New Confirmation Visit Time";
  }, 50);
};

function renderConfirmed() {
  const body = document.getElementById("confirmedTableBody");
  if (!body) return;
  const confirmed = requests.filter(
    (r) =>
      ((r.appointmentDate &&
        r.appointmentDate.trim() !== "" &&
        r.appointmentTime &&
        r.appointmentTime.trim() !== "") ||
        (Array.isArray(r.visitOptions) && r.visitOptions.length > 0)) &&
      !["approved", "rejected", "refused", "cancelled"].includes(r.status) &&
      r.blockReschedulePending !== true,
  );
  document.getElementById("confirmedCount").textContent =
    `${confirmed.length} confirmed`;
  const badge = document.getElementById("confirmed-badge");
  if (badge) {
    badge.textContent = confirmed.length;
    badge.style.display = confirmed.length > 0 ? "inline-flex" : "none";
  }

  body.innerHTML = confirmed.length
    ? confirmed
        .map((req) => {
          const hasVisitOptions =
            Array.isArray(req.visitOptions) &&
            req.visitOptions.length > 0 &&
            (!req.appointmentDate || req.appointmentDate.trim() === "");
          const editMode = hasVisitOptions
            ? "VIEW_ONLY"
            : getConfirmedEditMode(req);
          const isLive = editMode === "CONFIRMED_EDIT";
          const isPastWin = editMode === "RESCHEDULE_OR_REJECT";
          const isViewOnly = editMode === "VIEW_ONLY";
          const isBlockForced = req.blockReschedulePending === true;
          const safeId = escapeAdminJsArgument(req.id);

          let visitCell;
          if (hasVisitOptions) {
            visitCell = `<td>
                <span style="font-size:11px;font-weight:700;background:#eff6ff;color:#1d4ed8;padding:2px 8px;border-radius:999px;">⏳ Awaiting user selection</span>
                <div style="font-size:11px;color:#64748b;margin-top:3px;">${req.visitOptions.length} option${req.visitOptions.length > 1 ? "s" : ""} sent</div>
            </td>`;
          } else if (isBlockForced) {
            visitCell = `<td><span style="font-size:11px;font-weight:700;background:#fee2e2;color:#991b1b;padding:2px 8px;border-radius:999px;">Needs Reschedule</span>
               <div style="font-size:11px;color:#64748b;margin-top:3px;">Blocked: ${escapeAdminText(req.blockRescheduleReason || "facility unavailable")}</div></td>`;
          } else if (isLive) {
            visitCell = `<td><strong style="color:#800020;">${formatDateSimple(req.appointmentDate)}</strong>
               <span style="display:inline-block;margin-left:6px;background:#16a34a;color:white;font-size:10px;font-weight:700;padding:1px 7px;border-radius:999px;vertical-align:middle;animation:pulse 1.5s infinite;">● LIVE</span>
               <div style="font-size:11px;color:#16a34a;font-weight:600;">${escapeAdminText(req.appointmentTime ? formatApptTime(req.appointmentTime) : "")}</div></td>`;
          } else {
            visitCell = `<td><strong style="color:#800020;">${formatDateSimple(req.appointmentDate)}</strong>
               <div style="font-size:11px;color:#64748b;">${escapeAdminText(req.appointmentTime ? formatApptTime(req.appointmentTime) : "Not set")}</div></td>`;
          }

          const btnMode = hasVisitOptions
            ? "QUEUE_REVIEW"
            : isBlockForced
              ? "RESCHEDULE_OR_REJECT"
              : editMode;
          const btnLabel = hasVisitOptions
            ? "Edit Options"
            : isBlockForced
              ? "Reschedule"
              : isLive
                ? "Edit"
                : isPastWin
                  ? "Set New Visit Time"
                  : isViewOnly
                    ? "View"
                    : "Manage";
          const btnStyle = hasVisitOptions
            ? "background:#1d4ed8;border-color:#1d4ed8;color:white;"
            : isBlockForced
              ? "background:#f59e0b;border-color:#f59e0b;color:white;"
              : isLive
                ? "background:#16a34a;border-color:#16a34a;color:white;"
                : isPastWin
                  ? "background:#f59e0b;border-color:#f59e0b;color:white;"
                  : "";
          const rowStyle = hasVisitOptions
            ? ' style="background:#eff6ff;"'
            : isBlockForced
              ? ' style="background:#fff7ed;"'
              : isLive
                ? ' style="background:#f0fdf4;"'
                : "";

          return `<tr${rowStyle}>
            <td><strong>${escapeAdminText(req.name)}</strong></td>
            <td><span class="badge badge-secondary">${escapeAdminText(getFacilityName(req.facilityId))}</span></td>
            <td>${formatDateSimple(req.date)}</td>
            ${visitCell}
            <td><button class="btn btn-bchs btn-sm" style="${btnStyle}" onclick="${isPastWin ? `rescheduleConfirmed(${safeId})` : `openEditModal(${safeId},${escapeAdminJsArgument(btnMode)})`}">${btnLabel}</button></td>
        </tr>`;
        })
        .join("")
    : '<tr><td colspan="6" style="text-align:center;padding:20px;color:#6b7280;">No confirmed appointments yet</td></tr>';
}

// ─── Render Approved ──────────────────────────────────────────────────────────

function renderApproved() {
  const body = document.getElementById("approvedTableBody");
  if (!body) return;
  const approved = requests
    .filter(
      (r) =>
        ["approved", "accepted"].includes(r.status) &&
        r.blockReschedulePending !== true &&
        !r.isSchoolEvent &&
        !r.isFullDayBlock,
    )
    .sort((a, b) => a.date.localeCompare(b.date));
  document.getElementById("approvedCount").textContent =
    `${approved.length} approved`;
  const badge = document.getElementById("approved-badge");
  if (badge) {
    badge.textContent = approved.length;
    badge.style.display = approved.length > 0 ? "inline-flex" : "none";
  }

  body.innerHTML = approved.length
    ? approved
        .map((req) => {
          const hasAlternateSchedules =
            Array.isArray(req.rescheduleOptions) &&
            req.rescheduleOptions.length > 0;
          const needsReschedule = needsRescheduleReview(req);
          const rowStyle = needsReschedule
            ? ' style="background:#fff7ed;"'
            : "";
          const actionMode = "VIEW_ONLY";
          const actionLabel = "View";
          const safeId = escapeAdminJsArgument(req.id);
          const staffReq = isStaffRequest(req);
          const paymentStatus = staffReq
            ? "Free"
            : ["pending", "half_paid"].includes(req.paymentStatus)
              ? "Half Paid"
              : req.paymentStatus || "unpaid";
          const badgeCell = needsReschedule
            ? `<td><span style="font-size:11px;font-weight:700;background:#fff7ed;color:#92400e;padding:2px 8px;border-radius:999px;">${hasAlternateSchedules ? "Awaiting Requester Selection" : "Needs Reschedule"}</span>
                            <div style="font-size:11px;color:#64748b;margin-top:3px;">${hasAlternateSchedules ? `${req.rescheduleOptions.length} alternate schedule${req.rescheduleOptions.length === 1 ? "" : "s"} offered` : `Requested: ${req.rescheduledDate ? formatDateSimple(req.rescheduledDate) : "—"} ${req.rescheduledStartTime ? escapeAdminText(" " + convertTo12Hour(req.rescheduledStartTime) + "–" + convertTo12Hour(req.rescheduledEndTime)) : ""}`}</div></td>`
            : "";

          return `
        <tr${rowStyle}>
            <td><strong>${escapeAdminText(req.name)}</strong></td>
            <td><span class="badge badge-secondary">${escapeAdminText(getFacilityName(req.facilityId))}</span></td>
            <td>${formatDateSimple(req.date)}</td>
            <td>${escapeAdminText(convertTo12Hour(req.startTime))}–${escapeAdminText(convertTo12Hour(req.endTime))}</td>
            <td><div class="truncate" title="${escapeAdminText(req.purpose)}">${escapeAdminText(req.purpose)}</div>
                ${needsReschedule ? `<div style="font-size:11px;color:#64748b;margin-top:6px;">${hasAlternateSchedules ? "The requester has alternate event schedules to choose from." : `Requested reschedule: <strong style="color:#92400e;">${escapeAdminText(req.rescheduledDate ? formatDateSimple(req.rescheduledDate) : "—")}</strong> ${req.rescheduledStartTime ? escapeAdminText("· " + convertTo12Hour(req.rescheduledStartTime) + "–" + convertTo12Hour(req.rescheduledEndTime)) : ""}<div style="font-size:11px;color:#7c2d12;margin-top:4px;">Reason: ${escapeAdminText(req.rescheduleReason || "No reason provided")}</div>`}</div>` : ""}
            </td>
            <td><span class="badge ${staffReq ? "badge-secondary" : req.paymentStatus === "paid" ? "badge-success" : ["pending", "half_paid"].includes(req.paymentStatus) ? "badge-half-paid" : "badge-secondary"}">${escapeAdminText(paymentStatus)}</span></td>
            <td><button class="btn btn-outline btn-sm" onclick="openEditModal(${safeId},${escapeAdminJsArgument(actionMode)})">${actionLabel}</button></td>
        </tr>`;
        })
        .join("")
    : '<tr><td colspan="7" style="text-align:center;padding:20px;color:#6b7280;">No approved requests</td></tr>';
}

function renderReschedulingRequests() {
  const body = document.getElementById("reschedulingTableBody");
  if (!body) return;

  const reschedulingRequests = getReschedulingRequests();
  document.getElementById("reschedulingCount").textContent =
    `${reschedulingRequests.length} requests`;
  const hasBlockReschedules = reschedulingRequests.some(
    (request) => request.blockReschedulePending === true,
  );
  const tabTrigger = document.getElementById("reschedulingTabTrigger");
  tabTrigger?.classList.toggle("has-block-reschedules", hasBlockReschedules);
  const badge = document.getElementById("rescheduling-badge");
  if (badge) {
    badge.textContent = reschedulingRequests.length;
    badge.style.display =
      reschedulingRequests.length > 0 ? "inline-flex" : "none";
    badge.classList.toggle("is-block-reschedule", hasBlockReschedules);
  }

  body.innerHTML = reschedulingRequests.length
    ? reschedulingRequests
        .map((request) => {
          const safeId = escapeAdminJsArgument(request.id);
          const requestedSchedule =
            `${request.rescheduledDate ? formatDateSimple(request.rescheduledDate) : request.blockReschedulePending ? "Choose a new schedule" : "Date not specified"}${request.rescheduledStartTime ? ` · ${escapeAdminText(convertTo12Hour(request.rescheduledStartTime))}–${escapeAdminText(convertTo12Hour(request.rescheduledEndTime))}` : ""}`;
          const canAcceptRequestedSchedule =
            request.rescheduledDate &&
            request.rescheduledStartTime &&
            request.rescheduledEndTime;
          const isBlockReschedule = request.blockReschedulePending === true;
          const reason = request.blockRescheduleReason || request.rescheduleReason || "No reason provided";
          return `<tr${isBlockReschedule ? ' style="background:#fff7ed;border-left:4px solid #f97316;"' : ""}>
            <td><strong>${escapeAdminText(request.name)}</strong>${isBlockReschedule ? '<span style="display:inline-block;margin-left:6px;padding:1px 6px;border-radius:999px;background:#ffedd5;color:#c2410c;font-size:10px;font-weight:700;">BLOCKED</span>' : ""}</td>
            <td><span class="badge badge-secondary">${escapeAdminText(getFacilityName(request.facilityId))}</span></td>
            <td>${formatDateSimple(request.date)} · ${escapeAdminText(convertTo12Hour(request.startTime))}–${escapeAdminText(convertTo12Hour(request.endTime))}</td>
            <td>${requestedSchedule}</td>
            <td${isBlockReschedule ? ' style="color:#c2410c;font-weight:700;"' : ""}>${escapeAdminText(reason)}</td>
            <td><div style="display:flex;flex-direction:column;gap:6px;align-items:flex-start;">
              ${canAcceptRequestedSchedule ? `<button class="btn btn-primary btn-sm" onclick="acceptRescheduleSchedule(${safeId})">Accept Reschedule</button>` : ""}
              <button class="btn btn-outline btn-sm" onclick="openEditModal(${safeId},'RESCHEDULE_OR_REJECT')">Review Request</button>
            </div></td>
          </tr>`;
        })
        .join("")
    : '<tr><td colspan="6" style="text-align:center;padding:20px;color:#6b7280;">No rescheduling requests</td></tr>';
}

// ─── Render Upcoming ──────────────────────────────────────────────────────────

function renderUpcoming() {
  const container = document.getElementById("upcomingreservations");
  const filter =
    document.getElementById("searchFilter")?.value.toLowerCase() || "";
  const facilityFilter =
    document.getElementById("facilityFilter")?.value || "all";
  const today = new Date().toISOString().split("T")[0];

  const up = requests
    .filter((r) => {
      const isUp =
        (r.status === "blocked" ||
          (r.status === "approved" && r.blockReschedulePending !== true)) &&
        r.date >= today;
      const matchesFacility =
        facilityFilter === "all" || r.facilityId === facilityFilter;
      const matchSearch =
        !filter ||
        r.name.toLowerCase().includes(filter) ||
        r.purpose.toLowerCase().includes(filter);
      return isUp && matchesFacility && matchSearch;
    })
    .sort((a, b) => a.date.localeCompare(b.date));

  document.getElementById("upcomingCount").textContent = `${up.length} entries`;

  container.innerHTML = up.length
    ? up
        .map((b) => {
          const isBlock = b.status === "blocked";
          const isEvent = b.isSchoolEvent === true;
          const safeId = escapeAdminJsArgument(b.id);
          const safeDate = escapeAdminJsArgument(b.date);
          const cardClass = isBlock
            ? "timeslot-admin-blocked"
            : isEvent
              ? "school-event-card"
              : "";
          const badge = isEvent
            ? `<span style="font-size:10px;font-weight:700;background:#f59e0b;color:white;padding:2px 7px;border-radius:999px;margin-left:6px;">EVENT</span>`
            : "";
          const visitAppointment = b.appointmentTime
            ? `<div class="res-card-row2"><span class="res-card-time">Visit appointment: ${b.appointmentDate ? `${escapeAdminText(formatDateSimple(b.appointmentDate))} at ` : ""}${escapeAdminText(formatApptTime(b.appointmentTime))}</span></div>`
            : "";
          let actions = "";
          if (isEvent) {
            const evId = DateUtils.normalizeEventId(b.id);
            const safeEventId = escapeAdminJsArgument(evId);
            actions = `<div style="display:flex;gap:6px;flex-shrink:0;">
                <button onclick="openEditEventModal(${safeEventId})" class="btn btn-outline btn-sm">Edit</button>
                <button onclick="deleteEventFromSchedule(${safeEventId})" class="btn btn-sm" style="background:#fee2e2;color:#991b1b;border:1px solid #fecaca;">Delete</button>
            </div>`;
          } else if (isBlock) {
            actions = `<div style="display:flex;gap:6px;flex-shrink:0;"><button onclick="quickUnblock(${safeId},${safeDate})" class="btn btn-outline btn-sm">Unblock</button></div>`;
          } else {
            actions = `<button onclick="openEditModal(${safeId},'PAYMENT_ONLY')" class="btn btn-outline btn-sm" style="flex-shrink:0;">Manage</button>`;
          }
          return `<div class="reservation-card ${cardClass}" style="flex-direction:row;align-items:center;gap:8px;">
            <div style="flex:1;min-width:0;">
                <div class="res-card-row1"><span class="res-card-name">${escapeAdminText(isBlock ? "UNAVAILABLE" : b.name)}</span>${badge}<span style="flex:1;"></span><span class="res-card-facility">${escapeAdminText(getFacilityName(b.facilityId))}</span></div>
                <div class="res-card-row2"><span class="res-card-time">${formatDateSimple(b.date)} &nbsp;${escapeAdminText(convertTo12Hour(b.startTime))}–${escapeAdminText(convertTo12Hour(b.endTime))}</span><span class="res-card-purpose">${escapeAdminText(b.purpose)}</span></div>
                ${visitAppointment}
            </div>${actions}</div>`;
        })
        .join("")
    : '<div class="empty-state"><p>No upcoming entries found</p></div>';
}

// ─── Render Cancellations ─────────────────────────────────────────────────────

function renderCancellations() {
  const body = document.getElementById("cancellationsTableBody");
  if (!body) return;
  const cancellations = requests.filter(
    (r) => r.status === "cancelled" && r.cancellationReason,
  );
  document.getElementById("cancellationsCount").textContent =
    `${cancellations.length} requests`;
  const badge = document.getElementById("cancellations-badge");
  if (badge) {
    badge.textContent = cancellations.length;
    badge.style.display = cancellations.length > 0 ? "inline-flex" : "none";
  }

  body.innerHTML = cancellations.length
    ? cancellations
        .map((req) => {
          const isBlockCancelled = req.blockCancelled === true;
          const safeId = escapeAdminJsArgument(req.id);
          return `<tr>
            <td>${req.cancellationRequestedAt ? formatDateSimple(req.cancellationRequestedAt) : "N/A"}</td>
            <td><strong>${escapeAdminText(req.name)}</strong>${isBlockCancelled ? ' <span style="font-size:10px;background:#fee2e2;color:#991b1b;padding:1px 6px;border-radius:4px;font-weight:700;">BLOCK</span>' : ""}</td>
            <td><span class="badge badge-secondary">${escapeAdminText(getFacilityName(req.facilityId))}</span></td>
            <td>${formatDateSimple(req.date)}</td>
            <td><div class="truncate" title="${escapeAdminText(req.cancellationReason)}" style="max-width:300px;">${escapeAdminText(req.cancellationReason)}</div></td>
            <td><button class="btn btn-bchs btn-sm" onclick="openCancellationReview(${safeId})">Review</button></td>
        </tr>`;
        })
        .join("")
    : '<tr><td colspan="6" style="text-align:center;padding:20px;color:#6b7280;">No cancellation requests</td></tr>';
}

// ─── Cancellation Review Modal ────────────────────────────────────────────────

let _cancellationReviewId = null;

window.openCancellationReview = (id) => {
  const req = requests.find((r) => r.id === id);
  if (!req) return;
  _cancellationReviewId = id;

  // Populate reservation details
  const fmt12 = (t) => convertTo12Hour(t);
  const safeFacility = escapeAdminText(getFacilityName(req.facilityId));
  document.getElementById("cr-details").innerHTML = `
        <div style="display:flex;gap:6px;"><span style="color:#64748b;min-width:80px;">Name</span><strong>${escapeAdminText(req.name)}</strong></div>
        <div style="display:flex;gap:6px;"><span style="color:#64748b;min-width:80px;">Facility</span><strong>${safeFacility}</strong></div>
        <div style="display:flex;gap:6px;"><span style="color:#64748b;min-width:80px;">Date</span><strong>${formatDateSimple(req.date)}</strong></div>
        <div style="display:flex;gap:6px;"><span style="color:#64748b;min-width:80px;">Time</span><strong>${escapeAdminText(fmt12(req.startTime))} – ${escapeAdminText(fmt12(req.endTime))}</strong></div>
        <div style="display:flex;gap:6px;"><span style="color:#64748b;min-width:80px;">Purpose</span><span style="color:#374151;">${escapeAdminText(req.purpose)}</span></div>
        ${req.contact ? `<div style="display:flex;gap:6px;"><span style="color:#64748b;min-width:80px;">Contact</span><span>${escapeAdminText(req.contact)}</span></div>` : ""}
        ${req.email ? `<div style="display:flex;gap:6px;"><span style="color:#64748b;min-width:80px;">Email</span><span>${escapeAdminText(req.email)}</span></div>` : ""}
    `;

  // Populate reason (strip internal prefix if present)
  document.getElementById("cr-reason").textContent =
    req.cancellationReason.replace("Facility blocked by administration: ", "");

  document.getElementById("cancellationReviewModal").classList.add("active");
};

window.closeCancellationReview = () => {
  document.getElementById("cancellationReviewModal").classList.remove("active");
  _cancellationReviewId = null;
};

window.confirmCancellationDelete = async () => {
  if (!_cancellationReviewId) return;
  const req = requests.find((r) => r.id === _cancellationReviewId);
  if (!req) return;

  const now = new Date().toISOString();

  try {
    const response = await window.adminFetch(`/api/requests/${_cancellationReviewId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "refused", cancellationApprovedAt: now }),
    });
    if (!response.ok) throw new Error("Reservation update failed.");
    showToast("Cancellation approved — user will be notified.", "success");
  } catch (e) {
    showToast("Failed to process cancellation.", "error");
    return;
  }
  closeCancellationReview();
  await loadData();
};

// ─── Render History ───────────────────────────────────────────────────────────

// Cache for history records so filterHistory() and openHistoryView can look them up
var historyCache = [];

async function renderHistory() {
  const today = new Date().toISOString().split("T")[0];
  let history = requests.filter((r) => {
    const isPastEvent =
      (r.status === "approved" ||
        r.status === "accepted" ||
        r.status === "blocked") &&
      r.date < today;
    const isCancelled = ["cancelled", "rejected", "refused"].includes(
      r.status,
    );
    const isCompleted = r.status === "completed";
    return isPastEvent || isCancelled || isCompleted;
  });
  history.sort((a, b) => b.date.localeCompare(a.date));

  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - 2);
  const cutoffStr = cutoff.toISOString().split("T")[0];
  history = history.filter((r) => r.date >= cutoffStr);

  // Store full set for filtering
  historyCache = history;

  filterHistory();
}

function _getHistoryStatusLabel(req) {
  if (["cancelled", "rejected", "refused"].includes(req.status))
    return "Cancelled";
  if (req.status === "blocked") return "Past Block";
  if (req.status === "completed") return "Completed";
  if (req.status === "approved" || req.status === "accepted") {
    const today = new Date().toISOString().split("T")[0];
    // If the event date is in the past, it's fully completed
    if (req.date < today) return "Completed";
    // Event hasn't happened yet but was approved with an appointment — still Confirmed
    if (req.appointmentDate) return "Confirmed";
    return "Completed";
  }
  return "";
}

function filterHistory() {
  const search = (document.getElementById("historySearchFilter")?.value || "")
    .toLowerCase()
    .trim();
  const facilityFilter =
    document.getElementById("historyFacilityFilter")?.value || "all";
  const statusFilter =
    document.getElementById("historyStatusFilter")?.value || "all";

  const filtered = historyCache.filter((req) => {
    const statusText = _getHistoryStatusLabel(req);
    const matchSearch = !search || req.name.toLowerCase().includes(search);
    const matchFacility =
      facilityFilter === "all" || req.facilityId === facilityFilter;
    const matchStatus = statusFilter === "all" || statusText === statusFilter;
    return matchSearch && matchFacility && matchStatus;
  });

  const anyActive =
    search || facilityFilter !== "all" || statusFilter !== "all";
  const countLabel = anyActive
    ? `${filtered.length} of ${historyCache.length} records`
    : `${historyCache.length} records (last 2 months)`;
  document.getElementById("historyCount").textContent = countLabel;

  document.getElementById("historyTableBody").innerHTML = filtered.length
    ? filtered
        .map((req) => {
          const statusText = _getHistoryStatusLabel(req);
          const safeId = escapeAdminJsArgument(req.id);
          let statusBadge = "";
          if (statusText === "Cancelled") statusBadge = "badge-destructive";
          else if (statusText === "Confirmed") statusBadge = "badge-success";
          else if (statusText === "Completed") statusBadge = "badge-primary";
          else statusBadge = "badge-secondary";
          const confirmedOn = req.appointmentDate
            ? `<div style="font-size:11px;color:#64748b;margin-top:2px;">Confirmed: ${formatDateSimple(req.appointmentDate)}${req.appointmentTime ? " " + escapeAdminText(formatApptTime(req.appointmentTime)) : ""}</div>`
            : "";
          return `<tr>
            <td>${formatDateSimple(req.date)}</td>
            <td><strong>${escapeAdminText(req.name)}</strong>${confirmedOn}</td>
            <td>${escapeAdminText(getFacilityName(req.facilityId))}</td>
            <td><span class="badge ${statusBadge}">${escapeAdminText(statusText)}</span></td>
            <td><button class="btn btn-outline btn-sm" onclick="openHistoryView(${safeId})">View</button></td>
        </tr>`;
        })
        .join("")
    : '<tr><td colspan="5" style="text-align:center;padding:20px;color:#6b7280;">No history records found</td></tr>';
}

function clearHistoryFilters() {
  const search = document.getElementById("historySearchFilter");
  const facility = document.getElementById("historyFacilityFilter");
  const status = document.getElementById("historyStatusFilter");
  if (search) search.value = "";
  if (facility) facility.value = "all";
  if (status) status.value = "all";
  filterHistory();
}

// ─── History View Modal ───────────────────────────────────────────────────────

window.openHistoryView = (id) => {
  // Look up in historyCache first, fall back to requests array
  const r =
    historyCache.find((x) => x.id === id) || requests.find((x) => x.id === id);
  if (!r) {
    showToast("Record not found.", "error");
    return;
  }

  const fmt12 = (t) => convertTo12Hour(t);
  const fmtAmt = (v) =>
    v != null && v !== ""
      ? `₱${parseFloat(v).toLocaleString("en-PH", { minimumFractionDigits: 2 })}`
      : "—";

  let statusLabel = _getHistoryStatusLabel(r),
    statusColor = "#64748b";
  if (statusLabel === "Cancelled") statusColor = "#dc2626";
  else if (statusLabel === "Confirmed") statusColor = "#16a34a";
  else if (statusLabel === "Completed") statusColor = "#2563eb";
  else if (statusLabel === "Past Block") statusColor = "#6b7280";

  const row = (label, value) => `
        <div style="display:flex;gap:0.5rem;padding:0.4rem 0;border-bottom:1px solid #f1f5f9;">
            <span style="font-size:0.72rem;color:#94a3b8;font-weight:600;min-width:110px;flex-shrink:0;">${escapeAdminText(label)}</span>
            <span style="font-size:0.82rem;color:#1e293b;font-weight:500;flex:1;word-break:break-word;">${escapeAdminText(value)}</span>
        </div>`;
  const paymentRow = isStaffRequest(r)
    ? row("Payment", "Free")
    : ["pending", "half_paid"].includes(r.paymentStatus)
    ? `
        <div style="display:flex;gap:0.5rem;padding:0.4rem 0;border-bottom:1px solid #f1f5f9;">
            <span style="font-size:0.72rem;color:#94a3b8;font-weight:600;min-width:110px;flex-shrink:0;">Payment</span>
            <span style="flex:1;"><span class="badge badge-half-paid">Half Paid</span></span>
        </div>`
    : row("Payment", r.paymentStatus || "—");

  let rows = `
        ${row("Facility", getFacilityName(r.facilityId))}
        ${row("Name", r.name || "—")}
        ${row("Contact", r.contact || "—")}
        ${row("Email", r.email || "—")}
        ${row("Date", formatDateSimple(r.date))}
        ${row("Time", r.startTime ? `${fmt12(r.startTime)} – ${fmt12(r.endTime)}` : "—")}
        ${row("Purpose", r.purpose || "—")}
        ${row("Attendees", r.attendees != null ? r.attendees : "—")}
        ${row("Amount", fmtAmt(r.totalAmount))}
        ${paymentRow}
        ${row("Submitted", r.submittedAt ? formatDateTimeSimple(r.submittedAt) : "—")}
    `;
  if (r.appointmentDate)
    rows += row(
      "Visit Date",
      `${formatDateSimple(r.appointmentDate)}${r.appointmentTime ? " at " + r.appointmentTime : ""}`,
    );
  if (r.cancellationReason) rows += row("Cancel Reason", r.cancellationReason);
  if (r.rejectionReason) rows += row("Rejection", r.rejectionReason);
  if (r.additionalNotes) rows += row("Notes", r.additionalNotes);

  // Remove any existing history view modal
  document.getElementById("historyViewModal")?.remove();

  const modal = document.createElement("div");
  modal.id = "historyViewModal";
  modal.className = "modal active";
  modal.innerHTML = `
        <div class="modal-content modal-small">
            <div class="modal-header">
                <h2>History Record</h2>
                <button class="modal-close" onclick="document.getElementById('historyViewModal').remove()">&times;</button>
            </div>
            <div class="modal-body" style="padding-top:0.5rem;">
                <div style="display:inline-flex;align-items:center;gap:0.4rem;background:#f8fafc;border:1px solid #e2e8f0;border-radius:999px;padding:0.25rem 0.75rem;margin-bottom:0.75rem;">
                    <span style="width:8px;height:8px;border-radius:50%;background:${statusColor};flex-shrink:0;"></span>
                    <span style="font-size:0.75rem;font-weight:700;color:${statusColor};">${statusLabel}</span>
                </div>
                <div style="display:flex;flex-direction:column;">${rows}</div>
            </div>
            <div class="modal-footer" style="justify-content:flex-end;">
                <button class="btn btn-secondary" onclick="document.getElementById('historyViewModal').remove()">Close</button>
            </div>
        </div>`;

  // Close on backdrop click
  modal.addEventListener("click", (e) => {
    if (e.target === modal) modal.remove();
  });
  document.body.appendChild(modal);
};
