/**
 * Admin Reservations Module
 * Manual reservation creation, tab renders (Queue, Confirmed, Approved, Upcoming, History, Cancellations).
 * Room data sourced from RoomUtils (loaded via <script src="/scripts/RoomUtils.js"> in admin.html).
 */

// ─── Room Helpers ─────────────────────────────────────────────────────────────
// Use the live rooms array when populated, fall back to RoomUtils.ROOMS_FALLBACK.

function _getAdminRooms() {
    return (rooms && rooms.length > 0) ? rooms : RoomUtils.ROOMS_FALLBACK;
}

function _getAdminMinPax(roomId) {
    const room = _getAdminRooms().find(r => r.id === roomId);
    return (room && room.minPax != null) ? room.minPax : (RoomUtils.ROOM_MIN_PAX[roomId] || 0);
}

function _getRoomPriceFallback(roomId) {
    return RoomUtils.ROOM_PRICE_FALLBACK[roomId] || 0;
}

// ─── Render All Tabs ──────────────────────────────────────────────────────────

function renderAll() {
    renderQueue();
    renderConfirmed();
    renderApproved();
    renderUpcoming();
    renderPayments();
    renderCancellations();
    renderHistory();
    renderCalendar();
}

// ─── Room Selects / Facility Picker ──────────────────────────────────────────

function populateRoomSelects() {
    const source = _getAdminRooms();

    const editEl = document.getElementById('editRoomId');
    if (editEl) editEl.innerHTML = source.map(r => `<option value="${r.id}">${r.name} (${r.capacity} pax)</option>`).join('');

    renderAdminFacilityPicker();
    if (document.getElementById('addReservationModal')?.classList.contains('active')) updateManualPricing();
}

window.renderAdminFacilityPicker = function(filterPax) {
    const row = document.getElementById('admin-facility-row');
    if (!row) return;
    const source = _getAdminRooms();
    if (filterPax === undefined) filterPax = parseInt(document.getElementById('manualAttendees')?.value) || 0;
    const currentVal = document.getElementById('manualRoom')?.value || source[0].id;

    row.innerHTML = source.map(r => {
        const tooSmall  = filterPax > 0 && r.capacity < filterPax;
        const isSelected = r.id === currentVal;
        return `<button type="button"
            class="admin-facility-pill${isSelected ? ' selected' : ''}${tooSmall ? ' disabled' : ''}"
            ${tooSmall ? 'disabled' : ''}
            title="${tooSmall ? `Capacity: ${r.capacity} pax — too small for ${filterPax} attendees` : `${r.name} · up to ${r.capacity} pax`}"
            onclick="selectAdminFacility('${r.id}')">
            <span class="facility-pill-name">${r.name}</span>
            <span class="facility-pill-cap">${r.capacity} pax</span>
        </button>`;
    }).join('');
};

window.selectAdminFacility = function(roomId) {
    const hiddenInput = document.getElementById('manualRoom');
    if (hiddenInput) hiddenInput.value = roomId;
    renderAdminFacilityPicker();
    updateAdminRoomSuggestion();
    updateManualPricing();
    refreshManualConflicts();
    if (window.checkAdminMinPax) checkAdminMinPax();
};

// ─── Open / Close Manual Reservation Modal ────────────────────────────────────

function openAddReservationModal() {
    const modal       = document.getElementById('addReservationModal');
    const defaultRoom = (rooms && rooms.length > 0) ? rooms[0].id : 'auditorium';
    const hiddenRoom  = document.getElementById('manualRoom');
    if (hiddenRoom && !hiddenRoom.value) hiddenRoom.value = defaultRoom;

    populateRoomSelects();
    document.getElementById('manualDate').value      = new Date().toISOString().split('T')[0];
    document.getElementById('manualStartTime').value = '08:00';
    document.getElementById('manualEndTime').value   = '10:00';
    document.getElementById('admin-room-suggestion').style.display = 'none';

    renderAdminFacilityPicker(0);

    ['manualStartTime', 'manualEndTime'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.removeEventListener('change', updateManualPricing);
            el.addEventListener('change', updateManualPricing);
            el.removeEventListener('change', refreshManualConflicts);
            el.addEventListener('change', refreshManualConflicts);
        }
    });

    updateManualPricing();
    refreshManualConflicts();
    modal.classList.add('active');
}

window.closeAddReservationModal = () => {
    document.getElementById('addReservationModal').classList.remove('active');
    ['manualName','manualContact','manualContactNumber','manualEmail','manualPurpose'].forEach(id => {
        const el = document.getElementById(id); if (el) el.value = '';
    });
    document.getElementById('purposeOtherBox').style.display = 'none';
    document.getElementById('purposeOtherBox').value = '';
    document.getElementById('manualAttendees').value = '0';
    document.getElementById('manualRoom').value = '';
    document.querySelectorAll('#manualUtilities input[type="checkbox"]').forEach(cb => cb.checked = false);
    document.getElementById('utilitiesOtherBox').style.display = 'none';
    document.getElementById('utilitiesOtherBox').value = '';
    document.getElementById('admin-room-suggestion').style.display = 'none';
    document.getElementById('manualPricingPreview').style.display = 'none';
    document.getElementById('adminPaxRow').style.display = 'none';
    document.getElementById('admin-min-pax-warning').style.display = 'none';
    const staffToggle = document.getElementById('manualIsStaff');
    if (staffToggle) staffToggle.checked = false;
    updateManualPricing();
};

// ─── Pricing Preview ──────────────────────────────────────────────────────────

function updateManualPricing() {
    const roomId  = document.getElementById('manualRoom').value;
    const start   = document.getElementById('manualStartTime').value;
    const end     = document.getElementById('manualEndTime').value;
    const preview = document.getElementById('manualPricingPreview');
    const isStaff = document.getElementById('manualIsStaff')?.checked || false;

    const pill     = document.getElementById('staffTogglePill');
    const track    = document.getElementById('staffToggleTrack');
    const labelOff = document.getElementById('staffToggleLabel');
    const labelOn  = document.getElementById('staffToggleLabelOn');
    if (pill)     pill.style.transform   = isStaff ? 'translateX(78px)' : 'translateX(0)';
    if (track)    track.style.borderColor = isStaff ? '#800020' : '#e2e8f0';
    if (labelOff) labelOff.style.color    = isStaff ? '#94a3b8' : '#475569';
    if (labelOn)  { labelOn.style.color = isStaff ? '#800020' : '#94a3b8'; labelOn.style.fontWeight = isStaff ? '800' : '700'; }

    const paymentSelect = document.getElementById('manualPaymentStatus');
    if (paymentSelect) {
        paymentSelect.value    = isStaff ? 'paid' : 'pending';
        paymentSelect.disabled = isStaff;
        paymentSelect.style.opacity = isStaff ? '0.6' : '';
        paymentSelect.style.cursor  = isStaff ? 'not-allowed' : '';
    }

    if (!roomId || !start || !end || start >= end) { preview.style.display = 'none'; return; }

    const room         = rooms.find(r => r.id === roomId);
    const pricePerHour = isStaff ? 0 : (room?.pricePerHour ?? _getRoomPriceFallback(roomId));
    const { duration, facilityTotal, utilityFee, total } = computeBookingTotal(pricePerHour, start, end, isStaff);

    document.getElementById('manualPriceRate').textContent     = isStaff ? 'FREE (Staff)' : `₱${pricePerHour.toLocaleString('en-PH')}/hr`;
    document.getElementById('manualPriceDuration').textContent  = `${duration} hr${duration !== 1 ? 's' : ''}`;
    document.getElementById('manualPriceSubtotal').textContent  = isStaff ? 'FREE' : `₱${facilityTotal.toLocaleString('en-PH', {minimumFractionDigits: 2})}`;

    // Utility fee row — show only when applicable
    const utilityRow = document.getElementById('manualUtilityFeeRow');
    if (utilityRow) {
        if (!isStaff && utilityFee > 0) {
            utilityRow.style.display = 'flex';
            const utilityFeeEl = document.getElementById('manualUtilityFeeAmount');
            if (utilityFeeEl) utilityFeeEl.textContent = `₱${utilityFee.toLocaleString('en-PH', {minimumFractionDigits: 2})}`;
        } else {
            utilityRow.style.display = 'none';
        }
    }

    document.getElementById('manualPriceTotal').textContent     = isStaff ? 'FREE' : `₱${total.toLocaleString('en-PH', {minimumFractionDigits: 2})}`;
    document.getElementById('manualPriceTotal').style.color     = isStaff ? '#16a34a' : '#800020';
    preview.style.display = 'block';
}

window.updateAdminRoomSuggestion = function() {
    const attendees    = parseInt(document.getElementById('manualAttendees').value) || 0;
    const roomSelect   = document.getElementById('manualRoom');
    const suggestionBox  = document.getElementById('admin-room-suggestion');
    const suggestionText = document.getElementById('admin-suggestion-text');
    if (!attendees || attendees <= 0) { suggestionBox.style.display = 'none'; return; }

    const currentRoom = rooms.find(r => r.id === roomSelect.value);
    if (!currentRoom) { suggestionBox.style.display = 'none'; return; }

    if (attendees > currentRoom.capacity) {
        const fits = rooms.filter(r => r.capacity >= attendees).sort((a, b) => a.capacity - b.capacity);
        suggestionText.innerHTML = fits.length > 0
            ? `<strong>${currentRoom.name}</strong> fits ${currentRoom.capacity} pax. Suggested: <strong>${fits.map(r => `<a href="#" onclick="document.getElementById('manualRoom').value='${r.id}';updateAdminRoomSuggestion();return false;" style="color:#800020;">${r.name} (${r.capacity} pax)</a>`).join(', ')}</strong>`
            : `${attendees} pax exceeds all facilities. Contact admin for special arrangements.`;
        suggestionBox.style.display = 'block';
        return;
    }
    if (attendees < currentRoom.capacity * 0.2) {
        const smaller = rooms.filter(r => r.capacity >= attendees && r.capacity < currentRoom.capacity).sort((a, b) => a.capacity - b.capacity);
        if (smaller.length > 0) {
            suggestionText.innerHTML = `Only ${attendees} pax — consider a smaller room: ${smaller.map(r => `<a href="#" onclick="document.getElementById('manualRoom').value='${r.id}';updateAdminRoomSuggestion();return false;" style="color:#800020;">${r.name} (${r.capacity} pax)</a>`).join(', ')}`;
            suggestionBox.style.display = 'block';
            return;
        }
    }
    suggestionBox.style.display = 'none';
};

window.checkAdminMinPax = () => {
    const roomId  = document.getElementById('manualRoom').value;
    const pax     = parseInt(document.getElementById('manualAttendees').value) || 0;
    const min     = _getAdminMinPax(roomId);
    const warning = document.getElementById('admin-min-pax-warning');
    if (!warning) return;
    if (min > 0 && pax > 0 && pax < min) {
        warning.textContent    = `Minimum ${min} pax required for ${getRoomName(roomId)}.`;
        warning.style.display  = 'block';
    } else {
        warning.style.display  = 'none';
    }
};

// ─── Save Manual Reservation ──────────────────────────────────────────────────

async function saveManualReservation() {
    const name          = document.getElementById('manualName').value.trim();
    const roomId        = document.getElementById('manualRoom').value;
    const roomName      = getRoomName(roomId);
    const date          = document.getElementById('manualDate').value;
    const startTime     = document.getElementById('manualStartTime').value;
    const endTime       = document.getElementById('manualEndTime').value;
    const purposeVal    = document.getElementById('manualPurpose').value;
    const purpose       = purposeVal === 'Other' ? (document.getElementById('purposeOtherBox').value.trim() || 'Other') : purposeVal;
    const attendees     = parseInt(document.getElementById('manualAttendees').value) || 0;
    const paymentStatus = document.getElementById('manualPaymentStatus').value;
    const isStaff       = document.getElementById('manualIsStaff')?.checked || false;
    const contact       = document.getElementById('manualContactNumber').value.trim() || 'N/A';
    const email         = document.getElementById('manualEmail').value.trim() || 'admin@bchs.edu';
    const contactPerson = document.getElementById('manualContact').value.trim();
    const utilities     = Array.from(document.querySelectorAll('#manualUtilities input[type="checkbox"]:checked'))
        .map(cb => cb.value === 'Others' ? (document.getElementById('utilitiesOtherBox').value.trim() || 'Others') : cb.value);

    if (!name || !date || !startTime || !endTime || !purpose) {
        alert('Please fill in all required fields (Name, Date, Times, Purpose).');
        return;
    }
    if (startTime >= endTime) { alert('Start time must be earlier than end time.'); return; }

    // Hard conflict check — block save if time overlaps any existing reservation
    const existingConflict = adminCheckConflict(roomId, date, startTime, endTime);
    if (existingConflict) {
        const isBlock = existingConflict.status === 'blocked';
        showToast(
            isBlock
                ? `Cannot save: facility is blocked for this time slot.`
                : `Cannot save: time conflicts with "${existingConflict.name}" (${existingConflict.startTime}–${existingConflict.endTime}).`,
            'error'
        );
        return;
    }
    const minPax = _getAdminMinPax(roomId);
    if (minPax > 0 && attendees < minPax) { alert(`Minimum ${minPax} pax required for ${getRoomName(roomId)}.`); return; }

    const room         = rooms.find(r => r.id === roomId);
    const pricePerHour = isStaff ? 0 : (room?.pricePerHour ?? _getRoomPriceFallback(roomId));
    const { total: totalAmount } = computeBookingTotal(pricePerHour, startTime, endTime, isStaff);

    const newEntry = {
        id: 'admin_' + Date.now(),
        roomId, roomName, name, contact, email,
        contactPerson: contactPerson || name,
        date, startTime, endTime, purpose,
        utilities: utilities.length ? utilities : [],
        attendees, status: 'approved', paymentStatus, totalAmount,
        submittedAt: new Date().toISOString()
    };

    try {
        const res = await fetch('/api/requests', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(newEntry)
        });
        if (!res.ok) throw new Error();
        showToast('Manual reservation added successfully', 'success');
    } catch (e) {
        showToast('Failed to save reservation. Is the server running?', 'error');
        return;
    }

    closeAddReservationModal();
    await loadData();
}

// ─── Render Queue ─────────────────────────────────────────────────────────────

function renderQueue() {
    const body = document.getElementById('queueTableBody');
    if (!body) return;
    const pending = requests.filter(r => r.status === 'pending' && (!r.appointmentDate || r.appointmentDate.trim() === ''));
    document.getElementById('pendingCount').textContent = `${pending.length} pending`;
    const badge = document.getElementById('queue-badge');
    if (badge) { badge.textContent = pending.length; badge.style.display = pending.length > 0 ? 'inline-flex' : 'none'; }

    body.innerHTML = pending.length ? pending.map(req => {
        const staffReq    = isStaffRequest(req);
        const paymentCell = staffReq
            ? `<td><span class="badge badge-paid" style="font-weight:700;">PAID</span></td>`
            : `<td><span style="font-size:12px;color:#94a3b8;">—</span></td>`;
        const editedTag = req.userEditReason
            ? `<div style="display:inline-block;background:#eff6ff;color:#1d4ed8;border:1px solid #bfdbfe;border-radius:4px;font-size:10px;font-weight:700;padding:1px 6px;margin-left:5px;vertical-align:middle;">EDITED</div>`
            : '';
        return `<tr>
            <td>${formatDateSimple(req.submittedAt)}</td>
            <td><strong>${req.name}</strong>${editedTag}</td>
            <td><span class="badge badge-secondary">${getRoomName(req.roomId)}</span></td>
            <td>${formatDateSimple(req.date)}</td>
            <td><div class="truncate" title="${req.purpose}">${req.purpose}</div></td>
            ${paymentCell}
            <td><button class="btn btn-bchs btn-sm" onclick="openEditModal('${req.id}','QUEUE_REVIEW')">Manage Request</button></td>
        </tr>`;
    }).join('') : '<tr><td colspan="7" style="text-align:center;padding:20px;color:#6b7280;">Queue is empty</td></tr>';
}

// ─── Render Confirmed ─────────────────────────────────────────────────────────

function getConfirmedEditMode(req) {
    if (!req.appointmentDate || !req.appointmentTime) return 'VIEW_ONLY';
    const timeStr   = req.appointmentTime.trim();
    let hours = 0, minutes = 0;
    const ampmMatch = timeStr.match(/(\d+):(\d+)\s*(AM|PM)/i);
    const h24Match  = timeStr.match(/^(\d{1,2}):(\d{2})$/);
    if (ampmMatch) {
        hours = parseInt(ampmMatch[1]); minutes = parseInt(ampmMatch[2]);
        const period = ampmMatch[3].toUpperCase();
        if (period === 'PM' && hours !== 12) hours += 12;
        if (period === 'AM' && hours === 12) hours = 0;
    } else if (h24Match) {
        hours = parseInt(h24Match[1]); minutes = parseInt(h24Match[2]);
    } else { return 'VIEW_ONLY'; }
    const apptDateTime = new Date(`${req.appointmentDate}T${String(hours).padStart(2,'0')}:${String(minutes).padStart(2,'0')}:00`);
    const diffHours    = (new Date() - apptDateTime) / (1000 * 60 * 60);
    if (diffHours >= 0 && diffHours < 1.5) return 'CONFIRMED_EDIT';
    if (diffHours >= 1.5) return 'RESCHEDULE_OR_REJECT';
    return 'VIEW_ONLY';
}

window.rescheduleConfirmed = (id) => {
    openEditModal(id, 'QUEUE_REVIEW');
    setTimeout(() => {
        const titleEl = document.getElementById('editModalTitle');
        if (titleEl) titleEl.textContent = 'Reschedule Confirmation Visit';
    }, 50);
};

function renderConfirmed() {
    const body = document.getElementById('confirmedTableBody');
    if (!body) return;
    const confirmed = requests.filter(r =>
        (
            (r.appointmentDate && r.appointmentDate.trim() !== '' &&
             r.appointmentTime && r.appointmentTime.trim() !== '') ||
            (Array.isArray(r.visitOptions) && r.visitOptions.length > 0)
        ) &&
        !['approved','rejected','refused','cancelled'].includes(r.status)
    );
    document.getElementById('confirmedCount').textContent = `${confirmed.length} confirmed`;
    const badge = document.getElementById('confirmed-badge');
    if (badge) { badge.textContent = confirmed.length; badge.style.display = confirmed.length > 0 ? 'inline-flex' : 'none'; }

    body.innerHTML = confirmed.length ? confirmed.map(req => {
        const hasVisitOptions = Array.isArray(req.visitOptions) && req.visitOptions.length > 0 && (!req.appointmentDate || req.appointmentDate.trim() === '');
        const editMode      = hasVisitOptions ? 'VIEW_ONLY' : getConfirmedEditMode(req);
        const isLive        = editMode === 'CONFIRMED_EDIT';
        const isPastWin     = editMode === 'RESCHEDULE_OR_REJECT';
        const isViewOnly    = editMode === 'VIEW_ONLY';
        const isBlockForced = req.blockReschedulePending === true;

        let visitCell;
        if (hasVisitOptions) {
            visitCell = `<td>
                <span style="font-size:11px;font-weight:700;background:#eff6ff;color:#1d4ed8;padding:2px 8px;border-radius:999px;">⏳ Awaiting user selection</span>
                <div style="font-size:11px;color:#64748b;margin-top:3px;">${req.visitOptions.length} option${req.visitOptions.length > 1 ? 's' : ''} sent</div>
            </td>`;
        } else if (isBlockForced) {
            visitCell = `<td><span style="font-size:11px;font-weight:700;background:#fee2e2;color:#991b1b;padding:2px 8px;border-radius:999px;">Needs Reschedule</span>
               <div style="font-size:11px;color:#64748b;margin-top:3px;">Blocked: ${req.blockRescheduleReason || 'facility unavailable'}</div></td>`;
        } else if (isLive) {
            visitCell = `<td><strong style="color:#800020;">${formatDateSimple(req.appointmentDate)}</strong>
               <span style="display:inline-block;margin-left:6px;background:#16a34a;color:white;font-size:10px;font-weight:700;padding:1px 7px;border-radius:999px;vertical-align:middle;animation:pulse 1.5s infinite;">● LIVE</span>
               <div style="font-size:11px;color:#16a34a;font-weight:600;">${req.appointmentTime ? formatApptTime(req.appointmentTime) : ''}</div></td>`;
        } else {
            visitCell = `<td><strong style="color:#800020;">${formatDateSimple(req.appointmentDate)}</strong>
               <div style="font-size:11px;color:#64748b;">${req.appointmentTime ? formatApptTime(req.appointmentTime) : 'Not set'}</div></td>`;
        }

        const btnMode  = hasVisitOptions ? 'QUEUE_REVIEW'
                       : isBlockForced   ? 'RESCHEDULE_OR_REJECT'
                       : editMode;
        const btnLabel = hasVisitOptions ? 'Edit Options'
                       : isBlockForced   ? 'Reschedule'
                       : isLive          ? 'Edit'
                       : isPastWin       ? 'Reschedule'
                       : isViewOnly      ? 'View'
                       : 'Manage';
        const btnStyle = hasVisitOptions ? 'background:#1d4ed8;border-color:#1d4ed8;color:white;'
                       : isBlockForced   ? 'background:#f59e0b;border-color:#f59e0b;color:white;'
                       : isLive          ? 'background:#16a34a;border-color:#16a34a;color:white;'
                       : isPastWin       ? 'background:#f59e0b;border-color:#f59e0b;color:white;' : '';
        const rowStyle = hasVisitOptions ? ' style="background:#eff6ff;"'
                       : isBlockForced   ? ' style="background:#fff7ed;"'
                       : isLive          ? ' style="background:#f0fdf4;"' : '';

        return `<tr${rowStyle}>
            <td><strong>${req.name}</strong></td>
            <td><span class="badge badge-secondary">${getRoomName(req.roomId)}</span></td>
            <td>${formatDateSimple(req.date)}</td>
            ${visitCell}
            <td><button class="btn btn-bchs btn-sm" style="${btnStyle}" onclick="openEditModal('${req.id}','${btnMode}')">${btnLabel}</button></td>
        </tr>`;
    }).join('') : '<tr><td colspan="6" style="text-align:center;padding:20px;color:#6b7280;">No confirmed appointments yet</td></tr>';
}

// ─── Render Approved ──────────────────────────────────────────────────────────

function renderApproved() {
    const body = document.getElementById('approvedTableBody');
    if (!body) return;
    const approved = requests.filter(r => ['approved', 'accepted'].includes(r.status) && !r.isSchoolEvent && !r.isFullDayBlock)
        .sort((a, b) => a.date.localeCompare(b.date));
    document.getElementById('approvedCount').textContent = `${approved.length} approved`;
    const badge = document.getElementById('approved-badge');
    if (badge) { badge.textContent = approved.length; badge.style.display = approved.length > 0 ? 'inline-flex' : 'none'; }

    body.innerHTML = approved.length ? approved.map(req => {
        const hasAlternateSchedules = Array.isArray(req.rescheduleOptions) && req.rescheduleOptions.length > 0;
        const needsReschedule = hasAlternateSchedules || !!(req.rescheduleRequestedAt || req.rescheduleReason || req.rescheduledDate || req.rescheduledStartTime || req.rescheduledEndTime);
        const rowStyle = needsReschedule ? ' style="background:#fff7ed;"' : '';
        const actionMode = needsReschedule ? 'RESCHEDULE_OR_REJECT' : 'VIEW_ONLY';
        const actionLabel = hasAlternateSchedules ? 'Edit Alternate Schedules' : needsReschedule ? 'Review Event Rescheduling' : 'View';
        const badgeCell = needsReschedule ? `<td><span style="font-size:11px;font-weight:700;background:#fff7ed;color:#92400e;padding:2px 8px;border-radius:999px;">${hasAlternateSchedules ? 'Awaiting Requester Selection' : 'Needs Reschedule'}</span>
                            <div style="font-size:11px;color:#64748b;margin-top:3px;">${hasAlternateSchedules ? `${req.rescheduleOptions.length} alternate schedule${req.rescheduleOptions.length === 1 ? '' : 's'} offered` : `Requested: ${req.rescheduledDate ? formatDateSimple(req.rescheduledDate) : '—'} ${req.rescheduledStartTime ? ' ' + convertTo12Hour(req.rescheduledStartTime) + '–' + convertTo12Hour(req.rescheduledEndTime) : ''}`}</div></td>` : '';

        return `
        <tr${rowStyle}>
            <td><strong>${req.name}</strong></td>
            <td><span class="badge badge-secondary">${getRoomName(req.roomId)}</span></td>
            <td>${formatDateSimple(req.date)}</td>
            <td>${convertTo12Hour(req.startTime)}–${convertTo12Hour(req.endTime)}</td>
            <td><div class="truncate" title="${req.purpose}">${req.purpose}</div>
                ${needsReschedule ? `<div style="font-size:11px;color:#64748b;margin-top:6px;">${hasAlternateSchedules ? 'The requester has alternate event schedules to choose from.' : `Requested reschedule: <strong style="color:#92400e;">${req.rescheduledDate ? formatDateSimple(req.rescheduledDate) : '—'}</strong> ${req.rescheduledStartTime ? '· ' + convertTo12Hour(req.rescheduledStartTime) + '–' + convertTo12Hour(req.rescheduledEndTime) : ''}<div style="font-size:11px;color:#7c2d12;margin-top:4px;">Reason: ${req.rescheduleReason || 'No reason provided'}</div>`}</div>` : ''}
            </td>
            <td><span class="badge ${req.paymentStatus === 'paid' ? 'badge-success' : req.paymentStatus === 'pending' ? 'badge-warning' : 'badge-secondary'}">${req.paymentStatus || 'unpaid'}</span></td>
            <td><button class="btn btn-outline btn-sm" onclick="openEditModal('${req.id}','${actionMode}')">${actionLabel}</button></td>
        </tr>`;
    }).join('') : '<tr><td colspan="7" style="text-align:center;padding:20px;color:#6b7280;">No approved requests</td></tr>';
}

// ─── Render Upcoming ──────────────────────────────────────────────────────────

function renderUpcoming() {
    const container  = document.getElementById('upcomingreservations');
    const filter     = document.getElementById('searchFilter')?.value.toLowerCase() || '';
    const roomFilter = document.getElementById('roomFilter')?.value || 'all';
    const today      = new Date().toISOString().split('T')[0];

    const up = requests.filter(r => {
        const isUp        = (r.status === 'approved' || r.status === 'blocked') && r.date >= today;
        const matchesRoom = roomFilter === 'all' || r.roomId === roomFilter;
        const matchSearch = !filter || r.name.toLowerCase().includes(filter) || r.purpose.toLowerCase().includes(filter);
        return isUp && matchesRoom && matchSearch;
    }).sort((a, b) => a.date.localeCompare(b.date));

    document.getElementById('upcomingCount').textContent = `${up.length} entries`;

    container.innerHTML = up.length ? up.map(b => {
        const isBlock = b.status === 'blocked';
        const isEvent = b.isSchoolEvent === true;
        const cardClass = isBlock ? 'timeslot-admin-blocked' : isEvent ? 'school-event-card' : '';
        const badge = isEvent ? `<span style="font-size:10px;font-weight:700;background:#f59e0b;color:white;padding:2px 7px;border-radius:999px;margin-left:6px;">EVENT</span>` : '';
        let actions = '';
        if (isEvent) {
            const evId = DateUtils.normalizeEventId(b.id);
            actions = `<div style="display:flex;gap:6px;flex-shrink:0;">
                <button onclick="openEditEventModal('${evId}')" class="btn btn-outline btn-sm">Edit</button>
                <button onclick="deleteEventFromSchedule('${evId}')" class="btn btn-sm" style="background:#fee2e2;color:#991b1b;border:1px solid #fecaca;">Delete</button>
            </div>`;
        } else if (isBlock) {
            actions = `<div style="display:flex;gap:6px;flex-shrink:0;"><button onclick="quickUnblock('${b.id}','${b.date}')" class="btn btn-outline btn-sm">Unblock</button></div>`;
        } else {
            actions = `<button onclick="openEditModal('${b.id}','PAYMENT_ONLY')" class="btn btn-outline btn-sm" style="flex-shrink:0;">Manage</button>`;
        }
        return `<div class="reservation-card ${cardClass}" style="flex-direction:row;align-items:center;gap:8px;">
            <div style="flex:1;min-width:0;">
                <div class="res-card-row1"><span class="res-card-name">${isBlock ? 'UNAVAILABLE' : b.name}</span>${badge}<span style="flex:1;"></span><span class="res-card-room">${getRoomName(b.roomId)}</span></div>
                <div class="res-card-row2"><span class="res-card-time">${formatDateSimple(b.date)} &nbsp;${convertTo12Hour(b.startTime)}–${convertTo12Hour(b.endTime)}</span><span class="res-card-purpose">${b.purpose}</span></div>
            </div>${actions}</div>`;
    }).join('') : '<div class="empty-state"><p>No upcoming entries found</p></div>';
}

// ─── Render Cancellations ─────────────────────────────────────────────────────

function renderCancellations() {
    const body = document.getElementById('cancellationsTableBody');
    if (!body) return;
    const cancellations = requests.filter(r => r.status === 'cancelled' && r.cancellationReason);
    document.getElementById('cancellationsCount').textContent = `${cancellations.length} requests`;
    const badge = document.getElementById('cancellations-badge');
    if (badge) { badge.textContent = cancellations.length; badge.style.display = cancellations.length > 0 ? 'inline-flex' : 'none'; }

    body.innerHTML = cancellations.length ? cancellations.map(req => {
        const isBlockCancelled = req.blockCancelled === true;
        return `<tr>
            <td>${req.cancellationRequestedAt ? formatDateSimple(req.cancellationRequestedAt) : 'N/A'}</td>
            <td><strong>${req.name}</strong>${isBlockCancelled ? ' <span style="font-size:10px;background:#fee2e2;color:#991b1b;padding:1px 6px;border-radius:4px;font-weight:700;">BLOCK</span>' : ''}</td>
            <td><span class="badge badge-secondary">${getRoomName(req.roomId)}</span></td>
            <td>${formatDateSimple(req.date)}</td>
            <td><div class="truncate" title="${req.cancellationReason}" style="max-width:300px;">${req.cancellationReason}</div></td>
            <td><button class="btn btn-bchs btn-sm" onclick="openCancellationReview('${req.id}')">Review</button></td>
        </tr>`;
    }).join('') : '<tr><td colspan="6" style="text-align:center;padding:20px;color:#6b7280;">No cancellation requests</td></tr>';
}

// ─── Cancellation Review Modal ────────────────────────────────────────────────

let _cancellationReviewId = null;

window.openCancellationReview = (id) => {
    const req = requests.find(r => r.id === id);
    if (!req) return;
    _cancellationReviewId = id;

    // Populate reservation details
    const fmt12 = t => convertTo12Hour(t);
    document.getElementById('cr-details').innerHTML = `
        <div style="display:flex;gap:6px;"><span style="color:#64748b;min-width:80px;">Name</span><strong>${req.name}</strong></div>
        <div style="display:flex;gap:6px;"><span style="color:#64748b;min-width:80px;">Facility</span><strong>${getRoomName(req.roomId)}</strong></div>
        <div style="display:flex;gap:6px;"><span style="color:#64748b;min-width:80px;">Date</span><strong>${formatDateSimple(req.date)}</strong></div>
        <div style="display:flex;gap:6px;"><span style="color:#64748b;min-width:80px;">Time</span><strong>${fmt12(req.startTime)} – ${fmt12(req.endTime)}</strong></div>
        <div style="display:flex;gap:6px;"><span style="color:#64748b;min-width:80px;">Purpose</span><span style="color:#374151;">${req.purpose}</span></div>
        ${req.contact ? `<div style="display:flex;gap:6px;"><span style="color:#64748b;min-width:80px;">Contact</span><span>${req.contact}</span></div>` : ''}
        ${req.email   ? `<div style="display:flex;gap:6px;"><span style="color:#64748b;min-width:80px;">Email</span><span>${req.email}</span></div>`   : ''}
    `;

    // Populate reason (strip internal prefix if present)
    document.getElementById('cr-reason').textContent =
        req.cancellationReason.replace('Facility blocked by administration: ', '');

    document.getElementById('cancellationReviewModal').classList.add('active');
};

window.closeCancellationReview = () => {
    document.getElementById('cancellationReviewModal').classList.remove('active');
    _cancellationReviewId = null;
};

window.confirmCancellationDelete = async () => {
    if (!_cancellationReviewId) return;
    const req = requests.find(r => r.id === _cancellationReviewId);
    if (!req) return;

    const now = new Date().toISOString();

    // Build the archived record — mark as refused (cancelled by admin approval)
    const archivedEntry = {
        ...req,
        status: 'refused',
        cancellationApprovedAt: now
    };

    try {
        // 1. Write directly to history.json
        await fetch('/api/history', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(archivedEntry)
        });

        // 2. Remove from accepted.json if it was approved
        if (req.status === 'approved' || req.status === 'cancelled') {
            await fetch(`/api/accepted/${_cancellationReviewId}`, { method: 'DELETE' }).catch(() => {});
        }

        // 3. Keep in requests.json so user can see the admin-approved cancellation notice.
        //    Just patch the status to 'refused' with a timestamp — do NOT delete.
        await fetch(`/api/requests/${_cancellationReviewId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'refused', cancellationApprovedAt: now })
        });

        showToast('Cancellation approved — user will be notified.', 'success');
    } catch (e) {
        showToast('Failed to process cancellation.', 'error');
        return;
    }
    closeCancellationReview();
    await loadData();
};

// ─── Render History ───────────────────────────────────────────────────────────

// Cache for history records so filterHistory() and openHistoryView can look them up
var historyCache = [];

async function renderHistory() {
    let history = [];
    try {
        const res = await fetch('/api/history');
        if (res.ok) history = await res.json();
    } catch (e) {}

    const today      = new Date().toISOString().split('T')[0];
    const historyIds = new Set(history.map(h => h.id));
    requests.forEach(r => {
        if (historyIds.has(r.id)) return;
        const isPastEvent  = (r.status === 'approved' || r.status === 'blocked') && r.date < today;
        const isCancelled  = r.status === 'rejected' || r.status === 'refused';
        if (isPastEvent || isCancelled) history.push(r);
    });
    history.sort((a, b) => b.date.localeCompare(a.date));

    const cutoff    = new Date();
    cutoff.setMonth(cutoff.getMonth() - 2);
    const cutoffStr = cutoff.toISOString().split('T')[0];
    history         = history.filter(r => r.date >= cutoffStr);

    // Store full set for filtering
    historyCache = history;

    filterHistory();
}

function _getHistoryStatusLabel(req) {
    if (req.status === 'rejected' || req.status === 'refused') return 'Cancelled';
    if (req.status === 'blocked')                              return 'Past Block';
    if (req.status === 'approved') {
        const today = new Date().toISOString().split('T')[0];
        // If the event date is in the past, it's fully completed
        if (req.date < today) return 'Completed';
        // Event hasn't happened yet but was approved with an appointment — still Confirmed
        if (req.appointmentDate) return 'Confirmed';
        return 'Completed';
    }
    return '';
}

function filterHistory() {
    const search     = (document.getElementById('historySearchFilter')?.value || '').toLowerCase().trim();
    const roomFilter = document.getElementById('historyRoomFilter')?.value   || 'all';
    const statusFilter = document.getElementById('historyStatusFilter')?.value || 'all';

    const filtered = historyCache.filter(req => {
        const statusText   = _getHistoryStatusLabel(req);
        const matchSearch  = !search     || req.name.toLowerCase().includes(search);
        const matchRoom    = roomFilter   === 'all' || req.roomId === roomFilter;
        const matchStatus  = statusFilter === 'all' || statusText === statusFilter;
        return matchSearch && matchRoom && matchStatus;
    });

    const anyActive = search || roomFilter !== 'all' || statusFilter !== 'all';
    const countLabel = anyActive
        ? `${filtered.length} of ${historyCache.length} records`
        : `${historyCache.length} records (last 2 months)`;
    document.getElementById('historyCount').textContent = countLabel;

    document.getElementById('historyTableBody').innerHTML = filtered.length ? filtered.map(req => {
        const statusText = _getHistoryStatusLabel(req);
        let statusBadge = '';
        if (statusText === 'Cancelled')      statusBadge = 'badge-destructive';
        else if (statusText === 'Confirmed') statusBadge = 'badge-success';
        else if (statusText === 'Completed') statusBadge = 'badge-primary';
        else                                 statusBadge = 'badge-secondary';
        const confirmedOn = req.appointmentDate
            ? `<div style="font-size:11px;color:#64748b;margin-top:2px;">Confirmed: ${formatDateSimple(req.appointmentDate)}${req.appointmentTime ? ' ' + formatApptTime(req.appointmentTime) : ''}</div>`
            : '';
        return `<tr>
            <td>${formatDateSimple(req.date)}</td>
            <td><strong>${req.name}</strong>${confirmedOn}</td>
            <td>${getRoomName(req.roomId)}</td>
            <td><span class="badge ${statusBadge}">${statusText}</span></td>
            <td><button class="btn btn-outline btn-sm" onclick="openHistoryView('${req.id}')">View</button></td>
        </tr>`;
    }).join('') : '<tr><td colspan="5" style="text-align:center;padding:20px;color:#6b7280;">No history records found</td></tr>';
}

function clearHistoryFilters() {
    const search = document.getElementById('historySearchFilter');
    const room   = document.getElementById('historyRoomFilter');
    const status = document.getElementById('historyStatusFilter');
    if (search) search.value = '';
    if (room)   room.value   = 'all';
    if (status) status.value = 'all';
    filterHistory();
}

// ─── History View Modal ───────────────────────────────────────────────────────

window.openHistoryView = (id) => {
    // Look up in historyCache first, fall back to requests array
    const r = historyCache.find(x => x.id === id) || requests.find(x => x.id === id);
    if (!r) { showToast('Record not found.', 'error'); return; }

    const fmt12  = t => convertTo12Hour(t);
    const fmtAmt = v => (v != null && v !== '') ? `₱${parseFloat(v).toLocaleString('en-PH', { minimumFractionDigits: 2 })}` : '—';

    let statusLabel = _getHistoryStatusLabel(r), statusColor = '#64748b';
    if (statusLabel === 'Cancelled')  statusColor = '#dc2626';
    else if (statusLabel === 'Confirmed') statusColor = '#16a34a';
    else if (statusLabel === 'Completed') statusColor = '#2563eb';
    else if (statusLabel === 'Past Block') statusColor = '#6b7280';

    const row = (label, value) => `
        <div style="display:flex;gap:0.5rem;padding:0.4rem 0;border-bottom:1px solid #f1f5f9;">
            <span style="font-size:0.72rem;color:#94a3b8;font-weight:600;min-width:110px;flex-shrink:0;text-transform:uppercase;">${label}</span>
            <span style="font-size:0.82rem;color:#1e293b;font-weight:500;flex:1;word-break:break-word;">${value}</span>
        </div>`;

    let rows = `
        ${row('Facility',   getRoomName(r.roomId))}
        ${row('Name',       r.name      || '—')}
        ${row('Contact',    r.contact   || '—')}
        ${row('Email',      r.email     || '—')}
        ${row('Date',       formatDateSimple(r.date))}
        ${row('Time',       r.startTime ? `${fmt12(r.startTime)} – ${fmt12(r.endTime)}` : '—')}
        ${row('Purpose',    r.purpose   || '—')}
        ${row('Attendees',  r.attendees != null ? r.attendees : '—')}
        ${row('Amount',     fmtAmt(r.totalAmount))}
        ${row('Payment',    r.paymentStatus || '—')}
        ${row('Submitted',  r.submittedAt ? formatDateTimeSimple(r.submittedAt) : '—')}
    `;
    if (r.appointmentDate) rows += row('Visit Date', `${formatDateSimple(r.appointmentDate)}${r.appointmentTime ? ' at ' + r.appointmentTime : ''}`);
    if (r.cancellationReason) rows += row('Cancel Reason', r.cancellationReason);
    if (r.rejectionReason)    rows += row('Rejection',     r.rejectionReason);
    if (r.additionalNotes)    rows += row('Notes',         r.additionalNotes);

    // Remove any existing history view modal
    document.getElementById('historyViewModal')?.remove();

    const modal = document.createElement('div');
    modal.id = 'historyViewModal';
    modal.className = 'modal active';
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
    modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
    document.body.appendChild(modal);
};
