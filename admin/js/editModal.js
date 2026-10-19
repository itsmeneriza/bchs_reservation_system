/**
 * Admin Edit Modal
 * Context-aware reservation editor (VIEW_ONLY, QUEUE_REVIEW, CONFIRMED_EDIT, FULL_EDIT, PAYMENT_ONLY).
 */

let pendingRejectionId = null;

// ─── Multi-slot visit option builder (QUEUE_REVIEW) ───────────────────────────

let pendingVisitOptions = [];
let selectedVisitDates = [];
let selectedVisitTimes = [];
let visitCalendarMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

function escapeAdminText(value) {
    const escaped = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return String(value ?? '').replace(/[&<>"']/g, character => escaped[character]);
}

const VISIT_TIME_OPTIONS = [
    '7:00 AM – 8:00 AM',
    '8:00 AM – 9:00 AM',
    '9:00 AM – 10:00 AM',
    '10:00 AM – 11:00 AM',
    '11:00 AM – 12:00 PM',
    '1:00 PM – 2:00 PM',
    '2:00 PM – 3:00 PM',
    '3:00 PM – 4:00 PM',
    '4:00 PM – 5:00 PM'
];
const MAX_VISIT_TIME_SELECTION = 9;
const RESCHEDULE_SLOT_DURATION_MINUTES = 60;

/** Returns the ISO date string (YYYY-MM-DD) for tomorrow in local time. */
function _getEarliestVisitDate() {
    const tomorrow = new Date();
    tomorrow.setHours(0, 0, 0, 0);
    tomorrow.setDate(tomorrow.getDate() + 1);
    return _toISODate(tomorrow);
}

/** Format a Date as YYYY-MM-DD without UTC conversion */
function _toISODate(d) {
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function _isAllowedVisitDate(date) {
    return !date || date >= _getEarliestVisitDate();
}

function renderVisitCalendar() {
    const calendar = document.getElementById('visitCalendar');
    if (!calendar) return;
    const isEventRescheduleMode = currentModalMode === 'RESCHEDULE_OR_REJECT';
    const isVisitRescheduleMode = currentModalMode === 'VISIT_RESCHEDULE_OR_REJECT';

    const year = visitCalendarMonth.getFullYear();
    const month = visitCalendarMonth.getMonth();
    const firstWeekday = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const currentMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const canGoBack = visitCalendarMonth > currentMonth;
    const monthLabel = visitCalendarMonth.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    const cells = [];

    for (let blank = 0; blank < firstWeekday; blank++) {
        cells.push('<span class="visit-calendar-empty" aria-hidden="true"></span>');
    }
    for (let day = 1; day <= daysInMonth; day++) {
        const date = _toISODate(new Date(year, month, day));
        const selected = selectedVisitDates.includes(date);
        const unavailable = !_isAllowedVisitDate(date);
        const classes = ['visit-calendar-day', selected ? 'selected' : '', unavailable ? 'unavailable' : ''].filter(Boolean).join(' ');
        cells.push(`<button type="button" class="${classes}" onclick="toggleVisitDate('${date}')" aria-label="${date}" aria-pressed="${selected}" ${unavailable ? 'disabled' : ''}>${day}</button>`);
    }

    calendar.innerHTML = `
        <div class="visit-calendar-toolbar">
            <button type="button" class="visit-calendar-nav" onclick="changeVisitCalendarMonth(-1)" aria-label="Previous month" ${canGoBack ? '' : 'disabled'}>‹</button>
            <strong>${monthLabel}</strong>
            <button type="button" class="visit-calendar-nav" onclick="changeVisitCalendarMonth(1)" aria-label="Next month">›</button>
        </div>
        <div class="visit-calendar-grid" role="group" aria-label="${isEventRescheduleMode || isVisitRescheduleMode ? (isEventRescheduleMode ? 'Choose alternate event dates' : 'Choose alternate visit dates') : 'Choose visit dates'}">
            ${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => `<span class="visit-calendar-weekday">${day}</span>`).join('')}
            ${cells.join('')}
        </div>`;
}

function renderVisitTimeOptions() {
    const container = document.getElementById('visitTimeOptions');
    if (!container) return;
    const choices = getVisitTimeChoices();
    container.innerHTML = choices.map((choice, index) => {
        const selected = selectedVisitTimes.includes(choice.value);
        return `<button type="button" class="visit-time-option${selected ? ' selected' : ''}" onclick="toggleVisitTime(${index})" aria-pressed="${selected}">${choice.label}</button>`;
    }).join('');

    const count = document.getElementById('visitTimeSelectionCount');
    if (count) count.textContent = `${selectedVisitTimes.length} / ${Math.min(choices.length, MAX_VISIT_TIME_SELECTION)} selected`;
}

function parseTimeToMinutes(value) {
    if (!value || typeof value !== 'string') return null;
    const match = value.trim().match(/^(\d{1,2}):(\d{2})$/);
    if (!match) return null;
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (!Number.isFinite(hours) || !Number.isFinite(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
        return null;
    }
    return hours * 60 + minutes;
}

function getVisitTimeChoices() {
    if (currentModalMode !== 'RESCHEDULE_OR_REJECT') {
        return VISIT_TIME_OPTIONS.map(time => ({ value: time, label: time }));
    }

    const request = requests.find(item => item.id === selectedRequestToEdit);
    if (!request) return [];

    const formatTime = minutes => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
    const fixedStartTimes = [7 * 60, 8 * 60, 9 * 60, 10 * 60, 11 * 60, 13 * 60, 14 * 60, 15 * 60, 16 * 60];
    const choices = [];
    fixedStartTimes.forEach(startMinutesValue => {
        const endMinutesValue = startMinutesValue + RESCHEDULE_SLOT_DURATION_MINUTES;
        if (endMinutesValue > 18 * 60) return;
        const startTime = formatTime(startMinutesValue);
        const endTime = formatTime(endMinutesValue);
        choices.push({
            value: startTime,
            label: `${convertTo12Hour(startTime)}–${convertTo12Hour(endTime)}`
        });
    });
    return choices;
}

function getSelectableVisitTimeLimit() {
    const choices = getVisitTimeChoices();
    return Math.min(choices.length, MAX_VISIT_TIME_SELECTION);
}

function updateVisitDateSelectionCount() {
    const count = document.getElementById('visitDateSelectionCount');
    if (count) count.textContent = `${selectedVisitDates.length} / 5 selected`;
}

window.changeVisitCalendarMonth = function(offset) {
    const nextMonth = new Date(visitCalendarMonth.getFullYear(), visitCalendarMonth.getMonth() + offset, 1);
    const currentMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    if (nextMonth < currentMonth) return;
    visitCalendarMonth = nextMonth;
    renderVisitCalendar();
};

window.toggleVisitDate = function(date) {
    if (!_isAllowedVisitDate(date)) return;
    if (selectedVisitDates.includes(date)) {
        selectedVisitDates = selectedVisitDates.filter(selected => selected !== date);
    } else {
        if (selectedVisitDates.length >= 5) {
            showToast('You can select up to 5 dates.', 'error');
            return;
        }
        selectedVisitDates.push(date);
    }
    updateVisitDateSelectionCount();
    renderVisitCalendar();
};

window.toggleVisitTime = function(index) {
    const choices = getVisitTimeChoices();
    const choice = choices[index];
    if (!choice) return;
    const time = choice.value;
    if (selectedVisitTimes.includes(time)) {
        selectedVisitTimes = selectedVisitTimes.filter(selected => selected !== time);
    } else {
        const maximum = getSelectableVisitTimeLimit();
        if (selectedVisitTimes.length >= maximum) {
            showToast(`You can select up to ${maximum} time slots.`, 'error');
            return;
        }
        selectedVisitTimes.push(time);
    }
    renderVisitTimeOptions();
};

/** Add every selected date/time combination as a separate visit option. */
window.addVisitSlot = function() {
    const isEventReschedule = currentModalMode === 'RESCHEDULE_OR_REJECT';
    const isVisitReschedule = currentModalMode === 'VISIT_RESCHEDULE_OR_REJECT';
    if (selectedVisitDates.length === 0) {
        showToast(`Please select at least one ${isEventReschedule ? 'alternate schedule date' : isVisitReschedule ? 'alternate visit date' : 'visit date'}.`, 'error');
        return;
    }
    if (selectedVisitTimes.length === 0) {
        showToast(`Please select at least one ${isEventReschedule ? 'available start time' : isVisitReschedule ? 'alternate visit time' : 'time slot'}.`, 'error');
        return;
    }
    if (selectedVisitDates.some(date => !_isAllowedVisitDate(date))) {
        showToast('Visit dates must be tomorrow or later.', 'error');
        return;
    }

    let addedCount = 0;
    let conflictCount = 0;
    const request = requests.find(item => item.id === selectedRequestToEdit) || null;
    const formatTime = minutes => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

    selectedVisitDates.forEach(date => selectedVisitTimes.forEach(time => {
        if (isEventReschedule) {
            if (!request) return;
            const timeMinutes = parseTimeToMinutes(time);
            if (timeMinutes === null) return;
            const endTime = formatTime(timeMinutes + RESCHEDULE_SLOT_DURATION_MINUTES);
            if (adminCheckConflict(request.roomId, date, time, endTime, request.id)) {
                conflictCount++;
                return;
            }
            const newKey = `${date}::${time}::${endTime}`;
            const exists = pendingVisitOptions.some(slot => {
                const sDate = String(slot.date || '').trim();
                const sStart = String(slot.startTime || slot.time || '').trim();
                const sEnd = String(slot.endTime || '').trim();
                return `${sDate}::${sStart}::${sEnd}` === newKey;
            });
            if (!exists) {
                pendingVisitOptions.push({ date, startTime: time, endTime });
                addedCount++;
            }
        } else {
            if (request) {
                const timeMinutes = parseTimeToMinutes(time);
                const endTime = timeMinutes === null ? null : formatTime(timeMinutes + 60);
                if (endTime && adminCheckConflict(request.roomId, date, time, endTime, request.id)) {
                    conflictCount++;
                    return;
                }
            }
            const newKey = `${date}::${time}`;
            const exists = pendingVisitOptions.some(slot => {
                const sDate = String(slot.date || '').trim();
                const sTime = String(slot.time || slot.startTime || '').trim();
                return `${sDate}::${sTime}` === newKey;
            });
            if (!exists) {
                pendingVisitOptions.push({ date, time });
                addedCount++;
            }
        }
    }));

    if (addedCount === 0) {
        if (conflictCount > 0) {
            showToast('Those alternate schedules conflict with another reservation or facility block.', 'error');
            return;
        }
        showToast('Those date and time combinations have already been added.', 'error');
        return;
    }

    selectedVisitDates = [];
    selectedVisitTimes = [];
    renderVisitCalendar();
    updateVisitDateSelectionCount();
    renderVisitTimeOptions();
    renderVisitSlotList();
    if (conflictCount > 0) {
        showToast(`${addedCount} ${isEventReschedule ? 'alternate schedule' : 'visit option'}${addedCount === 1 ? '' : 's'} added; ${conflictCount} conflicting option${conflictCount === 1 ? '' : 's'} skipped.`, 'error');
    } else {
        showToast(`${addedCount} ${isVisitReschedule ? 'alternate visit slot' : isEventReschedule ? 'alternate schedule' : 'visit option'}${addedCount === 1 ? '' : 's'} added.`, 'success');
    }
};

/** Remove a slot by index */
window.removeVisitSlot = function(idx) {
    pendingVisitOptions.splice(idx, 1);
    renderVisitSlotList();
};

/** Render the current pendingVisitOptions into #visitSlotList */
function renderVisitSlotList() {
    const list = document.getElementById('visitSlotList');
    if (!list) return;
    const isEventRescheduleMode = currentModalMode === 'RESCHEDULE_OR_REJECT';
    const isVisitRescheduleMode = currentModalMode === 'VISIT_RESCHEDULE_OR_REJECT';
    if (pendingVisitOptions.length === 0) {
        list.innerHTML = `<p style="font-size:12px;color:#94a3b8;margin:0;">${isEventRescheduleMode ? 'No alternate schedules added yet.' : isVisitRescheduleMode ? 'No alternate visit slots added yet.' : 'No visit slots added yet.'}</p>`;
        return;
    }
    list.innerHTML = pendingVisitOptions.map((s, i) => `
        <div style="display:flex;align-items:center;justify-content:space-between;background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:7px 10px;font-size:13px;">
            <span style="font-weight:600;color:#1e293b;">${formatDateSimple(s.date)} · ${s.startTime && s.endTime ? `${convertTo12Hour(s.startTime)}–${convertTo12Hour(s.endTime)}` : s.time}</span>
            <button type="button" onclick="removeVisitSlot(${i})" style="background:none;border:none;color:#94a3b8;cursor:pointer;font-size:16px;line-height:1;padding:0 2px;" title="Remove">×</button>
        </div>
    `).join('');
    // Update save button label
    const saveBtn = document.getElementById('saveEdit');
    if (saveBtn && (currentModalMode === 'QUEUE_REVIEW' || currentModalMode === 'RESCHEDULE_OR_REJECT' || currentModalMode === 'VISIT_RESCHEDULE_OR_REJECT')) {
        saveBtn.textContent = pendingVisitOptions.length > 0
            ? (isEventRescheduleMode ? 'Offer Alternate Schedules' : isVisitRescheduleMode ? 'Offer Alternate Visit Slots' : 'Send Visit Options')
            : (isEventRescheduleMode ? 'Offer Alternate Schedules' : isVisitRescheduleMode ? 'Offer Alternate Visit Slots' : 'Set Visit');
    }
}

// ─── Open ─────────────────────────────────────────────────────────────────────

window.openEditModal = (id, mode = 'FULL_EDIT') => {
    const r = requests.find(x => x.id === id);
    if (!r) {
        showToast('Record not found. Try refreshing the page.', 'error');
        return;
    }

    selectedRequestToEdit = id;
    const isStaff = isStaffRequest(r);

    // Approved records: allow payment management, not full field editing
    if (r.status === 'approved' && mode === 'FULL_EDIT') mode = 'PAYMENT_ONLY';
    if (isStaff && mode === 'FULL_EDIT')                  mode = 'VIEW_ONLY';
    currentModalMode = mode;

    // Title
    const titles = {
        VIEW_ONLY:                    'View Reservation Record',
        PAYMENT_ONLY:                 'Request Details',
        CONFIRMED_EDIT:              'Edit Reservation Details',
        CONFIRMED_MANAGE:            'Manage Confirmed Appointment',
        RESCHEDULE_OR_REJECT:        'Review Event Rescheduling Request',
        VISIT_RESCHEDULE_OR_REJECT:  'Review Visit Rescheduling Request',
        QUEUE_REVIEW:                'Review Reservation Request'
    };
    document.getElementById('editModalTitle').textContent = titles[mode] || 'Manage Reservation Entry';

    // Reject button (header)
    const rejectBtn = document.getElementById('modal-reject-btn');
    if (rejectBtn) rejectBtn.style.display = mode === 'FULL_EDIT' ? 'block' : 'none';

    // Footer: context-aware buttons based on mode
    const isQueueMode         = mode === 'QUEUE_REVIEW';
    const isConfirmedEditMode = mode === 'CONFIRMED_EDIT';
    const isEventRescheduleMode = mode === 'RESCHEDULE_OR_REJECT';
    const isVisitRescheduleMode = mode === 'VISIT_RESCHEDULE_OR_REJECT';
    const statusSection  = document.getElementById('reservationStatusSection');
    const rejectEditBtn  = document.getElementById('rejectEditBtn');
    const saveEditBtn    = document.getElementById('saveEdit');
    const hideStatus     = isQueueMode || isConfirmedEditMode || isEventRescheduleMode || isVisitRescheduleMode || mode === 'VIEW_ONLY' || mode === 'PAYMENT_ONLY';
    if (statusSection) statusSection.style.display = hideStatus ? 'none' : '';
    if (rejectEditBtn) rejectEditBtn.style.display  = (isQueueMode || isConfirmedEditMode || isEventRescheduleMode || isVisitRescheduleMode) ? 'inline-flex' : 'none';
    if (saveEditBtn)   saveEditBtn.textContent       = isQueueMode ? 'Set Visit' : isConfirmedEditMode ? 'Update & Approve' : isEventRescheduleMode ? 'Offer Alternate Schedules' : isVisitRescheduleMode ? 'Offer Alternate Visit Slots' : 'Update & Save';

    // Summary
    document.getElementById('edit-summary').innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:flex-start;">
            <div>
                <div style="font-weight:800;font-size:18px;color:#1e293b;">${r.name}</div>
                <div style="color:#64748b;font-size:13px;margin-top:2px;">Contact: ${r.contact || 'N/A'} | Email: ${r.email || 'N/A'}</div>
            </div>
            <span class="badge badge-secondary">${r.status.toUpperCase()}</span>
        </div>
        <div style="margin-top:12px;font-size:14px;color:#475569;padding:10px;background:white;border-radius:6px;border:1px dashed #cbd5e1;">
            <strong style="display:block;margin-bottom:4px;font-size:11px;color:#94a3b8;text-transform:uppercase;">Original Request Purpose:</strong>
            "${r.purpose}"
        </div>
        ${r.userEditReason ? `
        <div style="margin-top:10px;font-size:13px;padding:10px 12px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:6px;">
            <strong style="display:block;margin-bottom:4px;font-size:11px;color:#1d4ed8;text-transform:uppercase;">User's Reason for Editing</strong>
            <span style="color:#1e40af;">${r.userEditReason}</span>
        </div>` : ''}
        ${r.adminRevisionReason ? `
        <div style="margin-top:10px;font-size:13px;padding:10px 12px;background:#f5f3ff;border:1px solid #ddd6fe;border-radius:6px;">
            <strong style="display:block;margin-bottom:4px;font-size:11px;color:#6d28d9;text-transform:uppercase;">Admin Revision Reason</strong>
            <span style="color:#4c1d95;">${escapeAdminText(r.adminRevisionReason)}</span>
        </div>` : ''}
        ${r.rescheduleReason || r.rescheduleRequestedAt ? `
        <div style="margin-top:10px;font-size:13px;padding:10px 12px;background:#fffbeb;border:1px solid #fef3c7;border-radius:6px;">
            <strong style="display:block;margin-bottom:4px;font-size:11px;color:#92400e;text-transform:uppercase;">User Requested Reschedule</strong>
            <div style="color:#92400e;font-weight:700;margin-bottom:6px;">${r.rescheduledDate ? formatDateSimple(r.rescheduledDate) : 'Date not specified'} ${r.rescheduledStartTime ? ' · ' + convertTo12Hour(r.rescheduledStartTime) + '–' + convertTo12Hour(r.rescheduledEndTime) : ''}</div>
            <div style="color:#7c2d12;">Reason: ${r.rescheduleReason || 'No reason provided'}</div>
        </div>` : ''}
        ${r.adminRescheduleNote ? `
        <div style="margin-top:10px;font-size:13px;padding:10px 12px;background:#f8fafc;border:1px solid #cbd5e1;border-radius:6px;">
            <strong style="display:block;margin-bottom:4px;font-size:11px;color:#475569;text-transform:uppercase;">Admin Note (shared with requester)</strong>
            <span style="color:#334155;">${escapeAdminText(r.adminRescheduleNote)}</span>
        </div>` : ''}`;

    const isConfirmedManage = mode === 'CONFIRMED_MANAGE' || mode === 'RESCHEDULE_OR_REJECT' || mode === 'VISIT_RESCHEDULE_OR_REJECT';
    const isConfirmedEdit   = mode === 'CONFIRMED_EDIT';
    const lockFields        = mode === 'PAYMENT_ONLY' || mode === 'VIEW_ONLY';
    const readOnlyAll       = mode === 'VIEW_ONLY';
    const isQueueReview     = mode === 'QUEUE_REVIEW';

    document.querySelectorAll('.edit-field-locked').forEach(el => {
        el.disabled = lockFields || isQueueReview || (isConfirmedManage && !isConfirmedEdit);
    });
    document.querySelectorAll('.edit-field-appointment').forEach(el => { el.disabled = lockFields; });
    document.getElementById('editPaymentStatus').disabled = readOnlyAll || isQueueReview;
    document.getElementById('saveEdit').style.display = readOnlyAll ? 'none' : 'block';

    // Populate booking fields
    populateRoomSelects();
    document.getElementById('editRoomId').value          = r.roomId;
    document.getElementById('editDate').value            = r.date;
    document.getElementById('editStartTime').value       = r.startTime;
    document.getElementById('editEndTime').value         = r.endTime;
    document.getElementById('editAppointmentDate').value = r.appointmentDate || '';

    const apptTime   = r.appointmentTime || '';
    const apptSelect = document.getElementById('editAppointmentTime');
    apptSelect.value = apptTime;

    // ── QUEUE_REVIEW / event or visit reschedule: show multi-slot builder, hide single-slot fields ──
    const slotBuilder = document.getElementById('visitSlotBuilder');
    const singleSlot  = document.getElementById('visitSingleSlot');
    const visitSectionTitle = document.getElementById('visitSectionTitle');
    const visitSlotInstructions = document.getElementById('visitSlotInstructions');
    const visitCalendarTitle = document.getElementById('visitCalendarTitle');
    const visitTimesTitle = document.getElementById('visitTimesTitle');
    const addVisitSlotButton = document.getElementById('addVisitSlotButton');
    const adminRescheduleNoteSection = document.getElementById('adminRescheduleNoteSection');
    const adminRescheduleNote = document.getElementById('adminRescheduleNote');
    const adminRevisionReasonSection = document.getElementById('adminRevisionReasonSection');
    const adminRevisionReason = document.getElementById('adminRevisionReason');
    if (visitSectionTitle) {
        visitSectionTitle.textContent = isEventRescheduleMode ? 'Alternate Schedule Available' : isVisitRescheduleMode ? 'Alternate Visit Time Available' : 'Confirmation Visit';
    }
    if (visitSlotInstructions) {
        visitSlotInstructions.textContent = isEventRescheduleMode
            ? 'Select alternative dates and times for the event reservation. Each option is a 1-hour event schedule. When the requester chooses an option, it becomes the finalized event schedule.'
            : isVisitRescheduleMode
            ? 'Select alternate visit dates and times for the confirmation visit. These options are independent from any event rescheduling request.'
            : 'Select up to 5 dates and up to 9 time slots. Adding them creates a separate option for each date and time combination.';
    }
    if (visitCalendarTitle) visitCalendarTitle.textContent = isEventRescheduleMode ? 'Alternate dates' : isVisitRescheduleMode ? 'Alternate visit dates' : 'Dates';
    if (visitTimesTitle) visitTimesTitle.textContent = isEventRescheduleMode ? 'Available event schedules' : isVisitRescheduleMode ? 'Available visit times' : 'Time slots';
    if (addVisitSlotButton) addVisitSlotButton.textContent = isEventRescheduleMode ? '+ Add Alternate Schedules' : isVisitRescheduleMode ? '+ Add Alternate Visit Slots' : '+ Add Selected Date & Time Options';
    const showAdminRevisionReason = ['FULL_EDIT', 'CONFIRMED_EDIT', 'CONFIRMED_MANAGE', 'RESCHEDULE_OR_REJECT'].includes(mode);
    if (adminRescheduleNoteSection) adminRescheduleNoteSection.style.display = isEventRescheduleMode ? '' : 'none';
    if (adminRescheduleNote) adminRescheduleNote.value = isEventRescheduleMode ? (r.adminRescheduleNote || '') : '';
    if (adminRevisionReasonSection) adminRevisionReasonSection.style.display = showAdminRevisionReason ? '' : 'none';
    if (adminRevisionReason) adminRevisionReason.value = r.adminRevisionReason || '';
    if (slotBuilder && singleSlot) {
        if (isQueueReview || isEventRescheduleMode || isVisitRescheduleMode) {
            slotBuilder.style.display = 'block';
            singleSlot.style.display  = 'none';
            function _normalizeOptions(arr) {
                const list = Array.isArray(arr) ? arr.map(s => ({ ...s })) : [];
                const seen = new Set();
                return list.filter(opt => {
                    const date = String(opt.date || '').trim();
                    const start = String(opt.startTime || opt.time || '').trim();
                    const end = String(opt.endTime || '').trim();
                    const key = `${date}::${start}::${end}`;
                    if (!date || !start) return false;
                    if (seen.has(key)) return false;
                    seen.add(key);
                    return true;
                });
            }

            pendingVisitOptions = isEventRescheduleMode
                ? _normalizeOptions(Array.isArray(r.rescheduleOptions) ? r.rescheduleOptions : [])
                : isVisitRescheduleMode
                ? _normalizeOptions(Array.isArray(r.visitOptions) ? r.visitOptions : [])
                : _normalizeOptions(Array.isArray(r.visitOptions) ? r.visitOptions : []);
            renderVisitSlotList();
            selectedVisitDates = [];
            selectedVisitTimes = [];
            visitCalendarMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
            renderVisitCalendar();
            updateVisitDateSelectionCount();
            renderVisitTimeOptions();
        } else {
            slotBuilder.style.display = 'none';
            singleSlot.style.display  = '';
        }
    }
    const apptDateEl = document.getElementById('editAppointmentDate');
    if (apptDateEl) apptDateEl.min = _getEarliestVisitDate();

    const downPaymentPaid      = r.downPaymentPaid      || false;
    const remainingBalancePaid = r.remainingBalancePaid || false;
    document.getElementById('editAmount').value         = r.totalAmount || 0;
    document.getElementById('downPaymentPaid').checked      = downPaymentPaid;
    document.getElementById('remainingBalancePaid').checked = remainingBalancePaid;

    updatePaymentBreakdown();

    if (!readOnlyAll) {
        document.getElementById('downPaymentPaid').onchange     = updatePaymentBreakdown;
        document.getElementById('remainingBalancePaid').onchange = updatePaymentBreakdown;
        document.getElementById('editAmount').oninput            = updatePaymentBreakdown;
    } else {
        document.getElementById('downPaymentPaid').onchange      = null;
        document.getElementById('remainingBalancePaid').onchange  = null;
        document.getElementById('editAmount').oninput             = null;
    }

    const canRecalc = (mode === 'CONFIRMED_EDIT' || mode === 'FULL_EDIT') && !isStaff;
    document.getElementById('editRoomId').onchange    = canRecalc ? recalcEditPrice : null;
    document.getElementById('editStartTime').onchange = canRecalc ? recalcEditPrice : null;
    document.getElementById('editEndTime').onchange   = canRecalc ? recalcEditPrice : null;

    // Payment status buttons
    const paymentStatus  = isStaff ? 'paid' : (r.paymentStatus || 'pending');
    // Unlock payment fields during CONFIRMED_EDIT only for non-staff (visitor is physically present)
    const lockPayment    = readOnlyAll || isQueueReview || isStaff || mode === 'RESCHEDULE_OR_REJECT' || mode === 'VISIT_RESCHEDULE_OR_REJECT';
    const lockBreakdown  = isStaff || (lockPayment && !isConfirmedEdit);
    const lockAmount     = isStaff || (lockPayment && !isConfirmedEdit);

    document.getElementById('editPaymentStatus').value           = paymentStatus;
    document.getElementById('editAmount').disabled               = lockAmount;
    document.getElementById('downPaymentPaid').disabled          = lockBreakdown;
    document.getElementById('remainingBalancePaid').disabled     = lockBreakdown;

    document.querySelectorAll('#paymentStatusGroup .status-btn').forEach(btn => {
        btn.classList.remove('active');
        const shouldLock = isStaff || (lockPayment && !isConfirmedEdit);
        btn.disabled = shouldLock;
        if (shouldLock) {
            btn.classList.add('disabled'); btn.onclick = null;
        } else {
            btn.classList.remove('disabled');
            btn.onclick = () => selectPaymentStatus(btn.dataset.value);
        }
    });
    document.querySelector(`#paymentStatusGroup [data-value="${paymentStatus}"]`)?.classList.add('active');

    // Staff badge / notice
    ['staff-payment-notice','staff-paid-badge'].forEach(id => document.getElementById(id)?.remove());
    document.getElementById('paymentStatusGroup').style.display  = isStaff ? 'none' : '';
    // Hide the entire Payment Breakdown section for staff — they are always free
    const downPaymentSection = document.getElementById('downPaymentSection');
    if (downPaymentSection) downPaymentSection.style.display = isStaff ? 'none' : '';
    if (isStaff) {
        const badge = document.createElement('div');
        badge.id        = 'staff-paid-badge';
        badge.innerHTML = '<span class="badge badge-paid" style="font-size:14px;font-weight:700;padding:6px 16px;">PAID</span>';
        document.getElementById('paymentStatusGroup').after(badge);
        const notice = document.createElement('p');
        notice.id             = 'staff-payment-notice';
        notice.style.cssText  = 'font-size:0.75rem;color:#16a34a;font-weight:600;margin-top:6px;';
        notice.textContent    = 'Staff member — payment is automatically set to Paid and cannot be changed.';
        badge.after(notice);
    }

    // Queue payment notice
    document.getElementById('queue-payment-notice')?.remove();
    if (isQueueReview && !isStaff) {
        const notice = document.createElement('p');
        notice.id            = 'queue-payment-notice';
        notice.style.cssText = 'font-size:0.75rem;color:#92400e;font-weight:600;margin-top:6px;';
        notice.textContent   = 'Payment status can only be updated during the confirmation visit.';
        document.getElementById('paymentStatusGroup').after(notice);
    }

    // Reservation status buttons
    const reservationStatus = r.status;
    const isApproved        = reservationStatus === 'approved';
    document.getElementById('editStatus').value = reservationStatus;

    document.querySelectorAll('#reservationStatusGroup .status-btn').forEach(btn => {
        btn.classList.remove('active', 'disabled');
        btn.style.display = '';

        if (isQueueReview) {
            if (btn.dataset.value === 'approved') { btn.style.display = 'none'; return; }
            btn.disabled = false; btn.classList.remove('disabled');
        } else if (isConfirmedManage) {
            if (btn.dataset.value === 'pending') { btn.style.display = 'none'; return; }
            if (btn.dataset.value === 'approved') btn.textContent = 'Accept';
            btn.disabled = false; btn.classList.remove('disabled');
        } else if (isConfirmedEdit) {
            if (btn.dataset.value === 'pending' || btn.classList.contains('queue-only-btn')) { btn.style.display = 'none'; return; }
            if (btn.dataset.value === 'approved') btn.textContent = 'Accept';
            btn.disabled = false; btn.classList.remove('disabled');
        } else {
            if (btn.classList.contains('queue-only-btn')) { btn.style.display = 'none'; return; }
            if (btn.dataset.value === 'approved') btn.textContent = 'Approved';
            btn.disabled = lockFields || isApproved;
            if (btn.disabled) btn.classList.add('disabled');
        }
    });

    if (isQueueReview) {
        document.querySelectorAll('#reservationStatusGroup .status-btn').forEach(btn => {
            if (btn.style.display !== 'none') { btn.disabled = false; btn.classList.remove('disabled'); }
        });
    }

    document.querySelector(`#reservationStatusGroup [data-value="${reservationStatus}"]`)?.classList.add('active');

    document.getElementById('approved-status-notice')?.remove();
    if (isApproved) {
        const notice = document.createElement('p');
        notice.id            = 'approved-status-notice';
        notice.style.cssText = 'font-size:0.75rem;color:#800020;font-weight:600;margin-top:6px;';
        notice.textContent   = 'This request has been approved and its status can no longer be changed.';
        document.getElementById('reservationStatusGroup').after(notice);
    }

    document.getElementById('editModal').classList.add('active');
};

// ─── Payment Breakdown ────────────────────────────────────────────────────────

function updatePaymentBreakdown() {
    const totalAmount       = parseFloat(document.getElementById('editAmount').value) || 0;
    const downPaymentPaid   = document.getElementById('downPaymentPaid').checked;
    const remainingPaid     = document.getElementById('remainingBalancePaid').checked;
    const downPaymentAmount = computeDownPayment(totalAmount);
    const remainingBalance  = Math.max(0, totalAmount - downPaymentAmount);
    let totalPaid           = 0;
    if (downPaymentPaid) totalPaid += downPaymentAmount;
    if (remainingPaid)   totalPaid += remainingBalance;

    // Update down payment section header label
    const dpAmountLabel = document.getElementById('downPaymentAmountLabel');
    if (dpAmountLabel) {
        dpAmountLabel.textContent = `Down Payment (₱${downPaymentAmount.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })})`;
    }

    document.getElementById('downPaymentLabel').textContent     = downPaymentPaid ? 'Paid' : 'Not Paid';
    document.getElementById('downPaymentLabel').style.color     = downPaymentPaid ? '#166534' : '#64748b';
    document.getElementById('remainingBalanceLabel').textContent = remainingPaid ? 'Paid' : 'Not Paid';
    document.getElementById('remainingBalanceLabel').style.color = remainingPaid ? '#166534' : '#64748b';

    const fmt = v => `₱${v.toLocaleString('en-PH', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
    document.getElementById('summaryTotal').textContent     = fmt(totalAmount);
    document.getElementById('summaryDown').textContent      = fmt(downPaymentAmount);
    document.getElementById('summaryRemaining').textContent = fmt(remainingBalance);
    document.getElementById('summaryPaid').textContent      = fmt(totalPaid);

    // Auto-set payment status based on what's been paid:
    // - fully paid (or zero-amount staff) → 'paid'
    // - partial (down paid but not remaining) → 'pending'
    // - nothing paid → do not override; keep whatever the admin set (may be 'unpaid' or 'pending')
    if (totalAmount === 0 || totalPaid >= totalAmount) {
        selectPaymentStatus('paid');
    } else if (totalPaid > 0) {
        selectPaymentStatus('pending');
    }
    // If totalPaid === 0 and totalAmount > 0, leave the status as-is.
}

function recalcEditPrice() {
    const roomId = document.getElementById('editRoomId').value;
    const start  = document.getElementById('editStartTime').value;
    const end    = document.getElementById('editEndTime').value;
    if (!roomId || !start || !end || start >= end) return;
    const req          = requests.find(x => x.id === selectedRequestToEdit);
    const isStaff      = req ? isStaffRequest(req) : false;
    const room         = rooms.find(r => r.id === roomId);
    const pricePerHour = room?.pricePerHour ?? _getRoomPriceFallback(roomId);
    const { total }    = computeBookingTotal(pricePerHour, start, end, isStaff);
    document.getElementById('editAmount').value = total;
    updatePaymentBreakdown();
}

// ─── Status Selectors ─────────────────────────────────────────────────────────

window.selectPaymentStatus = (status) => {
    if (selectedRequestToEdit) {
        const r = requests.find(x => x.id === selectedRequestToEdit);
        if (r && isStaffRequest(r)) return;
    }
    document.getElementById('editPaymentStatus').value = status;
    document.querySelectorAll('#paymentStatusGroup .status-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelector(`#paymentStatusGroup [data-value="${status}"]`)?.classList.add('active');
};

window.selectReservationStatus = (status) => {
    if (currentModalMode === 'PAYMENT_ONLY' || currentModalMode === 'VIEW_ONLY') return;
    if (document.getElementById('editStatus').value === 'approved') return;

    if (status === 'rejected') {
        const r = requests.find(x => x.id === selectedRequestToEdit);
        if (!r) return;
        pendingRejectionId = selectedRequestToEdit;
        document.getElementById('rejectionContactInfo').textContent = `Email: ${r.email || 'N/A'} | Phone: ${r.contact || 'N/A'}`;
        document.getElementById('rejectionReasonText').value = '';
        document.getElementById('rejectionReasonModal').classList.add('active');
        return;
    }

    document.getElementById('editStatus').value = status;
    document.querySelectorAll('#reservationStatusGroup .status-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelector(`#reservationStatusGroup [data-value="${status}"]`)?.classList.add('active');
};

// ─── Rejection Modal ──────────────────────────────────────────────────────────

window.closeRejectionModal = () => {
    document.getElementById('rejectionReasonModal').classList.remove('active');
    pendingRejectionId = null;
};

window.confirmRejection = async () => {
    const reason = document.getElementById('rejectionReasonText').value.trim();
    if (!reason) { alert('Please provide a reason for rejection.'); return; }

    const r = requests.find(x => x.id === pendingRejectionId);
    if (!r) return;

    if (r.email) {
        fetch('/api/notify-rejection', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: r.email, name: r.name, roomName: r.roomName || getRoomName(r.roomId), date: r.date, reason })
        }).catch(() => {});
    }

    await fetch(`/api/requests/${pendingRejectionId}`, { method: 'DELETE' });
    showToast('Request rejected and deleted.', 'success');
    closeRejectionModal();
    document.getElementById('editModal').classList.remove('active');
    await loadData();
};

// ─── Save Changes ─────────────────────────────────────────────────────────────

async function savereservationChanges() {
    if (currentModalMode === 'VIEW_ONLY') return;
    const idx = requests.findIndex(x => x.id === selectedRequestToEdit);
    if (idx === -1) return;
    const adminRevisionReason = document.getElementById('adminRevisionReason')?.value.trim() || '';

    // In CONFIRMED_EDIT mode, "Update & Approve" always approves
    if (currentModalMode === 'CONFIRMED_EDIT') {
        document.getElementById('editStatus').value = 'approved';
    }

    const selectedStatus = document.getElementById('editStatus').value;
    if (selectedStatus === 'rejected') {
        const r = requests[idx];
        pendingRejectionId = selectedRequestToEdit;
        document.getElementById('rejectionContactInfo').textContent = `Email: ${r.email || 'N/A'} | Phone: ${r.contact || 'N/A'}`;
        document.getElementById('rejectionReasonText').value = '';
        document.getElementById('rejectionReasonModal').classList.add('active');
        return;
    }

    let update = {};

    if (currentModalMode === 'PAYMENT_ONLY') {
        const isStaff = isStaffRequest(requests[idx]);
        update = {
            totalAmount:         isStaff ? (requests[idx].totalAmount || 0) : (parseFloat(document.getElementById('editAmount').value) || 0),
            paymentStatus:       isStaff ? 'paid' : document.getElementById('editPaymentStatus').value,
            downPaymentPaid:     isStaff ? false : document.getElementById('downPaymentPaid').checked,
            remainingBalancePaid: isStaff ? false : document.getElementById('remainingBalancePaid').checked
        };
    } else if (currentModalMode === 'QUEUE_REVIEW') {
        // ── Multi-slot path ──
        if (pendingVisitOptions.length > 0) {
            update = {
                visitOptions:    pendingVisitOptions,
                appointmentDate: '',
                appointmentTime: '',
                status:          document.getElementById('editStatus').value,
                blockReschedulePending: false,
                blockRescheduleReason:  null,
                adminRevisionReason
            };
        } else {
            // Fallback: single-slot (backward compat)
            const singleDate = document.getElementById('editAppointmentDate').value;
            const singleTime = document.getElementById('editAppointmentTime').value;
            if (!singleDate || !singleTime) {
                showToast('Please add at least one visit slot.', 'error');
                return;
            }
            update = {
                appointmentDate: singleDate,
                appointmentTime: singleTime,
                visitOptions:    [],
                status:          document.getElementById('editStatus').value,
                blockReschedulePending: false,
                blockRescheduleReason:  null,
                adminRevisionReason
            };
        }
    } else if (['CONFIRMED_MANAGE','RESCHEDULE_OR_REJECT','VISIT_RESCHEDULE_OR_REJECT'].includes(currentModalMode)) {
        if (currentModalMode === 'RESCHEDULE_OR_REJECT') {
            if (pendingVisitOptions.length === 0) {
                showToast('Please add at least one alternate event schedule.', 'error');
                return;
            }
            update = {
                rescheduleOptions: pendingVisitOptions,
                blockReschedulePending: false,
                blockRescheduleReason:  null,
                adminRevisionReason,
                adminRescheduleNote: document.getElementById('adminRescheduleNote')?.value.trim() || '',
                rescheduleReason: null,
                rescheduleRequestedAt: null,
                rescheduledDate: null,
                rescheduledStartTime: null,
                rescheduledEndTime: null
            };
        } else if (currentModalMode === 'VISIT_RESCHEDULE_OR_REJECT') {
            if (pendingVisitOptions.length === 0) {
                showToast('Please add at least one alternate visit slot.', 'error');
                return;
            }
            update = {
                visitOptions: pendingVisitOptions,
                appointmentDate: '',
                appointmentTime: '',
                blockReschedulePending: false,
                blockRescheduleReason:  null,
                adminRevisionReason
            };
        } else {
            update = {
                appointmentDate: document.getElementById('editAppointmentDate').value,
                appointmentTime: document.getElementById('editAppointmentTime').value,
                status:          document.getElementById('editStatus').value,
                blockReschedulePending: false,
                blockRescheduleReason:  null,
                adminRevisionReason
            };
        }
    } else {
        const isStaff = isStaffRequest(requests[idx]);
        update = {
            roomId:    document.getElementById('editRoomId').value,
            roomName:  getRoomName(document.getElementById('editRoomId').value),
            date:      document.getElementById('editDate').value,
            startTime: document.getElementById('editStartTime').value,
            endTime:   document.getElementById('editEndTime').value,
            appointmentDate: document.getElementById('editAppointmentDate').value,
            appointmentTime: document.getElementById('editAppointmentTime').value,
            totalAmount:         isStaff ? (requests[idx].totalAmount || 0) : (parseFloat(document.getElementById('editAmount').value) || 0),
            paymentStatus:       isStaff ? 'paid' : document.getElementById('editPaymentStatus').value,
            downPaymentPaid:     isStaff ? false  : document.getElementById('downPaymentPaid').checked,
            remainingBalancePaid: isStaff ? false  : document.getElementById('remainingBalancePaid').checked,
            status:              document.getElementById('editStatus').value,
            adminRevisionReason
        };
    }

    // Prevent changing payment tracking from PAID back to a non-paid state
    const currentPaymentStatus = requests[idx].paymentStatus || 'pending';
    const requestedPaymentStatus = update.paymentStatus;
    if (currentPaymentStatus === 'paid' && requestedPaymentStatus && requestedPaymentStatus !== 'paid') {
        showToast('Payment tracking is already marked PAID and cannot be changed.', 'error');
        return;
    }

    const dateChanged = typeof update.appointmentDate !== 'undefined' && String(update.appointmentDate ?? '') !== String(requests[idx].appointmentDate ?? '');
    const timeChanged = typeof update.appointmentTime !== 'undefined' && String(update.appointmentTime ?? '') !== String(requests[idx].appointmentTime ?? '');
    const visitOptionsChanged = Array.isArray(update.visitOptions) && update.visitOptions.length > 0;
    const rescheduleOptionsChanged = Array.isArray(update.rescheduleOptions) && update.rescheduleOptions.length > 0;
    const requiresRevisionReason = ['FULL_EDIT', 'CONFIRMED_EDIT', 'CONFIRMED_MANAGE', 'RESCHEDULE_OR_REJECT'].includes(currentModalMode) && (dateChanged || timeChanged || visitOptionsChanged || rescheduleOptionsChanged);
    if (requiresRevisionReason && !adminRevisionReason) {
        showToast('Please provide a reason for this revision before saving.', 'error');
        document.getElementById('adminRevisionReason')?.focus();
        return;
    }

    if (update.appointmentDate &&
        update.appointmentDate !== requests[idx].appointmentDate &&
        !_isAllowedVisitDate(update.appointmentDate)) {
        showToast('Visit dates must be tomorrow or later.', 'error');
        return;
    }
    if (Array.isArray(update.visitOptions) &&
        update.visitOptions.some(option => !_isAllowedVisitDate(option.date))) {
        showToast('All visit options must be scheduled for tomorrow or later.', 'error');
        return;
    }

    const saved = await patchRequest(selectedRequestToEdit, update);
    if (!saved) {
        showToast('Failed to save reservation changes. Please try again.', 'error');
        return;
    }

    if (update.status === 'approved') {
        const acceptedEntry = { ...requests[idx], ...update };
        try {
            await fetch('/api/accepted', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(acceptedEntry)
            });
        } catch (e) { console.warn('[WARN] Could not write to accepted.json'); }
    }

    const appointmentWasSet   = update.appointmentDate?.trim() && update.appointmentTime?.trim();
    const visitOptionsWereSent = Array.isArray(update.visitOptions) && update.visitOptions.length > 0;
    const wasApproved         = update.status === 'approved';

    if (wasApproved) {
        // Accepted during confirmation visit — switch to Approved tab
        showToast('Reservation approved successfully!', 'success');
        document.getElementById('editModal').classList.remove('active');
        await loadData();
        window.activateTab('approved');
    } else if (visitOptionsWereSent) {
        // Admin sent multiple visit options — notify user
        const r = requests.find(x => x.id === selectedRequestToEdit);
        if (r?.email) {
            fetch('/api/notify-visit-options', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    email: r.email, name: r.name,
                    roomName: r.roomName || getRoomName(r.roomId),
                    date: r.date, startTime: r.startTime, endTime: r.endTime,
                    visitOptions: update.visitOptions
                })
            }).catch(() => {});
        }
        showToast(`${update.visitOptions.length} visit option${update.visitOptions.length > 1 ? 's' : ''} sent! Request moved to Confirmed tab.`, 'success');
        document.getElementById('editModal').classList.remove('active');
        await loadData();
        window.activateTab('confirmed');
    } else if (appointmentWasSet) {
        const r = requests.find(x => x.id === selectedRequestToEdit);
        if (r?.email) {
            fetch('/api/notify-appointment', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    email: r.email, name: r.name,
                    roomName: r.roomName || getRoomName(r.roomId),
                    date: r.date, startTime: r.startTime, endTime: r.endTime,
                    appointmentDate: update.appointmentDate, appointmentTime: update.appointmentTime
                })
            }).catch(() => {});
        }
        showToast('Confirmation appointment set! Request moved to Confirmed tab.', 'success');
        document.getElementById('editModal').classList.remove('active');
        await loadData();
        window.activateTab('confirmed');
    } else {
        showToast('Changes saved successfully', 'success');
        document.getElementById('editModal').classList.remove('active');
        await loadData();
    }
}
