/**
 * Room List Component
 * Displays available rooms with pagination (3 per page)
 * Updated: Navigation buttons now flank the room cards.
 */

import { state, setSelectedRoom } from '../core/state.js';
import { Calendar } from './CalendarComponent.js';
import { TimeSlots } from './TimeSlotsComponent.js';

export class RoomList {
    constructor() {
        this.container = document.getElementById('room-list');
    }

    render(filterPax = 0) {
        if (!this.container) return;
        this.container.innerHTML = '';

        state.rooms.forEach(room => {
            const tooSmall = filterPax > 0 && room.capacity < filterPax;
            const roomCard = document.createElement('button');
            roomCard.className = 'room-card-mini';

            if (state.selectedRoom && state.selectedRoom.id === room.id) {
                roomCard.classList.add('selected');
            }

            if (tooSmall) {
                roomCard.classList.add('room-card-disabled');
                roomCard.disabled = true;
                roomCard.title = `Capacity: ${room.capacity} pax — too small for ${filterPax} attendees`;
            }

            roomCard.innerHTML = `
                <div class="room-info">
                    <div class="room-name">${room.name}</div>
                    <div class="room-capacity-badge">
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
                            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                            <circle cx="9" cy="7" r="4"></circle>
                        </svg>
                        <span>${room.capacity}</span>
                    </div>
                    ${tooSmall ? `<div class="room-capacity-warning">Too small</div>` : ''}
                </div>
            `;

            if (!tooSmall) {
                roomCard.addEventListener('click', () => this.selectRoom(room));
            }
            this.container.appendChild(roomCard);
        });
    }

    selectRoom(room) {
        setSelectedRoom(room);
        this.render();

        const calendar = new Calendar();
        calendar.render();

        const timeSlots = new TimeSlots();
        timeSlots.render();
    }
}
