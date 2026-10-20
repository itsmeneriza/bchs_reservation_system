/**
 * Room List Component
 * Displays available facilitys with pagination (3 per page)
 * Updated: Navigation buttons now flank the facility cards.
 */

import { state, setSelectedRoom } from "../core/state.js";
import { Calendar } from "./CalendarComponent.js";
import { TimeSlots } from "./TimeSlotsComponent.js";

export class RoomList {
  constructor() {
    this.container = document.getElementById("facility-list");
  }

  render(filterPax = 0) {
    if (!this.container) return;
    this.container.innerHTML = "";

    state.facilitys.forEach((facility) => {
      const tooSmall = filterPax > 0 && facility.capacity < filterPax;
      const facilityCard = document.createElement("button");
      facilityCard.className = "facility-card-mini";

      if (state.selectedRoom && state.selectedRoom.id === facility.id) {
        facilityCard.classList.add("selected");
      }

      if (tooSmall) {
        facilityCard.classList.add("facility-card-disabled");
        facilityCard.disabled = true;
        facilityCard.title = `Capacity: ${facility.capacity} pax — too small for ${filterPax} attendees`;
      }

      facilityCard.innerHTML = `
                <div class="facility-info">
                    <div class="facility-name">${facility.name}</div>
                    <div class="facility-capacity-badge">
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
                            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                            <circle cx="9" cy="7" r="4"></circle>
                        </svg>
                        <span>${facility.capacity}</span>
                    </div>
                    ${tooSmall ? `<div class="facility-capacity-warning">Too small</div>` : ""}
                </div>
            `;

      if (!tooSmall) {
        facilityCard.addEventListener("click", () => this.selectRoom(facility));
      }
      this.container.appendChild(facilityCard);
    });
  }

  selectRoom(facility) {
    setSelectedRoom(facility);
    this.render();

    const calendar = new Calendar();
    calendar.render();

    const timeSlots = new TimeSlots();
    timeSlots.render();
  }
}
