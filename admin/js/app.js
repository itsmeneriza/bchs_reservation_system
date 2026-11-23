/**
 * Admin App Init
 * Wires up tabs, modal close handlers, filters, calendar nav, and kicks off data load.
 * All logic lives in the individual modules loaded before this file.
 */

let adminInitialized = false;
let adminRefreshTimer;

function setupResponsiveTableLabels() {
  document.querySelectorAll("#adminApp .table").forEach((table) => {
    const labels = Array.from(table.querySelectorAll("thead th")).map(
      (header) => header.textContent.trim() || "Actions",
    );
    const body = table.tBodies[0];
    if (!body) return;

    const applyLabels = () => {
      Array.from(body.rows).forEach((row) => {
        const isEmptyState = row.cells.length === 1 && row.cells[0].colSpan > 1;
        row.classList.toggle("responsive-empty-row", isEmptyState);

        Array.from(row.cells).forEach((cell, index) => {
          if (isEmptyState) {
            cell.removeAttribute("data-label");
          } else if (labels[index]) {
            cell.dataset.label = labels[index];
          }
        });
      });
    };

    applyLabels();
    new MutationObserver(applyLabels).observe(body, { childList: true });
  });
}

setupResponsiveTableLabels();

window.addEventListener("bchs:admin-authenticated", async () => {
  if (adminInitialized) return;
  adminInitialized = true;

  setupTabs();
  setupModals();
  setupFilters();
  setupCalendarControls();

  await loadData();
  await reconcileExistingFacilityBlocks();
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
  setMobileNavOpen(false);
};

function setMobileNavOpen(isOpen) {
  const tabs = document.querySelector(".tabs");
  const toggle = document.getElementById("mobileNavToggle");
  if (!tabs || !toggle) return;

  tabs.classList.toggle("is-open", isOpen);
  toggle.classList.toggle("is-open", isOpen);
  toggle.setAttribute("aria-expanded", String(isOpen));
}

document.addEventListener("keydown", (event) => {
  const navToggle = document.getElementById("mobileNavToggle");
  if (
    event.key === "Escape" &&
    navToggle?.getAttribute("aria-expanded") === "true"
  ) {
    setMobileNavOpen(false);
    navToggle.focus();
  }
});

function setupTabs() {
  document.querySelectorAll(".tab-trigger").forEach((tab) => {
    tab.addEventListener("click", () => window.activateTab(tab.dataset.tab));
  });

  const navToggle = document.getElementById("mobileNavToggle");
  navToggle?.addEventListener("click", () => {
    const isOpen = navToggle.getAttribute("aria-expanded") === "true";
    setMobileNavOpen(!isOpen);
  });

  document
    .getElementById("mobileLogoutAdminBtn")
    ?.addEventListener("click", () => {
      setMobileNavOpen(false);
      document.getElementById("logoutAdminBtn")?.click();
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
    const date = window._getPendingDayActionDate();
    closeDayActionModal();
    openAddReservationModal(date);
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
