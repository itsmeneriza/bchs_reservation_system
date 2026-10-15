/**
 * reservation Modal Component
 * Handles reservation request form interactions, dynamic time filtering, and purpose-based venue suggestions.
 */

import { state } from '../core/state.js';
import { convertTo12Hour, isPastDate, getLocalISODate } from '../utils/dateUtils.js';
import { saveReservationRequest, findConflict, getBookedSlots, getReservationsForDate } from '../services/reservationService.js';
import { Calendar } from './CalendarComponent.js';
import { TimeSlots } from './TimeSlotsComponent.js';
import { showToast } from './NotificationComponent.js';

export class ReservationModal {
    constructor() {
        this.modal = document.getElementById('request-modal');
        this.policyModal = document.getElementById('policy-modal');
        this.form = document.getElementById('request-form');
        this.durationInfo = document.getElementById('duration-info');
        this.conflictWarning = document.getElementById('conflict-warning');
        this.suggestionBox = null;
        this.pendingRequestData = null;

        this.inputs = {
            name: document.getElementById('req-name'),
            email: document.getElementById('req-email'),
            contact: document.getElementById('req-contact'),
            date: document.getElementById('req-date-input') || { value: '' }, // real input shown in edit mode
            attendees: document.getElementById('req-attendees'),
            purposeSelect: document.getElementById('req-purpose-select'),
            purposeCustom: document.getElementById('req-purpose-custom'),
            startTime: document.getElementById('req-start-time'),
            endTime: document.getElementById('req-end-time'),
            notes: document.getElementById('req-notes')
        };
    }

    init() {
        this.injectUIElements();
        this.attachEventListeners();
        // Expose open() globally for CalendarComponent day-click and MyRequests edit
        window._openReservationModal = (editingId = null, prefill = null) => this.open(editingId, prefill);
    }

    injectUIElements() {
        const footer = this.form.querySelector('.modal-footer');

        // 1. Payment Notice
        const notice = document.createElement('div');
        notice.style.cssText = 'background: #f0fdf4; border: 1px solid #749965; padding: 12px; border-radius: 6px; margin-bottom: 16px; font-size: 13px; color: #3f6212;';
        notice.innerHTML = `<strong>Payment Deadline:</strong> Settlement must be made <strong>3 working days prior</strong> to the event. Unpaid reservations risk loss of priority to school activities.`;
        this.form.insertBefore(notice, footer);

        // 2. Suggestion Box — inserted after custom-purpose-group
        this.suggestionBox = document.createElement('div');
        this.suggestionBox.id = 'venue-suggestion';
        this.suggestionBox.style.cssText = 'background: #fdf4ff; border: 1px solid #d946ef; padding: 12px; border-radius: 6px; margin-bottom: 16px; font-size: 13px; color: #701a75; display: none;';
        const customPurposeGroup = document.getElementById('custom-purpose-group');
        if (customPurposeGroup && customPurposeGroup.nextSibling) {
            this.form.insertBefore(this.suggestionBox, customPurposeGroup.nextSibling);
        } else {
            this.form.insertBefore(this.suggestionBox, notice);
        }

        // 3. Facility Picker Row — injected just before the purpose group
        this.facilityPicker = document.createElement('div');
        this.facilityPicker.className = 'form-group facility-picker-group';
        this.facilityPicker.innerHTML = `<label>Facility *</label><div id="modal-facility-row" class="modal-facility-row"></div>`;
        const purposeGroup = this.form.querySelector('.form-group:has(#req-purpose-select)');
        if (purposeGroup) {
            this.form.insertBefore(this.facilityPicker, purposeGroup);
        }
        this.renderFacilityPicker();
    }

    renderFacilityPicker(filterPax = 0) {
        const row = document.getElementById('modal-facility-row');
        if (!row || !state.rooms.length) return;
        row.innerHTML = '';
        state.rooms.forEach(room => {
            const tooSmall = filterPax > 0 && room.capacity < filterPax;
            const isSelected = state.selectedRoom && state.selectedRoom.id === room.id;
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'facility-pill' + (isSelected ? ' selected' : '') + (tooSmall ? ' disabled' : '');
            btn.disabled = tooSmall;
            btn.title = tooSmall ? `Capacity: ${room.capacity} pax — too small for ${filterPax} attendees` : `${room.name} · up to ${room.capacity} pax`;
            btn.innerHTML = `<span class="facility-pill-name">${room.name}</span><span class="facility-pill-cap">${room.capacity} pax</span>`;
            if (!tooSmall) {
                btn.addEventListener('click', () => {
                    import('./RoomListComponent.js').then(({ RoomList }) => {
                        new RoomList().selectRoom(room);
                        this.renderFacilityPicker(filterPax);
                        this.updateAvailableTimes();
                        this.updateDurationInfo();
                        this.updateVenueSuggestion();
                        // Refresh min pax warning for new room
                        this.checkMinPax(parseInt(this.inputs.attendees?.value) || 0);
                    });
                });
            }
            row.appendChild(btn);
        });
    }

    open(editingId = null, prefill = null) {
        // --- AUTH CHECK ---
        if (!state.isLoggedIn) {
            showToast('Please login to request a reservation.', 'info');
            document.getElementById('login-modal').classList.add('active');
            return;
        }

        const selectedDateStr = getLocalISODate(state.selectedDate);

        // --- ADMIN BLOCK CHECK (skip when editing — user picks their own new date) ---
        if (!editingId) {
            const dayreservations = getReservationsForDate(state.selectedRoom.id, selectedDateStr);
            const isBlocked = dayreservations.some(b => b.status === 'blocked' && b.isFullDayBlock);
            if (isBlocked) {
                showToast('This facility is unavailable on the selected date.', 'error');
                return;
            }
        }

        // Set date — use prefill date if editing, else selected calendar date
        const dateToUse = prefill?.date || selectedDateStr;
        const dateInput = document.getElementById('req-date-input');
        const dateGroup = document.getElementById('req-date-group');
        if (dateInput) {
            dateInput.value = dateToUse;
            dateInput.min   = new Date().toISOString().split('T')[0];
        }
        if (dateGroup) dateGroup.style.display = editingId ? '' : 'none';
        // Keep this.inputs.date in sync
        if (this.inputs.date) this.inputs.date.value = dateToUse;

        if (prefill) {
            // Editing mode — fill all fields from the existing request
            const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val ?? ''; };

            set('req-name',    prefill.name    || '');
            set('req-email',   prefill.email   || '');
            set('req-contact', prefill.contact || '');

            // Lock identity fields
            ['req-name', 'req-email', 'req-contact'].forEach(id => {
                const el = document.getElementById(id);
                if (el) { el.readOnly = true; el.style.background = '#f1f5f9'; el.style.color = '#64748b'; el.style.cursor = 'not-allowed'; }
            });

            set('req-attendees', prefill.attendees || '');

            // Purpose dropdown
            const purposeSelect = document.getElementById('req-purpose-select');
            const customGroup   = document.getElementById('custom-purpose-group');
            const paxRow        = document.getElementById('pax-row');
            if (purposeSelect) {
                const opt = [...purposeSelect.options].find(o => o.value === prefill.purpose);
                if (opt) {
                    purposeSelect.value = prefill.purpose;
                    if (customGroup) customGroup.style.display = 'none';
                } else {
                    // Custom / "other" purpose
                    purposeSelect.value = 'other';
                    if (customGroup) {
                        customGroup.style.display = 'block';
                        set('req-purpose-custom', prefill.purpose || '');
                    }
                }
            }
            if (paxRow) paxRow.style.display = '';

            // Update available times for the prefill date (excludes own slot via editingId)
            this.updateAvailableTimes(editingId);

            // Re-enable the request's own time options so they can be selected
            [this.inputs.startTime, this.inputs.endTime].forEach(sel => {
                if (!sel) return;
                sel.querySelectorAll('option').forEach(opt => {
                    if (!opt.value) return;
                    const h = parseInt(opt.value.split(':')[0]);
                    const reqStartH = parseInt((prefill.startTime || '').split(':')[0]);
                    const reqEndH   = parseInt((prefill.endTime   || '').split(':')[0]);
                    if (h >= reqStartH && h < reqEndH) {
                        opt.disabled              = false;
                        opt.style.color           = '';
                        opt.style.backgroundColor = '';
                        opt.textContent = opt.textContent.replace(' (Unavailable)', '');
                    }
                });
            });

            // Set times AFTER re-enabling own options
            set('req-start-time', prefill.startTime || '');
            set('req-end-time',   prefill.endTime   || '');

            // Equipment checkboxes — restore from additionalNotes (comma-separated values)
            const savedEquipment = (prefill.additionalNotes || '')
                .split(',').map(s => s.trim()).filter(Boolean);
            document.querySelectorAll('[name="equipment"]').forEach(cb => {
                cb.checked = savedEquipment.includes(cb.value);
            });
            // Handle "Others" text — if none of the checkbox values match, it's free-text
            const knownValues = [...document.querySelectorAll('[name="equipment"]')].map(cb => cb.value);
            const othersText  = savedEquipment.filter(v => !knownValues.includes(v)).join(', ');
            const othersCheck = document.getElementById('equipment-others-check');
            const notesInput  = document.getElementById('req-notes');
            if (othersText && othersCheck) {
                othersCheck.checked = true;
                if (notesInput) { notesInput.value = othersText; notesInput.style.display = 'block'; }
            } else if (othersCheck) {
                othersCheck.checked = false;
                if (notesInput) { notesInput.value = ''; notesInput.style.display = 'none'; }
            }

            // Mark edit mode
            this.modal.dataset.editId = editingId;
        } else {
            // Auto-fill for logged-in users (new reservation)
            if (state.user) {
                if (state.user.phone) this.inputs.contact.value = state.user.phone;
                if (state.user.isStaff) {
                    if (state.user.name)  this.inputs.name.value  = state.user.name;
                    if (state.user.email) this.inputs.email.value = state.user.email;
                }
            }
            this.updateAvailableTimes();
        }

        this.updateDurationInfo();
        this.checkTimeConflict();
        this.modal.classList.add('active');

        // Render facility picker — highlight the current room (already set in state by editRequest)
        this.renderFacilityPicker(parseInt(this.inputs.attendees?.value) || 0);
        this.checkMinPax(parseInt(this.inputs.attendees?.value) || 0);
    }

    updateAvailableTimes(excludeId = null) {
        const dateVal = this.inputs.date.value;
        if (!dateVal) return;

        const bookedTimeRanges = getBookedSlots(state.selectedRoom.id, dateVal, excludeId);
        const takenHours = new Set();
        bookedTimeRanges.forEach(range => {
            const [start, end] = range.split('-');
            const startH = parseInt(start.split(':')[0]);
            const endH = parseInt(end.split(':')[0]);
            for (let h = startH; h < endH; h++) {
                takenHours.add(`${String(h).padStart(2, '0')}:00`);
            }
        });

        this.filterSelectOptions(this.inputs.startTime, takenHours, false);
        this.filterSelectOptions(this.inputs.endTime, takenHours, true);
    }

    filterSelectOptions(selectEl, takenHours, isEndTime) {
        const options = selectEl.querySelectorAll('option');
        options.forEach(opt => {
            if (!opt.value) return;
            const isReserved = takenHours.has(opt.value);
            if (isReserved) {
                opt.style.color = '#ef4444'; 
                opt.style.backgroundColor = '#fee2e2'; 
                opt.disabled = true;
                opt.textContent = opt.textContent.includes('(Unavailable)') ? opt.textContent : `${opt.textContent} (Unavailable)`;
            } else {
                opt.style.color = 'inherit';
                opt.style.backgroundColor = 'inherit';
                opt.disabled = false;
                opt.textContent = opt.textContent.replace(' (Unavailable)', '');
            }
        });
        if (selectEl.selectedOptions[0]?.disabled) selectEl.value = '';
    }

    /**
     * Enhanced AI-based Venue Recommendation
     * Suggests the absolute best fit based on purpose mapping and pax efficiency.
     * Includes clickable switch links to change the selected room.
     */
    updateVenueSuggestion() {
        const attendees = parseInt(this.inputs.attendees.value) || 0;
        
        const purposeValue = this.inputs.purposeSelect.value === 'other' 
            ? this.inputs.purposeCustom.value 
            : this.inputs.purposeSelect.value;
        const purpose = (purposeValue || '').toLowerCase();
        
        if (attendees === 0 && !purpose) {
            this.suggestionBox.style.display = 'none';
            return;
        }

        const currentRoom = state.selectedRoom;
        let recommendation = null;
        let switchOptions = [];

        // 1. HARD CONSTRAINT: Over Pax Limit
        if (attendees > currentRoom.capacity) {
            const fits = state.rooms.filter(r => r.capacity >= attendees).sort((a, b) => a.capacity - b.capacity);
            if (fits.length > 0) {
                switchOptions = fits;
                recommendation = `<strong>Over Pax Limit:</strong> ${currentRoom.name} fits ${currentRoom.capacity} pax. Switch to:`;
            } else {
                recommendation = `<strong>Extreme Pax Warning:</strong> ${attendees} pax exceeds our largest facility. Please contact Admin.`;
            }
        }

        // 2. SOFT CONSTRAINT: Purpose/Facility Alignment
        if (!recommendation && purpose) {
            const mappings = [
                { id: 'library', keywords: ['study', 'quiet', 'research', 'read', 'exam', 'book', 'writing'], reason: 'optimized for academic research and quiet study' },
                { id: 'gym', keywords: ['sport', 'game', 'basketball', 'volleyball', 'practice', 'training', 'dance', 'exercise', 'physical'], reason: 'equipped for physical education and sports' },
                { id: 'avr', keywords: ['media', 'audio', 'video', 'film', 'movie', 'projection', 'presentation', 'slides', 'multimedia', 'tech'], reason: 'fully equipped with audio-visual technology' },
                { id: 'auditorium', keywords: ['graduation', 'concert', 'assembly', 'performance', 'stage', 'seminar', 'summit', 'convention', 'theater'], reason: 'premier venue for large-scale events' },
                { id: 'grounds', keywords: ['outdoor', 'festival', 'rally', 'drill', 'field', 'open air', 'track', 'camp'], reason: 'best for outdoor activities' }
            ];

            const bestMapping = mappings.find(m => m.keywords.some(k => purpose.includes(k)));
            if (bestMapping && currentRoom.id !== bestMapping.id) {
                const targetRoom = state.rooms.find(r => r.id === bestMapping.id);
                if (targetRoom && targetRoom.capacity >= attendees) {
                    switchOptions = [targetRoom];
                    recommendation = `<strong>Suggestion:</strong> Based on your purpose, the <strong>${targetRoom.name}</strong> is better suited (${bestMapping.reason}). Switch?`;
                }
            }
        }

        // 3. EFFICIENCY: Under-utilization
        if (!recommendation && attendees > 0 && attendees < (currentRoom.capacity * 0.2)) {
            const smaller = state.rooms
                .filter(r => r.capacity >= attendees && r.capacity < currentRoom.capacity)
                .sort((a, b) => a.capacity - b.capacity);
            if (smaller.length > 0) {
                switchOptions = smaller;
                recommendation = `Only ${attendees} pax — consider a smaller room:`;
            }
        }

        if (recommendation) {
            let html = recommendation;
            if (switchOptions.length > 0) {
                html += ` <span style="display:inline-flex;gap:6px;flex-wrap:wrap;margin-top:4px;">` +
                    switchOptions.map(r => 
                        `<button type="button" onclick="window._switchRoom('${r.id}')" style="background:#800020;color:white;border:none;border-radius:4px;padding:2px 10px;font-size:12px;cursor:pointer;font-weight:600;">${r.name} (${r.capacity} pax)</button>`
                    ).join('') + `</span>`;
            }
            this.suggestionBox.innerHTML = html;
            this.suggestionBox.style.display = 'block';
        } else {
            this.suggestionBox.style.display = 'none';
        }

        // Expose switch handler
        window._switchRoom = (roomId) => {
            const room = state.rooms.find(r => r.id === roomId);
            if (!room) return;
            const prevStart = this.inputs.startTime.value;
            const prevEnd = this.inputs.endTime.value;
            const pax = parseInt(this.inputs.attendees.value) || 0;
            import('./RoomListComponent.js').then(({ RoomList }) => {
                const rl = new RoomList();
                rl.selectRoom(room);
                this.updateAvailableTimes();
                if (prevStart && !this.inputs.startTime.querySelector(`option[value="${prevStart}"]`)?.disabled) {
                    this.inputs.startTime.value = prevStart;
                }
                if (prevEnd && !this.inputs.endTime.querySelector(`option[value="${prevEnd}"]`)?.disabled) {
                    this.inputs.endTime.value = prevEnd;
                }
                this.updateDurationInfo();
                this.updateVenueSuggestion();
                this.renderFacilityPicker(pax);
                showToast(`Switched to ${room.name}`, 'success');
            });
        };
    }

    // MIN_PAX is now read from rooms.json via state.selectedRoom.minPax.
    // This getter keeps backward-compat for any call using ReservationModal.MIN_PAX[id].
    static get MIN_PAX() {
        const map = {};
        if (state.rooms && state.rooms.length > 0) {
            state.rooms.forEach(r => { if (r.minPax != null) map[r.id] = r.minPax; });
        }
        // Fallback values in case rooms haven't loaded yet
        const fallback = { auditorium: 100, grounds: 50, library: 40, avr: 30, gym: 50 };
        return Object.keys(fallback).reduce((acc, id) => {
            acc[id] = map[id] ?? fallback[id];
            return acc;
        }, {});
    }

    checkMinPax(pax) {
        const min = state.selectedRoom?.minPax ?? (ReservationModal.MIN_PAX[state.selectedRoom?.id] || 0);
        let warning = document.getElementById('min-pax-warning');
        if (!warning) {
            warning = document.createElement('div');
            warning.id = 'min-pax-warning';
            warning.style.cssText = 'font-size:0.78rem; color:#dc2626; font-weight:600; margin-top:0.25rem;';
            this.inputs.attendees?.parentElement?.appendChild(warning);
        }
        if (min > 0 && pax > 0 && pax < min) {
            warning.textContent = `Minimum ${min} pax required for ${state.selectedRoom.name}.`;
        } else {
            warning.textContent = '';
        }
    }

    getEquipmentValue() {
        const checked = [...document.querySelectorAll('[name="equipment"]:checked')].map(cb => cb.value);
        const othersText = this.inputs.notes?.value?.trim();
        if (checked.includes('Others') && othersText) {
            return checked.filter(v => v !== 'Others').concat(othersText).join(', ');
        }
        return checked.join(', ');
    }

    close() {
        this.modal.classList.remove('active');
        this.modal.dataset.editId = '';
        this.form.reset();
        if (this.inputs.notes) this.inputs.notes.style.display = 'none';
        this.durationInfo.style.display = 'none';
        this.conflictWarning.style.display = 'none';
        this.suggestionBox.style.display = 'none';
        this.pendingRequestData = null;
        const paxRow = document.getElementById('pax-row');
        if (paxRow) paxRow.style.display = 'none';
        // Hide date picker (only shown in edit mode)
        const dateGroup = document.getElementById('req-date-group');
        if (dateGroup) dateGroup.style.display = 'none';
        // Unlock identity fields
        ['req-name', 'req-email', 'req-contact'].forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                el.readOnly = false;
                el.style.background = '';
                el.style.color = '';
                el.style.cursor = '';
            }
        });
        import('./RoomListComponent.js').then(({ RoomList }) => new RoomList().render(0));
    }

    openPolicy() {
        const isEdit = !!this.pendingRequestData?._isEdit;

        // Toggle between full policy view and edit-reason view
        const policyBody    = this.policyModal.querySelector('.modal-body');
        const editSection   = document.getElementById('policy-edit-reason-section');
        const titleEl       = this.policyModal.querySelector('.modal-header h2');
        const acceptBtn     = document.getElementById('policy-accept');
        const declineBtn    = document.getElementById('policy-decline');

        if (isEdit) {
            // Hide all policy content nodes, show only the edit-reason section
            [...policyBody.children].forEach(el => {
                el.style.display = el.id === 'policy-edit-reason-section' ? '' : 'none';
            });
            if (titleEl)    titleEl.textContent   = 'Reason for Changes';
            if (acceptBtn)  acceptBtn.textContent  = 'Submit Changes';
            if (declineBtn) declineBtn.textContent = 'Cancel';
            // Reset textarea and error
            const textarea = document.getElementById('policy-edit-reason-input');
            const error    = document.getElementById('policy-edit-reason-error');
            if (textarea) { textarea.value = ''; textarea.style.borderColor = '#e2e8f0'; }
            if (error)    error.style.display = 'none';
        } else {
            // Show all policy content nodes, hide edit-reason section
            [...policyBody.children].forEach(el => {
                el.style.display = el.id === 'policy-edit-reason-section' ? 'none' : '';
            });
            if (titleEl)    titleEl.textContent   = 'Facility Usage Policy';
            if (acceptBtn)  acceptBtn.textContent  = 'I Accept & Submit';
            if (declineBtn) declineBtn.textContent = 'Decline';
        }

        this.policyModal.classList.add('active');
    }

    closePolicy() {
        this.policyModal.classList.remove('active');
        // Restore all policy body children to their default visible state
        // so next open (non-edit) shows everything correctly
        const policyBody  = this.policyModal.querySelector('.modal-body');
        const editSection = document.getElementById('policy-edit-reason-section');
        if (policyBody) {
            [...policyBody.children].forEach(el => {
                el.style.display = el.id === 'policy-edit-reason-section' ? 'none' : '';
            });
        }
    }

    attachEventListeners() {
        document.getElementById('modal-close')?.addEventListener('click', () => this.close());
        document.getElementById('cancel-btn')?.addEventListener('click', () => this.close());
        
        document.getElementById('policy-close')?.addEventListener('click', () => this.closePolicy());
        document.getElementById('policy-decline')?.addEventListener('click', () => this.closePolicy());
        document.getElementById('policy-accept')?.addEventListener('click', () => this.handlePolicyAccept());

        this.form?.addEventListener('submit', (e) => this.handleSubmit(e));

        const { startTime, endTime, attendees, purposeSelect, purposeCustom } = this.inputs;
        
        // Purpose dropdown handler
        purposeSelect?.addEventListener('change', () => {
            const customGroup = document.getElementById('custom-purpose-group');
            const paxRow = document.getElementById('pax-row');
            if (purposeSelect.value === 'other') {
                customGroup.style.display = 'block';
                purposeCustom.required = true;
            } else {
                customGroup.style.display = 'none';
                purposeCustom.required = false;
                purposeCustom.value = '';
            }
            // Show pax field once a purpose is chosen
            if (paxRow) paxRow.style.display = purposeSelect.value ? '' : 'none';
            this.updateVenueSuggestion();
        });
        
        purposeCustom?.addEventListener('input', () => this.updateVenueSuggestion());
        
        // Equipment checkboxes — update pricing when selection changes
        document.querySelectorAll('[name="equipment"]').forEach(cb => {
            cb?.addEventListener('change', () => {
                const start = this.inputs.startTime.value;
                const end = this.inputs.endTime.value;
                if (start && end && start < end) {
                    const duration = parseInt(end.split(':')[0]) - parseInt(start.split(':')[0]);
                    this.updatePricingSummary(duration);
                }
            });
        });
        
        // Date input (shown in edit/reschedule mode) — refresh times on change
        this.inputs.date?.addEventListener?.('change', () => {
            this.updateAvailableTimes();
            this.updateDurationInfo();
            this.checkTimeConflict();
        });

        [startTime, endTime].forEach(el => {
            el?.addEventListener('change', () => this.updateDurationInfo());
        });

        // Others equipment checkbox toggle
        document.getElementById('equipment-others-check')?.addEventListener('change', (e) => {
            const notesInput = document.getElementById('req-notes');
            if (notesInput) notesInput.style.display = e.target.checked ? 'block' : 'none';
        });

        attendees?.addEventListener('input', () => {
            this.updateVenueSuggestion();
            const pax = parseInt(attendees.value) || 0;
            this.checkMinPax(pax);
            import('./RoomListComponent.js').then(({ RoomList }) => {
                new RoomList().render(pax);
            });
            this.renderFacilityPicker(pax);
        });
    }

    updateDurationInfo() {
        const start = this.inputs.startTime.value;
        const end = this.inputs.endTime.value;

        if (start && end && start < end) {
            const duration = parseInt(end.split(':')[0]) - parseInt(start.split(':')[0]);
            this.durationInfo.innerHTML = `<strong>Estimated Duration:</strong> ${duration} hour${duration > 1 ? 's' : ''}`;
            this.durationInfo.style.display = 'block';
            
            // Calculate and display pricing
            this.updatePricingSummary(duration);
        } else {
            this.durationInfo.style.display = 'none';
            document.getElementById('pricing-summary').style.display = 'none';
        }
        this.checkTimeConflict();
    }

    updatePricingSummary(duration) {
        const currentRoom = state.selectedRoom;
        const isStaff = state.user?.isStaff || false;
        
        // Check if utilities are requested
        const utilitiesRequested = this.getEquipmentValue().trim().length > 0;
        
        // Staff members get free reservations
        const pricePerHour = isStaff ? 0 : (currentRoom.pricePerHour || 0);
        const facilityTotal = pricePerHour * duration;
        const utilityFee = (duration >= 8 && !isStaff) ? 800 : 0;
        const utilitiesRequestedFee = (utilitiesRequested && !isStaff) ? 800 : 0;
        const totalAmount = facilityTotal + utilityFee + utilitiesRequestedFee;

        // Update display
        if (isStaff) {
            document.getElementById('price-facility-rate').textContent = 'FREE (Staff)';
        } else {
            document.getElementById('price-facility-rate').textContent =
                `₱${pricePerHour.toLocaleString()}/hr × ${duration} hr${duration > 1 ? 's' : ''} = ₱${facilityTotal.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
        }
        
        document.getElementById('price-duration').textContent = `${duration} hour${duration > 1 ? 's' : ''}`;
        document.getElementById('price-total').textContent = isStaff ? 'FREE' : `₱${totalAmount.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
        
        // Show/hide utility fee row (8+ hours)
        const utilityRow = document.getElementById('utility-fee-row');
        if (utilityFee > 0) {
            utilityRow.style.display = 'flex';
        } else {
            utilityRow.style.display = 'none';
        }
        
        // Show/hide utilities requested fee row
        const utilitiesRequestedRow = document.getElementById('utilities-requested-fee-row');
        if (utilitiesRequestedFee > 0) {
            utilitiesRequestedRow.style.display = 'flex';
        } else {
            utilitiesRequestedRow.style.display = 'none';
        }

        // Show pricing summary
        document.getElementById('pricing-summary').style.display = 'block';
    }

    checkTimeConflict() {
        const { date, startTime, endTime } = this.inputs;
        if (!date.value || !startTime.value || !endTime.value || startTime.value >= endTime.value) {
            this.conflictWarning.style.display = 'none';
            return;
        }

        const editingId = this.modal.dataset.editId || null;
        const conflict = findConflict(state.selectedRoom.id, date.value, startTime.value, endTime.value, editingId);
        if (conflict) {
            const isBlocked = conflict.status === 'blocked';
            this.conflictWarning.innerHTML = isBlocked 
                ? `<strong style="color:#ef4444;">Facility Unavailable</strong><br>The administrator has marked this facility as unavailable for the selected time.`
                : `<strong style="color:#ef4444;">Timing Conflict</strong><br>The selected slot overlaps with an existing reservation.`;
            this.conflictWarning.style.display = 'block';
        } else {
            this.conflictWarning.style.display = 'none';
        }
    }

    async handleSubmit(e) {
        e.preventDefault();
        
        // Get purpose from dropdown or custom input
        const purposeValue = this.inputs.purposeSelect.value === 'other' 
            ? this.inputs.purposeCustom.value 
            : this.inputs.purposeSelect.value;
        
        const formData = {
            name: this.inputs.name.value,
            email: this.inputs.email.value,
            contact: this.inputs.contact.value,
            date: this.inputs.date.value,
            startTime: this.inputs.startTime.value,
            endTime: this.inputs.endTime.value,
            attendees: parseInt(this.inputs.attendees.value),
            purpose: purposeValue,
            additionalNotes: this.getEquipmentValue()
        };

        if (isPastDate(new Date(formData.date))) return showToast('Cannot book for past dates.', 'error');
        if (formData.startTime >= formData.endTime) return showToast('Invalid time range.', 'error');
        if (!state.selectedRoom) return showToast('Please select a facility first.', 'error');

        const minPax = state.selectedRoom?.minPax ?? (ReservationModal.MIN_PAX[state.selectedRoom.id] || 0);
        if (minPax > 0 && formData.attendees < minPax) {
            return showToast(`Minimum ${minPax} pax required for ${state.selectedRoom.name}.`, 'error');
        }
        
        const editingId = this.modal.dataset.editId || null;
        const conflict = findConflict(state.selectedRoom.id, formData.date, formData.startTime, formData.endTime, editingId);
        if (conflict) {
            return showToast(conflict.status === 'blocked' ? 'Facility is unavailable.' : 'Selected time is already taken.', 'error');
        }

        // Calculate total amount (free for staff)
        const isStaff = state.user?.isStaff || false;
        const duration = parseInt(formData.endTime.split(':')[0]) - parseInt(formData.startTime.split(':')[0]);
        const pricePerHour = isStaff ? 0 : (state.selectedRoom.pricePerHour || 0);
        const facilityTotal = pricePerHour * duration;
        const utilityFee = (duration >= 8 && !isStaff) ? 800 : 0;
        const utilitiesRequestedFee = (formData.additionalNotes.trim().length > 0 && !isStaff) ? 800 : 0;
        const totalAmount = facilityTotal + utilityFee + utilitiesRequestedFee;

        this.pendingRequestData = {
            id: this.modal.dataset.editId || Date.now().toString(),
            roomId: state.selectedRoom.id,
            roomName: state.selectedRoom.name,
            totalAmount: totalAmount,
            paymentStatus: isStaff ? 'paid' : 'pending',
            isStaff: isStaff,
            userId: state.user?.phone || state.user?.staffId || formData.contact || formData.email,
            ...formData,
            status: 'pending',
            submittedAt: new Date().toISOString(),
            _isEdit: !!this.modal.dataset.editId
        };
        this.openPolicy();
    }

    async handlePolicyAccept() {
        if (!this.pendingRequestData) return;
        const { _isEdit, ...data } = this.pendingRequestData;

        if (_isEdit) {
            // Validate that the user has provided a reason for the changes
            const reasonInput = document.getElementById('policy-edit-reason-input');
            const errorEl     = document.getElementById('policy-edit-reason-error');
            const reason      = reasonInput?.value.trim() || '';
            if (!reason) {
                if (errorEl)     errorEl.style.display     = 'block';
                if (reasonInput) reasonInput.style.borderColor = '#dc2626';
                reasonInput?.focus();
                return;
            }

            let success;
            try {
                const res = await fetch(`/api/requests/${data.id}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        ...data,
                        userEditReason: reason,
                        _editedByUser: true,
                        blockReschedulePending: false,
                        blockRescheduleReason: null,
                        appointmentDate: null,
                        appointmentTime: null
                    })
                });
                success = res.ok;
            } catch { success = false; }

            if (success) {
                showToast('Request updated successfully!', 'success');
                this.closePolicy();
                this.close();
                location.reload();
            } else {
                showToast('Submission failed. Make sure the server is running, or the time slot may already be taken.', 'error');
            }
        } else {
            let success;
            try {
                success = await saveReservationRequest(data);
            } catch (error) {
                if (error.status === 429) {
                    showToast(error.message, 'error');
                    return;
                }
                throw error;
            }
            if (success) {
                showToast('Request submitted successfully!', 'success');
                this.closePolicy();
                this.close();
                location.reload();
            } else {
                showToast('Submission failed. Make sure the server is running, or the time slot may already be taken.', 'error');
            }
        }
    }
}