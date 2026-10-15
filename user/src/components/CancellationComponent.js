/**
 * Cancellation Component
 * Handles verification flow for deleting reservations
 */

import { state } from '../core/state.js';
import { convertTo12Hour, formatDate } from '../utils/dateUtils.js';
import { showToast } from './NotificationComponent.js';
import { Calendar } from './CalendarComponent.js';
import { TimeSlots } from './TimeSlotsComponent.js';

export class CancellationHandler {
    constructor() {
        this.modal = document.getElementById('cancel-verification-modal');
        this.stepConfirm = document.getElementById('cancel-step-confirm');
        this.stepVerify = document.getElementById('cancel-step-verify');
        this.stepReason = document.getElementById('cancel-step-reason');
        
        this.detailsContainer = document.getElementById('cancel-reservation-details');
        this.emailText = document.getElementById('cancel-target-email');
        this.otpInput = document.getElementById('cancel-otp-input');
        this.otpError = document.getElementById('cancel-otp-error');
        this.reasonInput = document.getElementById('cancel-reason-input');
        
        this.activereservation = null;
        this.generatedCode = null;

        this.init();
    }

    init() {
        this.attachListeners();
    }

    attachListeners() {
        // Modal Controls
        document.getElementById('cancel-modal-close').onclick = () => this.close();
        document.getElementById('cancel-flow-abort').onclick = () => this.close();
        document.getElementById('cancel-flow-back').onclick = () => this.showConfirmStep();

        // Flow Logic
        document.getElementById('cancel-flow-send-code').onclick = () => this.handleSendCode();
        document.getElementById('cancel-flow-finalize').onclick = () => this.handleFinalize();
        document.getElementById('cancel-flow-submit-reason').onclick = () => this.handleCompleteCancellation();

        // Listen for requests from the right sidebar
        document.addEventListener('request-reservation-cancellation', (e) => {
            const { reservationId } = e.detail;
            this.open(reservationId);
        });
    }

    open(reservationId) {
        const reservation = state.reservations.find(b => b.id === reservationId);
        if (!reservation) {
            showToast('Unable to find reservation record.', 'error');
            return;
        }

        // Only allow cancellation of user-submitted records (must have email)
        if (!reservation.email) {
            showToast('Static records cannot be cancelled via this portal.', 'error');
            return;
        }

        // Check if event is within 2 weeks (14 days)
        if (!reservation.date) {
            showToast('Reservation has no event date.', 'error');
            return;
        }
        const eventDate = new Date(reservation.date);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        eventDate.setHours(0, 0, 0, 0);
        
        const daysUntilEvent = Math.ceil((eventDate - today) / (1000 * 60 * 60 * 24));
        
        if (daysUntilEvent < 14) {
            showToast('Cancellations are not accepted within 2 weeks of the event date.', 'error');
            return;
        }

        this.activereservation = reservation;
        this.renderDetails();
        this.showConfirmStep(); // Enforce confirm → verify → reason flow
        this.modal.classList.add('active');
    }

    close() {
        this.modal.classList.remove('active');
        this.activereservation = null;
        this.generatedCode = null;
        this.otpInput.value = '';
        this.reasonInput.value = '';
        this.otpError.style.display = 'none';
    }

    showConfirmStep() {
        this.stepConfirm.style.display = 'block';
        this.stepVerify.style.display = 'none';
        this.stepReason.style.display = 'none';
    }

    showVerifyStep() {
        this.stepConfirm.style.display = 'none';
        this.stepVerify.style.display = 'block';
        this.stepReason.style.display = 'none';
        this.emailText.textContent = this.activereservation.email;
    }

    showReasonStep() {
        this.stepConfirm.style.display = 'none';
        this.stepVerify.style.display = 'none';
        this.stepReason.style.display = 'block';
    }

    renderDetails() {
        const b = this.activereservation;
        this.detailsContainer.innerHTML = `
            <div style="font-weight: 700; color: #1f2937; margin-bottom: 0.25rem;">${b.name}</div>
            <div style="font-size: 0.9rem; color: #4b5563;">${b.purpose}</div>
            <div style="font-size: 0.85rem; color: #6b7280; margin-top: 0.5rem;">
                <strong>Date:</strong> ${formatDate(b.date)}<br>
                <strong>Time:</strong> ${convertTo12Hour(b.startTime)} - ${convertTo12Hour(b.endTime)}
            </div>
        `;
    }

    async handleSendCode() {
        try {
            const res = await fetch('/api/send-cancellation-otp', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    requestId: this.activereservation.id,
                    email: this.activereservation.email,
                    name: this.activereservation.name
                })
            });
            if (!res.ok) throw new Error('Send failed');
            showToast(`Verification code sent to ${this.activereservation.email}`, 'info');
            this.showVerifyStep();
        } catch {
            showToast('Failed to send verification code. Please try again.', 'error');
        }
    }

    async handleFinalize() {
        const entered = this.otpInput.value.trim();
        try {
            const res = await fetch('/api/verify-cancellation-otp', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    requestId: this.activereservation.id,
                    code: entered
                })
            });
            const data = await res.json();
            if (data.valid) {
                this.otpError.style.display = 'none';
                this.showReasonStep();
            } else {
                this.otpError.style.display = 'block';
            }
        } catch {
            this.otpError.style.display = 'block';
        }
    }

    async handleCompleteCancellation() {
        const reason = this.reasonInput.value.trim();
        
        if (!reason) {
            showToast('Please provide a reason for cancellation.', 'error');
            return;
        }

        const id = this.activereservation.id;
        const updated = {
            status: 'cancelled',
            cancellationReason: reason,
            cancellationRequestedAt: new Date().toISOString()
        };

        let failureMessage = 'Failed to delete record.';
        try {
            const res = await fetch(`/api/requests/${id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(updated)
            });
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                failureMessage = data.message || failureMessage;
            } else {
                showToast('reservation cancelled successfully. Reason sent to admin.', 'success');
                this.close();
                // Refresh UI components
                new Calendar().render();
                new TimeSlots().render();
                return;
            }
        } catch (error) {
            console.error('Failed to submit cancellation:', error);
        }
        
        showToast(failureMessage, 'error');
    }
}