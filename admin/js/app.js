/**
 * Admin App Init
 * Wires up tabs, modal close handlers, filters, calendar nav, and kicks off data load.
 * All logic lives in the individual modules loaded before this file.
 */

let adminInitialized = false;
let adminRefreshTimer;

window.addEventListener("bchs:admin-authenticated", async () => {
  if (adminInitialized) return;
  adminInitialized = true;

  setupTabs();
  setupModals();
  setupFilters();
  setupCalendarControls();

  await loadData();
  adminRefreshTimer = setInterval(loadData, 30000);
});

window.addEventListener("bchs:admin-logged-out", () => {
  window.clearInterval(adminRefreshTimer);
  adminRefreshTimer = null;
  adminInitialized = false;
});

// ─── Tabs ─────────────────────────────────────────────────────────────────────

/**
 * Activates a named tab programmatically.
 * Exposed on window so other modules (editModal.js, blocks.js) can call it
 * instead of duplicating the querySelectorAll pattern.
 *
 * @param {string} tabName  Value of data-tab attribute, e.g. 'approved'
 */
window.activateTab = function (tabName) {
  document
    .querySelectorAll(".tab-trigger")
    .forEach((t) => t.classList.remove("active"));
  document
    .querySelectorAll(".tab-content")
    .forEach((c) => c.classList.remove("active"));
  const trigger = document.querySelector(`.tab-trigger[data-tab="${tabName}"]`);
  if (trigger) trigger.classList.add("active");
  document.getElementById(`${tabName}-tab`)?.classList.add("active");
};

function setupTabs() {
  document.querySelectorAll(".tab-trigger").forEach((tab) => {
    tab.addEventListener("click", () => window.activateTab(tab.dataset.tab));
  });
}

// ─── Filters ──────────────────────────────────────────────────────────────────

function setupFilters() {
  document
    .getElementById("searchFilter")
    ?.addEventListener("input", renderUpcoming);
  document
    .getElementById("facilityFilter")
    ?.addEventListener("change", renderUpcoming);
}

// ─── Calendar Controls ────────────────────────────────────────────────────────

function setupCalendarControls() {
  document.getElementById("prevMonth").onclick = () => {
    currentCalendarDate.setMonth(currentCalendarDate.getMonth() - 1);
    renderCalendar();
  };
  document.getElementById("nextMonth").onclick = () => {
    currentCalendarDate.setMonth(currentCalendarDate.getMonth() + 1);
    renderCalendar();
  };
}

// ─── Modals ───────────────────────────────────────────────────────────────────

function setupModals() {
  // Close on backdrop click
  [
    "editModal",
    "addEventModal",
    "dayActionModal",
    "quickBlockModal",
    "addReservationModal",
    "rejectionReasonModal",
    "cancellationReviewModal",
  ].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("click", (e) => {
      if (e.target === el) el.classList.remove("active");
    });
  });

  // Edit modal
  document.getElementById("closeEditModal").onclick = () =>
    document.getElementById("editModal").classList.remove("active");
  document.getElementById("saveEdit").onclick = savereservationChanges;

  // Block modal
  document.getElementById("confirmQuickBlockBtn").onclick = confirmQuickBlock;

  // Manual reservation
  document.getElementById("openAddReservationBtn").onclick = () => {
    closeDayActionModal();
    openAddReservationModal();
  };
  document.getElementById("saveManualReservationBtn").onclick =
    saveManualReservation;

  // Event modal
  document
    .getElementById("openAddEventBtn")
    ?.addEventListener("click", () => openAddEventModal());
  document.getElementById("saveEventBtn").onclick = saveNewEvent;

  // Day action choice modal
  document.getElementById("dayActionEventBtn").onclick = () => {
    const date = window._getPendingDayActionDate();
    closeDayActionModal();
    openAddEventModal(date);
  };
  document.getElementById("dayActionBlockBtn").onclick = () => {
    const date = window._getPendingDayActionDate();
    closeDayActionModal();
    openQuickBlock(date);
  };
}
