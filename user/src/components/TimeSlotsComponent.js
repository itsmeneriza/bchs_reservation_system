/**
 * Time Slots Component
 * Shows Daily Schedule and Facility Visual Preview.
 */

import { state } from "../core/state.js";
import {
  formatDate,
  getLocalISODate,
  convertTo12Hour,
} from "../utils/dateUtils.js";
import { getReservationsForDate } from "../services/reservationService.js";
import { dataService } from "../services/dataService.js";

export class TimeSlots {
  constructor() {
    this.container = document.getElementById("timeslots-container");
    this.previewWrapper = document.getElementById("facility-preview-wrapper");
    this.dateText = document.getElementById("selected-date-text");

    // Viewer Modal elements
    this.viewerModal = document.getElementById("image-viewer-modal");
    this.viewerImage = document.getElementById("viewer-image");
    this.viewerCaption = document.getElementById("viewer-caption");
    this.viewerClose = document.getElementById("viewer-close");
    this.viewerPrevBtn = document.getElementById("viewer-prev-btn");
    this.viewerNextBtn = document.getElementById("viewer-next-btn");
    this.viewerCounter = document.getElementById("viewer-image-counter");

    // Image navigation
    this.currentImageIndex = 0;

    this.setupViewer();
  }

  setupViewer() {
    if (!this.viewerClose) return;
    this.viewerClose.onclick = () =>
      this.viewerModal.classList.remove("active");
    this.viewerModal.onclick = (e) => {
      if (e.target === this.viewerModal) {
        this.viewerModal.classList.remove("active");
      }
    };

    // Setup viewer navigation buttons
    if (this.viewerPrevBtn) {
      this.viewerPrevBtn.onclick = (e) => {
        e.stopPropagation();
        this.navigateViewerImage(-1);
      };
    }
    if (this.viewerNextBtn) {
      this.viewerNextBtn.onclick = (e) => {
        e.stopPropagation();
        this.navigateViewerImage(1);
      };
    }
  }

  render() {
    if (!this.container || !state.selectedRoom) return;

    // 1. Render Facility Preview Image
    this.renderFacilityPreview();

    // 2. Update Header Date
    if (this.dateText) {
      this.dateText.textContent = formatDate(state.selectedDate);
    }

    const dateStr = getLocalISODate(state.selectedDate);
    const dayreservations = getReservationsForDate(
      state.selectedRoom.id,
      dateStr,
    );

    // Sort entries by start time
    dayreservations.sort((a, b) => a.startTime.localeCompare(b.startTime));

    let html = "";

    // --- SCHEDULE LIST ---
    html += `<div class="timeslot-section">
                    <div class="timeslot-header">Daily Schedule (${dayreservations.length})</div>
                    <div class="timeslot-list">`;

    if (dayreservations.length > 0) {
      dayreservations.forEach((reservation) => {
        const start12 = convertTo12Hour(reservation.startTime);
        const end12 = convertTo12Hour(reservation.endTime);
        const isPending = reservation.status === "pending";
        const isBlocked = reservation.status === "blocked";
        const isSchoolEvent = reservation.isSchoolEvent === true;

        let styleClass = "timeslot-booked";
        if (isPending) styleClass = "timeslot-pending";
        if (isBlocked) styleClass = "timeslot-blocked-admin";
        if (isSchoolEvent) styleClass = "timeslot-school-event";

        const icon = isBlocked
          ? '<circle cx="12" cy="12" r="10"></circle><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"></line>'
          : isSchoolEvent
            ? '<rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line>'
            : isPending
              ? '<circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline>'
              : '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline>';

        const statusLabel = isBlocked
          ? "Unavailable"
          : isSchoolEvent
            ? "School Event"
            : isPending
              ? "Pending"
              : "Approved";
        const purposeText = isBlocked
          ? reservation.purpose.replace("FACILITY UNAVAILABLE: ", "")
          : reservation.purpose || "";
        const nameText = reservation.name
          ? `<span class="ts-name">${reservation.name}</span>`
          : "";
        const attendeesText = reservation.attendees
          ? `<span class="ts-pax">${reservation.attendees} pax</span>`
          : "";

        html += `
                    <div class="timeslot ts-card ${styleClass}" data-reservation-id="${reservation.id}">
                        <div class="ts-icon-wrap">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">${icon}</svg>
                        </div>
                        <div class="ts-body">
                            <div class="ts-time">${start12} – ${end12}</div>
                            <div class="ts-purpose">${purposeText}</div>
                            <div class="ts-meta">${nameText}${attendeesText}</div>
                        </div>
                        <span class="ts-badge">${statusLabel}</span>
                    </div>
                `;
      });
    } else {
      html += `<div class="empty-slots">No reservations for this date</div>`;
    }
    html += `</div></div>`;

    this.container.innerHTML = html;
    this.attachEventListeners();
  }

  renderFacilityPreview() {
    if (!this.previewWrapper) return;

    this.currentImageIndex = 0;
    const imageUrl = dataService.getFacilityImage(
      state.selectedRoom.id,
      this.currentImageIndex,
    );
    const facilityName = state.selectedRoom.name;
    const capacity = state.selectedRoom.capacity;

    this.previewWrapper.innerHTML = `
            <div class="facility-preview-card" title="Click to enlarge view">
                <img src="${imageUrl}" alt="${facilityName}" class="preview-img" id="facility-preview-img" loading="lazy">
                <div class="preview-overlay">
                    <span class="preview-name">${facilityName}</span>
                    <span class="preview-pax">${capacity} Pax Max</span>
                </div>
                <div class="zoom-indicator">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2">
                        <circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line><line x1="11" y1="8" x2="11" y2="14"></line><line x1="8" y1="11" x2="14" y2="11"></line>
                    </svg>
                </div>
            </div>
        `;

    this.previewWrapper.querySelector(".facility-preview-card").onclick =
      () => {
        this.openViewer();
      };
  }

  openViewer() {
    const imageCount = dataService.getFacilityImageCount(state.selectedRoom.id);
    const imageUrl = dataService.getFacilityImage(
      state.selectedRoom.id,
      this.currentImageIndex,
    );
    const facilityName = state.selectedRoom.name;
    const capacity = state.selectedRoom.capacity;

    this.viewerImage.src = imageUrl;
    this.viewerCaption.textContent = `${facilityName} - School Facility (Max ${capacity} Pax)`;

    // Show/hide navigation buttons based on image count
    if (imageCount > 1) {
      this.viewerPrevBtn.style.display = "flex";
      this.viewerNextBtn.style.display = "flex";
      this.viewerCounter.style.display = "block";
      this.viewerCounter.textContent = `${this.currentImageIndex + 1} / ${imageCount}`;
    } else {
      this.viewerPrevBtn.style.display = "none";
      this.viewerNextBtn.style.display = "none";
      this.viewerCounter.style.display = "none";
    }

    this.viewerModal.classList.add("active");
  }

  navigateViewerImage(direction) {
    const imageCount = dataService.getFacilityImageCount(state.selectedRoom.id);
    this.currentImageIndex =
      (this.currentImageIndex + direction + imageCount) % imageCount;

    const imageUrl = dataService.getFacilityImage(
      state.selectedRoom.id,
      this.currentImageIndex,
    );

    this.viewerImage.src = imageUrl;
    this.viewerCounter.textContent = `${this.currentImageIndex + 1} / ${imageCount}`;
  }

  attachEventListeners() {
    // Cancellation feature removed - all slots are now non-interactive
  }
}
