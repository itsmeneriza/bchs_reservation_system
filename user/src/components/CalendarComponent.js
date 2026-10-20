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
  isPastDate,
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

    let html = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"]
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
    const isAdminBlocked = dayreservations.some(
      (b) => b.status === "blocked" && b.isFullDayBlock,
    );

    const dayOfWeek = date.getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    const isPast = date < today;

    // Hard disabled states: Past dates or Grounds on weekends
    const isDisabled =
      isPast || (state.selectedFacility.id === "grounds" && isWeekend);

    let bgColor = "transparent";
    if (isAdminBlocked) {
      bgColor = "#4b5563"; // Admin Blocked Dark Gray
    } else if (isDisabled) {
      bgColor = isPast && !isWeekend ? "#e5e7eb" : "#4b5563";
    } else if (selected) {
      bgColor = "var(--calendar-selected-bg)";
    } else if (isCurrentDay) {
      bgColor = "var(--calendar-today-bg)";
    } else if (density === "full") {
      bgColor = "var(--calendar-full-bg)";
    } else if (density === "busy") {
      bgColor = "var(--calendar-busy-bg)";
    } else if (density === "light") {
      bgColor = "var(--calendar-light-bg)";
    } else if (hasPending && !hasApproved) {
      bgColor = "var(--calendar-pending-bg)";
    }

    const closedStyle = isDisabled
      ? `background-color: ${bgColor}; opacity: ${isPast && !isWeekend ? "0.4" : "0.6"}; color: #9ca3af; cursor: not-allowed;`
      : `background-color: ${bgColor};`;

    // Use white text on dark backgrounds
    const darkBg = [
      "var(--calendar-full-bg)",
      "var(--calendar-busy-bg)",
      "#4b5563",
    ].includes(bgColor);
    const textColor = darkBg ? "color: white;" : "";

    const todayRing =
      isCurrentDay && !selected && !isDisabled
        ? "box-shadow: 0 0 0 2px var(--calendar-today-ring);"
        : "";

    // Pending marker
    const pendingMarker =
      hasPending && hasApproved && !selected
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
    const tooltip = tooltipParts.length > 0 ? tooltipParts.join(" · ") : "";

    return `
            <button 
                class="day-cell" 
                data-day="${day}" 
                data-blocked="${isAdminBlocked}"
                ${tooltip ? `data-tooltip="${tooltip}"` : ""}
                ${isDisabled ? `disabled style="${closedStyle}"` : `style="${closedStyle} ${todayRing} ${textColor}"`}
            >
                ${pendingMarker}
                <span>${day}</span>
                ${tooltip ? `<span class="day-tooltip">${tooltip}</span>` : ""}
            </button>
        `;
  }

  /**
   * Renders the color legend for the calendar
   */
  renderLegend() {
    const items = [
      { color: "var(--calendar-full-bg)", label: "Full" },
      { color: "var(--calendar-busy-bg)", label: "Busy" },
      { color: "var(--calendar-light-bg)", label: "Light" },
      { color: "var(--calendar-pending-bg)", label: "Pending" },
      { color: "var(--calendar-selected-bg)", label: "Selected" },
      {
        color: "var(--calendar-today-bg)",
        label: "Today",
        border: "var(--calendar-today-ring)",
      },
      { color: "#4b5563", label: "Unavailable" },
      { color: "#f59e0b", label: "School Event" },
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
