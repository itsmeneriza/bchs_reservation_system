/**
 * My Requests Component
 * Displays all reservation requests made by the logged-in user
 */

import { state, setSelectedDate, setSelectedFacility } from "../core/state.js";
import {
  convertTo12Hour,
  formatDate,
  formatDateTime,
  getLocalISODate,
  getWorkingDaysUntil,
} from "../utils/dateUtils.js";
import {
  findConflict,
  getBookedSlots,
} from "../services/reservationService.js";

const escapeHtml = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character],
  );

export class MyRequests {
  constructor() {
    this.container = document.getElementById("my-requests-container");
    this.setupVisitSlotPicker();
    this.setupRescheduleModal();
    this.setupRequestActions();
  }

  setupVisitSlotPicker() {
    window.selectRescheduleOption = async (requestId, optionIndex) => {
      try {
        const response = await fetch(`/api/requests/${requestId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            rescheduleOptionIndex: optionIndex,
            _editedByUser: true,
          }),
        });
        const payload = await response.json().catch(() => ({}));
        const { showToast } = await import("./NotificationComponent.js");
        if (!response.ok) {
          showToast(
            payload.message ||
              "Could not finalize this event schedule. Please choose another option or contact the administration office.",
            "error",
          );
          return;
        }
        showToast(
          "Your event schedule has been updated and finalized.",
          "success",
        );
        this.render();
      } catch (error) {
        console.error("Failed to finalize alternate event schedule:", error);
        const { showToast } = await import("./NotificationComponent.js");
        showToast(
          "Could not finalize this event schedule. Please try again.",
          "error",
        );
      }
    };

    window.selectVisitSlot = async (requestId, date, time) => {
      try {
        const patchRes = await fetch(`/api/requests/${requestId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            appointmentDate: date,
            appointmentTime: time,
            visitOptions: [],
            _editedByUser: true,
          }),
        });
        if (!patchRes.ok) throw new Error("Patch failed");

        // Notify user via email
        const allRes = await fetch("/api/requests");
        if (allRes.ok) {
          const data = await allRes.json();
          const req = (data.requests || []).find((r) => r.id === requestId);
          if (req?.email) {
            fetch("/api/notify-appointment-confirmed", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                requestId,
                email: req.email,
                name: req.name,
                facilityName: req.facilityName,
                date: req.date,
                startTime: req.startTime,
                endTime: req.endTime,
                appointmentDate: date,
                appointmentTime: time,
              }),
            }).catch(() => {});
          }
        }

        import("./NotificationComponent.js").then(({ showToast }) => {
          showToast(
            "Visit slot confirmed! You'll receive a confirmation email shortly.",
            "success",
          );
        });
        this.render();
      } catch (e) {
        console.warn("Failed to confirm visit slot:", e);
        import("./NotificationComponent.js").then(({ showToast }) => {
          showToast("Failed to confirm slot. Please try again.", "error");
        });
      }
    };
  }

  setupRescheduleModal() {
    if (!document.getElementById("reschedule-modal")) {
      const modal = document.createElement("div");
      modal.id = "reschedule-modal";
      modal.style.cssText =
        "display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 1000; align-items: center; justify-content: center;";
      modal.innerHTML = `
                <div style="background: white; border-radius: 1rem; padding: 2rem; max-width: 520px; width: 90%; box-shadow: 0 20px 25px -5px rgba(0,0,0,0.1);">
                    <h3 style="font-size: 1.5rem; font-weight: 700; color: #1e293b; margin-bottom: 0.75rem;">Request Event Rescheduling</h3>
                    <p style="font-size: 0.875rem; color: #64748b; margin-bottom: 1.25rem;">Please provide a reason and choose a new date and time for your event reservation.</p>

                    <div style="margin-bottom: 1rem;">
                        <label style="display: block; font-size: 0.875rem; font-weight: 600; color: #374151; margin-bottom: 0.5rem;">Reschedule Reason *</label>
                        <textarea id="reschedule-reason-input" rows="4" placeholder="Explain why you need to reschedule this request..." style="width: 100%; padding: 0.75rem; border: 2px solid #e2e8f0; border-radius: 0.5rem; font-size: 0.875rem; resize: vertical; font-family: inherit;" required></textarea>
                    </div>

                    <div style="margin-bottom: 1rem;">
                        <label style="display: block; font-size: 0.875rem; font-weight: 600; color: #374151; margin-bottom: 0.5rem;">New Date *</label>
                        <input id="reschedule-date-input" type="date" style="width: 100%; padding: 0.75rem; border: 2px solid #e2e8f0; border-radius: 0.5rem; font-size: 0.875rem;" required>
                    </div>

                    <div style="margin-bottom: 1.5rem; display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem;">
                        <div>
                            <label style="display: block; font-size: 0.875rem; font-weight: 600; color: #374151; margin-bottom: 0.5rem;">New Start Time *</label>
                            <select id="reschedule-start-time" style="width: 100%; padding: 0.75rem; border: 2px solid #e2e8f0; border-radius: 0.5rem; font-size: 0.875rem;" required></select>
                        </div>
                        <div>
                            <label style="display: block; font-size: 0.875rem; font-weight: 600; color: #374151; margin-bottom: 0.5rem;">New End Time *</label>
                            <select id="reschedule-end-time" style="width: 100%; padding: 0.75rem; border: 2px solid #e2e8f0; border-radius: 0.5rem; font-size: 0.875rem;" required></select>
                        </div>
                    </div>

                    <div style="display: flex; gap: 0.75rem; justify-content: flex-end;">
                        <button onclick="window.closeRescheduleModal()" style="background: #f1f5f9; color: #475569; border: none; padding: 0.75rem 1.5rem; border-radius: 0.5rem; font-weight: 600; cursor: pointer;" onmouseover="this.style.background='#e2e8f0'" onmouseout="this.style.background='#f1f5f9'">Cancel</button>
                        <button onclick="window.submitReschedule()" style="background: #2563eb; color: white; border: none; padding: 0.75rem 1.5rem; border-radius: 0.5rem; font-weight: 600; cursor: pointer;" onmouseover="this.style.background='#1d4ed8'" onmouseout="this.style.background='#2563eb'">Submit Event Rescheduling Request</button>
                    </div>
                </div>
            `;
      document.body.appendChild(modal);
    }

    window.requestReschedule = (requestId) => {
      this.currentRescheduleId = requestId;
      const modal = document.getElementById("reschedule-modal");
      const reasonInput = document.getElementById("reschedule-reason-input");
      const dateInput = document.getElementById("reschedule-date-input");
      const startInput = document.getElementById("reschedule-start-time");
      const endInput = document.getElementById("reschedule-end-time");

      const request =
        this.currentRequests?.find((r) => r.id === requestId) || null;
      dateInput.min = getLocalISODate(new Date());
      if (request) {
        dateInput.value = request.date || "";
      }

      reasonInput.value = "";
      dateInput.onchange = () => this.updateRescheduleTimeAvailability(request);
      this.updateRescheduleTimeAvailability(request);
      startInput.value = request?.startTime || "";
      endInput.value = request?.endTime || "";
      modal.style.display = "flex";
    };

    window.closeRescheduleModal = () => {
      const modal = document.getElementById("reschedule-modal");
      modal.style.display = "none";
      this.currentRescheduleId = null;
    };

    window.submitReschedule = () => {
      const reason = document
        .getElementById("reschedule-reason-input")
        .value.trim();
      const date = document.getElementById("reschedule-date-input").value;
      const startTime = document.getElementById("reschedule-start-time").value;
      const endTime = document.getElementById("reschedule-end-time").value;

      if (!reason) {
        alert("Please provide a reason for rescheduling.");
        return;
      }
      if (!date || !startTime || !endTime) {
        alert("Please select a new date and time for rescheduling.");
        return;
      }
      if (date < getLocalISODate(new Date())) {
        alert("Please choose today or a future date.");
        return;
      }
      if (startTime >= endTime) {
        alert("Please choose a valid time range.");
        return;
      }

      if (this.currentRescheduleId) {
        const request = this.currentRequests?.find(
          (r) => r.id === this.currentRescheduleId,
        );
        const conflict =
          request &&
          findConflict(
            request.facilityId,
            date,
            startTime,
            endTime,
            request.id,
          );
        if (conflict) {
          alert(
            "The selected time overlaps with a booking or a facility block. Please choose another time.",
          );
          return;
        }
        this.processReschedule(this.currentRescheduleId, {
          reason,
          date,
          startTime,
          endTime,
        });
      }
    };
  }

  updateRescheduleTimeAvailability(request) {
    const dateInput = document.getElementById("reschedule-date-input");
    const startInput = document.getElementById("reschedule-start-time");
    const endInput = document.getElementById("reschedule-end-time");
    if (!dateInput || !startInput || !endInput) return;

    const date = dateInput.value;
    const bookedHours = new Set();
    if (request && date) {
      getBookedSlots(request.facilityId, date, request.id).forEach((range) => {
        const [start, end] = range
          .split("-")
          .map((time) => Number(time.slice(0, 2)));
        for (let hour = start; hour < end; hour++) bookedHours.add(hour);
      });
    }

    const renderOptions = (select, firstHour, lastHour, selectedValue) => {
      select.replaceChildren(new Option("Select time", ""));
      for (let hour = firstHour; hour <= lastHour; hour++) {
        const value = `${String(hour).padStart(2, "0")}:00`;
        const option = new Option(convertTo12Hour(value), value);
        if (bookedHours.has(hour)) {
          option.disabled = true;
          option.style.color = "#b91c1c";
          option.style.backgroundColor = "#fee2e2";
          option.textContent += " (Booked)";
        }
        select.add(option);
      }
      if (
        selectedValue &&
        [...select.options].some(
          (option) => option.value === selectedValue && !option.disabled,
        )
      ) {
        select.value = selectedValue;
      } else {
        select.value = "";
      }
    };

    const selectedStart = startInput.value;
    const selectedEnd = endInput.value;
    renderOptions(startInput, 7, 17, selectedStart);
    renderOptions(endInput, 8, 18, selectedEnd);
  }

  setupRequestActions() {
    // Setup global functions
    window.requestCancellation = (requestId) => {
      document.dispatchEvent(
        new CustomEvent("request-reservation-cancellation", {
          detail: { reservationId: requestId },
        }),
      );
    };

    window.removeRequest = async (requestId) => {
      try {
        await fetch(`/api/requests/${requestId}`, { method: "DELETE" });
      } catch (e) {
        console.warn("Failed to delete request from server");
      }
      this.render();
    };

  }

  async processReschedule(requestId, data) {
    try {
      const res = await fetch(`/api/requests/${requestId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "approved",
          rescheduleReason: data.reason,
          rescheduleRequestedAt: new Date().toISOString(),
          rescheduledDate: data.date,
          rescheduledStartTime: data.startTime,
          rescheduledEndTime: data.endTime,
          _editedByUser: true,
        }),
      });

      const payload = await res.json().catch(() => ({}));
      const { showToast } = await import("./NotificationComponent.js");

      if (!res.ok) {
        showToast(
          payload.message || "Failed to submit reschedule request.",
          "error",
        );
        return;
      }

      window.closeRescheduleModal();
      showToast(
        "Reschedule request submitted successfully. Please wait for admin review.",
        "success",
      );
      this.render();
    } catch (error) {
      console.error("Failed to submit reschedule request:", error);
      const { showToast } = await import("./NotificationComponent.js");
      showToast(
        "Something went wrong while submitting the reschedule request.",
        "error",
      );
    }
  }

  updateBadge(count) {
    const badge = document.getElementById("my-requests-badge");
    if (!badge) return;
    if (count > 0) {
      badge.textContent = count;
      badge.style.display = "inline-block";
    } else {
      badge.style.display = "none";
    }
  }

  async render() {
    if (!this.container) return;

    // Check if user is logged in
    if (!state.isLoggedIn || !state.user) {
      this.updateBadge(0);
      this.container.innerHTML = `
                <div style="text-align: center; padding: 3rem; color: #64748b;">
                    <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="margin: 0 auto 1rem;">
                        <path d="M9 11l3 3L22 4"></path>
                        <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"></path>
                    </svg>
                    <p style="font-size: 1.125rem; font-weight: 600; margin-bottom: 0.5rem;">Please log in to view your requests</p>
                    <p style="font-size: 0.875rem;">Click the Login button in the top-right corner to access your reservation history.</p>
                </div>
            `;
      return;
    }

    // Get user's requests from server
    let allRequests = [];
    try {
      const res = await fetch("/api/requests");
      if (res.ok) {
        const data = await res.json();
        allRequests = data.requests || [];
      }
    } catch (e) {
      console.warn("Could not load requests from server");
    }

    // Filter requests by user's contact number or email
    const userRequests = allRequests.filter((req) => {
      if (state.user.phone && req.contact === state.user.phone) return true;
      if (state.user.email && req.email === state.user.email) return true;
      return false;
    });

    // Sort by date (newest first)
    userRequests.sort((a, b) => {
      const dateCompare = b.date.localeCompare(a.date);
      if (dateCompare !== 0) return dateCompare;
      return b.submittedAt?.localeCompare(a.submittedAt || "") || 0;
    });

    // Check for payment reminders (approved + unpaid + within 5 working days)
    const paymentReminders = userRequests.filter((req) => {
      if (req.status !== "approved") return false;
      if (req.paymentStatus === "paid") return false;
      const workingDaysLeft = this.getWorkingDaysUntil(req.date);
      return workingDaysLeft >= 0 && workingDaysLeft <= 5;
    });

    if (userRequests.length === 0) {
      this.updateBadge(0);
      this.container.innerHTML = `
                <div style="text-align: center; padding: 3rem; color: #64748b;">
                    <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="margin: 0 auto 1rem;">
                        <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                        <line x1="16" y1="2" x2="16" y2="6"></line>
                        <line x1="8" y1="2" x2="8" y2="6"></line>
                        <line x1="3" y1="10" x2="21" y2="10"></line>
                    </svg>
                    <p style="font-size: 1.125rem; font-weight: 600; margin-bottom: 0.5rem;">No requests found</p>
                    <p style="font-size: 0.875rem;">You haven't made any reservation requests yet.</p>
                </div>
            `;
      return;
    }

    const reminderBanners = paymentReminders
      .map((req) => {
        const daysLeft = this.getWorkingDaysUntil(req.date);
        const urgency = daysLeft <= 2;
        return `
                <div style="background: ${urgency ? "#fff1f2" : "#fffbeb"}; border: 2px solid ${urgency ? "#f87171" : "#fbbf24"}; border-radius: 0.75rem; padding: 1rem 1.25rem; display: flex; align-items: flex-start; gap: 0.75rem;">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="${urgency ? "#dc2626" : "#d97706"}" stroke-width="2" style="flex-shrink: 0; margin-top: 2px;">
                        <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"></path>
                        <line x1="12" y1="9" x2="12" y2="13"></line>
                        <line x1="12" y1="17" x2="12.01" y2="17"></line>
                    </svg>
                    <div>
                        <div style="font-weight: 700; color: ${urgency ? "#991b1b" : "#92400e"}; font-size: 0.9rem; margin-bottom: 0.25rem;">
                            Payment Reminder — ${req.facilityName} on ${formatDate(req.date)}
                        </div>
                        <div style="font-size: 0.8rem; color: ${urgency ? "#b91c1c" : "#78350f"};">
                            Your event is in <strong>${daysLeft} working day${daysLeft !== 1 ? "s" : ""}</strong>. Payment must be completed at least 3 working days before your event. Please visit the Administration Office (8:00 AM – 5:00 PM, Mon–Fri) to settle your balance.
                        </div>
                    </div>
                </div>
            `;
      })
      .join("");

    // Update badge count
    this.currentRequests = userRequests;
    this.updateBadge(userRequests.length);

    // Render requests
    this.container.innerHTML = `
            ${reminderBanners ? `<div style="display: flex; flex-direction: column; gap: 0.75rem; margin-bottom: 1rem;">${reminderBanners}</div>` : ""}
            <div style="margin-bottom: 1rem;">
                <h2 style="font-size: 1.25rem; font-weight: 700; color: #1e293b; margin-bottom: 0.25rem;">My Reservation Requests</h2>
                <p style="font-size: 0.8rem; color: #64748b;">Total: ${userRequests.length} request${userRequests.length > 1 ? "s" : ""}</p>
            </div>
            <div class="requests-landscape">
                ${userRequests.map((req) => this.renderRequestCard(req)).join("")}
            </div>
        `;

    window.editRequest = (requestId) => {
      const req = userRequests.find((r) => r.id === requestId);
      if (!req || !window._openReservationModal) return;

      // Set facility and date in state synchronously BEFORE opening the modal
      const facility = state.facilities.find((r) => r.id === req.facilityId);
      if (facility) setSelectedFacility(facility);
      setSelectedDate(new Date(req.date + "T00:00:00"));

      // Open modal with the full request data to prefill all fields
      window._openReservationModal(requestId, req);
    };

    window.toggleRequestCard = (requestId) => {
      const details = document.getElementById(`card-details-${requestId}`);
      const chevron = document.getElementById(`chevron-${requestId}`);
      if (!details) return;
      const isOpen = details.style.display !== "none";
      details.style.display = isOpen ? "none" : "block";
      if (chevron) chevron.style.transform = isOpen ? "" : "rotate(180deg)";
    };
  }

  renderEditBanner(snapshot) {
    const LABELS = {
      facilityId: "Facility",
      facilityName: "Facility",
      date: "Date",
      startTime: "Start Time",
      endTime: "End Time",
      totalAmount: "Amount",
    };
    const fmt = (field, val) => {
      if (!val && val !== 0) return "—";
      if (field === "startTime" || field === "endTime")
        return convertTo12Hour(val);
      if (field === "totalAmount")
        return `₱${parseFloat(val).toLocaleString("en-PH", { minimumFractionDigits: 2 })}`;
      return val;
    };

    const rows = Object.entries(snapshot.changes)
      .filter(([field]) => field !== "facilityId")
      .map(
        ([field, { before, after }]) => `
                <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 0.3rem; align-items: center; padding: 0.3rem 0; border-bottom: 1px solid #fde68a;">
                    <span style="font-size: 0.68rem; color: #78350f; font-weight: 600;">${LABELS[field] || field}</span>
                    <span style="font-size: 0.68rem; color: #991b1b; text-decoration: line-through;">${fmt(field, before)}</span>
                    <span style="font-size: 0.68rem; color: #166534; font-weight: 700;">→ ${fmt(field, after)}</span>
                </div>
            `,
      )
      .join("");

    if (!rows) return "";

    const changedAt = snapshot.changedAt
      ? formatDateTime(snapshot.changedAt)
      : "";

    return `
            <div style="background: #fffbeb; border: 1px solid #fbbf24; border-radius: 0.375rem; padding: 0.5rem 0.6rem; margin-bottom: 0.4rem; font-size: 0.72rem;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.35rem;">
                    <span style="font-weight: 700; color: #92400e;">Admin edited your request</span>
                    <span style="font-size: 0.62rem; color: #a16207;">${changedAt}</span>
                </div>
                <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 0.3rem; padding-bottom: 0.2rem; margin-bottom: 0.2rem;">
                    <span style="font-size: 0.62rem; color: #a16207; font-weight: 700; text-transform: uppercase;">Field</span>
                    <span style="font-size: 0.62rem; color: #a16207; font-weight: 700; text-transform: uppercase;">Before</span>
                    <span style="font-size: 0.62rem; color: #a16207; font-weight: 700; text-transform: uppercase;">After</span>
                </div>
                ${rows}
            </div>
        `;
  }

  renderUserEditBanner(snapshot) {
    const LABELS = {
      facilityName: "Facility",
      date: "Date",
      startTime: "Start Time",
      endTime: "End Time",
      attendees: "Pax",
      purpose: "Purpose",
      totalAmount: "Amount",
    };
    const fmt = (field, val) => {
      if (!val && val !== 0) return "—";
      if (field === "startTime" || field === "endTime")
        return convertTo12Hour(val);
      if (field === "totalAmount")
        return `₱${parseFloat(val).toLocaleString("en-PH", { minimumFractionDigits: 2 })}`;
      return String(val);
    };

    const rows = Object.entries(snapshot.changes)
      .filter(([field]) => field !== "facilityId")
      .map(
        ([field, { before, after }]) => `
                <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 0.3rem; align-items: center; padding: 0.3rem 0; border-bottom: 1px solid #bfdbfe;">
                    <span style="font-size: 0.68rem; color: #1e40af; font-weight: 600;">${LABELS[field] || field}</span>
                    <span style="font-size: 0.68rem; color: #991b1b; text-decoration: line-through;">${fmt(field, before)}</span>
                    <span style="font-size: 0.68rem; color: #166534; font-weight: 700;">→ ${fmt(field, after)}</span>
                </div>
            `,
      )
      .join("");

    if (!rows) return "";

    const changedAt = snapshot.changedAt
      ? formatDateTime(snapshot.changedAt)
      : "";

    return `
            <div style="background: #eff6ff; border: 1px solid #93c5fd; border-radius: 0.375rem; padding: 0.5rem 0.6rem; margin-bottom: 0.4rem; font-size: 0.72rem;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.35rem;">
                    <span style="font-weight: 700; color: #1e40af;">You edited this request</span>
                    <span style="font-size: 0.62rem; color: #3b82f6;">${changedAt}</span>
                </div>
                <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 0.3rem; padding-bottom: 0.2rem; margin-bottom: 0.2rem;">
                    <span style="font-size: 0.62rem; color: #3b82f6; font-weight: 700; text-transform: uppercase;">Field</span>
                    <span style="font-size: 0.62rem; color: #3b82f6; font-weight: 700; text-transform: uppercase;">Before</span>
                    <span style="font-size: 0.62rem; color: #3b82f6; font-weight: 700; text-transform: uppercase;">After</span>
                </div>
                ${rows}
            </div>
        `;
  }

  getWorkingDaysUntil(dateStr) {
    // Delegates to shared utility in dateUtils.js
    return getWorkingDaysUntil(dateStr);
  }

  renderRequestCard(req) {
    const isBlockForced = req.blockReschedulePending === true;

    const isAdminApprovedCancellation =
      req.status === "refused" && !!req.cancellationApprovedAt;

    const statusConfig = {
      pending: {
        color: "#fbbf24",
        bg: "#fef3c7",
        text: "#92400e",
        label: "Pending Review",
        icon: "",
      },
      approved: {
        color: "#800020",
        bg: "#fff5f7",
        text: "#660019",
        label: "Approved",
        icon: "",
      },
      accepted: {
        color: "#800020",
        bg: "#fff5f7",
        text: "#660019",
        label: "Accepted",
        icon: "",
      },
      rejected: {
        color: "#ef4444",
        bg: "#fee2e2",
        text: "#991b1b",
        label: "Rejected",
        icon: "",
      },
      refused: isAdminApprovedCancellation
        ? {
            color: "#16a34a",
            bg: "#f0fdf4",
            text: "#166534",
            label: "Cancellation Approved",
            icon: "",
          }
        : {
            color: "#6b7280",
            bg: "#f3f4f6",
            text: "#374151",
            label: "Cancelled",
            icon: "",
          },
      cancelled: {
        color: "#f59e0b",
        bg: "#fef3c7",
        text: "#92400e",
        label: "Cancellation Pending",
        icon: "",
      },
    };

    const hasRescheduleOptions =
      Array.isArray(req.rescheduleOptions) && req.rescheduleOptions.length > 0;
    const hasVisitOptions =
      Array.isArray(req.visitOptions) &&
      req.visitOptions.length > 0 &&
      (!req.appointmentDate || req.appointmentDate.trim() === "");

    const status = isBlockForced
      ? {
          color: "#f59e0b",
          bg: "#fff7ed",
          text: "#92400e",
          label: "Needs Rescheduling",
          icon: "",
        }
      : req.blockCancelled
        ? {
            color: "#ef4444",
            bg: "#fff1f2",
            text: "#991b1b",
            label: "Cancelled by Admin",
            icon: "",
          }
        : hasRescheduleOptions
          ? {
              color: "#1d4ed8",
              bg: "#eff6ff",
              text: "#1d4ed8",
              label: "Choose an Alternate Event Schedule",
              icon: "",
            }
          : hasVisitOptions
            ? {
                color: "#1d4ed8",
                bg: "#eff6ff",
                text: "#1d4ed8",
                label: "Pick a Visit Date",
                icon: "",
              }
            : statusConfig[req.status] || statusConfig["pending"];

    const isPast = new Date(req.date) < new Date();
    const isAcceptedReservation = ["approved", "accepted"].includes(req.status);
    const canCancel =
      (req.status === "pending" || isAcceptedReservation) &&
      !isPast &&
      !req.cancellationReason &&
      !isBlockForced;
    const canEdit = req.status === "pending" && !isPast && !isBlockForced;
    const canRemove =
      isPast || ["rejected", "refused", "cancelled"].includes(req.status);

    const blockForcedBanner = isBlockForced
      ? `
            <div style="background:#fff7ed;border:2px solid #f59e0b;border-radius:0.5rem;padding:0.6rem 0.75rem;margin-bottom:0.5rem;">
                <div style="display:flex;align-items:flex-start;gap:0.5rem;">
                    <div style="flex:1;">
                        <div style="font-weight:700;color:#92400e;font-size:0.8rem;margin-bottom:0.2rem;">Your reservation needs to be rescheduled</div>
                        <div style="font-size:0.72rem;color:#78350f;margin-bottom:0.4rem;">
                            <strong>Reason:</strong> ${req.blockRescheduleReason || "The facility has been made unavailable for your originally requested time."}
                        </div>
                        <div style="font-size:0.7rem;color:#92400e;">Please select a new date and time. Your original booking details have been saved.</div>
                    </div>
                </div>
            </div>`
      : "";

    return `
            <div style="background: white; border: ${isBlockForced ? "2px solid #f59e0b" : hasRescheduleOptions || hasVisitOptions ? "2px solid #93c5fd" : "1px solid #e2e8f0"}; border-radius: 0.5rem; transition: all 0.2s; font-size: 0.8rem; overflow: hidden;">

                <!-- ── Always-visible header (click to expand) ── -->
                <div onclick="window.toggleRequestCard('${req.id}')"
                     style="display:flex;justify-content:space-between;align-items:center;padding:0.75rem;cursor:pointer;user-select:none;gap:0.5rem;">
                    <div style="flex:1;min-width:0;">
                        <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.2rem;flex-wrap:wrap;">
                            <h3 style="font-size:0.9rem;font-weight:700;color:#1e293b;margin:0;">${req.facilityName || "Facility"}</h3>
                            <span style="background:${status.bg};color:${status.text};padding:0.15rem 0.5rem;border-radius:0.375rem;font-size:0.7rem;font-weight:600;border:1px solid ${status.color};">${status.label}</span>
                            ${isPast ? '<span style="background:#f3f4f6;color:#6b7280;padding:0.15rem 0.5rem;border-radius:0.375rem;font-size:0.7rem;font-weight:600;">Past</span>' : ""}
                        </div>
                        <div style="display:flex;gap:1rem;font-size:0.72rem;color:#64748b;flex-wrap:wrap;">
                            <span>${formatDate(req.date)}</span>
                            <span>${convertTo12Hour(req.startTime)}–${convertTo12Hour(req.endTime)}</span>
                            <span>${req.attendees} pax</span>
                            ${req.totalAmount ? `<span style="color:#800020;font-weight:700;">₱${parseFloat(req.totalAmount).toLocaleString("en-PH", { minimumFractionDigits: 2 })}</span>` : ""}
                        </div>
                    </div>
                    <!-- action btns — stop propagation so clicks don't toggle the card -->
                    <div style="display:flex;gap:0.35rem;flex-shrink:0;" onclick="event.stopPropagation()">
                        ${
                          canEdit
                            ? `
                        <button onclick="window.editRequest('${req.id}')"
                            style="background:#eff6ff;color:#1d4ed8;border:1px solid #bfdbfe;padding:0.25rem 0.6rem;border-radius:0.375rem;font-size:0.7rem;font-weight:600;cursor:pointer;white-space:nowrap;"
                            onmouseover="this.style.background='#dbeafe'" onmouseout="this.style.background='#eff6ff'">
                            Edit
                        </button>`
                            : ""
                        }
                        ${
                          canCancel
                            ? `
                        <button onclick="window.requestCancellation('${req.id}')"
                            style="background:#fee2e2;color:#991b1b;border:1px solid #fecaca;padding:0.25rem 0.6rem;border-radius:0.375rem;font-size:0.7rem;font-weight:600;cursor:pointer;white-space:nowrap;"
                            onmouseover="this.style.background='#fecaca'" onmouseout="this.style.background='#fee2e2'">
                            Cancel
                        </button>`
                            : ""
                        }
                        ${
                          isAcceptedReservation &&
                          !isPast &&
                          !hasRescheduleOptions
                            ? `
                        <button onclick="window.requestReschedule('${req.id}')"
                            style="background:#dcfce7;color:#166534;border:1px solid #86efac;padding:0.25rem 0.6rem;border-radius:0.375rem;font-size:0.7rem;font-weight:600;cursor:pointer;white-space:nowrap;"
                            onmouseover="this.style.background='#bbf7d0'" onmouseout="this.style.background='#dcfce7'">
                            Request Event Rescheduling
                        </button>`
                            : ""
                        }
                        <!-- chevron -->
                        <span id="chevron-${req.id}" style="display:flex;align-items:center;color:#94a3b8;transition:transform 0.2s;">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"></polyline></svg>
                        </span>
                    </div>
                </div>

                ${
                  hasRescheduleOptions
                    ? `
                <div style="background:#eff6ff;border-top:1.5px solid #93c5fd;padding:0.7rem 0.75rem;">
                    <div style="font-weight:700;color:#1d4ed8;font-size:0.82rem;margin-bottom:0.4rem;">Alternate schedules available</div>
                    <p style="font-size:0.72rem;color:#3b82f6;margin:0 0 0.5rem 0;">Choose one option to update and finalize the event date and time on your reservation.</p>
                    ${req.adminRescheduleNote ? `<div style="background:#fff;border:1px solid #bfdbfe;border-radius:0.375rem;padding:0.45rem 0.6rem;margin-bottom:0.5rem;font-size:0.72rem;color:#334155;white-space:pre-wrap;"><strong style="color:#475569;">Admin note:</strong> ${escapeHtml(req.adminRescheduleNote)}</div>` : ""}
                    <div style="display:flex;flex-direction:column;gap:0.4rem;">
                        ${req.rescheduleOptions
                          .map(
                            (option, index) => `
                        <button onclick="window.selectRescheduleOption('${req.id}',${index})"
                            style="background:white;border:2px solid #93c5fd;border-radius:0.375rem;padding:0.5rem 0.75rem;text-align:left;cursor:pointer;font-size:0.8rem;font-weight:600;color:#1e293b;display:flex;align-items:center;gap:0.5rem;width:100%;"
                            onmouseover="this.style.background='#dbeafe';this.style.borderColor='#3b82f6'"
                            onmouseout="this.style.background='white';this.style.borderColor='#93c5fd'">
                            <span style="background:#1d4ed8;color:white;font-size:0.65rem;font-weight:700;border-radius:999px;padding:1px 7px;flex-shrink:0;">Option ${index + 1}</span>
                            <span>${formatDate(option.date)}</span>
                            <span style="color:#64748b;">·</span>
                            <span>${convertTo12Hour(option.startTime)}–${convertTo12Hour(option.endTime)}</span>
                        </button>`,
                          )
                          .join("")}
                    </div>
                </div>`
                    : ""
                }

                <!-- ── Visit options picker — always visible when options are pending ── -->
                ${
                  hasVisitOptions
                    ? `
                <div style="background:#eff6ff;border-top:1.5px solid #93c5fd;padding:0.7rem 0.75rem;">
                    <div style="font-weight:700;color:#1d4ed8;font-size:0.82rem;margin-bottom:0.4rem;">Please choose a visit date and time</div>
                    <p style="font-size:0.72rem;color:#3b82f6;margin:0 0 0.5rem 0;">The admin has offered the following slots for your confirmation visit. Tap the one that works for you.</p>
                    <div style="display:flex;flex-direction:column;gap:0.4rem;">
                        ${req.visitOptions
                          .map(
                            (opt, i) => `
                        <button onclick="window.selectVisitSlot('${req.id}','${opt.date}','${opt.time}')"
                            style="background:white;border:2px solid #93c5fd;border-radius:0.375rem;padding:0.5rem 0.75rem;text-align:left;cursor:pointer;font-size:0.8rem;font-weight:600;color:#1e293b;display:flex;align-items:center;gap:0.5rem;width:100%;"
                            onmouseover="this.style.background='#dbeafe';this.style.borderColor='#3b82f6'"
                            onmouseout="this.style.background='white';this.style.borderColor='#93c5fd'">
                            <span style="background:#1d4ed8;color:white;font-size:0.65rem;font-weight:700;border-radius:999px;padding:1px 7px;flex-shrink:0;">Option ${i + 1}</span>
                            <span>${formatDate(opt.date)}</span>
                            <span style="color:#64748b;">·</span>
                            <span>${opt.time}</span>
                        </button>`,
                          )
                          .join("")}
                    </div>
                </div>`
                    : ""
                }

                <!-- ── Collapsible details ── -->
                <div id="card-details-${req.id}" style="display:none;padding:0 0.75rem 0.75rem;">
                    <hr style="border:none;border-top:1px solid #f1f5f9;margin:0 0 0.6rem;">

                    ${blockForcedBanner}

                    <!-- scheduled visit banner (user already picked) -->
                    ${
                      req.appointmentDate &&
                      req.appointmentTime &&
                      req.status !== "approved"
                        ? `
                    <div style="background:#f0fdf4;border:1.5px solid #86efac;border-radius:0.375rem;padding:0.5rem 0.7rem;margin-bottom:0.4rem;font-size:0.78rem;">
                        <div style="font-weight:700;color:#166534;margin-bottom:0.2rem;">Visit Scheduled</div>
                        <div style="color:#15803d;">${formatDate(req.appointmentDate)} · ${req.appointmentTime}</div>
                        <div style="font-size:0.68rem;color:#4ade80;margin-top:0.2rem;">Please visit the Administration Office at the scheduled time.</div>
                    </div>`
                        : ""
                    }

                    <!-- purpose -->
                    <div style="font-size:0.72rem;color:#475569;margin-bottom:0.5rem;">
                        <span style="font-weight:600;color:#94a3b8;text-transform:uppercase;font-size:0.62rem;letter-spacing:0.06em;">Purpose</span><br>
                        <span>${req.purpose}</span>
                    </div>

                    ${
                      req.rejectionReason
                        ? `
                    <div style="background:#fee2e2;border:1px solid #fecaca;border-radius:0.375rem;padding:0.4rem 0.6rem;margin-bottom:0.4rem;font-size:0.72rem;">
                        <span style="color:#991b1b;font-weight:700;">Rejected:</span>
                        <span style="color:#7f1d1d;margin-left:0.4rem;">${req.rejectionReason}</span>
                    </div>`
                        : ""
                    }

                    ${
                      req.cancellationReason && !isBlockForced
                        ? `
                    <div style="background:${isAdminApprovedCancellation ? "#f0fdf4" : req.blockCancelled ? "#fff1f2" : req.status === "refused" ? "#f3f4f6" : "#fef3c7"};border:1px solid ${isAdminApprovedCancellation ? "#86efac" : req.blockCancelled ? "#f87171" : req.status === "refused" ? "#d1d5db" : "#fbbf24"};border-radius:0.375rem;padding:0.4rem 0.6rem;margin-bottom:0.4rem;font-size:0.72rem;">
                        <div style="font-weight:700;color:${isAdminApprovedCancellation ? "#166534" : req.blockCancelled ? "#991b1b" : req.status === "refused" ? "#374151" : "#92400e"};margin-bottom:0.2rem;">
                            ${isAdminApprovedCancellation ? "Admin approved your cancellation request" : req.blockCancelled ? "Reservation Cancelled by Administration" : req.status === "refused" ? "Cancellation Accepted" : "Cancellation Pending"}
                        </div>
                        ${isAdminApprovedCancellation ? `<div style="font-size:0.69rem;color:#166534;margin-bottom:0.25rem;">Approved on ${formatDateTime(req.cancellationApprovedAt)}. You can now remove this entry.</div>` : ""}
                        ${req.blockCancelled ? `<div style="font-size:0.69rem;color:#b91c1c;margin-bottom:0.2rem;">${req.facilityName} &bull; ${formatDate(req.date)} &bull; ${convertTo12Hour(req.startTime)}–${convertTo12Hour(req.endTime)}</div>` : ""}
                        <div style="color:${isAdminApprovedCancellation ? "#166534" : req.blockCancelled ? "#7f1d1d" : req.status === "refused" ? "#4b5563" : "#78350f"};">
                            <strong>Reason:</strong> ${req.cancellationReason.replace("Facility blocked by administration: ", "")}
                        </div>
                        ${req.blockCancelled ? '<div style="margin-top:0.3rem;font-size:0.7rem;color:#b91c1c;">Contact the Administration Office to reschedule.</div>' : ""}
                    </div>`
                        : ""
                    }

                    ${
                      req.adminRescheduleNote
                        ? `
                    <div style="background:#f8fafc;border:1px solid #cbd5e1;border-radius:0.375rem;padding:0.45rem 0.6rem;margin-bottom:0.4rem;font-size:0.72rem;">
                        <div style="font-weight:700;color:#475569;margin-bottom:0.2rem;">Admin Note</div>
                        <div style="color:#334155;white-space:pre-wrap;">${req.adminRescheduleNote}</div>
                    </div>`
                        : ""
                    }
                    ${req.adminEditSnapshot ? this.renderEditBanner(req.adminEditSnapshot) : ""}
                    ${req.userEditSnapshot ? this.renderUserEditBanner(req.userEditSnapshot) : ""}

                    <!-- footer -->
                    <div style="padding-top:0.4rem;border-top:1px solid #f1f5f9;display:flex;justify-content:space-between;align-items:center;margin-top:0.4rem;">
                        <span style="font-size:0.65rem;color:#94a3b8;">
                            ${req.submittedAt ? formatDateTime(req.submittedAt) : ""}
                        </span>
                        ${
                          canRemove
                            ? `
                        <button onclick="window.removeRequest('${req.id}')"
                            style="background:#f1f5f9;color:#64748b;border:1px solid #e2e8f0;padding:0.3rem 0.6rem;border-radius:0.375rem;font-size:0.72rem;font-weight:600;cursor:pointer;"
                            onmouseover="this.style.background='#fee2e2';this.style.color='#991b1b'" onmouseout="this.style.background='#f1f5f9';this.style.color='#64748b'">
                            Remove
                        </button>`
                            : ""
                        }
                    </div>
                </div>
            </div>
        `;
  }
}
