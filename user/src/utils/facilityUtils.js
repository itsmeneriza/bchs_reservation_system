/**
 * Facility Utilities
 * Helpers for facility image viewing and mobile interactions.
 */

import { dataService } from '../services/dataService.js';
import { state } from '../core/state.js';

// ─── Image Viewer ─────────────────────────────────────────────────────────────

/**
 * Opens the facility image viewer modal for the currently selected room.
 * If a facility preview card is already visible, it delegates to that card's
 * click handler so the viewer state stays in sync with TimeSlotsComponent.
 */
export function openFacilityViewer() {
    const modal = document.getElementById('image-viewer-modal');
    if (!modal) return;

    // Prefer delegating to the existing preview card (keeps TimeSlotsComponent in sync)
    const previewCard = document.querySelector('.facility-preview-card');
    if (previewCard) {
        previewCard.click();
        return;
    }

    // No preview card rendered yet — open viewer directly using the first room
    const room = state.selectedRoom || (state.rooms && state.rooms[0]);
    if (!room) return;

    const count = dataService.getFacilityImageCount(room.id);

    const img     = document.getElementById('viewer-image');
    const cap     = document.getElementById('viewer-caption');
    const prevBtn = document.getElementById('viewer-prev-btn');
    const nextBtn = document.getElementById('viewer-next-btn');
    const counter = document.getElementById('viewer-image-counter');

    if (img) img.src = dataService.getFacilityImage(room.id, 0);
    if (cap) cap.textContent = `${room.name} - School Facility (Max ${room.capacity} Pax)`;

    const hasMultiple = count > 1;
    if (prevBtn) prevBtn.style.display = hasMultiple ? 'flex' : 'none';
    if (nextBtn) nextBtn.style.display = hasMultiple ? 'flex' : 'none';
    if (counter) {
        counter.style.display = hasMultiple ? 'block' : 'none';
        counter.textContent   = `1 / ${count}`;
    }

    modal.classList.add('active');
}

// ─── Mobile Global Binding ────────────────────────────────────────────────────

/**
 * Registers window._viewFacilityMobile so the inline onclick on the
 * "View Facility" button in reservation.html can call it.
 * Called once on app init from app.js.
 */
export function registerMobileViewer() {
    window._viewFacilityMobile = openFacilityViewer;
}
