
/**
 * Landing Page Script
 * Loads and displays events
 */

async function loadEvents() {
    let events = [];
    try {
        // Try server API first (source of truth)
        const res = await fetch('/api/events');
        if (res.ok) {
            const data = await res.json();
            events = data.events || [];
        } else {
            throw new Error();
        }
    } catch {
        try {
            // Fallback to static file
            const res = await fetch('/data/events.json');
            const data = await res.json();
            events = data.events || [];
        } catch (e) {
            console.error('Error loading events:', e);
        }
    }
    renderEvents(events);
}

function renderEvents(events) {
    const upcomingContainer = document.getElementById('upcoming-events-grid');
    const pastContainer = document.getElementById('past-events-grid');
    
    if (!upcomingContainer || !pastContainer) return;

    const now = new Date();
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    const oneYearAgo = new Date(today);
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

    const datedEvents = events
        .map(event => ({
            event,
            date: parseEventDate(event.date),
            endDate: getEventEndDate(event)
        }))
        .filter(item => item.date && item.endDate);
    const upcoming = datedEvents
        .filter(item => item.endDate >= now)
        .map(item => item.event);
    const past = datedEvents
        .filter(item => item.endDate < now && item.date > oneYearAgo)
        .map(item => item.event);

    // Render upcoming events
    upcomingContainer.innerHTML = upcoming.length > 0
        ? upcoming.map(event => createEventCard(event)).join('')
        : '<p class="empty-message">No upcoming events</p>';

    // Render past events
    pastContainer.innerHTML = past.length > 0
        ? past.map(event => createEventCard(event, true)).join('')
        : '<p class="empty-message">No past events</p>';
}

function parseEventDate(dateValue) {
    if (typeof dateValue !== 'string' || !dateValue) return null;

    const dateOnlyMatch = dateValue.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (dateOnlyMatch) {
        const [, year, month, day] = dateOnlyMatch;
        const date = new Date(Number(year), Number(month) - 1, Number(day));
        if (date.getFullYear() !== Number(year) ||
            date.getMonth() !== Number(month) - 1 ||
            date.getDate() !== Number(day)) {
            return null;
        }
        return date;
    }

    const date = new Date(dateValue);
    return Number.isNaN(date.getTime()) ? null : date;
}

function getEventEndDate(event) {
    const date = parseEventDate(event.date);
    if (!date) return null;

    const endDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const timeRange = typeof event.time === 'string' ? event.time.split(/\s*[-–—]\s*/) : [];
    const endTime = timeRange.length > 1 ? timeRange[timeRange.length - 1].trim() : '';
    const match = endTime.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);

    if (!match) {
        endDate.setHours(23, 59, 59, 999);
        return endDate;
    }

    let hours = Number(match[1]);
    const minutes = Number(match[2]);
    const meridiem = match[3]?.toUpperCase();
    if (minutes > 59 || (meridiem && (hours < 1 || hours > 12)) ||
        (!meridiem && hours > 23)) {
        endDate.setHours(23, 59, 59, 999);
        return endDate;
    }
    if (meridiem) {
        hours = hours % 12 + (meridiem === 'PM' ? 12 : 0);
    }

    endDate.setHours(hours, minutes, 0, 0);
    return endDate;
}

function createEventCard(event, isPast = false) {
    const date = parseEventDate(event.date);
    const formattedDate = date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
    });
    const cardId = `event-details-${event.id}`;

    const isGradient = event.image && event.image.startsWith('__gradient__');
    const bgStyle = isGradient
        ? `background: ${event.image.replace('__gradient__', '')};`
        : `background-image: url('${event.image || ''}');`;

    return `
        <div class="event-card-wrapper">
            <div class="event-card ${isPast ? 'past-event' : ''}" style="${bgStyle}" 
                 onclick="toggleEventDetails('${cardId}')" role="button" tabindex="0"
                 onkeydown="if(event.key==='Enter'||event.key===' ')toggleEventDetails('${cardId}')">
                <div class="event-card-overlay">
                    <div class="event-card-header">
                        <h3 class="event-title">${event.title}</h3>
                        <span class="event-expand-icon">&#9660;</span>
                    </div>
                    <p class="event-date">&#128197; ${formattedDate}</p>
                    <p class="event-location">&#128205; ${event.location}</p>
                </div>
            </div>
            <div class="event-details-panel" id="${cardId}">
                <div class="event-details-inner">
                    ${event.time ? `<p><span class="detail-label">&#128336; Time</span> ${event.time}</p>` : ''}
                    ${event.attendees ? `<p><span class="detail-label">&#128101; Expected Attendees</span> ${event.attendees}</p>` : ''}
                    ${event.description ? `<p><span class="detail-label">&#128221; Details</span> ${event.description}</p>` : ''}
                </div>
            </div>
        </div>
    `;
}

function toggleEventDetails(id) {
    const panel = document.getElementById(id);
    if (!panel) return;
    const card = panel.previousElementSibling;
    const isOpen = panel.classList.toggle('open');
    if (card) card.classList.toggle('expanded', isOpen);
}

// Load events when page loads
document.addEventListener('DOMContentLoaded', () => {
    loadEvents();

    // Events toggle
    document.querySelectorAll('.toggle-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.toggle-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.events-panel').forEach(p => p.classList.remove('active'));
            btn.classList.add('active');
            document.getElementById(btn.dataset.target)?.classList.add('active');
        });
    });
});
