/**
 * Calendar Component
 * Handles calendar display, date selection, and reservation density legend.
 */

import { state, setSelectedDate } from "../core/state.js";
import {
  getMonthYear,
  getDaysInMonth,
  getFirstDayOfMonth,
  isToday,
  isSameDate,
  formatDate,
  isInCurrentWeek,
  getLocalISODate,
} from "../utils/dateUtils.js";
import {
  getReservationDensity,
  getReservationsForDate,
} from "../services/reservationService.js";
import { TimeSlots } from "./TimeSlotsComponent.js";
import { showToast } from "./NotificationComponent.js";

export class Calendar {
  constructor() {
    this.container = document.getElementById("calendar-grid");
    this.monthYearEl = document.getElementById("calendar-month-year");
    this.monthYearMobileEl = document.getElementById(
      "calendar-month-year-mobile",
    );
    this.facilityTitleEl = document.getElementById("calendar-facility-title");
    this.sectionEl = document.querySelector(".calendar-section");
  }

  render() {
    if (!this.container || !state.selectedFacility) return;

    this.facilityTitleEl.textContent = `Calendar - ${state.selectedFacility.name}`;
    const monthYear = getMonthYear(state.currentMonth, state.currentYear);
    this.monthYearEl.textContent = monthYear;
    if (this.monthYearMobileEl) this.monthYearMobileEl.textContent = monthYear;

    const daysInMonth = getDaysInMonth(state.currentMonth, state.currentYear);
    const firstDay = getFirstDayOfMonth(state.currentMonth, state.currentYear);

    let html = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
      .map((day) => `<div class="day-header">${day}</div>`)
      .join("");

    // Empty cells before first day
    for (let i = 0; i < firstDay; i++) {
      html += "<div></div>";
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Render day cells
    for (let day = 1; day <= daysInMonth; day++) {
      html += this.renderDayCell(day, today);
    }

    this.container.innerHTML = html;
    this.updateGroundsNote();
    this.updateRequestButton();
    this.renderLegend();
    this.attachEventListeners();
  }

  renderDayCell(day, today) {
    const date = new Date(state.currentYear, state.currentMonth, day);
    date.setHours(0, 0, 0, 0);
    const dateStr = getLocalISODate(date);

    const isCurrentDay = isToday(day, state.currentMonth, state.currentYear);
    const selected = isSameDate(state.selectedDate, date);
    const density = getReservationDensity(
      state.selectedFacility.id,
      day,
      state.currentMonth,
      state.currentYear,
    );

    const dayreservations = getReservationsForDate(
      state.selectedFacility.id,
      dateStr,
    );
    const hasPending = dayreservations.some((b) => b.status === "pending");
    const hasApproved = dayreservations.some(
      (b) => b.status === "approved" || b.status === "accepted",
    );
    const hasSchoolEvent = dayreservations.some(
      (b) => b.isSchoolEvent === true,
    );
    const isAdminBlocked = dayreservations.some(
      (b) => b.status === "blocked" && b.isFullDayBlock,
    );

    const dayOfWeek = date.getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    const isPast = date < today;
    const isCurrentWeek = isInCurrentWeek(date);
    const isGroundsWeekend =
      state.selectedFacility.id === "grounds" && isWeekend;
    const isUnavailable =
      isAdminBlocked || hasSchoolEvent || isGroundsWeekend;

    // User reservations start from the next week.
    const isDisabled = isPast || isCurrentWeek || isUnavailable;

    let bgColor = "transparent";
    if (isUnavailable) {
      bgColor = "var(--calendar-unavailable-bg)";
    } else if (isPast) {
      bgColor = "var(--calendar-past-bg)";
    } else if (selected) {
      bgColor = "var(--calendar-selected-bg)";
    } else if (isCurrentDay) {
      bgColor = "var(--calendar-today-bg)";
    } else if (hasPending && !hasApproved) {
      bgColor = "var(--calendar-pending-bg)";
    } else if (density === "full") {
      bgColor = "var(--calendar-full-bg)";
    } else if (density === "busy") {
      bgColor = "var(--calendar-busy-bg)";
    }

    const closedStyle = isDisabled
      ? `background-color: ${bgColor}; color: ${isUnavailable ? "white" : "#6b7280"}; cursor: not-allowed;`
      : `background-color: ${bgColor};`;

    // Use white text on dark backgrounds
    const darkBg = [
      "var(--calendar-full-bg)",
      "var(--calendar-unavailable-bg)",
    ].includes(bgColor);
    const textColor = darkBg ? "color: white;" : "";

    const todayRing =
      isCurrentDay && !selected && !isDisabled
        ? "box-shadow: 0 0 0 2px var(--calendar-today-ring);"
        : "";

    // Pending marker
    const pendingMarker = hasPending
      ? '<span style="position: absolute; top: 4px; right: 4px; width: 6px; height: 6px; background-color: var(--status-pending); border-radius: 50%;"></span>'
      : "";

    // Hover tooltip: count approved + pending
    const approvedCount = dayreservations.filter(
      (b) => b.status === "approved" || b.status === "accepted",
    ).length;
    const pendingCount = dayreservations.filter(
      (b) => b.status === "pending",
    ).length;
    let tooltipParts = [];
    if (approvedCount > 0) tooltipParts.push(`${approvedCount} reserved`);
    if (pendingCount > 0) tooltipParts.push(`${pendingCount} pending`);
    const tooltip =
      !isPast && tooltipParts.length > 0 ? tooltipParts.join(" · ") : "";

    return `
            <span class="day-cell-wrapper">
            <button 
                class="day-cell" 
                data-day="${day}" 
                data-blocked="${isAdminBlocked || hasSchoolEvent}"
                ${tooltip ? `data-tooltip="${tooltip}"` : ""}
                ${isDisabled ? `disabled style="${closedStyle}"` : `style="${closedStyle} ${todayRing} ${textColor}"`}
            >
                ${pendingMarker}
                <span>${day}</span>
            </button>
                ${tooltip ? `<span class="day-tooltip">${tooltip}</span>` : ""}
            </span>
        `;
  }

  /**
   * Renders the color legend for the calendar
   */
  renderLegend() {
    const items = [
      { color: "var(--calendar-full-bg)", label: "Full" },
      { color: "var(--calendar-busy-bg)", label: "Partial" },
      { color: "var(--calendar-pending-bg)", label: "Pending" },
      { color: "var(--calendar-selected-bg)", label: "Selected" },
      {
        color: "var(--calendar-today-bg)",
        label: "Today",
        border: "var(--calendar-today-ring)",
      },
      { color: "var(--calendar-unavailable-bg)", label: "Unavailable" },
    ];

    const html = items
      .map(
        (item) => `
            <div class="legend-item">
                <div class="legend-color" style="background-color: ${item.color}; ${item.border ? `box-shadow: 0 0 0 2px ${item.border}` : ""}"></div>
                <span>${item.label}</span>
            </div>
        `,
      )
      .join("");

    const legend = document.getElementById("calendar-legend");
    if (legend) legend.innerHTML = html;

    const legendMobile = document.getElementById("calendar-legend-mobile");
    if (legendMobile) legendMobile.innerHTML = html;
  }

  updateGroundsNote() {
    const groundsNote = document.getElementById("grounds-note");
    if (groundsNote) {
      groundsNote.style.display =
        state.selectedFacility.id === "grounds" ? "block" : "none";
    }
  }

  updateRequestButton() {
    // Button removed — modal opens directly on day click
  }

  attachEventListeners() {
    const isMobile = () => window.matchMedia("(max-width: 768px)").matches;

    document.querySelectorAll(".day-cell").forEach((cell) => {
      if (!cell.disabled) {
        // Single click — select date and update right sidebar
        // On mobile: also open the reservation modal immediately
        cell.addEventListener("click", () => {
          const isBlocked = cell.dataset.blocked === "true";
          if (isBlocked) {
            showToast("This day is unavailable for reservations.", "error");
            return;
          }

          const day = parseInt(cell.dataset.day);
          setSelectedDate(new Date(state.currentYear, state.currentMonth, day));
          this.render();

          const timeSlots = new TimeSlots();
          timeSlots.render();

          const dateText = document.getElementById("selected-date-text");
          if (dateText) {
            dateText.textContent = formatDate(state.selectedDate);
          }

          if (isMobile() && window._openReservationModal) {
            window._openReservationModal();
          }
        });

        // Double click — open reservation modal (desktop)
        cell.addEventListener("dblclick", () => {
          const isBlocked = cell.dataset.blocked === "true";
          if (isBlocked) return;

          if (window._openReservationModal) window._openReservationModal();
        });
      }
    });
  }

  previousMonth() {
    state.currentMonth--;
    if (state.currentMonth < 0) {
      state.currentMonth = 11;
      state.currentYear--;
    }
    this.render();
  }

  nextMonth() {
    state.currentMonth++;
    if (state.currentMonth > 11) {
      state.currentMonth = 0;
      state.currentYear++;
    }
    this.render();
  }
}
